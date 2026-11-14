import {
  ArcticFetchError,
  Google,
  OAuth2RequestError,
  OAuth2Tokens,
  decodeIdToken,
  generateCodeVerifier,
  generateState,
} from "arctic";
import { eq } from "drizzle-orm";
import { decrypt, encrypt } from "@/server/crypto";
import type { Db } from "@/server/db/client";
import { googleAccounts, type GoogleAccountRow } from "@/server/db/schema";
import { getEnv } from "@/server/env";
import { readCookie, serializeCookie } from "./http";

// Google OAuth for three separate flows:
//   login    — identity only (openid/email/profile). Proves who is signing in; stores no tokens.
//   personal — the personal calendar (read + write events). Saved as googleAccounts role 'personal'.
//   work     — the work calendar, read-only. Saved as googleAccounts role 'work'.
// Every flow uses PKCE + a state cookie. Tokens are stored encrypted (AES-256-GCM).

export type GoogleRole = "personal" | "work";
export type OAuthFlow = "login" | GoogleRole;

export const LOGIN_SCOPES = ["openid", "email", "profile"] as const;
export const PERSONAL_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
] as const;
/** Read-only. The app never asks the work account for any write scope. */
export const WORK_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.readonly"] as const;

export const OAUTH_CALLBACK_PATHS: Record<OAuthFlow, string> = {
  login: "/api/auth/callback/google",
  personal: "/api/connect/personal/callback",
  work: "/api/connect/work/callback",
};

interface FlowConfig {
  scopes: readonly string[];
  offline: boolean;
  cookie: string;
}

const FLOWS: Record<OAuthFlow, FlowConfig> = {
  login: { scopes: LOGIN_SCOPES, offline: false, cookie: "drs_oauth_login" },
  personal: { scopes: PERSONAL_SCOPES, offline: true, cookie: "drs_oauth_personal" },
  work: { scopes: WORK_SCOPES, offline: true, cookie: "drs_oauth_work" },
};

const STATE_MAX_AGE_SECONDS = 10 * 60;
/** Refresh access tokens this long before they expire. */
const REFRESH_SKEW_MS = 60 * 1000;

/**
 * Errors Google reports when a Workspace admin blocks the app for the account
 * (`access_denied` is also what a cancelled consent looks like; both are shown
 * the same guidance).
 */
const ORG_POLICY_ERRORS = new Set(["admin_policy_enforced", "org_internal", "access_denied"]);

export function isOrgPolicyError(code: string): boolean {
  return ORG_POLICY_ERRORS.has(code);
}

function googleClient(flow: OAuthFlow): Google {
  const env = getEnv();
  return new Google(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, `${env.APP_URL}${OAUTH_CALLBACK_PATHS[flow]}`);
}

// ---------------------------------------------------------------------------
// Starting and finishing a flow
// ---------------------------------------------------------------------------

/**
 * The Google authorization URL for `flow` and the Set-Cookie value that
 * remembers its state + PKCE verifier for the callback.
 *
 * - login: `prompt=select_account`, online access only.
 * - personal/work: `access_type=offline` + `prompt=select_account consent`.
 *   consent makes Google always return a refresh token; select_account shows
 *   the account chooser, because the browser's active Google account is often
 *   the other one (personal vs work).
 */
export function beginGoogleOAuth(flow: OAuthFlow): { url: URL; cookie: string } {
  const config = FLOWS[flow];
  const state = generateState();
  const verifier = generateCodeVerifier();
  const url = googleClient(flow).createAuthorizationURL(state, verifier, [...config.scopes]);
  if (config.offline) {
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "select_account consent");
  } else {
    url.searchParams.set("prompt", "select_account");
  }
  return { url, cookie: serializeCookie(config.cookie, `${state}.${verifier}`, STATE_MAX_AGE_SECONDS) };
}

export interface GoogleIdentity {
  email: string;
  emailVerified: boolean;
}

export type OAuthCallbackResult =
  | { ok: true; tokens: OAuth2Tokens; identity: GoogleIdentity; clearCookie: string }
  | {
      ok: false;
      /** Google's error code (`access_denied`, `admin_policy_enforced`, `invalid_grant`…) or `state_mismatch` / `exchange_failed` / `no_email`. */
      code: string;
      clearCookie: string;
    };

/** Validates state + PKCE, exchanges the code, and reads the signed-in Google email. Never throws. */
export async function completeGoogleOAuth(flow: OAuthFlow, req: Request): Promise<OAuthCallbackResult> {
  const config = FLOWS[flow];
  const clearCookie = serializeCookie(config.cookie, "", 0);
  const params = new URL(req.url).searchParams;

  const googleError = params.get("error");
  if (googleError) return { ok: false, code: googleError, clearCookie };

  const code = params.get("code");
  const state = params.get("state");
  const [savedState, verifier] = (readCookie(req, config.cookie) ?? "").split(".");
  if (!code || !state || !savedState || !verifier || state !== savedState) {
    return { ok: false, code: "state_mismatch", clearCookie };
  }

  let tokens: OAuth2Tokens;
  try {
    tokens = await googleClient(flow).validateAuthorizationCode(code, verifier);
  } catch (error) {
    return { ok: false, code: error instanceof OAuth2RequestError ? error.code : "exchange_failed", clearCookie };
  }

  const identity = await readIdentity(tokens);
  if (!identity) return { ok: false, code: "no_email", clearCookie };
  return { ok: true, tokens, identity, clearCookie };
}

/**
 * False when Google's granular consent let the user untick a calendar scope the
 * flow needs. (If Google does not echo scopes, assume they were granted.)
 */
export function grantedCalendarScopes(flow: GoogleRole, tokens: OAuth2Tokens): boolean {
  if (!tokens.hasScopes()) return true;
  const granted = new Set(tokens.scopes());
  return FLOWS[flow].scopes.filter((s) => s.startsWith("https://")).every((s) => granted.has(s));
}

async function readIdentity(tokens: OAuth2Tokens): Promise<GoogleIdentity | null> {
  // The id_token comes straight from Google's token endpoint over TLS, so its
  // claims can be read without verifying the signature.
  try {
    const claims = decodeIdToken(tokens.idToken()) as { email?: unknown; email_verified?: unknown };
    if (typeof claims.email === "string" && claims.email) {
      return { email: claims.email.toLowerCase(), emailVerified: claims.email_verified !== false };
    }
  } catch {
    // No id_token: fall back to the userinfo endpoint.
  }
  try {
    const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokens.accessToken()}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const info = (await res.json()) as { email?: unknown; email_verified?: unknown };
    if (typeof info.email !== "string" || !info.email) return null;
    return { email: info.email.toLowerCase(), emailVerified: info.email_verified !== false };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Stored tokens
// ---------------------------------------------------------------------------

export interface GoogleTokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  scope: string;
}

function toTokenSet(tokens: OAuth2Tokens | GoogleTokenSet): GoogleTokenSet {
  if (!(tokens instanceof OAuth2Tokens)) return tokens;
  let expiresInSeconds = 3600;
  try {
    expiresInSeconds = tokens.accessTokenExpiresInSeconds();
  } catch {
    // Google always sends expires_in; default to its usual hour if not.
  }
  return {
    accessToken: tokens.accessToken(),
    refreshToken: tokens.hasRefreshToken() ? tokens.refreshToken() : null,
    expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
    scope: tokens.hasScopes() ? tokens.scopes().join(" ") : "",
  };
}

export async function findGoogleAccount(db: Db, role: GoogleRole): Promise<GoogleAccountRow | null> {
  const [row] = await db.select().from(googleAccounts).where(eq(googleAccounts.role, role)).limit(1);
  return row ?? null;
}

/**
 * Upserts the `role` account with encrypted tokens and status 'ok'. If Google
 * sent no new refresh token, the stored one is kept (same email only).
 */
export async function saveGoogleTokens(
  db: Db,
  role: GoogleRole,
  tokens: OAuth2Tokens | GoogleTokenSet,
  email: string,
): Promise<void> {
  const set = toTokenSet(tokens);
  const normalizedEmail = email.toLowerCase();
  const existing = await findGoogleAccount(db, role);
  const refreshTokenEnc = set.refreshToken
    ? encrypt(set.refreshToken)
    : existing && existing.email === normalizedEmail
      ? existing.refreshTokenEnc
      : null;
  const values = {
    email: normalizedEmail,
    accessTokenEnc: encrypt(set.accessToken),
    refreshTokenEnc,
    expiresAt: set.expiresAt,
    scope: set.scope,
    status: "ok" as const,
    updatedAt: new Date(),
  };
  await db
    .insert(googleAccounts)
    .values({ role, ...values })
    .onConflictDoUpdate({ target: googleAccounts.role, set: values });
}

export async function markNeedsReconnect(db: Db, role: GoogleRole): Promise<void> {
  await db
    .update(googleAccounts)
    .set({ status: "needs_reconnect", updatedAt: new Date() })
    .where(eq(googleAccounts.role, role));
}

export async function deleteGoogleAccount(db: Db, role: GoogleRole): Promise<void> {
  await db.delete(googleAccounts).where(eq(googleAccounts.role, role));
}

// One refresh per (db, role) at a time: concurrent API calls share it.
const inflight = new WeakMap<Db, Map<GoogleRole, Promise<string | null>>>();

/**
 * A usable access token for `role`, or null if the account is not connected or
 * needs to be reconnected. Refreshes when the token expires within 60 seconds.
 * A refresh that Google rejects (revoked / expired grant) marks the account
 * `needs_reconnect`; a network hiccup just returns null for this call.
 */
export async function getAccessToken(db: Db, role: GoogleRole): Promise<string | null> {
  const row = await findGoogleAccount(db, role);
  if (!row || row.status !== "ok") return null;

  if (row.expiresAt.getTime() - Date.now() > REFRESH_SKEW_MS) {
    try {
      return decrypt(row.accessTokenEnc);
    } catch {
      // ENCRYPTION_KEY changed: the stored tokens are unreadable.
      await markNeedsReconnect(db, role);
      return null;
    }
  }

  const perDb = inflight.get(db) ?? new Map<GoogleRole, Promise<string | null>>();
  inflight.set(db, perDb);
  const pending = perDb.get(role);
  if (pending) return pending;
  const refresh = refreshAccessToken(db, row).finally(() => perDb.delete(role));
  perDb.set(role, refresh);
  return refresh;
}

async function refreshAccessToken(db: Db, row: GoogleAccountRow): Promise<string | null> {
  const role = row.role;
  let refreshToken: string | null = null;
  try {
    refreshToken = row.refreshTokenEnc ? decrypt(row.refreshTokenEnc) : null;
  } catch {
    refreshToken = null;
  }
  if (!refreshToken) {
    await markNeedsReconnect(db, role);
    return null;
  }

  let refreshed: GoogleTokenSet;
  try {
    refreshed = toTokenSet(await googleClient(role).refreshAccessToken(refreshToken));
  } catch (error) {
    const transient = error instanceof ArcticFetchError || !(error instanceof OAuth2RequestError);
    if (!transient) await markNeedsReconnect(db, role);
    return null;
  }

  await db
    .update(googleAccounts)
    .set({
      accessTokenEnc: encrypt(refreshed.accessToken),
      // Google usually keeps the same refresh token; store a rotated one if sent.
      refreshTokenEnc: refreshed.refreshToken ? encrypt(refreshed.refreshToken) : row.refreshTokenEnc,
      expiresAt: refreshed.expiresAt,
      scope: refreshed.scope || row.scope,
      status: "ok",
      updatedAt: new Date(),
    })
    .where(eq(googleAccounts.role, role));
  return refreshed.accessToken;
}

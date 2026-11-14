import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as callbackGET } from "@/app/api/auth/callback/google/route";
import { GET as devLoginGET } from "@/app/api/auth/dev-login/route";
import { GET as loginGET } from "@/app/api/auth/login/route";
import { POST as logoutPOST } from "@/app/api/auth/logout/route";
import { GET as personalCallbackGET } from "@/app/api/connect/personal/callback/route";
import { GET as personalStartGET } from "@/app/api/connect/personal/route";
import { readSession, sessionCookieFor } from "@/server/auth/session";
import { decrypt } from "@/server/crypto";
import type { Db } from "@/server/db/client";
import { googleAccounts, settings } from "@/server/db/schema";
import { createTestDb } from "@/server/db/test-db";
import { setTestEnv } from "@/server/env";
import { PERSONAL_SCOPES, findGoogleAccount, getAccessToken } from "./google-oauth";
import {
  fakeIdToken,
  isTokenEndpoint,
  jsonResponse,
  mockGoogleFetch,
  seedGoogleAccount,
  tokenEndpointResponse,
} from "./test-google";

const APP = "http://localhost:3000";

let db: Db;
let session: string;

beforeEach(async () => {
  setTestEnv();
  db = await createTestDb();
  session = await sessionCookieFor();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function setCookies(res: Response): string[] {
  return res.headers.getSetCookie();
}

function sessionFromSetCookie(res: Response): string | undefined {
  return setCookies(res)
    .map((c) => c.split(";")[0])
    .find((c) => c.startsWith("drs=") && c.length > "drs=".length);
}

/** Google's token endpoint answering with an id_token for `email`. */
function mockTokenExchange(email: string, extra: Record<string, unknown> = {}) {
  return mockGoogleFetch((call) => {
    if (isTokenEndpoint(call)) {
      return tokenEndpointResponse({ id_token: fakeIdToken({ email, email_verified: true }), ...extra });
    }
  });
}

function loginCallback(query: string, oauthCookie = "drs_oauth_login=st4te.v3rifier") {
  return callbackGET(new Request(`${APP}/api/auth/callback/google?${query}`, { headers: { cookie: oauthCookie } }));
}

describe("login", () => {
  it("redirects to Google with identity-only scopes, PKCE and a state cookie", async () => {
    const res = await loginGET();
    expect(res.status).toBe(302);
    const url = new URL(res.headers.get("location")!);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("prompt")).toBe("select_account");
    expect(url.searchParams.get("access_type")).toBeNull();
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(`${APP}/api/auth/callback/google`);
    const state = url.searchParams.get("state")!;
    const cookie = setCookies(res).find((c) => c.startsWith("drs_oauth_login="))!;
    expect(cookie).toContain(`drs_oauth_login=${state}.`);
    expect(cookie).toContain("HttpOnly");
  });

  it("callback rejects email not equal ALLOWED_EMAIL with 403 page", async () => {
    mockTokenExchange("stranger@example.com");
    const res = await loginCallback("code=c0de&state=st4te");
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("허용되지 않은 계정이에요.");
    expect(html).toContain("stranger@example.com");
    expect(sessionFromSetCookie(res)).toBeUndefined();
  });

  it("callback accepts the primary email in any case and redirects to /today", async () => {
    const google = mockTokenExchange("Me@Example.com");
    const res = await loginCallback("code=c0de&state=st4te");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${APP}/today`);
    const sessionCookie = sessionFromSetCookie(res)!;
    expect(await readSession(new Request(APP, { headers: { cookie: sessionCookie } }))).toEqual({
      email: "me@example.com",
    });
    // PKCE verifier from the cookie is sent to Google.
    expect(new URLSearchParams(google.calls[0].body!).get("code_verifier")).toBe("v3rifier");
  });

  it("callback accepts backup email in ALLOWED_EMAIL list", async () => {
    setTestEnv({ ALLOWED_EMAIL: "me@example.com, Me@Company.com" });
    mockTokenExchange("me@company.com");
    const res = await loginCallback("code=c0de&state=st4te");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${APP}/today`);
    expect(sessionFromSetCookie(res)).toBeDefined();
  });

  it("login callback does not store calendar tokens", async () => {
    mockTokenExchange("me@example.com", { refresh_token: "should-not-be-kept" });
    const res = await loginCallback("code=c0de&state=st4te");
    expect(res.status).toBe(302);
    expect(await db.select().from(googleAccounts)).toHaveLength(0);
  });

  it("org policy error at login shows personal-login page", async () => {
    for (const error of ["admin_policy_enforced", "org_internal", "access_denied"]) {
      const google = mockGoogleFetch(() => undefined);
      const res = await loginCallback(`error=${error}&state=st4te`);
      expect(res.status).toBe(403);
      const html = await res.text();
      expect(html).toContain("이 계정으로는 로그인할 수 없게 막혀 있어요.");
      expect(html).toContain("다른 허용된 Google 계정으로 로그인해 주세요.");
      expect(html).toContain('href="/api/auth/login"');
      expect(sessionFromSetCookie(res)).toBeUndefined();
      expect(google.calls).toHaveLength(0);
    }
  });

  it("callback with a mismatched state goes back to /login without calling Google", async () => {
    const google = mockGoogleFetch(() => undefined);
    const res = await loginCallback("code=c0de&state=other");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${APP}/login?error=state`);
    expect(google.calls).toHaveLength(0);
  });

  it("logout clears the session cookie", async () => {
    const res = await logoutPOST();
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${APP}/login`);
    expect(setCookies(res).some((c) => c.startsWith("drs=;") && c.includes("Max-Age=0"))).toBe(true);
  });
});

describe("dev login", () => {
  it("is 404 unless DEV_LOGIN=1", async () => {
    const res = await devLoginGET();
    expect(res.status).toBe(404);
    expect(sessionFromSetCookie(res)).toBeUndefined();
  });

  it("signs in as the primary ALLOWED_EMAIL when enabled", async () => {
    setTestEnv({ DEV_LOGIN: "1", ALLOWED_EMAIL: "me@example.com, me@company.com" });
    const res = await devLoginGET();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${APP}/today`);
    const sessionCookie = sessionFromSetCookie(res)!;
    expect(await readSession(new Request(APP, { headers: { cookie: sessionCookie } }))).toEqual({
      email: "me@example.com",
    });
  });
});

describe("personal calendar connect", () => {
  it("requires a session", async () => {
    expect((await personalStartGET(new Request(`${APP}/api/connect/personal`))).status).toBe(401);
  });

  it("redirects to Google with calendar scopes, offline access and consent", async () => {
    const res = await personalStartGET(new Request(`${APP}/api/connect/personal`, { headers: { cookie: session } }));
    expect(res.status).toBe(302);
    const url = new URL(res.headers.get("location")!);
    expect(url.searchParams.get("scope")).toBe(PERSONAL_SCOPES.join(" "));
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toContain("consent");
    expect(url.searchParams.get("prompt")).toContain("select_account");
    expect(url.searchParams.get("login_hint")).toBeNull();
    expect(url.searchParams.get("redirect_uri")).toBe(`${APP}/api/connect/personal/callback`);
    expect(setCookies(res).some((c) => c.startsWith("drs_oauth_personal="))).toBe(true);
  });

  it("personal connect saves personal role tokens", async () => {
    mockTokenExchange("Any.Account@gmail.com", {
      access_token: "personal-at",
      refresh_token: "personal-rt",
      scope: PERSONAL_SCOPES.join(" "),
    });
    const res = await personalCallbackGET(
      new Request(`${APP}/api/connect/personal/callback?code=c0de&state=st4te`, {
        headers: { cookie: `${session}; drs_oauth_personal=st4te.v3rifier` },
      }),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${APP}/settings?personal=connected`);
    const row = (await findGoogleAccount(db, "personal"))!;
    expect(row.email).toBe("any.account@gmail.com");
    expect(row.status).toBe("ok");
    expect(row.accessTokenEnc).not.toContain("personal-at");
    expect(decrypt(row.accessTokenEnc)).toBe("personal-at");
    expect(decrypt(row.refreshTokenEnc!)).toBe("personal-rt");
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now() + 50 * 60 * 1000);
    expect(await findGoogleAccount(db, "work")).toBeNull();
  });

  it("refuses to use the connected work account as the personal calendar", async () => {
    await seedGoogleAccount(db, "work", { email: "me@company.com" });
    mockTokenExchange("me@company.com", { refresh_token: "rt" });
    const res = await personalCallbackGET(
      new Request(`${APP}/api/connect/personal/callback?code=c0de&state=st4te`, {
        headers: { cookie: `${session}; drs_oauth_personal=st4te.v3rifier` },
      }),
    );
    expect(res.headers.get("location")).toBe(`${APP}/settings?personal=work_account`);
    expect(await findGoogleAccount(db, "personal")).toBeNull();
  });

  it("refuses the shared work calendar's account as the personal calendar", async () => {
    // Shared-calendar mode: no work tokens are stored, only the shared calendar id.
    await db.update(settings).set({ workCalendarVia: "personal_shared", workCalendarId: "Me@Company.com" });
    mockTokenExchange("me@company.com", { refresh_token: "rt" });
    const res = await personalCallbackGET(
      new Request(`${APP}/api/connect/personal/callback?code=c0de&state=st4te`, {
        headers: { cookie: `${session}; drs_oauth_personal=st4te.v3rifier` },
      }),
    );
    expect(res.headers.get("location")).toBe(`${APP}/settings?personal=work_account`);
    expect(await findGoogleAccount(db, "personal")).toBeNull();
  });

  it("a cancelled consent goes back to settings with an error flag", async () => {
    mockGoogleFetch(() => undefined);
    const res = await personalCallbackGET(
      new Request(`${APP}/api/connect/personal/callback?error=access_denied&state=st4te`, {
        headers: { cookie: `${session}; drs_oauth_personal=st4te.v3rifier` },
      }),
    );
    expect(res.headers.get("location")).toBe(`${APP}/settings?personal=error`);
  });
});

describe("getAccessToken", () => {
  it("returns the stored token while it is fresh, without calling Google", async () => {
    await seedGoogleAccount(db, "personal", { accessToken: "fresh-token", expiresInMs: 10 * 60 * 1000 });
    const google = mockGoogleFetch(() => undefined);
    expect(await getAccessToken(db, "personal")).toBe("fresh-token");
    expect(google.calls).toHaveLength(0);
  });

  it("returns null when the role is not connected", async () => {
    expect(await getAccessToken(db, "work")).toBeNull();
  });

  it("getAccessToken refreshes when expiring and stores new token", async () => {
    await seedGoogleAccount(db, "work", { accessToken: "old", refreshToken: "work-rt", expiresInMs: 30 * 1000 });
    const google = mockGoogleFetch((call) => {
      if (isTokenEndpoint(call)) return tokenEndpointResponse({ access_token: "refreshed", expires_in: 3600 });
    });
    expect(await getAccessToken(db, "work")).toBe("refreshed");
    const body = new URLSearchParams(google.calls[0].body!);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("work-rt");
    const row = (await findGoogleAccount(db, "work"))!;
    expect(decrypt(row.accessTokenEnc)).toBe("refreshed");
    expect(decrypt(row.refreshTokenEnc!)).toBe("work-rt");
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now() + 50 * 60 * 1000);
    // Fresh now: no second refresh.
    expect(await getAccessToken(db, "work")).toBe("refreshed");
    expect(google.calls).toHaveLength(1);
  });

  it("refresh failure marks needs_reconnect", async () => {
    await seedGoogleAccount(db, "personal", { expiresInMs: -5 * 60 * 1000 });
    mockGoogleFetch((call) => {
      if (isTokenEndpoint(call)) return jsonResponse({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400);
    });
    expect(await getAccessToken(db, "personal")).toBeNull();
    expect((await findGoogleAccount(db, "personal"))!.status).toBe("needs_reconnect");
    // Stays disconnected without retrying Google.
    const again = mockGoogleFetch(() => undefined);
    expect(await getAccessToken(db, "personal")).toBeNull();
    expect(again.calls).toHaveLength(0);
  });

  it("a network error during refresh returns null but keeps the account connected", async () => {
    await seedGoogleAccount(db, "personal", { expiresInMs: 10 * 1000 });
    mockGoogleFetch(() => {
      throw new TypeError("fetch failed");
    });
    expect(await getAccessToken(db, "personal")).toBeNull();
    expect((await findGoogleAccount(db, "personal"))!.status).toBe("ok");
  });

  it("missing refresh token marks needs_reconnect", async () => {
    await seedGoogleAccount(db, "work", { refreshToken: null, expiresInMs: 0 });
    const google = mockGoogleFetch(() => undefined);
    expect(await getAccessToken(db, "work")).toBeNull();
    expect((await findGoogleAccount(db, "work"))!.status).toBe("needs_reconnect");
    expect(google.calls).toHaveLength(0);
  });
});

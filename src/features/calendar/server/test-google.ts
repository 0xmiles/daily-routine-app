// Test-only helpers for mocking Google (OAuth token endpoint + Calendar API).
// Never import from app code.
import { vi } from "vitest";
import { encrypt } from "@/server/crypto";
import type { Db } from "@/server/db/client";
import { googleAccounts } from "@/server/db/schema";

export interface RecordedCall {
  method: string;
  url: URL;
  body: string | null;
  /** The Authorization header, e.g. 'Bearer personal-access-token'. */
  auth: string | null;
}

type Handler = (call: RecordedCall) => Response | Promise<Response> | undefined | Promise<undefined>;

/**
 * Replaces global fetch. `handler` returns a Response for the calls it knows;
 * any other call throws, so unexpected Google traffic fails the test loudly.
 */
export function mockGoogleFetch(handler: Handler) {
  const calls: RecordedCall[] = [];
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const body = req.method === "GET" || req.method === "HEAD" ? null : await req.clone().text();
    const call: RecordedCall = { method: req.method, url: new URL(req.url), body, auth: req.headers.get("authorization") };
    calls.push(call);
    const res = await handler(call);
    if (!res) throw new Error(`Unmocked fetch: ${call.method} ${call.url.href}`);
    return res;
  });
  vi.stubGlobal("fetch", spy);
  return {
    calls,
    spy,
    /** Every call that is not a GET (inserts, patches, deletes, token posts…). */
    nonGetCalls: () => calls.filter((c) => c.method !== "GET"),
    calendarCalls: () => calls.filter((c) => c.url.hostname === "www.googleapis.com"),
  };
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

export function googleError(status: number, reason: string): Response {
  return jsonResponse({ error: { code: status, message: reason, errors: [{ reason, message: reason }] } }, status);
}

/** An unsigned id_token carrying `claims` (arctic only decodes it). */
export function fakeIdToken(claims: Record<string, unknown>): string {
  const part = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  return `${part({ alg: "RS256", typ: "JWT" })}.${part(claims)}.${Buffer.from("sig").toString("base64url")}`;
}

export function tokenEndpointResponse(fields: Record<string, unknown> = {}): Response {
  return jsonResponse({
    access_token: "new-access-token",
    expires_in: 3599,
    token_type: "Bearer",
    scope: "openid email",
    ...fields,
  });
}

export const isTokenEndpoint = (c: RecordedCall) =>
  c.method === "POST" && c.url.href === "https://oauth2.googleapis.com/token";

/** Inserts a googleAccounts row with a token valid for an hour (unless overridden). */
export async function seedGoogleAccount(
  db: Db,
  role: "personal" | "work",
  opts: { email?: string; accessToken?: string; refreshToken?: string | null; expiresInMs?: number; status?: "ok" | "needs_reconnect" } = {},
) {
  const refreshToken = opts.refreshToken === undefined ? `${role}-refresh-token` : opts.refreshToken;
  await db.insert(googleAccounts).values({
    role,
    email: opts.email ?? (role === "personal" ? "me@example.com" : "me@company.com"),
    accessTokenEnc: encrypt(opts.accessToken ?? `${role}-access-token`),
    refreshTokenEnc: refreshToken ? encrypt(refreshToken) : null,
    expiresAt: new Date(Date.now() + (opts.expiresInMs ?? 60 * 60 * 1000)),
    scope: "",
    status: opts.status ?? "ok",
  });
}

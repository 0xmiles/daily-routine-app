import { afterEach, describe, expect, it, vi } from "vitest";
import { setTestEnv } from "@/server/env";
import {
  SESSION_COOKIE,
  UnauthorizedError,
  clearSessionCookie,
  createSessionCookie,
  readSession,
  requireUser,
  sessionCookieFor,
  withUser,
} from "./session";

const URL_BASE = "http://localhost:3000/api/test";

function reqWithCookie(cookie?: string): Request {
  return new Request(URL_BASE, cookie ? { headers: { cookie } } : undefined);
}

/** Turns a Set-Cookie value into a Cookie header value. */
function toCookieHeader(setCookie: string): string {
  return setCookie.split(";")[0];
}

afterEach(() => {
  vi.useRealTimers();
  setTestEnv();
});

describe("session", () => {
  it("createSessionCookie returns a drs Set-Cookie (httpOnly, lax, 180 days, not secure outside prod)", async () => {
    const setCookie = await createSessionCookie("me@example.com");
    expect(SESSION_COOKIE).toBe("drs");
    expect(setCookie).toMatch(/^drs=[\w-]+\.[\w-]+\.[\w-]+;/);
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain(`Max-Age=${180 * 24 * 60 * 60}`);
    expect(setCookie).not.toContain("Secure");
  });

  it("readSession reads the cookie from a Request", async () => {
    const cookie = toCookieHeader(await createSessionCookie("me@example.com"));
    expect(await readSession(reqWithCookie(`other=1; ${cookie}; x=y`))).toEqual({ email: "me@example.com" });
  });

  it("readSession returns null without a cookie or with garbage", async () => {
    expect(await readSession(reqWithCookie())).toBeNull();
    expect(await readSession(reqWithCookie("drs=garbage"))).toBeNull();
  });

  it("expired cookie returns null", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const cookie = await sessionCookieFor("me@example.com");
    vi.setSystemTime(new Date("2026-06-29T23:59:00Z")); // 179 days later: still valid
    expect(await readSession(reqWithCookie(cookie))).toEqual({ email: "me@example.com" });
    vi.setSystemTime(new Date("2026-07-01T00:00:01Z")); // > 180 days later
    expect(await readSession(reqWithCookie(cookie))).toBeNull();
  });

  it("cookie signed with another secret returns null", async () => {
    const cookie = await sessionCookieFor("me@example.com");
    setTestEnv({ AUTH_SECRET: "a-completely-different-secret-of-32+chars" });
    expect(await readSession(reqWithCookie(cookie))).toBeNull();
  });

  it("requireUser throws for a session of a different email", async () => {
    const cookie = await sessionCookieFor("intruder@example.com");
    await expect(requireUser(reqWithCookie(cookie))).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("requireUser throws without a session and returns the allowed user otherwise", async () => {
    await expect(requireUser(reqWithCookie())).rejects.toBeInstanceOf(UnauthorizedError);
    const cookie = await sessionCookieFor("Me@Example.com");
    expect(await requireUser(reqWithCookie(cookie))).toEqual({ email: "me@example.com" });
  });

  it("requireUser accepts every address in ALLOWED_EMAIL", async () => {
    setTestEnv({ ALLOWED_EMAIL: "work@company.com,me@gmail.com" });
    const backup = await sessionCookieFor("me@gmail.com");
    expect(await requireUser(reqWithCookie(backup))).toEqual({ email: "me@gmail.com" });
    const stranger = await sessionCookieFor("someone@gmail.com");
    await expect(requireUser(reqWithCookie(stranger))).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("sessionCookieFor defaults to ALLOWED_EMAIL", async () => {
    setTestEnv({ ALLOWED_EMAIL: "owner@example.com" });
    const cookie = await sessionCookieFor();
    expect(cookie.startsWith("drs=")).toBe(true);
    expect(await requireUser(reqWithCookie(cookie))).toEqual({ email: "owner@example.com" });
  });

  it("clearSessionCookie expires the cookie", () => {
    expect(clearSessionCookie()).toMatch(/^drs=;.*Max-Age=0/);
  });
});

describe("withUser", () => {
  const GET = withUser(async (req, user, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    return Response.json({ email: user.email, id, url: new URL(req.url).pathname });
  });
  const ctx = { params: Promise.resolve({ id: "abc" }) };

  it("returns 401 problem without a session", async () => {
    const res = await GET(reqWithCookie(), ctx);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ message: "로그인이 필요해요." });
  });

  it("returns 401 for a non-allowed email", async () => {
    const res = await GET(reqWithCookie(await sessionCookieFor("intruder@example.com")), ctx);
    expect(res.status).toBe(401);
  });

  it("passes the user and route context through", async () => {
    const res = await GET(reqWithCookie(await sessionCookieFor()), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: "me@example.com", id: "abc", url: "/api/test" });
  });

  it("maps UnauthorizedError thrown inside the handler to 401 and rethrows others", async () => {
    const cookie = await sessionCookieFor();
    const unauthorized = withUser(async () => {
      throw new UnauthorizedError("nope");
    });
    expect((await unauthorized(reqWithCookie(cookie))).status).toBe(401);
    const boom = withUser(async () => {
      throw new Error("boom");
    });
    await expect(boom(reqWithCookie(cookie))).rejects.toThrow("boom");
  });
});

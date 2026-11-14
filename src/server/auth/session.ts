import { SignJWT, jwtVerify } from "jose";
import { getEnv, isAllowedEmail } from "@/server/env";
import { problem } from "@/shared/http";

// Session = HS256 JWT `{ email }` in the `drs` cookie, valid for 180 days.
//
// Route handlers: wrap with `withUser`, which reads the cookie from the Request
// (no Next runtime needed, so handlers are testable by calling them directly):
//
//   export const GET = withUser(async (req, user) => json({ email: user.email }));
//   export const PATCH = withUser(async (req, user, ctx: RouteContext<'/api/todos/[id]'>) => {
//     const { id } = await ctx.params; ...
//   });
//
// Server components / pages: `await readSession()` or `await requireUser()`
// without arguments read the cookie via `next/headers`.

export const SESSION_COOKIE = "drs";
const MAX_AGE_SECONDS = 180 * 24 * 60 * 60;
const ALG = "HS256";

export interface SessionUser {
  email: string;
}

export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(getEnv().AUTH_SECRET);
}

function cookieAttributes(maxAge: number): string {
  const attrs = ["Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`];
  if (process.env.NODE_ENV === "production") attrs.push("Secure");
  return attrs.join("; ");
}

async function signSession(email: string): Promise<string> {
  return new SignJWT({ email: email.toLowerCase() })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secretKey());
}

/** A `Set-Cookie` header value that logs `email` in for 180 days. */
export async function createSessionCookie(email: string): Promise<string> {
  return `${SESSION_COOKIE}=${await signSession(email)}; ${cookieAttributes(MAX_AGE_SECONDS)}`;
}

/** A `Set-Cookie` header value that logs out (expires the session cookie). */
export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; ${cookieAttributes(0)}`;
}

function cookieFromHeader(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

async function tokenFrom(req?: Request): Promise<string | undefined> {
  if (req) return cookieFromHeader(req.headers.get("cookie"), SESSION_COOKIE);
  const { cookies } = await import("next/headers");
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

/**
 * The signed-in session, or null if there is no cookie, it is invalid, or it
 * has expired. Does NOT check ALLOWED_EMAIL — use `requireUser` for that.
 * Pass `req` in route handlers/tests; omit it in server components.
 */
export async function readSession(req?: Request): Promise<SessionUser | null> {
  const token = await tokenFrom(req);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: [ALG] });
    return typeof payload.email === "string" ? { email: payload.email } : null;
  } catch {
    return null;
  }
}

/** The signed-in allowed user. Throws `UnauthorizedError` otherwise. */
export async function requireUser(req?: Request): Promise<SessionUser> {
  const session = await readSession(req);
  if (!session) throw new UnauthorizedError("No valid session");
  const email = session.email.toLowerCase();
  if (!isAllowedEmail(email)) throw new UnauthorizedError("Email is not allowed");
  return { email };
}

/**
 * Route handler wrapper. Responds 401 `{ message: '로그인이 필요해요.' }` unless
 * the request carries a session for ALLOWED_EMAIL. Extra route arguments (the
 * `{ params }` context of dynamic routes) are passed through unchanged.
 */
export function withUser<T extends unknown[]>(
  handler: (req: Request, user: SessionUser, ...rest: T) => Promise<Response>,
): (req: Request, ...rest: T) => Promise<Response> {
  return async (req: Request, ...rest: T): Promise<Response> => {
    try {
      const user = await requireUser(req);
      return await handler(req, user, ...rest);
    } catch (error) {
      if (error instanceof UnauthorizedError) return problem(401, "로그인이 필요해요.");
      throw error;
    }
  };
}

// ---------------------------------------------------------------------------
// Test helper
// ---------------------------------------------------------------------------

/**
 * A `Cookie` request-header value (`drs=<jwt>`) for a valid session.
 * Defaults to ALLOWED_EMAIL, i.e. a request that passes `withUser`.
 *
 *   const cookie = await sessionCookieFor();
 *   const res = await GET(new Request('http://localhost/api/todos?view=today', { headers: { cookie } }));
 */
export async function sessionCookieFor(email: string = getEnv().ALLOWED_EMAIL): Promise<string> {
  return `${SESSION_COOKIE}=${await signSession(email)}`;
}

import { UnauthorizedError, requireUser, type SessionUser } from "@/server/auth/session";
import { getEnv } from "@/server/env";

// Small cookie/redirect helpers for the OAuth route handlers.

/** A `Set-Cookie` value: HttpOnly, SameSite=Lax (Google's redirect back is a top-level GET), Secure in production. */
export function serializeCookie(name: string, value: string, maxAgeSeconds: number): string {
  const attrs = [`${name}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSeconds}`];
  if (process.env.NODE_ENV === "production") attrs.push("Secure");
  return attrs.join("; ");
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/** Redirect to an app path (resolved against APP_URL) or an absolute URL, setting each cookie. */
export function redirectTo(location: string | URL, opts: { cookies?: string[]; status?: 302 | 303 } = {}): Response {
  const headers = new Headers({ Location: new URL(location, getEnv().APP_URL).toString(), "Cache-Control": "no-store" });
  for (const cookie of opts.cookies ?? []) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: opts.status ?? 302, headers });
}

/** The signed-in allowed user, or null (for navigation routes that redirect instead of answering 401). */
export async function userOrNull(req: Request): Promise<SessionUser | null> {
  try {
    return await requireUser(req);
  } catch (error) {
    if (error instanceof UnauthorizedError) return null;
    throw error;
  }
}

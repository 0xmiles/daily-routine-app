import { clearSessionCookie } from "@/server/auth/session";
import { redirectTo } from "@/features/calendar/server/http";

// POST /api/auth/logout → clears the session and goes to /login (303).
// Connected calendars stay connected; signing in again picks them up.
export async function POST(): Promise<Response> {
  return redirectTo("/login", { cookies: [clearSessionCookie()], status: 303 });
}

import { beginGoogleOAuth } from "@/features/calendar/server/google-oauth";
import { redirectTo } from "@/features/calendar/server/http";

// GET /api/auth/login → Google sign-in (identity only: openid, email, profile).
// Calendars are connected separately in 설정.
export async function GET(): Promise<Response> {
  const { url, cookie } = beginGoogleOAuth("login");
  return redirectTo(url, { cookies: [cookie] });
}

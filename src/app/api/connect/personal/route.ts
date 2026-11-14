import { withUser } from "@/server/auth/session";
import { beginGoogleOAuth } from "@/features/calendar/server/google-oauth";
import { redirectTo } from "@/features/calendar/server/http";

// GET /api/connect/personal → Google consent for the personal calendar
// (calendar.events + calendar.readonly, offline). Any Google account may be
// chosen; the user is already signed in.
export const GET = withUser(async () => {
  const { url, cookie } = beginGoogleOAuth("personal");
  return redirectTo(url, { cookies: [cookie] });
});

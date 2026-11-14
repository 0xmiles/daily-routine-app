import { withUser } from "@/server/auth/session";
import { beginGoogleOAuth } from "@/features/calendar/server/google-oauth";
import { redirectTo } from "@/features/calendar/server/http";

// GET /api/connect/work → Google consent for the work calendar, read-only
// (calendar.readonly). No write scope is ever requested for the work account.
export const GET = withUser(async () => {
  const { url, cookie } = beginGoogleOAuth("work");
  return redirectTo(url, { cookies: [cookie] });
});

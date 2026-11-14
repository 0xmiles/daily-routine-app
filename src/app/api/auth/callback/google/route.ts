import { createSessionCookie } from "@/server/auth/session";
import { isAllowedEmail } from "@/server/env";
import { completeGoogleOAuth, isOrgPolicyError } from "@/features/calendar/server/google-oauth";
import { redirectTo } from "@/features/calendar/server/http";
import { loginBlockedPage, notAllowedPage } from "@/features/calendar/server/pages";

// GET /api/auth/callback/google — finishes sign-in. Only proves identity: it
// sets the session for an allowed email and stores no Google tokens.
export async function GET(req: Request): Promise<Response> {
  const result = await completeGoogleOAuth("login", req);
  if (!result.ok) {
    if (isOrgPolicyError(result.code)) return loginBlockedPage([result.clearCookie]);
    const reason = result.code === "state_mismatch" ? "state" : "google";
    return redirectTo(`/login?error=${reason}`, { cookies: [result.clearCookie] });
  }

  const { email, emailVerified } = result.identity;
  if (!emailVerified || !isAllowedEmail(email)) return notAllowedPage(email, [result.clearCookie]);

  return redirectTo("/today", { cookies: [result.clearCookie, await createSessionCookie(email)] });
}

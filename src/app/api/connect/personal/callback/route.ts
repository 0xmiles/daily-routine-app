import { getDb } from "@/server/db/client";
import { connectPersonalAccount, isKnownWorkIdentity } from "@/features/calendar/server/connections";
import { completeGoogleOAuth, grantedCalendarScopes } from "@/features/calendar/server/google-oauth";
import { redirectTo, userOrNull } from "@/features/calendar/server/http";

// GET /api/connect/personal/callback → saves the personal calendar tokens and
// returns to /settings?personal=connected | error | scope | work_account.
export async function GET(req: Request): Promise<Response> {
  if (!(await userOrNull(req))) return redirectTo("/login");

  const result = await completeGoogleOAuth("personal", req);
  const back = (flag: string) => redirectTo(`/settings?personal=${flag}`, { cookies: [result.clearCookie] });
  if (!result.ok) return back("error");

  const db = getDb();
  // New events are written to this account's primary calendar, so it must never be the work account
  // (connected directly, or picked as the shared work calendar).
  if (await isKnownWorkIdentity(db, result.identity.email)) return back("work_account");
  if (!grantedCalendarScopes("personal", result.tokens)) return back("scope");

  await connectPersonalAccount(db, result.tokens, result.identity.email);
  return back("connected");
}

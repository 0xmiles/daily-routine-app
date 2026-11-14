import { getDb } from "@/server/db/client";
import { connectWorkAccount } from "@/features/calendar/server/connections";
import {
  completeGoogleOAuth,
  findGoogleAccount,
  grantedCalendarScopes,
  isOrgPolicyError,
} from "@/features/calendar/server/google-oauth";
import { redirectTo, userOrNull } from "@/features/calendar/server/http";

// GET /api/connect/work/callback → saves the read-only work tokens and returns
// to /settings?work=connected | blocked | same_account | scope | error.
// `blocked` = the Workspace admin does not allow this app (admin_policy_enforced,
// org_internal, access_denied); settings then suggests the shared-calendar route.
export async function GET(req: Request): Promise<Response> {
  if (!(await userOrNull(req))) return redirectTo("/login");

  const result = await completeGoogleOAuth("work", req);
  const back = (flag: string) => redirectTo(`/settings?work=${flag}`, { cookies: [result.clearCookie] });
  if (!result.ok) return back(isOrgPolicyError(result.code) ? "blocked" : "error");

  const db = getDb();
  const personal = await findGoogleAccount(db, "personal");
  if (personal && personal.email.toLowerCase() === result.identity.email.toLowerCase()) return back("same_account");
  if (!grantedCalendarScopes("work", result.tokens)) return back("scope");

  await connectWorkAccount(db, result.tokens, result.identity.email);
  return back("connected");
}

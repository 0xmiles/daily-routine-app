import { MESSAGES, MONTH_RE } from "@/features/assets/server/http";
import { getSummary } from "@/features/assets/server/repo";
import { withUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { json, problem } from "@/shared/http";

// GET → AssetsSummary. flow is this Seoul month unless ?month=YYYY-MM is given.
export const GET = withUser(async (req) => {
  const month = new URL(req.url).searchParams.get("month");
  if (month !== null && !MONTH_RE.test(month)) return problem(400, MESSAGES.badMonth);
  return json(await getSummary(getDb(), { month: month ?? undefined }));
});

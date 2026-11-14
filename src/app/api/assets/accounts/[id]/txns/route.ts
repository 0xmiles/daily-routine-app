import { DATE_RE, MESSAGES, isUuid } from "@/features/assets/server/http";
import { findAccountRow, listTxns } from "@/features/assets/server/repo";
import { withUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { json, problem } from "@/shared/http";

// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD (Seoul dates, inclusive, both optional) → { txns: Txn[] }, oldest first.
export const GET = withUser(async (req, _user, ctx: RouteContext<"/api/assets/accounts/[id]/txns">) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return problem(404, MESSAGES.accountNotFound);

  const params = new URL(req.url).searchParams;
  const from = params.get("from") || undefined;
  const to = params.get("to") || undefined;
  if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) return problem(400, MESSAGES.badDate);

  const db = getDb();
  if (!(await findAccountRow(db, id))) return problem(404, MESSAGES.accountNotFound);
  return json({ txns: await listTxns(db, id, { from, to }) });
});

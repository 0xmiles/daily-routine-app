import { z } from "zod";
import { MESSAGES, amountSchema, isUuid, readJson } from "@/features/assets/server/http";
import { findAccountRow, setValuation } from "@/features/assets/server/repo";
import { withUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { json, problem } from "@/shared/http";

// PUT { amount } → { account }. The 투자계좌 평가금액, entered by hand; its
// entry time becomes the account's 기준 시점.
export const PUT = withUser(async (req, _user, ctx: RouteContext<"/api/assets/accounts/[id]/valuation">) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return problem(404, MESSAGES.accountNotFound);
  const body = await readJson(req, z.object({ amount: amountSchema }));
  if ("error" in body) return body.error;

  const db = getDb();
  const row = await findAccountRow(db, id);
  if (!row) return problem(404, MESSAGES.accountNotFound);
  if (row.kind !== "investment") return problem(400, MESSAGES.valuationKind);
  const account = await setValuation(db, id, body.data.amount);
  return account ? json({ account }) : problem(404, MESSAGES.accountNotFound);
});

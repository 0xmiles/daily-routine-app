import { z } from "zod";
import { MESSAGES, isUuid, readJson } from "@/features/assets/server/http";
import { setTxnTransfer } from "@/features/assets/server/repo";
import { withUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { json, problem } from "@/shared/http";

const bodySchema = z.object({
  isTransfer: z.boolean({ error: "이체 여부를 알 수 없어요. 화면을 새로 고친 뒤 다시 해 주세요." }),
});

// PATCH { isTransfer } → { txn }. A choice made here is kept: automatic
// transfer detection never overwrites it (transferOverridden).
export const PATCH = withUser(async (req, _user, ctx: RouteContext<"/api/assets/txns/[id]">) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return problem(404, MESSAGES.txnNotFound);
  const body = await readJson(req, bodySchema);
  if ("error" in body) return body.error;
  const txn = await setTxnTransfer(getDb(), id, body.data.isTransfer);
  return txn ? json({ txn }) : problem(404, MESSAGES.txnNotFound);
});

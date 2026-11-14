import { z } from "zod";
import { MESSAGES, isUuid, kindSchema, nameSchema, readJson } from "@/features/assets/server/http";
import { updateAccount } from "@/features/assets/server/repo";
import { withUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { json, problem } from "@/shared/http";

// PATCH { name?, kind? } → { account }
export const PATCH = withUser(async (req, _user, ctx: RouteContext<"/api/assets/accounts/[id]">) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return problem(404, MESSAGES.accountNotFound);
  const body = await readJson(req, z.object({ name: nameSchema.optional(), kind: kindSchema.optional() }));
  if ("error" in body) return body.error;
  const account = await updateAccount(getDb(), id, body.data);
  return account ? json({ account }) : problem(404, MESSAGES.accountNotFound);
});

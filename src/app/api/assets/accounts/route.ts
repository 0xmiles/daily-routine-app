import { z } from "zod";
import { kindSchema, nameSchema, readJson } from "@/features/assets/server/http";
import { createAccount, listAccounts } from "@/features/assets/server/repo";
import { withUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { json } from "@/shared/http";

// GET → { accounts: BankAccount[] }
export const GET = withUser(async () => json({ accounts: await listAccounts(getDb()) }));

// POST { kind, name } → 201 { account }. Used to add a 투자계좌 by hand.
export const POST = withUser(async (req) => {
  const body = await readJson(req, z.object({ kind: kindSchema, name: nameSchema }));
  if ("error" in body) return body.error;
  return json({ account: await createAccount(getDb(), body.data) }, 201);
});

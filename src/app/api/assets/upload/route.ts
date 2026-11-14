import { isParseError, parseShinhanWorkbook } from "@/features/assets/parse/shinhan";
import { MAX_UPLOAD_BYTES, MESSAGES, isUuid } from "@/features/assets/server/http";
import { importStatement } from "@/features/assets/server/repo";
import { withUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { json, problem } from "@/shared/http";

// POST multipart { file, accountId? } → { account, inserted, skipped }
// 422 { message } for an unreadable file (nothing stored),
// 409 { message, needsAccount: true } when the file does not say which account.
// The file is read in memory and never stored.
export const POST = withUser(async (req) => {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return problem(400, MESSAGES.noFile);
  }

  const file = form.get("file");
  if (!(file instanceof Blob) || file.size === 0) return problem(400, MESSAGES.noFile);
  if (file.size > MAX_UPLOAD_BYTES) return problem(413, MESSAGES.tooBig);

  const accountIdField = form.get("accountId");
  const accountId = typeof accountIdField === "string" && accountIdField.trim() ? accountIdField.trim() : null;
  if (accountId !== null && !isUuid(accountId)) return problem(404, MESSAGES.accountNotFound);

  const parsed = parseShinhanWorkbook(await file.arrayBuffer());
  if (isParseError(parsed)) return problem(422, parsed.error);

  const result = await importStatement(getDb(), parsed, { accountId });
  switch (result.kind) {
    case "needsAccount":
      return json({ message: MESSAGES.needsAccount, needsAccount: true }, 409);
    case "accountNotFound":
      return problem(404, MESSAGES.accountNotFound);
    case "accountMismatch":
      return problem(422, MESSAGES.accountMismatch);
    case "ok":
      return json({ account: result.account, inserted: result.inserted, skipped: result.skipped });
  }
});

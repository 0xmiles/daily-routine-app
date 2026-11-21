import { createFolder, createFolderSchema } from "@/features/memo/server/folders";
import { readBody } from "@/features/memo/server/http";
import { withUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { json } from "@/shared/http";

/** POST /api/memo/folders { name, hue? } → 201 MemoFolder. Without hue: the first unused pencil. */
export const POST = withUser(async (req) => {
  const body = await readBody(req, createFolderSchema);
  if (!body.ok) return body.response;
  return json(await createFolder(getDb(), body.data), 201);
});

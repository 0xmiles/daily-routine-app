import { deleteFolder, updateFolder, updateFolderSchema } from "@/features/memo/server/folders";
import { FOLDER_NOT_FOUND, readBody } from "@/features/memo/server/http";
import { withUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { json, problem } from "@/shared/http";

/** PATCH /api/memo/folders/[id] { name?, hue? } → 200 MemoFolder; 404 if it doesn't exist. */
export const PATCH = withUser(async (req, _user, ctx: RouteContext<"/api/memo/folders/[id]">) => {
  const { id } = await ctx.params;
  const body = await readBody(req, updateFolderSchema);
  if (!body.ok) return body.response;
  const folder = await updateFolder(getDb(), id, body.data);
  if (!folder) return problem(404, FOLDER_NOT_FOUND);
  return json(folder);
});

/** DELETE /api/memo/folders/[id] → 204. Its memos move out of it (and keep their colour); none is deleted. */
export const DELETE = withUser(async (_req, _user, ctx: RouteContext<"/api/memo/folders/[id]">) => {
  const { id } = await ctx.params;
  if (!(await deleteFolder(getDb(), id))) return problem(404, FOLDER_NOT_FOUND);
  return new Response(null, { status: 204 });
});

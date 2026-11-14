import { BLOCK_NOT_FOUND, readBody } from "@/features/memo/server/http";
import { deleteBlock, saveBlock, saveBlockSchema } from "@/features/memo/server/repo";
import { withUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { json, problem } from "@/shared/http";

/**
 * PUT /api/memo/blocks/[id] { content, baseVersion } → 200 MemoBlock (version + 1).
 * 409 { current } when baseVersion is stale: another device saved first.
 */
export const PUT = withUser(async (req, _user, ctx: RouteContext<"/api/memo/blocks/[id]">) => {
  const { id } = await ctx.params;
  const body = await readBody(req, saveBlockSchema);
  if (!body.ok) return body.response;
  const result = await saveBlock(getDb(), id, body.data.content, body.data.baseVersion);
  if (!result) return problem(404, BLOCK_NOT_FOUND);
  if (!result.ok) return json({ current: result.current }, 409);
  return json(result.block);
});

/**
 * DELETE /api/memo/blocks/[id][?baseVersion=N] → 204.
 * With baseVersion, 409 { current } if the block changed since (nothing is deleted).
 */
export const DELETE = withUser(async (req, _user, ctx: RouteContext<"/api/memo/blocks/[id]">) => {
  const { id } = await ctx.params;
  const raw = new URL(req.url).searchParams.get("baseVersion");
  const baseVersion = raw !== null && /^\d+$/.test(raw) ? Number(raw) : undefined;
  const result = await deleteBlock(getDb(), id, baseVersion);
  if (!result) return problem(404, BLOCK_NOT_FOUND);
  if (!result.ok) return json({ current: result.current }, 409);
  return new Response(null, { status: 204 });
});

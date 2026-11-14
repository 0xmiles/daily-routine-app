import { createBlock, createBlockSchema, listBlocks } from "@/features/memo/server/repo";
import { readBody } from "@/features/memo/server/http";
import { withUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { json } from "@/shared/http";

/** GET /api/memo/blocks → { blocks: MemoBlock[] } (newest first). */
export const GET = withUser(async () => {
  return json({ blocks: await listBlocks(getDb()) });
});

/**
 * POST /api/memo/blocks { content?, eventRef? } → 201 MemoBlock.
 * An eventRef whose eventKey already has a block → 200 with that block.
 */
export const POST = withUser(async (req) => {
  const body = await readBody(req, createBlockSchema);
  if (!body.ok) return body.response;
  const { block, created } = await createBlock(getDb(), body.data);
  return json(block, created ? 201 : 200);
});

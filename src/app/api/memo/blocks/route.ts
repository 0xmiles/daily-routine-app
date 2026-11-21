import { listFolders } from "@/features/memo/server/folders";
import { createBlock, createBlockSchema, listBlocks } from "@/features/memo/server/repo";
import { readBody } from "@/features/memo/server/http";
import { withUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { json } from "@/shared/http";

/** GET /api/memo/blocks → { blocks: MemoBlock[] (newest first), folders: MemoFolder[] }. */
export const GET = withUser(async () => {
  const db = getDb();
  const [blocks, folders] = await Promise.all([listBlocks(db), listFolders(db)]);
  return json({ blocks, folders });
});

/**
 * POST /api/memo/blocks { content?, eventRef?, folderId?, hue? } → 201 MemoBlock.
 * A folderId that doesn't exist (deleted meanwhile) makes the memo outside any folder.
 * An eventRef whose eventKey already has a block → 200 with that block.
 */
export const POST = withUser(async (req) => {
  const body = await readBody(req, createBlockSchema);
  if (!body.ok) return body.response;
  const { block, created } = await createBlock(getDb(), body.data);
  return json(block, created ? 201 : 200);
});

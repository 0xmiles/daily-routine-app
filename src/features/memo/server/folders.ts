import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/server/db/client";
import { memoBlocks, memoFolders, type MemoFolderRow } from "@/server/db/schema";
import type { MemoFolder } from "@/shared/contracts";
import { HUES, nextFolderHue } from "@/ui/hues";
import { isBlockId } from "./repo";

// Memo folders: one level only. Deleting a folder never deletes a memo: its
// memos move out, and the ones that were showing the folder's colour keep it.

export const FOLDER_NAME_MAX = 40;

const folderName = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().min(1).max(FOLDER_NAME_MAX));

export const createFolderSchema = z.object({ name: folderName, hue: z.enum(HUES).optional() });
export const updateFolderSchema = z.object({ name: folderName.optional(), hue: z.enum(HUES).optional() });
export type CreateFolderInput = z.infer<typeof createFolderSchema>;
export type UpdateFolderInput = z.infer<typeof updateFolderSchema>;

export function toMemoFolder(row: MemoFolderRow): MemoFolder {
  return {
    id: row.id,
    name: row.name,
    hue: row.hue,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** All folders, oldest first (the list sorts them by name for display). */
export async function listFolders(db: Db): Promise<MemoFolder[]> {
  const rows = await db.select().from(memoFolders).orderBy(asc(memoFolders.createdAt), asc(memoFolders.id));
  return rows.map(toMemoFolder);
}

/** New folder; without a hue it gets the first pencil no folder uses yet. */
export async function createFolder(db: Db, input: CreateFolderInput): Promise<MemoFolder> {
  let hue = input.hue;
  if (!hue) {
    const used = await db.select({ hue: memoFolders.hue }).from(memoFolders);
    hue = nextFolderHue(used.map((r) => r.hue));
  }
  const [row] = await db.insert(memoFolders).values({ name: input.name, hue }).returning();
  return toMemoFolder(row);
}

/** Rename and/or recolour. `null` when the folder doesn't exist. */
export async function updateFolder(db: Db, id: string, patch: UpdateFolderInput): Promise<MemoFolder | null> {
  if (!isBlockId(id)) return null;
  const [row] = await db
    .update(memoFolders)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(memoFolders.id, id))
    .returning();
  return row ? toMemoFolder(row) : null;
}

/**
 * Deletes a folder. Its memos move out (the foreign key sets folder_id to null);
 * memos with no colour of their own first get the folder's colour, so nothing
 * on screen changes colour. Memo `version` and `updated_at` stay as they are.
 * `false` when the folder doesn't exist.
 */
export async function deleteFolder(db: Db, id: string): Promise<boolean> {
  if (!isBlockId(id)) return false;
  return db.transaction(async (tx) => {
    const [folder] = await tx.select().from(memoFolders).where(eq(memoFolders.id, id)).for("update");
    if (!folder) return false;
    await tx
      .update(memoBlocks)
      .set({ hue: folder.hue })
      .where(and(eq(memoBlocks.folderId, id), isNull(memoBlocks.hue)));
    await tx.delete(memoFolders).where(eq(memoFolders.id, id));
    return true;
  });
}

import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/server/db/client";
import { memoBlocks, memoFolders, type MemoBlockRow } from "@/server/db/schema";
import type { EventRef, MemoBlock } from "@/shared/contracts";
import { HUES, isHue, type Hue } from "@/ui/hues";

// Memo blocks: one long memo pad split into blocks (Heynote style).
//
// Concurrency (Review Focus #3): every block has a `version`. A save must name
// the version it was based on; the UPDATE only matches that exact version, so a
// device holding an older copy gets `{ ok: false, current }` instead of silently
// overwriting what another device wrote.

/** Event blocks start with one empty bullet line (spec §5.3). */
export const EVENT_BLOCK_INITIAL_CONTENT = "- ";
const BUSY_WORK_TITLE = "회사 일정";
const UNTITLED_TITLE = "제목 없는 일정";
const MAX_CONTENT = 200_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a syntactically valid uuid (anything else can't exist, and would make Postgres throw). */
export function isBlockId(id: string): boolean {
  return UUID_RE.test(id);
}

export const eventRefSchema = z.object({
  eventKey: z.string().min(1).max(1024),
  calendarId: z.string().min(1).max(512),
  eventId: z.string().min(1).max(512),
  recurringEventId: z.string().max(512).nullable().default(null),
  source: z.enum(["personal", "work"]),
  title: z.string().max(500).default(""),
  start: z.string().min(1).max(64),
  end: z.string().min(1).max(64),
  allDay: z.boolean(),
  deleted: z.boolean().default(false),
});

export const createBlockSchema = z.object({
  content: z.string().max(MAX_CONTENT).optional(),
  eventRef: eventRefSchema.optional(),
  // Lenient on purpose: a create carries text that must never be refused over
  // where it goes. An unknown folder or colour just means "outside, automatic".
  folderId: z.string().max(64).nullable().optional(),
  hue: z.string().max(32).nullable().optional(),
});
export type CreateBlockInput = z.infer<typeof createBlockSchema>;

export const saveBlockSchema = z.object({
  content: z.string().max(MAX_CONTENT),
  baseVersion: z.number().int().min(1),
});

export const placeBlockSchema = z.object({
  folderId: z.string().regex(UUID_RE).nullable().optional(),
  hue: z.enum(HUES).nullable().optional(),
});
export type Placement = z.infer<typeof placeBlockSchema>;

export function toMemoBlock(row: MemoBlockRow): MemoBlock {
  return {
    id: row.id,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
    eventRef: row.eventRef ?? null,
    folderId: row.folderId ?? null,
    hue: row.hue ?? null,
  };
}

/** The folder id as stored: the folder if it (still) exists, else null. Same statement as the write, so no race. */
function existingFolder(folderId: string | null | undefined) {
  if (!folderId || !isBlockId(folderId)) return null;
  return sql<string | null>`(select ${memoFolders.id} from ${memoFolders} where ${memoFolders.id} = ${folderId})`;
}

function normalizeEventRef(ref: z.infer<typeof eventRefSchema>): EventRef {
  const title = ref.title.trim() || (ref.source === "work" ? BUSY_WORK_TITLE : UNTITLED_TITLE);
  return { ...ref, title };
}

function sameLabel(a: EventRef, b: EventRef): boolean {
  return (
    a.title === b.title &&
    a.start === b.start &&
    a.end === b.end &&
    a.allDay === b.allDay &&
    a.deleted === b.deleted &&
    a.source === b.source &&
    a.recurringEventId === b.recurringEventId
  );
}

/** All blocks, newest first. */
export async function listBlocks(db: Db): Promise<MemoBlock[]> {
  const rows = await db.select().from(memoBlocks).orderBy(desc(memoBlocks.createdAt), desc(memoBlocks.id));
  return rows.map(toMemoBlock);
}

export async function getBlock(db: Db, id: string): Promise<MemoBlock | null> {
  if (!isBlockId(id)) return null;
  const [row] = await db.select().from(memoBlocks).where(eq(memoBlocks.id, id));
  return row ? toMemoBlock(row) : null;
}

/**
 * Creates a block. With an `eventRef`, at most one block exists per eventKey:
 * if it already exists that block is returned (`created: false`) with its
 * content untouched — only the stored label is refreshed when the event's
 * title/time changed, so the label follows the calendar (spec §5.1).
 */
export async function createBlock(db: Db, input: CreateBlockInput): Promise<{ block: MemoBlock; created: boolean }> {
  const placement = { folderId: existingFolder(input.folderId), hue: isHue(input.hue) ? input.hue : null };
  if (!input.eventRef) {
    const [row] = await db
      .insert(memoBlocks)
      .values({ content: input.content ?? "", ...placement })
      .returning();
    return { block: toMemoBlock(row), created: true };
  }

  const ref = normalizeEventRef(input.eventRef);
  const existing = await findByEventKey(db, ref.eventKey);
  if (existing) return { block: await refreshLabel(db, existing, ref), created: false };

  const [inserted] = await db
    .insert(memoBlocks)
    .values({
      content: input.content ?? EVENT_BLOCK_INITIAL_CONTENT,
      eventKey: ref.eventKey,
      eventRef: ref,
      ...placement,
    })
    .onConflictDoNothing({ target: memoBlocks.eventKey })
    .returning();
  if (inserted) return { block: toMemoBlock(inserted), created: true };

  // Lost a race with another request creating the same event block.
  const winner = await findByEventKey(db, ref.eventKey);
  if (!winner) throw new Error(`memo block for ${ref.eventKey} vanished during create`);
  return { block: toMemoBlock(winner), created: false };
}

async function findByEventKey(db: Db, eventKey: string): Promise<MemoBlockRow | undefined> {
  const [row] = await db.select().from(memoBlocks).where(eq(memoBlocks.eventKey, eventKey));
  return row;
}

async function refreshLabel(db: Db, row: MemoBlockRow, ref: EventRef): Promise<MemoBlock> {
  if (row.eventRef && sameLabel(row.eventRef, ref)) return toMemoBlock(row);
  // The label is not part of the user's text, so it does not bump `version`.
  const [updated] = await db.update(memoBlocks).set({ eventRef: ref }).where(eq(memoBlocks.id, row.id)).returning();
  return toMemoBlock(updated ?? row);
}

export type SaveResult = { ok: true; block: MemoBlock } | { ok: false; current: MemoBlock } | null;

/**
 * Compare-and-swap save. `null` when the block does not exist; `{ ok: false, current }`
 * when `baseVersion` is not the stored version (someone else saved first).
 */
export async function saveBlock(db: Db, id: string, content: string, baseVersion: number): Promise<SaveResult> {
  if (!isBlockId(id)) return null;
  const [updated] = await db
    .update(memoBlocks)
    .set({ content, version: sql`${memoBlocks.version} + 1`, updatedAt: sql`now()` })
    .where(and(eq(memoBlocks.id, id), eq(memoBlocks.version, baseVersion)))
    .returning();
  if (updated) return { ok: true, block: toMemoBlock(updated) };
  const current = await getBlock(db, id);
  return current ? { ok: false, current } : null;
}

export type PlaceResult = { ok: true; block: MemoBlock } | { ok: false; reason: "folder" } | null;

/**
 * Moves a memo to a folder (or out: `folderId: null`) and/or sets its colour
 * (`hue: null` = automatic). Not part of the text: `version` and `updated_at`
 * stay as they are, so this never conflicts with a text save from another
 * device and doesn't move the memo up the list. Last write wins.
 * `null` when the memo doesn't exist; `{ ok: false }` when the folder doesn't.
 */
export async function placeBlock(db: Db, id: string, patch: Placement): Promise<PlaceResult> {
  if (!isBlockId(id)) return null;
  const set: { folderId?: string | null; hue?: Hue | null } = {};
  if (patch.folderId !== undefined) {
    if (patch.folderId !== null) {
      const [folder] = await db.select({ id: memoFolders.id }).from(memoFolders).where(eq(memoFolders.id, patch.folderId));
      if (!folder) return { ok: false, reason: "folder" };
    }
    set.folderId = patch.folderId;
  }
  if (patch.hue !== undefined) set.hue = patch.hue;
  if (Object.keys(set).length === 0) {
    const current = await getBlock(db, id);
    return current ? { ok: true, block: current } : null;
  }
  const [updated] = await db.update(memoBlocks).set(set).where(eq(memoBlocks.id, id)).returning();
  return updated ? { ok: true, block: toMemoBlock(updated) } : null;
}

export type DeleteResult = { ok: true } | { ok: false; current: MemoBlock } | null;

/**
 * Deletes a block. With `baseVersion`, only deletes if nobody saved since
 * (so emptying a block on one device can't wipe text written on another).
 */
export async function deleteBlock(db: Db, id: string, baseVersion?: number): Promise<DeleteResult> {
  if (!isBlockId(id)) return null;
  const where =
    baseVersion === undefined ? eq(memoBlocks.id, id) : and(eq(memoBlocks.id, id), eq(memoBlocks.version, baseVersion));
  const deleted = await db.delete(memoBlocks).where(where).returning({ id: memoBlocks.id });
  if (deleted.length > 0) return { ok: true };
  if (baseVersion === undefined) return null;
  const current = await getBlock(db, id);
  return current ? { ok: false, current } : null;
}

/** eventKeys that already have a memo block (drives "메모 쓰기" vs "메모 보기"). */
export async function listEventKeys(db: Db): Promise<string[]> {
  const rows = await db
    .select({ eventKey: memoBlocks.eventKey })
    .from(memoBlocks)
    .where(isNotNull(memoBlocks.eventKey));
  return rows.flatMap((r) => (r.eventKey ? [r.eventKey] : []));
}

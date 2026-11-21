import type { EventRef, MemoBlock, MemoFolder } from "@/shared/contracts";
import type { Hue } from "@/ui/hues";

// Browser client for /api/memo/*. Safe to import from any client component.
//
// Errors: a network failure rejects with the fetch TypeError (callers treat it
// as "offline"); any other non-2xx (except the 409 that saveBlock/deleteBlock
// turn into `{ ok: false, current }`) rejects with `MemoApiError`.

export class MemoApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "MemoApiError";
    this.status = status;
  }
}

export interface NewMemoBlock {
  content?: string;
  eventRef?: EventRef;
  /** Folder to make it in (a folder that no longer exists means outside any folder). */
  folderId?: string | null;
  hue?: Hue | null;
}

/** Where a memo sits: its folder (null = outside) and its own colour (null = automatic). */
export interface Placement {
  folderId?: string | null;
  hue?: Hue | null;
}

export interface MemoList {
  blocks: MemoBlock[];
  folders: MemoFolder[];
}

export type SaveBlockResult = { ok: true; block: MemoBlock } | { ok: false; current: MemoBlock };
export type DeleteBlockResult = { ok: true } | { ok: false; current: MemoBlock };

const FALLBACK_MESSAGE = "메모를 저장소와 주고받지 못했어요. 잠시 뒤 다시 시도해 주세요.";

async function call(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: { ...(init?.body !== undefined ? { "content-type": "application/json" } : {}), ...init?.headers },
  });
}

async function fail(res: Response): Promise<never> {
  let message = FALLBACK_MESSAGE;
  try {
    const body = (await res.json()) as { message?: unknown };
    if (typeof body.message === "string" && body.message) message = body.message;
  } catch {
    // Non-JSON error body; keep the fallback.
  }
  throw new MemoApiError(res.status, message);
}

/** GET /api/memo/blocks — all blocks (newest first) and all folders. */
export async function fetchMemos(): Promise<MemoList> {
  const res = await call("/api/memo/blocks");
  if (!res.ok) return fail(res);
  const body = (await res.json()) as { blocks: MemoBlock[]; folders?: MemoFolder[] };
  return { blocks: body.blocks, folders: body.folders ?? [] };
}

/** GET /api/memo/blocks — all blocks, newest first. */
export async function fetchBlocks(): Promise<MemoBlock[]> {
  return (await fetchMemos()).blocks;
}

/** POST /api/memo/blocks. With an eventRef that already has a block, resolves to that existing block. */
export async function createBlock(input: NewMemoBlock = {}): Promise<MemoBlock> {
  const res = await call("/api/memo/blocks", { method: "POST", body: JSON.stringify(input) });
  if (!res.ok) return fail(res);
  return (await res.json()) as MemoBlock;
}

/**
 * PUT /api/memo/blocks/[id]. `baseVersion` is the version the edited text was based on.
 * `{ ok: false, current }` means another device saved first (409); nothing was overwritten.
 */
export async function saveBlock(id: string, content: string, baseVersion: number): Promise<SaveBlockResult> {
  const res = await call(`/api/memo/blocks/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ content, baseVersion }),
  });
  if (res.status === 409) return { ok: false, current: ((await res.json()) as { current: MemoBlock }).current };
  if (!res.ok) return fail(res);
  return { ok: true, block: (await res.json()) as MemoBlock };
}

/**
 * DELETE /api/memo/blocks/[id]. Pass `baseVersion` to delete only if nobody saved
 * since (otherwise `{ ok: false, current }` and the block is kept).
 */
export async function deleteBlock(id: string, baseVersion?: number): Promise<DeleteBlockResult> {
  const query = baseVersion === undefined ? "" : `?baseVersion=${baseVersion}`;
  const res = await call(`/api/memo/blocks/${encodeURIComponent(id)}${query}`, { method: "DELETE" });
  if (res.status === 409) return { ok: false, current: ((await res.json()) as { current: MemoBlock }).current };
  if (!res.ok) return fail(res);
  return { ok: true };
}

/** PATCH /api/memo/blocks/[id] — move a memo and/or set its colour. Doesn't change its version. */
export async function placeBlock(id: string, patch: Placement): Promise<MemoBlock> {
  const res = await call(`/api/memo/blocks/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
  if (!res.ok) return fail(res);
  return (await res.json()) as MemoBlock;
}

/** POST /api/memo/folders. Without `hue` the server picks the first pencil no folder uses. */
export async function createFolder(name: string, hue?: Hue): Promise<MemoFolder> {
  const res = await call("/api/memo/folders", { method: "POST", body: JSON.stringify(hue ? { name, hue } : { name }) });
  if (!res.ok) return fail(res);
  return (await res.json()) as MemoFolder;
}

/** PATCH /api/memo/folders/[id] — rename and/or recolour. */
export async function updateFolder(id: string, patch: { name?: string; hue?: Hue }): Promise<MemoFolder> {
  const res = await call(`/api/memo/folders/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
  if (!res.ok) return fail(res);
  return (await res.json()) as MemoFolder;
}

/** DELETE /api/memo/folders/[id] — its memos move out of it; none is deleted. */
export async function deleteFolder(id: string): Promise<void> {
  const res = await call(`/api/memo/folders/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) return fail(res);
}

/** GET /api/memo/event-keys — eventKeys (`${calendarId}:${eventId}`) that already have a memo. */
export async function fetchEventKeys(): Promise<string[]> {
  const res = await call("/api/memo/event-keys");
  if (!res.ok) return fail(res);
  return ((await res.json()) as { keys: string[] }).keys;
}

/** `/memo?id=<id>` — the memo page opens that memo file. */
export function memoHref(id: string): string {
  return `/memo?id=${encodeURIComponent(id)}`;
}

/** @deprecated Same as memoHref (memos are files now; old `?block=` links still open). */
export const memoBlockHref = memoHref;

/**
 * "메모 쓰기" / "메모 보기" from an event: creates the event's memo file (or gets
 * the existing one — one memo per eventKey) and then navigates to `/memo?id=<id>`.
 *
 * Navigation defaults to `window.location.assign` (a full page load, works from
 * anywhere). Inside the app pass the App Router instead for a soft navigation:
 *   const router = useRouter();
 *   await openEventMemo(ref, (href) => router.push(href));
 */
export async function openEventMemo(
  ref: EventRef,
  navigate: (href: string) => void = (href) => window.location.assign(href),
): Promise<MemoBlock> {
  const block = await createBlock({ eventRef: ref });
  navigate(memoHref(block.id));
  return block;
}

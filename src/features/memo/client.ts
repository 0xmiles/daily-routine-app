import type { EventRef, MemoBlock } from "@/shared/contracts";

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

/** GET /api/memo/blocks — all blocks, newest first. */
export async function fetchBlocks(): Promise<MemoBlock[]> {
  const res = await call("/api/memo/blocks");
  if (!res.ok) return fail(res);
  return ((await res.json()) as { blocks: MemoBlock[] }).blocks;
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

/** GET /api/memo/event-keys — eventKeys (`${calendarId}:${eventId}`) that already have a memo. */
export async function fetchEventKeys(): Promise<string[]> {
  const res = await call("/api/memo/event-keys");
  if (!res.ok) return fail(res);
  return ((await res.json()) as { keys: string[] }).keys;
}

/** `/memo?block=<id>` — the memo page scrolls to and focuses that block. */
export function memoBlockHref(blockId: string): string {
  return `/memo?block=${encodeURIComponent(blockId)}`;
}

/**
 * "메모 쓰기" / "메모 보기" from an event: creates the event's block (or gets the
 * existing one — one block per eventKey) and then navigates to `/memo?block=<id>`.
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
  navigate(memoBlockHref(block.id));
  return block;
}

import type { Hue } from "@/ui/hues";

// Unsaved memo text kept on this device (spec §5.3 "메모 유실 금지").
//
// Every edit is written here before the debounced save; a successful save
// removes it. After a reload or reconnect the page sends what is left.
// localStorage can be missing, full, or throw (private mode) — every access is
// wrapped, and a failure only means the draft isn't kept.

const STORAGE_KEY = "drs.memo.drafts.v1";

export interface MemoDraft {
  /** Client key of the block (its server id once it has one). */
  key: string;
  /** Server id, or null if the block was never created on the server. */
  id: string | null;
  content: string;
  /** Server version the content was based on (0 = never created). */
  baseVersion: number;
  /** The block's createdAt (for blocks that exist only on this device). */
  createdAt: string;
  /** When this draft was written (ISO). */
  savedAt: string;
  /** Folder / own colour of a memo not on the server yet (older drafts have neither: null). */
  folderId?: string | null;
  hue?: Hue | null;
}

type DraftMap = Record<string, MemoDraft>;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isDraft(value: unknown): value is MemoDraft {
  if (!value || typeof value !== "object") return false;
  const d = value as Record<string, unknown>;
  return (
    typeof d.key === "string" &&
    (d.id === null || typeof d.id === "string") &&
    typeof d.content === "string" &&
    typeof d.baseVersion === "number" &&
    typeof d.createdAt === "string" &&
    typeof d.savedAt === "string"
  );
}

function readMap(): DraftMap {
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const map: DraftMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isDraft(value)) map[key] = value;
    }
    return map;
  } catch {
    return {};
  }
}

function writeMap(map: DraftMap): boolean {
  try {
    const store = storage();
    if (!store) return false;
    if (Object.keys(map).length === 0) store.removeItem(STORAGE_KEY);
    else store.setItem(STORAGE_KEY, JSON.stringify(map));
    return true;
  } catch {
    return false;
  }
}

/** All drafts on this device. */
export function readDrafts(): MemoDraft[] {
  return Object.values(readMap());
}

/** The draft stored under `draftKey`, if any. */
export function readDraft(draftKey: string): MemoDraft | null {
  return readMap()[draftKey] ?? null;
}

/** Stores (or replaces) a draft. Returns false if the device storage refused it. */
export function writeDraft(draftKey: string, draft: MemoDraft): boolean {
  const map = readMap();
  map[draftKey] = draft;
  return writeMap(map);
}

export function removeDraft(draftKey: string): void {
  const map = readMap();
  if (!(draftKey in map)) return;
  delete map[draftKey];
  writeMap(map);
}

/** Test helper / logout: forget every draft. */
export function clearDrafts(): void {
  writeMap({});
}

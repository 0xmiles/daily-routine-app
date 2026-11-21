import type { MemoFolder } from "@/shared/contracts";
import { hueFor, type Hue } from "@/ui/hues";
import type { PadBlock } from "./store";

// How the memo list is laid out: folders (가나다순) on top, each with its memos
// (most recently edited first), then the memos outside any folder.

/** A memo's pencil: its own colour, else its folder's, else one that stays with the memo. */
export function memoHue(block: Pick<PadBlock, "hue" | "folderId" | "id" | "key">, folders: readonly MemoFolder[]): Hue {
  if (block.hue) return block.hue;
  const folder = block.folderId ? folders.find((f) => f.id === block.folderId) : undefined;
  return folder?.hue ?? hueFor(block.id ?? block.key);
}

/** Search: the memo's text or its event's title contains `query` (already trimmed and lower-cased). */
export function matchesQuery(block: PadBlock, query: string): boolean {
  if (!query) return true;
  return block.content.toLowerCase().includes(query) || (block.eventRef?.title.toLowerCase().includes(query) ?? false);
}

export interface FolderGroup {
  folder: MemoFolder;
  /** Showing its memos: not closed, or there is a search (then only folders with a match are listed). */
  open: boolean;
  memos: PadBlock[];
}

export interface MemoGroups {
  folders: FolderGroup[];
  /** Memos outside any folder (or in a folder this device doesn't know yet). */
  loose: PadBlock[];
}

/** Groups the (already ordered) memos. With a search, folders without a match are left out and the rest open. */
export function groupMemos(
  blocks: readonly PadBlock[],
  folders: readonly MemoFolder[],
  opts: { query: string; closed: ReadonlySet<string> },
): MemoGroups {
  const known = new Set(folders.map((f) => f.id));
  const byFolder = new Map<string, PadBlock[]>();
  const loose: PadBlock[] = [];
  for (const block of blocks) {
    if (!matchesQuery(block, opts.query)) continue;
    if (block.folderId && known.has(block.folderId)) {
      const list = byFolder.get(block.folderId) ?? [];
      list.push(block);
      byFolder.set(block.folderId, list);
    } else {
      loose.push(block);
    }
  }
  const searching = opts.query !== "";
  const sorted = [...folders].sort((a, b) => a.name.localeCompare(b.name, "ko") || a.createdAt.localeCompare(b.createdAt));
  const groups: FolderGroup[] = [];
  for (const folder of sorted) {
    const memos = byFolder.get(folder.id) ?? [];
    if (searching && memos.length === 0) continue;
    groups.push({ folder, open: searching || !opts.closed.has(folder.id), memos });
  }
  return { folders: groups, loose };
}

/** The memos in the order the list shows them (open folders only). Enter in the search opens the first. */
export function shownMemos(groups: MemoGroups): PadBlock[] {
  return [...groups.folders.flatMap((g) => (g.open ? g.memos : [])), ...groups.loose];
}

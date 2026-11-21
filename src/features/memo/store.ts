import type { EventRef, MemoBlock, MemoFolder } from "@/shared/contracts";
import { formatKoreanTimestamp } from "@/shared/time";
import type { Hue } from "@/ui/hues";
import * as client from "./client";
import { MemoApiError, type Placement } from "./client";
import { readDrafts, removeDraft, writeDraft } from "./draft";

// Client-side state of the memo files and their sync with the server.
//
// Each memo is a file (the server still calls them "blocks"): its first line is
// its title. The list is ordered by last edit, newest first.
//
// - Edits are kept in memory and in device storage (draft.ts) right away, and
//   sent 800ms after typing stops.
// - Saves are compare-and-swap on `version`. A 409 means another device saved
//   first: the server text replaces this block and the local text becomes a new
//   "충돌 사본 — <시각>" block, so neither side is lost (Review Focus #3).
// - Network failures keep the draft and retry on `online`, on a timer, when the
//   page becomes visible again, and on the next load.
// - Folders and colours ("placement") are not text: they are applied on screen
//   at once and sent as their own request, which never bumps `version`. Without
//   a connection they are undone with a notice (no queue). A memo that is not on
//   the server yet keeps its placement on the device and sends it with its create.

export type BlockStatus = "saved" | "pending" | "offline";

export interface PadBlock {
  /** Stable client key (the server id for blocks loaded from the server). */
  key: string;
  /** Server id; null until the block has been created on the server. */
  id: string | null;
  content: string;
  /** Server version `content` is based on (0 = not created yet). */
  version: number;
  createdAt: string;
  /** Last edit (local edits move a file to the top of the list right away). */
  updatedAt: string;
  eventRef: EventRef | null;
  status: BlockStatus;
  /** Bumped whenever `content` was replaced from the server; the editor reloads its text then. */
  remoteRev: number;
  /** Folder (null = outside any folder). */
  folderId: string | null;
  /** Own colour (null = automatic: the folder's, or hueFor() outside a folder). */
  hue: Hue | null;
}

export type PadNotice =
  | { kind: "conflict"; copyKey: string }
  | { kind: "deleteConflict"; key: string }
  /** Moving / recolouring / a folder change didn't reach the server and was undone. */
  | { kind: "placementFailed"; message: string }
  | null;

export interface PadState {
  phase: "loading" | "ready" | "error";
  loadError: string | null;
  blocks: PadBlock[];
  folders: MemoFolder[];
  /** A save failed for lack of network; unsaved text is kept on this device. */
  offline: boolean;
  /** The session expired; unsaved text is kept on this device. */
  authRequired: boolean;
  notice: PadNotice;
}

export interface MemoApi {
  fetchMemos: typeof client.fetchMemos;
  createBlock: typeof client.createBlock;
  saveBlock: typeof client.saveBlock;
  deleteBlock: typeof client.deleteBlock;
  placeBlock: typeof client.placeBlock;
  createFolder: typeof client.createFolder;
  updateFolder: typeof client.updateFolder;
  deleteFolder: typeof client.deleteFolder;
}

export interface MemoPadOptions {
  api?: MemoApi;
  /** Debounce after the last keystroke. Default 800ms. */
  saveDelayMs?: number;
  /** Retry interval while offline. Default 15s. */
  retryMs?: number;
  now?: () => Date;
}

export const SAVE_DELAY_MS = 800;
export const CONFLICT_PREFIX = "충돌 사본 — ";

/** First line of a conflict copy: "충돌 사본 — 11월 14일 오전 9:12", then the local text. */
export function conflictCopyContent(mine: string, now: Date): string {
  return `${CONFLICT_PREFIX}${formatKoreanTimestamp(now.toISOString())}\n${mine}`;
}

const MESSAGES = {
  loadOffline: "메모를 불러오지 못했어요. 인터넷 연결을 확인한 뒤 다시 불러와 주세요.",
  loadAuth: "로그인이 풀렸어요. 다시 로그인한 뒤 메모를 열어 주세요.",
};

/** What a placement change was, for its failure notice: "메모를 옮기지" → "…메모를 옮기지 못했어요." */
type PlacementAction =
  | "메모를 옮기지"
  | "메모 색을 바꾸지"
  | "폴더를 만들지"
  | "폴더 이름을 바꾸지"
  | "폴더 색을 바꾸지"
  | "폴더를 지우지";

function placementFailure(error: unknown, action: PlacementAction): string {
  if (error instanceof MemoApiError) return error.message;
  return `인터넷에 연결되지 않아 ${action} 못했어요. 연결되면 다시 해 주세요.`;
}

const NO_PLACEMENT = { folderId: null, hue: null } as const;

let keySeq = 0;
function newKey(): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `local-${random}-${(keySeq++).toString(36)}`;
}

function fromServer(block: MemoBlock): PadBlock {
  return {
    key: block.id,
    id: block.id,
    content: block.content,
    version: block.version,
    createdAt: block.createdAt,
    updatedAt: block.updatedAt,
    eventRef: block.eventRef,
    status: "saved",
    remoteRev: 0,
    folderId: block.folderId ?? null,
    hue: block.hue ?? null,
  };
}

/** Most recently edited first (stable for equal timestamps). */
function sortBlocks(blocks: PadBlock[]): PadBlock[] {
  return [...blocks].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}

interface Meta {
  timer?: ReturnType<typeof setTimeout>;
  inFlight: boolean;
  again: boolean;
  /** Placement requests in flight: until they answer, a reload keeps the placement on screen. */
  placing: number;
}

export class MemoPad {
  private state: PadState = {
    phase: "loading",
    loadError: null,
    blocks: [],
    folders: [],
    offline: false,
    authRequired: false,
    notice: null,
  };
  private readonly listeners = new Set<() => void>();
  private readonly meta = new Map<string, Meta>();
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private started = false;
  private readonly api: MemoApi;
  private readonly saveDelayMs: number;
  private readonly retryMs: number;
  private readonly now: () => Date;

  constructor(options: MemoPadOptions = {}) {
    this.api = options.api ?? client;
    this.saveDelayMs = options.saveDelayMs ?? SAVE_DELAY_MS;
    this.retryMs = options.retryMs ?? 15_000;
    this.now = options.now ?? (() => new Date());
  }

  // ---- store protocol (useSyncExternalStore) ------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): PadState => this.state;

  private set(patch: Partial<PadState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private setBlocks(blocks: PadBlock[]): void {
    this.set({ blocks });
  }

  private patchBlock(key: string, patch: Partial<PadBlock>): void {
    this.setBlocks(this.state.blocks.map((b) => (b.key === key ? { ...b, ...patch } : b)));
  }

  find(key: string): PadBlock | undefined {
    return this.state.blocks.find((b) => b.key === key);
  }

  private metaOf(key: string): Meta {
    let m = this.meta.get(key);
    if (!m) this.meta.set(key, (m = { inFlight: false, again: false, placing: 0 }));
    return m;
  }

  // ---- lifecycle -----------------------------------------------------------

  /** Loads the blocks and starts listening for reconnects / page visibility. */
  start(): void {
    if (this.started) return;
    this.started = true;
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.onOnline);
      window.addEventListener("pagehide", this.onPageHide);
      document.addEventListener("visibilitychange", this.onVisibility);
    }
    void this.load();
  }

  /** Stops listening; anything still waiting for its debounce is sent now. */
  dispose(): void {
    if (!this.started) return;
    this.started = false;
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.onOnline);
      window.removeEventListener("pagehide", this.onPageHide);
      document.removeEventListener("visibilitychange", this.onVisibility);
    }
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.flushAll();
  }

  private onOnline = (): void => {
    this.flushAll();
  };

  private onPageHide = (): void => {
    this.flushAll();
  };

  private onVisibility = (): void => {
    this.flushAll();
    // Back on this device: pick up what the other device wrote.
    if (document.visibilityState === "visible" && this.state.phase === "ready") void this.load();
  };

  // ---- loading -------------------------------------------------------------

  /**
   * First call: loads blocks and restores drafts left on this device.
   * Later calls: merges the server state in without touching unsaved text.
   */
  async load(): Promise<void> {
    const first = this.state.phase !== "ready";
    if (first) this.set({ phase: "loading", loadError: null });
    let server: MemoBlock[];
    let folders: MemoFolder[];
    try {
      ({ blocks: server, folders } = await this.api.fetchMemos());
    } catch (error) {
      if (!first) return; // background refresh: keep what is on screen
      const auth = error instanceof MemoApiError && error.status === 401;
      this.set({
        phase: "error",
        authRequired: auth,
        loadError: auth ? MESSAGES.loadAuth : error instanceof MemoApiError ? error.message : MESSAGES.loadOffline,
      });
      return;
    }

    let blocks = this.merge(server, folders);
    if (first) blocks = this.restoreDrafts(blocks, folders);
    this.set({ phase: "ready", loadError: null, blocks: sortBlocks(blocks), folders });
    if (first) this.flushAll();
  }

  private merge(server: MemoBlock[], folders: MemoFolder[]): PadBlock[] {
    const folderIds = new Set(folders.map((f) => f.id));
    // Placement always follows the server, unless a change of ours is still on its way.
    const placed = (local: PadBlock, s: MemoBlock) =>
      this.metaOf(local.key).placing > 0 ? {} : { folderId: s.folderId ?? null, hue: s.hue ?? null };
    const known = new Map<string, PadBlock>();
    for (const b of this.state.blocks) if (b.id) known.set(b.id, b);
    const out: PadBlock[] = [];
    for (const s of server) {
      const local = known.get(s.id);
      known.delete(s.id);
      if (!local) {
        out.push(fromServer(s));
      } else if (local.status !== "saved" || this.metaOf(local.key).inFlight) {
        // Unsaved local text wins on screen; its save will 409 if the server moved on.
        out.push({ ...local, eventRef: s.eventRef, ...placed(local, s) });
      } else {
        const changed = local.content !== s.content;
        out.push({
          ...local,
          content: s.content,
          version: s.version,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          eventRef: s.eventRef,
          remoteRev: changed ? local.remoteRev + 1 : local.remoteRev,
          ...placed(local, s),
        });
      }
    }
    // Gone from the server (deleted on another device): keep only unsaved text, as a new block.
    const keepFolder = (b: PadBlock) => (b.folderId && !folderIds.has(b.folderId) ? { folderId: null } : {});
    for (const local of known.values()) {
      if (local.status !== "saved") out.push({ ...local, id: null, version: 0, eventRef: null, ...keepFolder(local) });
    }
    for (const b of this.state.blocks) if (b.id === null) out.push({ ...b, ...keepFolder(b) });
    return out;
  }

  private restoreDrafts(blocks: PadBlock[], folders: MemoFolder[]): PadBlock[] {
    const folderIds = new Set(folders.map((f) => f.id));
    const out = [...blocks];
    for (const draft of readDrafts()) {
      const index = draft.id ? out.findIndex((b) => b.id === draft.id) : out.findIndex((b) => b.key === draft.key);
      if (index >= 0) {
        const block = out[index];
        removeDraft(draft.key);
        if (draft.content === block.content) continue;
        out[index] = {
          ...block,
          content: draft.content,
          version: draft.baseVersion,
          updatedAt: draft.savedAt,
          status: "pending",
        };
        this.persist(out[index]);
        continue;
      }
      if (draft.content.trim() === "") {
        removeDraft(draft.key);
        continue;
      }
      // Never reached the server, or deleted there since: keep the text as a block of its own.
      const block: PadBlock = {
        key: draft.key,
        id: null,
        content: draft.content,
        version: 0,
        createdAt: draft.createdAt,
        updatedAt: draft.savedAt,
        eventRef: null,
        status: "pending",
        remoteRev: 0,
        folderId: draft.folderId && folderIds.has(draft.folderId) ? draft.folderId : null,
        hue: draft.hue ?? null,
      };
      out.push(block);
      this.persist(block);
    }
    return out;
  }

  // ---- editing -------------------------------------------------------------

  /** The editor's text changed. */
  edit(key: string, content: string): void {
    const block = this.find(key);
    if (!block || block.content === content) return;
    this.setBlocks(
      sortBlocks(
        this.state.blocks.map((b) =>
          b.key === key ? { ...b, content, status: "pending", updatedAt: this.now().toISOString() } : b,
        ),
      ),
    );
    this.persist(this.find(key)!);
    this.schedule(key);
  }

  /**
   * New memo file at the top, optionally starting with `content` (e.g. a title
   * line), in `folderId` (null = outside any folder). Reuses an untouched empty
   * one in the same place. Returns its key.
   */
  addBlock(content = "", folderId: string | null = null): string {
    const empty = this.state.blocks.find(
      (b) => b.id === null && b.content === "" && b.eventRef === null && b.folderId === folderId,
    );
    if (empty && content === "") return empty.key;
    const block = this.newLocal(content, content === "" ? "saved" : "pending", { folderId, hue: null });
    this.setBlocks([block, ...this.state.blocks.filter((b) => b !== empty)]);
    if (content !== "") {
      this.persist(block);
      this.schedule(block.key);
    }
    return block.key;
  }

  /**
   * Drops a memo that has no text (left empty, or emptied). Event memos stay:
   * they belong to their event. The server delete is version-checked: if another
   * device wrote in it meanwhile, the memo comes back with that text.
   */
  removeBlock(key: string): boolean {
    const block = this.find(key);
    if (!block || block.content.trim() !== "" || block.eventRef) return false;
    this.drop(block);
    return true;
  }

  /**
   * Deletes a memo the user chose to delete, text and all. Version-checked: if
   * another device changed it since, it comes back with that text and a notice.
   */
  deleteBlock(key: string): boolean {
    const block = this.find(key);
    if (!block) return false;
    this.drop(block, true);
    return true;
  }

  private drop(block: PadBlock, notifyConflict = false): void {
    const m = this.meta.get(block.key);
    if (m?.timer) clearTimeout(m.timer);
    this.meta.delete(block.key);
    this.setBlocks(this.state.blocks.filter((b) => b.key !== block.key));
    removeDraft(block.key);
    if (!block.id) return;
    this.api.deleteBlock(block.id, block.version).then(
      (result) => {
        if (result.ok) return;
        const back = fromServer(result.current);
        this.setBlocks(sortBlocks([...this.state.blocks, back]));
        if (notifyConflict) this.set({ notice: { kind: "deleteConflict", key: back.key } });
      },
      () => {
        // Offline: the memo may show up again on the next load. No text is lost.
      },
    );
  }

  dismissNotice(): void {
    if (this.state.notice) this.set({ notice: null });
  }

  // ---- placement and folders -------------------------------------------------

  private failPlacement(error: unknown, action: PlacementAction): void {
    this.set({ notice: { kind: "placementFailed", message: placementFailure(error, action) } });
  }

  /**
   * Moves a memo (`folderId`, null = out of any folder) and/or sets its colour
   * (`hue`, null = automatic). Shown at once; undone with a notice if the server
   * can't be reached. A memo not on the server yet just keeps it for its create.
   */
  async place(key: string, patch: Placement): Promise<void> {
    const block = this.find(key);
    if (!block) return;
    const before = { folderId: block.folderId, hue: block.hue };
    this.patchBlock(key, patch);
    if (!block.id) {
      const now = this.find(key)!;
      if (now.status !== "saved") this.persist(now);
      return;
    }
    const m = this.metaOf(key);
    m.placing++;
    try {
      const updated = await this.api.placeBlock(block.id, patch);
      if (this.find(key)) this.patchBlock(key, { folderId: updated.folderId ?? null, hue: updated.hue ?? null });
    } catch (error) {
      if (this.find(key)) this.patchBlock(key, before);
      this.failPlacement(error, patch.folderId !== undefined ? "메모를 옮기지" : "메모 색을 바꾸지");
    } finally {
      m.placing--;
    }
  }

  /** New folder (shown once the server has made it). `null` if that failed (with a notice). */
  async createFolder(name: string): Promise<MemoFolder | null> {
    try {
      const folder = await this.api.createFolder(name);
      this.set({ folders: [...this.state.folders, folder] });
      return folder;
    } catch (error) {
      this.failPlacement(error, "폴더를 만들지");
      return null;
    }
  }

  private async changeFolder(id: string, patch: { name?: string; hue?: Hue }, action: PlacementAction): Promise<void> {
    const before = this.state.folders.find((f) => f.id === id);
    if (!before) return;
    const swap = (folder: MemoFolder) => this.set({ folders: this.state.folders.map((f) => (f.id === id ? folder : f)) });
    swap({ ...before, ...patch });
    try {
      swap(await this.api.updateFolder(id, patch));
    } catch (error) {
      if (this.state.folders.some((f) => f.id === id)) swap(before);
      this.failPlacement(error, action);
    }
  }

  renameFolder(id: string, name: string): Promise<void> {
    return this.changeFolder(id, { name }, "폴더 이름을 바꾸지");
  }

  recolorFolder(id: string, hue: Hue): Promise<void> {
    return this.changeFolder(id, { hue }, "폴더 색을 바꾸지");
  }

  /**
   * Deletes a folder. Its memos move out of it and keep the colour they were
   * showing (the folder's, unless they had their own) — same as the server does.
   */
  async deleteFolder(id: string): Promise<void> {
    const folder = this.state.folders.find((f) => f.id === id);
    if (!folder) return;
    const moved = this.state.blocks.filter((b) => b.folderId === id).map((b) => ({ key: b.key, hue: b.hue }));
    this.set({
      folders: this.state.folders.filter((f) => f.id !== id),
      blocks: this.state.blocks.map((b) => (b.folderId === id ? { ...b, folderId: null, hue: b.hue ?? folder.hue } : b)),
    });
    for (const b of this.state.blocks) if (!b.id && b.status !== "saved" && moved.some((m) => m.key === b.key)) this.persist(b);
    try {
      await this.api.deleteFolder(id);
    } catch (error) {
      const back = new Map(moved.map((m) => [m.key, m.hue]));
      this.set({
        folders: [...this.state.folders, folder],
        blocks: this.state.blocks.map((b) => (back.has(b.key) ? { ...b, folderId: id, hue: back.get(b.key) ?? null } : b)),
      });
      this.failPlacement(error, "폴더를 지우지");
    }
  }

  // ---- saving --------------------------------------------------------------

  private newLocal(
    content: string,
    status: BlockStatus,
    placement: { folderId: string | null; hue: Hue | null } = NO_PLACEMENT,
  ): PadBlock {
    const now = this.now().toISOString();
    return {
      key: newKey(),
      id: null,
      content,
      version: 0,
      createdAt: now,
      updatedAt: now,
      eventRef: null,
      status,
      remoteRev: 0,
      folderId: placement.folderId,
      hue: placement.hue,
    };
  }

  private persist(block: PadBlock): void {
    writeDraft(block.key, {
      key: block.key,
      id: block.id,
      content: block.content,
      baseVersion: block.version,
      createdAt: block.createdAt,
      savedAt: this.now().toISOString(),
      folderId: block.folderId,
      hue: block.hue,
    });
  }

  private schedule(key: string): void {
    const m = this.metaOf(key);
    if (m.timer) clearTimeout(m.timer);
    m.timer = setTimeout(() => {
      m.timer = undefined;
      void this.flush(key);
    }, this.saveDelayMs);
  }

  /** Sends every block that has unsaved text, now. */
  flushAll(): void {
    for (const block of this.state.blocks) if (block.status !== "saved") void this.flush(block.key);
  }

  /** Sends this block's text now (no-op if saved; queued if a save is in flight). */
  async flush(key: string): Promise<void> {
    const m = this.metaOf(key);
    if (m.timer) {
      clearTimeout(m.timer);
      m.timer = undefined;
    }
    if (m.inFlight) {
      m.again = true;
      return;
    }
    const block = this.find(key);
    if (!block || block.status === "saved") return;
    const sent = block.content;
    if (block.id === null && sent.trim() === "") {
      this.patchBlock(key, { status: "saved" });
      removeDraft(key);
      return;
    }

    m.inFlight = true;
    try {
      if (block.id === null) {
        const placement = { folderId: block.folderId, hue: block.hue };
        const created = await this.api.createBlock({
          content: sent,
          ...(placement.folderId ? { folderId: placement.folderId } : {}),
          ...(placement.hue ? { hue: placement.hue } : {}),
        });
        this.afterCreate(key, created, placement);
        this.afterSave(key, sent, { id: created.id, version: created.version, createdAt: created.createdAt });
      } else {
        const result = await this.api.saveBlock(block.id, sent, block.version);
        if (result.ok) this.afterSave(key, sent, { version: result.block.version });
        else this.resolveConflict(key, result.current);
      }
      if (this.state.offline || this.state.authRequired) this.set({ offline: false, authRequired: false });
    } catch (error) {
      this.onSaveError(key, error);
    } finally {
      m.inFlight = false;
      if (m.again) {
        m.again = false;
        if (this.find(key)?.status === "pending") void this.flush(key);
      }
    }
  }

  /**
   * A memo's first save: take the placement the server stored (its folder may
   * have been deleted meanwhile), unless it was moved here while the create was
   * on its way — then send that move now.
   */
  private afterCreate(key: string, created: MemoBlock, sent: { folderId: string | null; hue: Hue | null }): void {
    const block = this.find(key);
    if (!block) return;
    if (block.folderId === sent.folderId && block.hue === sent.hue) {
      this.patchBlock(key, { folderId: created.folderId ?? null, hue: created.hue ?? null });
      return;
    }
    const patch: Placement = {};
    if (block.folderId !== sent.folderId) patch.folderId = block.folderId;
    if (block.hue !== sent.hue) patch.hue = block.hue;
    this.patchBlock(key, { id: created.id });
    void this.place(key, patch);
  }

  private afterSave(key: string, sent: string, patch: Partial<PadBlock>): void {
    const block = this.find(key);
    if (!block) {
      // Removed while its first save was in flight: don't leave it behind on the server.
      if (patch.id) this.api.deleteBlock(patch.id, patch.version).catch(() => undefined);
      return;
    }
    if (block.content === sent) {
      this.patchBlock(key, { ...patch, status: "saved" });
      removeDraft(key);
    } else {
      // Typed more while saving: keep going from the new version.
      this.patchBlock(key, { ...patch, status: "pending" });
      this.persist(this.find(key)!);
      this.metaOf(key).again = true;
    }
  }

  private resolveConflict(key: string, current: MemoBlock): void {
    const block = this.find(key);
    if (!block) return;
    const mine = block.content; // includes anything typed while the save was in flight
    this.metaOf(key).again = false;
    this.patchBlock(key, {
      content: current.content,
      version: current.version,
      eventRef: current.eventRef,
      status: "saved",
      remoteRev: block.remoteRev + 1,
      folderId: current.folderId ?? null,
      hue: current.hue ?? null,
    });
    removeDraft(key);
    if (mine === current.content || mine.trim() === "") return;

    const copy = this.newLocal(conflictCopyContent(mine, this.now()), "pending", {
      folderId: current.folderId ?? block.folderId,
      hue: current.hue ?? block.hue,
    });
    this.setBlocks(sortBlocks([copy, ...this.state.blocks]));
    this.persist(copy);
    this.set({ notice: { kind: "conflict", copyKey: copy.key } });
    void this.flush(copy.key);
  }

  private onSaveError(key: string, error: unknown): void {
    if (error instanceof MemoApiError && error.status === 404) {
      // Deleted on another device while edited here: keep the text as a new block.
      this.patchBlock(key, { id: null, version: 0, eventRef: null, status: "pending" });
      const block = this.find(key);
      if (block) this.persist(block);
      this.metaOf(key).again = true;
      return;
    }
    if (this.find(key)) this.patchBlock(key, { status: "offline" });
    if (error instanceof MemoApiError && error.status === 401) {
      this.set({ authRequired: true });
      return;
    }
    this.set({ offline: true });
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (this.retryTimer || !this.started) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.flushAll();
    }, this.retryMs);
  }
}

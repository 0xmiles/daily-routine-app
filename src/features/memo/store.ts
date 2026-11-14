import type { EventRef, MemoBlock } from "@/shared/contracts";
import { formatKoreanTimestamp } from "@/shared/time";
import * as client from "./client";
import { MemoApiError } from "./client";
import { readDrafts, removeDraft, writeDraft } from "./draft";

// Client-side state of the memo pad and its sync with the server.
//
// - Edits are kept in memory and in device storage (draft.ts) right away, and
//   sent 800ms after typing stops.
// - Saves are compare-and-swap on `version`. A 409 means another device saved
//   first: the server text replaces this block and the local text becomes a new
//   "충돌 사본 — <시각>" block, so neither side is lost (Review Focus #3).
// - Network failures keep the draft and retry on `online`, on a timer, when the
//   page becomes visible again, and on the next load.

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
  eventRef: EventRef | null;
  status: BlockStatus;
  /** Bumped whenever `content` was replaced from the server; the editor reloads its text then. */
  remoteRev: number;
}

export type PadNotice = { kind: "conflict"; copyKey: string } | null;

export interface PadState {
  phase: "loading" | "ready" | "error";
  loadError: string | null;
  blocks: PadBlock[];
  /** A save failed for lack of network; unsaved text is kept on this device. */
  offline: boolean;
  /** The session expired; unsaved text is kept on this device. */
  authRequired: boolean;
  notice: PadNotice;
}

export interface MemoApi {
  fetchBlocks: typeof client.fetchBlocks;
  createBlock: typeof client.createBlock;
  saveBlock: typeof client.saveBlock;
  deleteBlock: typeof client.deleteBlock;
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
    eventRef: block.eventRef,
    status: "saved",
    remoteRev: 0,
  };
}

/** Newest first (stable for equal timestamps). */
function sortBlocks(blocks: PadBlock[]): PadBlock[] {
  return [...blocks].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

interface Meta {
  timer?: ReturnType<typeof setTimeout>;
  inFlight: boolean;
  again: boolean;
}

export class MemoPad {
  private state: PadState = {
    phase: "loading",
    loadError: null,
    blocks: [],
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
    if (!m) this.meta.set(key, (m = { inFlight: false, again: false }));
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
    try {
      server = await this.api.fetchBlocks();
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

    let blocks = this.merge(server);
    if (first) blocks = this.restoreDrafts(blocks);
    if (blocks.length === 0) blocks = [this.newLocal("", "saved")];
    this.set({ phase: "ready", loadError: null, blocks: sortBlocks(blocks) });
    if (first) this.flushAll();
  }

  private merge(server: MemoBlock[]): PadBlock[] {
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
        out.push({ ...local, eventRef: s.eventRef });
      } else {
        const changed = local.content !== s.content;
        out.push({
          ...local,
          content: s.content,
          version: s.version,
          createdAt: s.createdAt,
          eventRef: s.eventRef,
          remoteRev: changed ? local.remoteRev + 1 : local.remoteRev,
        });
      }
    }
    // Gone from the server (deleted on another device): keep only unsaved text, as a new block.
    for (const local of known.values()) {
      if (local.status !== "saved") out.push({ ...local, id: null, version: 0, eventRef: null });
    }
    for (const b of this.state.blocks) if (b.id === null) out.push(b);
    return out;
  }

  private restoreDrafts(blocks: PadBlock[]): PadBlock[] {
    const out = [...blocks];
    for (const draft of readDrafts()) {
      const index = draft.id ? out.findIndex((b) => b.id === draft.id) : out.findIndex((b) => b.key === draft.key);
      if (index >= 0) {
        const block = out[index];
        removeDraft(draft.key);
        if (draft.content === block.content) continue;
        out[index] = { ...block, content: draft.content, version: draft.baseVersion, status: "pending" };
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
        eventRef: null,
        status: "pending",
        remoteRev: 0,
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
    this.patchBlock(key, { content, status: "pending" });
    this.persist(this.find(key)!);
    this.schedule(key);
  }

  /** New empty block at the top (reuses an untouched empty one). Returns its key. */
  addBlock(): string {
    const top = this.state.blocks[0];
    if (top && top.id === null && top.content === "") return top.key;
    const block = this.newLocal("", "saved");
    this.setBlocks([block, ...this.state.blocks]);
    return block.key;
  }

  /**
   * Removes an empty block (Backspace in an empty editor). Refuses if it has
   * text or is the only block. The server delete is version-checked: if another
   * device wrote in it meanwhile, the block comes back with that text.
   */
  removeBlock(key: string): boolean {
    const block = this.find(key);
    if (!block || block.content !== "" || this.state.blocks.length <= 1) return false;
    const m = this.meta.get(key);
    if (m?.timer) clearTimeout(m.timer);
    this.meta.delete(key);
    this.setBlocks(this.state.blocks.filter((b) => b.key !== key));
    removeDraft(key);
    if (block.id) {
      this.api.deleteBlock(block.id, block.version).then(
        (result) => {
          if (!result.ok) this.setBlocks(sortBlocks([...this.state.blocks, fromServer(result.current)]));
        },
        () => {
          // Offline: the empty block may show up again on the next load. No text is lost.
        },
      );
    }
    return true;
  }

  dismissNotice(): void {
    if (this.state.notice) this.set({ notice: null });
  }

  // ---- saving --------------------------------------------------------------

  private newLocal(content: string, status: BlockStatus): PadBlock {
    return {
      key: newKey(),
      id: null,
      content,
      version: 0,
      createdAt: this.now().toISOString(),
      eventRef: null,
      status,
      remoteRev: 0,
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
        const created = await this.api.createBlock({ content: sent });
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
    });
    removeDraft(key);
    if (mine === current.content || mine.trim() === "") return;

    const copy = this.newLocal(conflictCopyContent(mine, this.now()), "pending");
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

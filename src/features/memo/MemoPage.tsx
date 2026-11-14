"use client";

import type { StateCommand } from "@codemirror/state";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import { formatKoreanTimestamp } from "@/shared/time";
import { Button, cx } from "@/ui/primitives";
import { BlockEditor, type BlockEditorHandle } from "./BlockEditor";
import { indentLines, outdentLines, toggleBold } from "./editor";
import { EventLabel } from "./EventLabel";
import { CloseIcon, NewBlockIcon, SearchIcon } from "./icons";
import styles from "./MemoPage.module.css";
import { MobileToolbar } from "./MobileToolbar";
import { MemoPad, type PadBlock } from "./store";

export interface MemoPageProps {
  /** From `/memo?block=<id>`: scroll to that block and focus it. */
  focusBlockId?: string | null;
}

const NARROW_QUERY = "(max-width: 899.98px)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function matchMediaSafe(query: string): boolean {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener?.("change", onChange);
      return () => mql.removeEventListener?.("change", onChange);
    },
    () => matchMediaSafe(query),
    () => false,
  );
}

const blockDomId = (key: string) => `memo-block-${key}`;

function scrollToBlock(key: string): void {
  const el = document.getElementById(blockDomId(key));
  el?.scrollIntoView?.({ block: "center", behavior: matchMediaSafe(REDUCED_MOTION_QUERY) ? "auto" : "smooth" });
}

function matches(block: PadBlock, query: string): boolean {
  if (!query) return true;
  return block.content.toLowerCase().includes(query) || (block.eventRef?.title.toLowerCase().includes(query) ?? false);
}

function editorLabel(block: PadBlock): string {
  if (block.eventRef) return `${block.eventRef.title} 일정 메모`;
  return `${formatKoreanTimestamp(block.createdAt)}에 만든 메모`;
}

/**
 * The memo pad (spec §5.3): one long page of blocks, newest on top, one
 * CodeMirror per block.
 *
 * Contract with the app shell: while a block is being edited on a narrow screen
 * (< 900px) this sets `document.body.dataset.editing = "true"`; the shell hides
 * the bottom tabs while that attribute is present.
 */
export function MemoPage({ focusBlockId = null }: MemoPageProps) {
  const [pad] = useState(() => new MemoPad());
  const state = useSyncExternalStore(pad.subscribe, pad.getSnapshot, pad.getSnapshot);
  const narrow = useMediaQuery(NARROW_QUERY);

  const editors = useRef(new Map<string, BlockEditorHandle>());
  const pendingFocus = useRef<{ key: string; at: "start" | "end" } | null>(null);
  const order = useRef<string[]>([]);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);

  /** Last block that had focus (cosmetic: which block is "current"). */
  const [lastFocusedKey, setLastFocusedKey] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    pad.start();
    return () => pad.dispose();
  }, [pad]);

  const q = query.trim().toLowerCase();
  const visible = state.blocks.filter((b) => matches(b, q));

  useEffect(() => {
    order.current = visible.map((b) => b.key);
  });

  // ---- focus plumbing -----------------------------------------------------

  // Refs and DOM only (no React state), so effects may call it.
  const focusBlock = useCallback((key: string, at: "start" | "end") => {
    const handle = editors.current.get(key);
    if (!handle) {
      pendingFocus.current = { key, at };
      return;
    }
    pendingFocus.current = null;
    scrollToBlock(key);
    handle.focus(at);
  }, []);

  const register = useCallback((key: string, handle: BlockEditorHandle | null) => {
    if (!handle) {
      editors.current.delete(key);
      return;
    }
    editors.current.set(key, handle);
    const pending = pendingFocus.current;
    if (pending?.key === key) {
      pendingFocus.current = null;
      scrollToBlock(key);
      handle.focus(pending.at);
    }
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setQuery("");
  }, []);

  const newBlock = useCallback(() => {
    closeSearch();
    focusBlock(pad.addBlock(), "start");
  }, [pad, focusBlock, closeSearch]);

  const onBoundary = useCallback(
    (key: string, dir: "up" | "down") => {
      const keys = order.current;
      const target = keys[keys.indexOf(key) + (dir === "up" ? -1 : 1)];
      if (!target) return false;
      focusBlock(target, dir === "up" ? "end" : "start");
      return true;
    },
    [focusBlock],
  );

  const onRemoveEmpty = useCallback(
    (key: string) => {
      const keys = order.current;
      const index = keys.indexOf(key);
      const neighbour = keys[index - 1] ?? keys[index + 1];
      if (!neighbour || !pad.removeBlock(key)) return false;
      focusBlock(neighbour, index > 0 ? "end" : "start");
      return true;
    },
    [pad, focusBlock],
  );

  const onChange = useCallback((key: string, content: string) => pad.edit(key, content), [pad]);

  const onFocusChange = useCallback((key: string, focused: boolean) => {
    if (focused) {
      setEditingKey(key);
      setLastFocusedKey(key);
      return;
    }
    // Focus may be moving to another block; only stop "editing" if no editor has it.
    setTimeout(() => {
      if (document.activeElement?.closest?.("[data-memo-editor]")) return;
      setEditingKey((current) => (current === key ? null : current));
    }, 80);
  }, []);

  // ---- ?block=<id> ----------------------------------------------------------

  const handledFocusId = useRef<string | null>(null);
  const refetchedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!focusBlockId || state.phase !== "ready" || handledFocusId.current === focusBlockId) return;
    const block = state.blocks.find((b) => b.id === focusBlockId);
    if (block) {
      handledFocusId.current = focusBlockId;
      focusBlock(block.key, "end");
    } else if (refetchedFor.current !== focusBlockId) {
      // Just created from an event on another screen: load it.
      refetchedFor.current = focusBlockId;
      void pad.load();
    }
  }, [focusBlockId, state.phase, state.blocks, pad, focusBlock]);

  // Empty memo pad on a wide screen: ready to type right away.
  const autoFocused = useRef(false);
  useEffect(() => {
    if (autoFocused.current || state.phase !== "ready" || focusBlockId || narrow) return;
    autoFocused.current = true;
    const only = state.blocks.length === 1 ? state.blocks[0] : null;
    if (only && only.id === null && only.content === "") focusBlock(only.key, "start");
  }, [state.phase, state.blocks, focusBlockId, narrow, focusBlock]);

  // ---- shortcuts and shell contract -----------------------------------------

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setSearchOpen(true);
        requestAnimationFrame(() => searchInput.current?.focus());
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (searchOpen) searchInput.current?.focus();
  }, [searchOpen]);

  const editingNarrow = narrow && editingKey !== null;
  useEffect(() => {
    if (!editingNarrow) return;
    document.body.dataset.editing = "true";
    return () => {
      delete document.body.dataset.editing;
    };
  }, [editingNarrow]);

  // ---- tool bar -------------------------------------------------------------

  const runOnEditing = useCallback(
    (command: StateCommand) => {
      const handle = editingKey ? editors.current.get(editingKey) : undefined;
      if (!handle) return;
      command(handle.view);
      handle.view.focus();
    },
    [editingKey],
  );

  const finishEditing = useCallback(() => {
    const handle = editingKey ? editors.current.get(editingKey) : undefined;
    handle?.view.contentDOM.blur();
    setEditingKey(null);
  }, [editingKey]);

  // ---- search -----------------------------------------------------------------

  const toggleSearch = () => {
    if (searchOpen) closeSearch();
    else setSearchOpen(true);
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSearch();
      searchButton.current?.focus();
    } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      const first = visible[0];
      if (!q || !first) return;
      // Un-hide every block first so the scroll lands in the right place.
      flushSync(closeSearch);
      focusBlock(first.key, "end");
    }
  };

  const searchResult = !q
    ? null
    : visible.length > 0
      ? `${visible.length}개 블록에서 찾았어요. Enter를 누르면 첫 블록으로 이동해요.`
      : "찾는 내용이 들어간 메모가 없어요. 다른 낱말로 찾아보세요.";

  // ---- render -----------------------------------------------------------------

  const dimOthers = editingKey !== null;
  const focusTargetKey = focusBlockId ? state.blocks.find((b) => b.id === focusBlockId)?.key : undefined;
  const activeKey = editingKey ?? lastFocusedKey ?? focusTargetKey ?? null;

  return (
    <div className={styles.page} data-toolbar={editingNarrow || undefined}>
      <header className={styles.header}>
        <h1 className={styles.title}>메모</h1>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="새 블록 만들기"
            title="새 블록 만들기 (⌘Enter)"
            onClick={newBlock}
            disabled={state.phase !== "ready"}
          >
            <NewBlockIcon size={20} />
          </button>
          <button
            ref={searchButton}
            type="button"
            className={styles.iconButton}
            aria-label={searchOpen ? "메모 검색 닫기" : "메모 검색"}
            title="메모 검색 (⌘F)"
            aria-expanded={searchOpen}
            aria-controls="memo-search"
            onClick={toggleSearch}
          >
            {searchOpen ? <CloseIcon size={20} /> : <SearchIcon />}
          </button>
        </div>
      </header>

      {searchOpen && (
        <div className={styles.search} role="search">
          <input
            ref={searchInput}
            id="memo-search"
            type="search"
            className={styles.searchInput}
            aria-label="메모에서 찾기"
            placeholder="메모 내용이나 일정 제목으로 찾기"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onSearchKeyDown}
            autoComplete="off"
            enterKeyHint="search"
          />
          <p className={styles.searchResult} aria-live="polite">
            {searchResult}
          </p>
        </div>
      )}

      {state.authRequired && state.phase === "ready" && (
        <p className={styles.status} role="status">
          로그인이 풀려 저장하지 못했어요. 쓴 내용은 이 기기에 보관해 두었으니{" "}
          <Link href="/login">다시 로그인</Link>해 주세요.
        </p>
      )}
      {state.offline && !state.authRequired && (
        <p className={styles.status} role="status">
          인터넷에 연결되지 않아 이 기기에 보관해 두었어요. 연결되면 바로 저장할게요.
        </p>
      )}
      {state.notice?.kind === "conflict" && (
        <div className={styles.notice} role="status">
          <p>다른 기기에서 먼저 고친 내용이 있어 그 내용을 보여 드리고, 여기서 쓴 내용은 맨 위 충돌 사본 블록으로 남겼어요.</p>
          <button type="button" className={styles.noticeClose} onClick={() => pad.dismissNotice()}>
            안내 닫기
          </button>
        </div>
      )}

      {state.phase === "loading" && <p className={styles.loading}>메모를 불러오고 있어요.</p>}
      {state.phase === "error" && (
        <div className={styles.error} role="alert">
          <p>{state.loadError}</p>
          {state.authRequired ? (
            <Link href="/login" className={styles.errorLink}>
              다시 로그인하기
            </Link>
          ) : (
            <Button variant="outline" onClick={() => void pad.load()}>
              메모 다시 불러오기
            </Button>
          )}
        </div>
      )}

      {state.phase === "ready" && (
        <div className={styles.blocks}>
          {state.blocks.map((block) => {
            const shown = matches(block, q);
            return (
              <section
                key={block.key}
                id={blockDomId(block.key)}
                className={styles.block}
                hidden={!shown}
                data-block-id={block.id ?? undefined}
                data-dim={(dimOthers && editingKey !== block.key) || undefined}
                data-active={activeKey === block.key || undefined}
              >
                <div className={styles.stamp}>
                  <span className="num">{formatKoreanTimestamp(block.createdAt)}</span>
                </div>
                {block.eventRef && <EventLabel eventRef={block.eventRef} />}
                <BlockEditor
                  blockKey={block.key}
                  content={block.content}
                  remoteRev={block.remoteRev}
                  label={editorLabel(block)}
                  placeholder={state.blocks.length === 1 ? "여기에 메모를 써 보세요." : undefined}
                  className={cx(styles.editor)}
                  onChange={onChange}
                  onNewBlock={newBlock}
                  onBoundary={onBoundary}
                  onRemoveEmpty={onRemoveEmpty}
                  onFocusChange={onFocusChange}
                  register={register}
                />
              </section>
            );
          })}
        </div>
      )}

      {editingNarrow && (
        <MobileToolbar
          onIndent={() => runOnEditing(indentLines)}
          onOutdent={() => runOnEditing(outdentLines)}
          onBold={() => runOnEditing(toggleBold)}
          onNewBlock={newBlock}
          onDone={finishEditing}
        />
      )}
    </div>
  );
}

"use client";

import type { StateCommand } from "@codemirror/state";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { onDataChanged, onNewMemoRequest, takeNewMemoTitle } from "@/features/shell/events";
import { useIsWide } from "@/features/shell/useMediaQuery";
import { formatKoreanTimestamp } from "@/shared/time";
import { Button, Sheet, cx } from "@/ui/primitives";
import { BlockEditor, type BlockEditorHandle } from "./BlockEditor";
import { memoHref } from "./client";
import { indentLines, outdentLines, toggleBold } from "./editor";
import { EventLabel } from "./EventLabel";
import { formatMemoTime, memoPreview, memoTitle } from "./format";
import { BackIcon, CalendarIcon, CloseIcon, FileIcon, PlusIcon, SearchIcon, TrashIcon } from "./icons";
import styles from "./MemoPage.module.css";
import { MobileToolbar } from "./MobileToolbar";
import { MemoPad, type PadBlock } from "./store";

export interface MemoPageProps {
  /** `?id=` (or the old `?block=`) from the server render; the URL is read live afterwards. */
  initialId?: string | null;
}

const UNTITLED = "새 메모";

function matches(block: PadBlock, query: string): boolean {
  if (!query) return true;
  return block.content.toLowerCase().includes(query) || (block.eventRef?.title.toLowerCase().includes(query) ?? false);
}

/** The memo the URL names: by client key (new, unsaved files) or server id. */
function findSelected(blocks: PadBlock[], ref: string | null): PadBlock | null {
  if (!ref) return null;
  return blocks.find((b) => b.key === ref || b.id === ref) ?? null;
}

function setUrl(href: string, how: "push" | "replace"): void {
  if (how === "push") window.history.pushState(null, "", href);
  else window.history.replaceState(null, "", href);
}

function statusText(block: PadBlock): string {
  if (block.status === "pending") return "저장하고 있어요";
  if (block.status === "offline") return "이 기기에 보관했어요";
  return "저장했어요";
}

/**
 * 메모 (spec §5.3, files edition): every memo is a file whose first line is its
 * title. Phone: the list, then one file full screen with its own back button.
 * 900px and wider: the list on the left and the open file on the right.
 *
 * Contracts with the app shell (on phones):
 * - `body[data-editing="true"]` while typing hides the bottom tabs and top bar;
 * - `body[data-own-header="true"]` while a file is open hides the top bar, since
 *   the file has its own header with a back button.
 */
export function MemoPage({ initialId = null }: MemoPageProps) {
  const [pad] = useState(() => new MemoPad());
  const state = useSyncExternalStore(pad.subscribe, pad.getSnapshot, pad.getSnapshot);
  const wide = useIsWide();
  const params = useSearchParams();
  const urlRef = params ? (params.get("id") ?? params.get("block")) : initialId;
  const newRequest = params ? params.get("new") : null;

  const editor = useRef<BlockEditorHandle | null>(null);
  const pendingFocus = useRef<"start" | "end" | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const openedFromList = useRef(false);
  const searchHintId = useId();

  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    pad.start();
    return () => pad.dispose();
  }, [pad]);

  const selected = findSelected(state.blocks, urlRef);
  const q = query.trim().toLowerCase();
  const visible = state.blocks.filter((b) => matches(b, q));
  const ready = state.phase === "ready";

  // ---- navigation -------------------------------------------------------------

  const open = useCallback(
    (key: string, how: "push" | "replace" = "push", focus: "start" | "end" | null = null) => {
      const block = pad.find(key);
      pendingFocus.current = focus;
      if (how === "push") openedFromList.current = true;
      setUrl(memoHref(block?.id ?? key), how);
    },
    [pad],
  );

  const backToList = useCallback(() => {
    if (openedFromList.current) {
      openedFromList.current = false;
      window.history.back();
    } else {
      setUrl("/memo", "replace");
    }
  }, []);

  const newFile = useCallback(
    (content = "") => {
      setQuery("");
      const key = pad.addBlock(content);
      open(key, "push", "end");
    },
    [pad, open],
  );

  // A new file that just got its server id: put the id in the URL.
  useEffect(() => {
    if (selected?.id && urlRef !== selected.id) setUrl(memoHref(selected.id), "replace");
  }, [selected?.id, urlRef]);

  // Leaving a memo that has no text drops it (event memos stay).
  const lastSelectedKey = useRef<string | null>(null);
  useEffect(() => {
    const previous = lastSelectedKey.current;
    lastSelectedKey.current = selected?.key ?? null;
    if (previous && previous !== selected?.key) pad.removeBlock(previous);
  }, [selected?.key, pad]);

  // Wide screens always show a file: the most recent one when none is named.
  useEffect(() => {
    if (wide !== true || !ready || urlRef || newRequest !== null) return;
    const first = state.blocks[0];
    if (first) setUrl(memoHref(first.id ?? first.key), "replace");
  }, [wide, ready, urlRef, newRequest, state.blocks]);

  // `?id=` that isn't loaded (just made from an event on another screen): load once.
  const refetchedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !urlRef || selected || refetchedFor.current === urlRef) return;
    refetchedFor.current = urlRef;
    void pad.load();
  }, [ready, urlRef, selected, pad]);

  // `?new` from 빠른 추가 on another screen (once per request). The typed first
  // line comes from memory, never from the URL, so a crafted link can only open
  // an empty memo, which is not saved until something is typed.
  const handledNew = useRef(false);
  useEffect(() => {
    if (newRequest === null) {
      handledNew.current = false;
      return;
    }
    if (!ready || handledNew.current) return;
    handledNew.current = true;
    const title = takeNewMemoTitle()?.trim() ?? "";
    const key = pad.addBlock(title ? `${title}\n` : "");
    open(key, "replace", "end");
  }, [ready, newRequest, pad, open]);

  // + / ⌘N on the memo tab.
  useEffect(() => onNewMemoRequest(() => newFile()), [newFile]);

  // An event memo made elsewhere (event sheet): pick it up.
  useEffect(
    () =>
      onDataChanged((kind) => {
        if (kind === "memo") void pad.load();
      }),
    [pad],
  );

  // ---- editor plumbing ----------------------------------------------------------

  const register = useCallback(
    (_key: string, handle: BlockEditorHandle | null) => {
      editor.current = handle;
      if (!handle) return;
      const at = pendingFocus.current ?? (wide === true ? "end" : null);
      pendingFocus.current = null;
      if (at) handle.focus(at);
    },
    [wide],
  );

  const onChange = useCallback((key: string, content: string) => pad.edit(key, content), [pad]);
  const onFocusChange = useCallback((_key: string, focused: boolean) => {
    if (focused) {
      setEditing(true);
      return;
    }
    setTimeout(() => {
      if (document.activeElement?.closest?.("[data-memo-editor]")) return;
      setEditing(false);
    }, 80);
  }, []);

  const runOnEditor = useCallback((command: StateCommand) => {
    const handle = editor.current;
    if (!handle) return;
    command(handle.view);
    handle.view.focus();
  }, []);

  const finishEditing = useCallback(() => {
    editor.current?.view.contentDOM.blur();
    setEditing(false);
  }, []);

  // ---- shell contract (phones) ----------------------------------------------------

  const phone = wide === false;
  const editingPhone = phone && editing && selected !== null;
  useEffect(() => {
    if (!editingPhone) return;
    document.body.dataset.editing = "true";
    return () => {
      delete document.body.dataset.editing;
    };
  }, [editingPhone]);

  const fileOnPhone = phone && selected !== null;
  useEffect(() => {
    if (!fileOnPhone) return;
    document.body.dataset.ownHeader = "true";
    return () => {
      delete document.body.dataset.ownHeader;
    };
  }, [fileOnPhone]);

  // ---- search -----------------------------------------------------------------------

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f") {
        if (phone && selected) return;
        event.preventDefault();
        searchInput.current?.focus();
        searchInput.current?.select();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [phone, selected]);

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setQuery("");
    } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      const first = visible[0];
      if (q && first) open(first.key, "push", "end");
    }
  };

  const searchResult = !q
    ? null
    : visible.length > 0
      ? `메모 ${visible.length}개를 찾았어요. Enter를 누르면 첫 메모를 열어요.`
      : "찾는 내용이 들어간 메모가 없어요. 다른 낱말로 찾아보세요.";

  // ---- delete -----------------------------------------------------------------------

  const deleteSelected = () => {
    if (!selected) return;
    const index = state.blocks.findIndex((b) => b.key === selected.key);
    const next = state.blocks[index + 1] ?? state.blocks[index - 1] ?? null;
    setConfirmDelete(false);
    lastSelectedKey.current = null;
    pad.deleteBlock(selected.key);
    if (phone || !next) setUrl("/memo", "replace");
    else setUrl(memoHref(next.id ?? next.key), "replace");
  };

  // ---- render -----------------------------------------------------------------------

  const onRowClick = (event: MouseEvent<HTMLAnchorElement>, key: string) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    open(key, wide === true ? "replace" : "push");
  };

  const notices = (
    <>
      {state.authRequired && ready && (
        <p className={styles.status} role="status">
          로그인이 풀려 저장하지 못했어요. 쓴 내용은 이 기기에 보관해 두었으니 <Link href="/login">다시 로그인</Link>해
          주세요.
        </p>
      )}
      {state.offline && !state.authRequired && (
        <p className={styles.status} role="status">
          인터넷에 연결되지 않아 이 기기에 보관해 두었어요. 연결되면 바로 저장할게요.
        </p>
      )}
      {state.notice?.kind === "conflict" && (
        <div className={styles.notice} role="status">
          <p>다른 기기에서 먼저 고친 내용이 있어 그 내용을 보여 드리고, 여기서 쓴 내용은 충돌 사본 메모로 따로 남겼어요.</p>
          <div className={styles.noticeActions}>
            <button
              type="button"
              className={styles.noticeButton}
              onClick={() => {
                const key = state.notice?.kind === "conflict" ? state.notice.copyKey : null;
                pad.dismissNotice();
                if (key) open(key, "push");
              }}
            >
              사본 열기
            </button>
            <button type="button" className={styles.noticeButton} onClick={() => pad.dismissNotice()}>
              안내 닫기
            </button>
          </div>
        </div>
      )}
      {state.notice?.kind === "deleteConflict" && (
        <div className={styles.notice} role="status">
          <p>다른 기기에서 방금 고친 메모라 지우지 않고 남겨 두었어요. 내용을 확인한 뒤 다시 지워 주세요.</p>
          <div className={styles.noticeActions}>
            <button type="button" className={styles.noticeButton} onClick={() => pad.dismissNotice()}>
              안내 닫기
            </button>
          </div>
        </div>
      )}
    </>
  );

  return (
    <div className={styles.page} data-view={selected ? "file" : "list"}>
      <h1 className="sr-only">메모</h1>

      <section className={styles.listPane} aria-label="메모 목록">
        <div className={styles.listHead}>
          <div className={styles.searchBox} role="search">
            <SearchIcon size={18} />
            <input
              ref={searchInput}
              type="search"
              className={styles.searchInput}
              aria-label="메모 찾기"
              aria-describedby={q ? searchHintId : undefined}
              placeholder="메모 찾기"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onSearchKeyDown}
              autoComplete="off"
              enterKeyHint="search"
            />
            {query && (
              <button type="button" className={styles.clear} aria-label="검색어 지우기" onClick={() => setQuery("")}>
                <CloseIcon size={16} />
              </button>
            )}
          </div>
          <button
            type="button"
            className={cx(styles.iconButton, styles.newInList)}
            aria-label="새 메모"
            title="새 메모 (⌘N)"
            onClick={() => newFile()}
            disabled={!ready}
          >
            <PlusIcon />
          </button>
        </div>
        {searchResult && (
          <p id={searchHintId} className={styles.searchResult} aria-live="polite">
            {searchResult}
          </p>
        )}

        {!selected && <div className={styles.listNotices}>{notices}</div>}

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

        {ready && state.blocks.length === 0 && (
          <div className={styles.empty}>
            <span className={styles.emptyMark} aria-hidden="true">
              <FileIcon size={28} strokeWidth={1.7} />
            </span>
            <p className={styles.emptyTitle}>아직 메모가 없어요.</p>
            <p className={styles.emptyText}>첫 줄이 메모 이름이 돼요. 일정에서 메모를 쓰면 여기에 함께 모여요.</p>
            <Button onClick={() => newFile()}>새 메모 쓰기</Button>
          </div>
        )}

        {ready && visible.length > 0 && (
          <ul className={styles.files}>
            {visible.map((block) => {
              const title = memoTitle(block) || UNTITLED;
              const preview = memoPreview(block);
              const on = selected?.key === block.key;
              return (
                <li key={block.key}>
                  <a
                    href={memoHref(block.id ?? block.key)}
                    className={styles.file}
                    aria-current={on ? "page" : undefined}
                    onClick={(event) => onRowClick(event, block.key)}
                  >
                    <span className={styles.fileTitle}>
                      {block.eventRef ? (
                        <span className={cx(styles.fileIcon, styles.eventIcon)} role="img" aria-label="일정 메모">
                          <CalendarIcon size={13} />
                        </span>
                      ) : (
                        <span className={styles.fileIcon} aria-hidden="true">
                          <FileIcon size={14} strokeWidth={2} />
                        </span>
                      )}
                      <span className={styles.fileName}>{title}</span>
                    </span>
                    <span className={styles.fileMeta}>
                      <span className={cx("num", styles.fileTime)}>{formatMemoTime(block.updatedAt)}</span>
                      <span className={styles.filePreview}>{preview || "내용 없음"}</span>
                    </span>
                    {block.status === "offline" && <span className={styles.fileStatus}>이 기기에만 있어요</span>}
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className={styles.filePane} aria-label={selected ? `${memoTitle(selected) || UNTITLED} 메모` : "메모"}>
        {selected ? (
          <>
            <header className={styles.fileHead}>
              <button type="button" className={cx(styles.iconButton, styles.back)} onClick={backToList}>
                <BackIcon />
                <span>메모</span>
              </button>
              <span className={styles.fileStatusText} aria-live="polite">
                {statusText(selected)}
              </span>
              <button
                type="button"
                className={styles.iconButton}
                aria-label="이 메모 지우기"
                title="이 메모 지우기"
                onClick={() => setConfirmDelete(true)}
              >
                <TrashIcon />
              </button>
            </header>
            <div className={styles.paneNotices}>{notices}</div>
            <article className={styles.doc} data-toolbar={editingPhone || undefined}>
              <p className={styles.stamp}>
                <span className="num">{formatKoreanTimestamp(selected.updatedAt)}</span>에 고침
              </p>
              {selected.eventRef && <EventLabel eventRef={selected.eventRef} className={styles.label} />}
              <BlockEditor
                key={selected.key}
                blockKey={selected.key}
                content={selected.content}
                remoteRev={selected.remoteRev}
                titled={!selected.eventRef}
                label={selected.eventRef ? `${selected.eventRef.title} 일정 메모` : "메모 내용"}
                placeholder={selected.eventRef ? "회의에서 나온 이야기를 적어 보세요." : "첫 줄에 메모 이름을 쓰고 Enter를 눌러 이어 써 보세요."}
                className={styles.editor}
                onChange={onChange}
                onNewBlock={() => newFile()}
                onBoundary={() => false}
                onRemoveEmpty={() => false}
                onFocusChange={onFocusChange}
                register={register}
              />
            </article>
          </>
        ) : (
          ready &&
          state.blocks.length > 0 && (
            <div className={styles.paneEmpty}>
              {urlRef ? (
                <>
                  <p className={styles.emptyTitle}>이 메모를 찾지 못했어요.</p>
                  <p className={styles.emptyText}>다른 기기에서 지웠을 수 있어요. 목록에서 다른 메모를 골라 주세요.</p>
                  <Button variant="outline" onClick={() => setUrl("/memo", "replace")}>
                    메모 목록 보기
                  </Button>
                </>
              ) : (
                <p className={styles.emptyText}>왼쪽 목록에서 메모를 고르세요.</p>
              )}
            </div>
          )
        )}
      </section>

      {editingPhone && (
        <MobileToolbar
          onIndent={() => runOnEditor(indentLines)}
          onOutdent={() => runOnEditor(outdentLines)}
          onBold={() => runOnEditor(toggleBold)}
          onDone={finishEditing}
        />
      )}

      <Sheet open={confirmDelete} onClose={() => setConfirmDelete(false)} title="이 메모를 지울까요?">
        <div className={styles.confirm}>
          <p>
            {selected?.eventRef
              ? "일정은 그대로 두고 이 일정에 쓴 메모만 지워요. 지운 메모는 되살릴 수 없어요."
              : `‘${(selected && memoTitle(selected)) || UNTITLED}’ 메모를 지워요. 지운 메모는 되살릴 수 없어요.`}
          </p>
          <div className={styles.confirmActions}>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              그대로 두기
            </Button>
            <Button className={styles.danger} onClick={deleteSelected}>
              메모 지우기
            </Button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}

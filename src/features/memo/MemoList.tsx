"use client";

import type { MouseEvent } from "react";
import type { MemoFolder } from "@/shared/contracts";
import { hueStyle } from "@/ui/hues";
import { cx } from "@/ui/primitives";
import { memoHref } from "./client";
import { memoHue, type MemoGroups } from "./folders";
import { formatMemoTime, memoPreview, memoTitle } from "./format";
import { CalendarIcon, ChevronIcon, FileIcon, FolderIcon, MoreIcon, PlusIcon } from "./icons";
import styles from "./MemoPage.module.css";
import type { PadBlock } from "./store";

export const UNTITLED = "새 메모";

export interface MemoListProps {
  groups: MemoGroups;
  folders: readonly MemoFolder[];
  selectedKey: string | null;
  /** A search is on: folders are shown open and can't be closed. */
  searching: boolean;
  onOpen(event: MouseEvent<HTMLAnchorElement>, key: string): void;
  onToggleFolder(id: string): void;
  onNewInFolder(id: string): void;
  onFolderMenu(id: string): void;
}

/** The memo list: folders (가나다순) with their memos, then the memos outside any folder. */
export function MemoList({ groups, folders, selectedKey, searching, onOpen, onToggleFolder, onNewInFolder, onFolderMenu }: MemoListProps) {
  const row = (block: PadBlock) => (
    <MemoRow key={block.key} block={block} folders={folders} current={selectedKey === block.key} onOpen={onOpen} />
  );
  return (
    <>
      {groups.folders.length > 0 && (
        <ul className={styles.tree}>
          {groups.folders.map(({ folder, open, memos }) => {
            const bodyId = `memo-folder-${folder.id}`;
            const holdsCurrent = !open && memos.some((m) => m.key === selectedKey);
            return (
              <li key={folder.id} className={styles.folder} style={hueStyle(folder.hue)}>
                <div className={styles.folderRow} data-current={holdsCurrent || undefined}>
                  <button
                    type="button"
                    className={styles.folderToggle}
                    aria-label={`${folder.name} 폴더`}
                    aria-expanded={open}
                    aria-controls={open ? bodyId : undefined}
                    onClick={() => !searching && onToggleFolder(folder.id)}
                  >
                    <span className={styles.chevron} aria-hidden="true">
                      <ChevronIcon />
                    </span>
                    <span className={styles.folderIcon} aria-hidden="true">
                      <FolderIcon size={14} />
                    </span>
                    <span className={styles.folderName}>{folder.name}</span>
                    <span className={cx("num", styles.folderCount)} aria-hidden="true">
                      {memos.length}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={cx(styles.iconButton, styles.folderTool)}
                    aria-label={`‘${folder.name}’ 폴더 메뉴`}
                    title="이름 · 색 · 지우기"
                    onClick={() => onFolderMenu(folder.id)}
                  >
                    <MoreIcon />
                  </button>
                  <button
                    type="button"
                    className={cx(styles.iconButton, styles.folderTool)}
                    aria-label={`‘${folder.name}’ 폴더에 새 메모`}
                    title="이 폴더에 새 메모"
                    onClick={() => onNewInFolder(folder.id)}
                  >
                    <PlusIcon size={18} />
                  </button>
                </div>
                {open &&
                  (memos.length > 0 ? (
                    <ul id={bodyId} className={cx(styles.files, styles.folderFiles)}>
                      {memos.map(row)}
                    </ul>
                  ) : (
                    <p id={bodyId} className={styles.folderEmpty}>
                      메모가 없어요
                    </p>
                  ))}
              </li>
            );
          })}
        </ul>
      )}
      {groups.loose.length > 0 && (
        <ul className={cx(styles.files, groups.folders.length > 0 && styles.looseFiles)}>{groups.loose.map(row)}</ul>
      )}
    </>
  );
}

function MemoRow({
  block,
  folders,
  current,
  onOpen,
}: {
  block: PadBlock;
  folders: readonly MemoFolder[];
  current: boolean;
  onOpen(event: MouseEvent<HTMLAnchorElement>, key: string): void;
}) {
  const title = memoTitle(block) || UNTITLED;
  const preview = memoPreview(block);
  return (
    <li>
      <a
        href={memoHref(block.id ?? block.key)}
        className={styles.file}
        style={hueStyle(memoHue(block, folders))}
        aria-current={current ? "page" : undefined}
        onClick={(event) => onOpen(event, block.key)}
      >
        <span className={styles.fileTitle}>
          {block.eventRef ? (
            <span className={styles.fileIcon} role="img" aria-label="일정 메모">
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
}

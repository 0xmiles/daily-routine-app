"use client";

import { useEffect, useState, type CSSProperties, type MouseEvent } from "react";
import { IndentIcon, NewBlockIcon, OutdentIcon } from "./icons";
import styles from "./MobileToolbar.module.css";

export interface MobileToolbarProps {
  onIndent(): void;
  onOutdent(): void;
  onBold(): void;
  /** 제목: the line goes plain → # → ## → ### → plain. */
  onHeading(): void;
  /** Optional: shows a "새 메모" tool. */
  onNewBlock?(): void;
  onDone(): void;
}

/** Height of the on-screen keyboard (0 when closed), from the visual viewport. */
function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = typeof window === "undefined" ? undefined : window.visualViewport;
    if (!vv) return;
    const update = () => setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return inset;
}

// Keep focus (and the keyboard) in the editor while a tool is pressed.
const keepFocus = (event: MouseEvent) => event.preventDefault();

/**
 * Tool bar that sits on top of the iPhone keyboard while a memo block is being
 * edited (under 900px): 들여쓰기, 내어쓰기, 굵게, 제목, 완료 (and 새 메모 when asked).
 */
export function MobileToolbar({ onIndent, onOutdent, onBold, onHeading, onNewBlock, onDone }: MobileToolbarProps) {
  const inset = useKeyboardInset();
  const style = { "--kb-inset": `${inset}px` } as CSSProperties;
  return (
    <div role="toolbar" aria-label="메모 편집 도구" className={styles.bar} style={style} data-keyboard={inset > 0}>
      <button type="button" className={styles.tool} aria-label="들여쓰기" onMouseDown={keepFocus} onClick={onIndent}>
        <IndentIcon />
      </button>
      <button type="button" className={styles.tool} aria-label="내어쓰기" onMouseDown={keepFocus} onClick={onOutdent}>
        <OutdentIcon />
      </button>
      <button type="button" className={`${styles.tool} ${styles.bold}`} aria-label="굵게" onMouseDown={keepFocus} onClick={onBold}>
        B
      </button>
      <button type="button" className={`${styles.tool} ${styles.bold}`} aria-label="제목" onMouseDown={keepFocus} onClick={onHeading}>
        H
      </button>
      {onNewBlock && (
        <button type="button" className={styles.tool} aria-label="새 메모" onMouseDown={keepFocus} onClick={onNewBlock}>
          <NewBlockIcon />
        </button>
      )}
      <button type="button" className={styles.done} aria-label="완료" onMouseDown={keepFocus} onClick={onDone}>
        완료
      </button>
    </div>
  );
}

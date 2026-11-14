"use client";

import { useEffect, useEffectEvent, useId, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "./cx";
import styles from "./Sheet.module.css";

export interface SheetProps {
  open: boolean;
  /** Called on Esc, backdrop click and the close button. The parent sets open=false. */
  onClose: () => void;
  /** Dialog heading; also its accessible name. */
  title: ReactNode;
  children?: ReactNode;
  /** Extra class for the panel. */
  className?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

// Only the top-most open sheet reacts to Esc / Tab.
const openStack: symbol[] = [];

const noopSubscribe = () => () => {};
function useIsClient(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

/**
 * Modal sheet: bottom sheet under 900px, centered dialog at 900px and wider.
 * Closes on Esc and backdrop click; traps Tab focus; restores focus on close.
 */
export function Sheet({ open, ...props }: SheetProps) {
  const isClient = useIsClient();
  if (!open || !isClient) return null;
  return createPortal(<SheetPanel {...props} />, document.body);
}

function SheetPanel({ onClose, title, children, className }: Omit<SheetProps, "open">) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = useEffectEvent(() => onClose());

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const token = Symbol("sheet");
    openStack.push(token);
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!panel.contains(document.activeElement)) panel.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (openStack[openStack.length - 1] !== token || !panel) return;
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const outside = !panel.contains(active) || active === panel;
      if (event.shiftKey && (active === first || outside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || outside)) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const index = openStack.indexOf(token);
      if (index !== -1) openStack.splice(index, 1);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  return (
    <div className={styles.root}>
      <div className={styles.backdrop} data-sheet-backdrop="" aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx(styles.panel, className)}
      >
        <div className={styles.grabber} aria-hidden="true" />
        <div className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          <button type="button" className={styles.close} aria-label="닫기" onClick={onClose}>
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );
}

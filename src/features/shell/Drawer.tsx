"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { cx } from "@/ui/primitives";
import { AssetsIcon, MemoIcon, PinIcon, SettingsIcon, TodoIcon, UploadIcon } from "./icons";
import { sectionOf } from "./sections";
import { todoViewOf } from "./TodoSegment";
import styles from "./Drawer.module.css";

export interface DrawerProps {
  id: string;
  /** overlay: covers the content with a scrim. pinned: a sidebar next to the content. */
  mode: "overlay" | "pinned";
  pathname: string | null;
  pinned: boolean;
  onTogglePin: () => void;
  /** Called when a menu item is chosen. */
  onNavigate: () => void;
  /** Scrim click (overlay only). Esc is handled by the shell. */
  onClose: () => void;
}

export function Drawer({ id, mode, pathname, pinned, onTogglePin, onNavigate, onClose }: DrawerProps) {
  const panelRef = useRef<HTMLElement>(null);
  const section = sectionOf(pathname);
  const todoView = todoViewOf(pathname);

  // Overlay: move focus into the drawer so keyboard users land on the menu.
  useEffect(() => {
    if (mode !== "overlay") return;
    panelRef.current?.querySelector<HTMLElement>("a, button")?.focus();
  }, [mode]);

  const item = (href: string, label: string, on: boolean, icon: React.ReactNode, sub = false) => (
    <Link
      href={href}
      className={cx(sub ? styles.sub : styles.item, on && styles.on)}
      aria-current={on ? "page" : undefined}
      onClick={onNavigate}
    >
      {icon}
      <span className={on ? "hl" : undefined}>{label}</span>
    </Link>
  );

  const panel = (
    <aside
      ref={panelRef}
      id={id}
      className={cx(styles.panel, mode === "overlay" ? styles.floating : styles.sidebar)}
    >
      <div className={styles.head}>
        <span className={styles.logo}>데일리</span>
        <button
          type="button"
          className={cx(styles.pin, pinned && styles.pinOn)}
          aria-pressed={pinned}
          onClick={onTogglePin}
        >
          <PinIcon size={13} />
          고정
        </button>
      </div>
      <nav aria-label="전체 메뉴" className={styles.nav}>
        <div className={styles.group}>
          {item("/today", "할 일", section === "todo" && todoView === null, <TodoIcon size={16} />)}
          {item("/today", "오늘", todoView === "today", null, true)}
          {item("/calendar", "달력", todoView === "calendar", null, true)}
          {item("/list", "목록", todoView === "list", null, true)}
          {item("/memo", "메모", section === "memo", <MemoIcon size={16} />)}
          {item("/assets", "자산", section === "assets", <AssetsIcon size={16} />)}
        </div>
        <div className={styles.bottom}>
          {item("/assets", "거래내역 올리기", false, <UploadIcon size={16} />)}
          {item("/settings", "설정", section === "settings", <SettingsIcon size={16} />)}
        </div>
      </nav>
    </aside>
  );

  if (mode === "pinned") return panel;
  return (
    <div className={styles.overlay}>
      <div className={styles.scrim} aria-hidden="true" onClick={onClose} />
      {panel}
    </div>
  );
}

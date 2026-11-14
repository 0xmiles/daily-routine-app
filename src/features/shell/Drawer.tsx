"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { cx } from "@/ui/primitives";
import { AssetsIcon, MemoIcon, PinIcon, SettingsIcon, TodoIcon, UploadIcon } from "./icons";
import { sectionOf } from "./sections";
import { todoViewOf } from "./TodoSegment";
import styles from "./Drawer.module.css";

type Tone = "todo" | "memo" | "assets" | "settings";

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

  // tone: the index colour of the menu this item opens (planner tabs, spec §9.4).
  const item = (href: string, label: string, on: boolean, icon: React.ReactNode, tone: Tone, sub = false) => (
    <Link
      href={href}
      className={cx(sub ? styles.sub : styles.item, on && styles.on)}
      data-tone={tone}
      aria-current={on ? "page" : undefined}
      onClick={onNavigate}
    >
      {icon && <span className={styles.tile}>{icon}</span>}
      <span>{label}</span>
    </Link>
  );

  const panel = (
    <aside
      ref={panelRef}
      id={id}
      className={cx(styles.panel, mode === "overlay" ? styles.floating : styles.sidebar)}
    >
      <div className={styles.head}>
        <span className={styles.logo}>
          {/* eslint-disable-next-line @next/next/no-img-element -- tiny static brand mark */}
          <img src="/icons/mark.svg" alt="" className={styles.mark} width={26} height={26} />
          <span className={styles.brand}>데일리</span>
        </span>
        <button
          type="button"
          className={cx(styles.pin, pinned && styles.pinOn)}
          aria-pressed={pinned}
          onClick={onTogglePin}
        >
          <PinIcon size={14} />
          고정
        </button>
      </div>
      <nav aria-label="전체 메뉴" className={styles.nav}>
        <div className={styles.group}>
          {item("/today", "할 일", section === "todo" && todoView === null, <TodoIcon size={16} />, "todo")}
          {item("/today", "오늘", todoView === "today", null, "todo", true)}
          {item("/calendar", "달력", todoView === "calendar", null, "todo", true)}
          {item("/list", "목록", todoView === "list", null, "todo", true)}
          {item("/memo", "메모", section === "memo", <MemoIcon size={16} />, "memo")}
          {item("/assets", "자산", section === "assets", <AssetsIcon size={16} />, "assets")}
        </div>
        <div className={styles.bottom}>
          {item("/assets", "거래내역 올리기", false, <UploadIcon size={16} />, "assets")}
          {item("/settings", "설정", section === "settings", <SettingsIcon size={16} />, "settings")}
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

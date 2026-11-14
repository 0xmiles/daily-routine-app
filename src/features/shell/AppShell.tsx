"use client";

import { usePathname } from "next/navigation";
import { useEffect, useEffectEvent, useId, useRef, useState, type ReactNode } from "react";
import { EventEditorSheet } from "@/features/calendar/EventEditorSheet";
import { TodoEditorSheet } from "@/features/todos/TodoEditorSheet";
import { cx } from "@/ui/primitives";
import { BottomTabs } from "./BottomTabs";
import { Drawer } from "./Drawer";
import { MenuIcon } from "./icons";
import { readPref, writePref } from "./prefs";
import { QuickAdd, type QuickAddKind } from "./QuickAdd";
import { SECTION_TITLES, sectionOf } from "./sections";
import { TodoSegment, todoViewOf } from "./TodoSegment";
import { useBodyFlag } from "./useBodyFlag";
import { useIsWide } from "./useMediaQuery";
import styles from "./AppShell.module.css";

interface DrawerPref {
  pinned: boolean;
  open: boolean;
}

const DRAWER_PREF = "drawer";
const TOAST_MS = 4000;

type Editor = { kind: "todo" } | { kind: "event"; title: string } | null;

function isBackslash(e: KeyboardEvent): boolean {
  // Korean Mac layouts type ₩ on the backslash key.
  return e.code === "Backslash" || e.key === "\\" || e.key === "₩";
}

function isN(e: KeyboardEvent): boolean {
  return e.code === "KeyN" || e.key.toLowerCase() === "n" || e.key === "ㅜ";
}

/**
 * App frame. Under 900px: bottom tabs + round + button. At 900px and wider:
 * a top bar with ☰ (⌘\), the 할 일 segment and "새로 만들기 ⌘N"; the drawer
 * covers the content, or stays as a sidebar when pinned (remembered per device).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const wide = useIsWide();
  const editing = useBodyFlag("editing");
  const drawerId = useId();
  const menuButton = useRef<HTMLButtonElement>(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [editor, setEditor] = useState<Editor>(null);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);

  const section = sectionOf(pathname);
  const todoView = todoViewOf(pathname);

  // Restore the pinned sidebar on this device. This must run after hydration:
  // the server can't read localStorage, so reading it during render would
  // produce markup that differs from the server's.
  useEffect(() => {
    const pref = readPref<DrawerPref>(DRAWER_PREF, { pinned: false, open: false });
    if (pref && pref.pinned) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- post-hydration restore from localStorage
      setPinned(true);
      setDrawerOpen(pref.open !== false);
    }
  }, []);

  // Keep the service worker (push notifications) registered and up to date.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function setDrawer(open: boolean, nextPinned = pinned) {
    setDrawerOpen(open);
    setPinned(nextPinned);
    writePref(DRAWER_PREF, { pinned: nextPinned, open: nextPinned ? open : false } satisfies DrawerPref);
  }

  function closeOverlay(restoreFocus: boolean) {
    setDrawer(false);
    if (restoreFocus) menuButton.current?.focus();
  }

  function openQuickAdd() {
    if (!pinned) setDrawerOpen(false);
    setEditor(null);
    setQuickOpen(true);
  }

  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.altKey && isBackslash(e)) {
      if (wide === false) return;
      e.preventDefault();
      setDrawer(!drawerOpen);
      return;
    }
    if (mod && !e.altKey && !e.shiftKey && isN(e)) {
      e.preventDefault();
      openQuickAdd();
      return;
    }
    if (e.key === "Escape" && drawerOpen && !pinned && !e.isComposing) {
      // Sheets handle their own Esc.
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      e.preventDefault();
      closeOverlay(true);
    }
  });

  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKeyDown(e);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);

  const showTop = wide !== false;
  const showTabs = wide !== true && !editing;
  const showDrawer = wide !== false && drawerOpen;

  return (
    <div className={cx(styles.shell, showTabs && styles.withTabs)}>
      <a href="#main" className={styles.skip}>
        본문으로 건너뛰기
      </a>

      {showDrawer && pinned && (
        <Drawer
          id={drawerId}
          mode="pinned"
          pathname={pathname}
          pinned
          onTogglePin={() => setDrawer(true, false)}
          onNavigate={() => {}}
          onClose={() => setDrawer(false)}
        />
      )}

      <div className={styles.column}>
        {showTop && (
          <header className={styles.topBar}>
            <button
              ref={menuButton}
              type="button"
              className={styles.menuButton}
              aria-label="메뉴 열기"
              aria-expanded={drawerOpen}
              aria-controls={drawerOpen ? drawerId : undefined}
              aria-keyshortcuts="Meta+Backslash"
              onClick={() => setDrawer(!drawerOpen)}
            >
              <MenuIcon size={15} />
            </button>
            {todoView ? (
              <TodoSegment active={todoView} variant="bar" />
            ) : (
              section && <span className={styles.title}>{SECTION_TITLES[section]}</span>
            )}
            <button
              type="button"
              className={styles.newButton}
              aria-keyshortcuts="Meta+N"
              onClick={openQuickAdd}
            >
              새로 만들기
              <kbd className={cx("num", styles.kbd)}>⌘N</kbd>
            </button>
          </header>
        )}

        <main id="main" className={styles.main} tabIndex={-1}>
          {children}
        </main>
      </div>

      {showDrawer && !pinned && (
        <Drawer
          id={drawerId}
          mode="overlay"
          pathname={pathname}
          pinned={false}
          onTogglePin={() => setDrawer(true, true)}
          onNavigate={() => closeOverlay(false)}
          onClose={() => closeOverlay(true)}
        />
      )}

      {showTabs && <BottomTabs pathname={pathname} onQuickAdd={openQuickAdd} />}

      <QuickAdd
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        defaultKind={todoView === "calendar" ? "event" : "todo"}
        onSaved={(text) => {
          setQuickOpen(false);
          setToast({ id: Date.now(), text });
        }}
        onMore={(kind: QuickAddKind, title: string) => {
          setQuickOpen(false);
          setEditor(kind === "todo" ? { kind: "todo" } : { kind: "event", title });
        }}
      />
      <TodoEditorSheet open={editor?.kind === "todo"} onClose={() => setEditor(null)} />
      {editor?.kind === "event" && (
        <EventEditorSheet open initialTitle={editor.title} onClose={() => setEditor(null)} />
      )}

      <div role="status" aria-live="polite" className={cx(styles.toast, toast && styles.toastOn)}>
        {toast?.text}
      </div>
    </div>
  );
}

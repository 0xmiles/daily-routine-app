"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useId, useRef, useState, type ReactNode } from "react";
import { EventEditorSheet } from "@/features/calendar/EventEditorSheet";
import { TodoEditorSheet } from "@/features/todos/TodoEditorSheet";
import { cx } from "@/ui/primitives";
import { BottomTabs } from "./BottomTabs";
import { Drawer } from "./Drawer";
import { requestNewMemo } from "./events";
import { MenuIcon, SettingsIcon } from "./icons";
import { readPref, writePref } from "./prefs";
import { QuickAdd, type QuickAddKind } from "./QuickAdd";
import { SECTION_TITLES, sectionOf } from "./sections";
import { TodoSegment, todoViewOf } from "./TodoSegment";
import { useBodyFlag } from "./useBodyFlag";
import { useIsWide, useMediaQuery } from "./useMediaQuery";
import styles from "./AppShell.module.css";

interface DrawerPref {
  pinned: boolean;
  open: boolean;
}

const DRAWER_PREF = "drawer";
/** With no saved choice, the menu starts pinned as a sidebar on roomy screens. */
const ROOMY_QUERY = "(min-width: 1200px)";
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
 * App frame. One top bar in the same place on every screen:
 * - under 900px: the 할 일 segment (or the section name) and a settings button;
 *   bottom tabs and a floating + button sit below.
 * - 900px and wider: ☰ (⌘\), the segment or section name, "새로 만들기 ⌘N".
 *   The drawer covers the content, or stays as a sidebar when pinned
 *   (remembered per device; pinned by default on screens ≥1200px).
 *
 * A page can take over the phone top bar (e.g. the memo editor with its own back
 * button) by setting `document.body.dataset.ownHeader = "true"`.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const wide = useIsWide();
  const roomy = useMediaQuery(ROOMY_QUERY);
  const editing = useBodyFlag("editing");
  const ownHeader = useBodyFlag("ownHeader");
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
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || roomy === null) return;
    restored.current = true;
    const pref = readPref<DrawerPref | null>(DRAWER_PREF, null);
    const pin = pref ? pref.pinned : roomy;
    if (pin) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- post-hydration restore from localStorage
      setPinned(true);
      setDrawerOpen(pref ? pref.open !== false : true);
    }
  }, [roomy]);

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
    // On the memo tab, + / ⌘N opens a new memo right away (no sheet).
    if (section === "memo") {
      setQuickOpen(false);
      requestNewMemo();
      return;
    }
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

  const showTabs = wide !== true && !editing;
  const showDrawer = wide !== false && drawerOpen;
  const hideNarrowBar = wide !== true && (editing || ownHeader);
  const heading = todoView ? (
    <TodoSegment active={todoView} variant="bar" />
  ) : (
    section && <span className={styles.title}>{SECTION_TITLES[section]}</span>
  );

  return (
    <div className={cx(styles.shell, showTabs && styles.withTabs)} data-section={section ?? undefined}>
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
        <header className={cx(styles.topBar, hideNarrowBar && styles.barHidden)}>
          {wide !== false && (
            <button
              ref={menuButton}
              type="button"
              className={cx(styles.iconButton, styles.wideOnly)}
              aria-label="메뉴 열기"
              aria-expanded={drawerOpen}
              aria-controls={drawerOpen ? drawerId : undefined}
              aria-keyshortcuts="Meta+Backslash"
              onClick={() => setDrawer(!drawerOpen)}
            >
              <MenuIcon size={18} />
            </button>
          )}
          {heading}
          {wide !== false && (
            <button
              type="button"
              className={cx(styles.newButton, styles.wideOnly)}
              aria-keyshortcuts="Meta+N"
              onClick={openQuickAdd}
            >
              {section === "memo" ? "새 메모" : "새로 만들기"}
              <kbd className={cx("num", styles.kbd)}>⌘N</kbd>
            </button>
          )}
          {wide !== true && section !== "settings" && (
            <Link href="/settings" className={cx(styles.iconButton, styles.narrowOnly, styles.end)} aria-label="설정">
              <SettingsIcon size={20} />
            </Link>
          )}
        </header>

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
        defaultKind={section === "memo" ? "memo" : todoView === "calendar" ? "event" : "todo"}
        onMemoCreated={(href: string) => {
          setQuickOpen(false);
          router.push(href);
        }}
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

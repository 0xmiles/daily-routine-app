"use client";

import Link from "next/link";
import { cx } from "@/ui/primitives";
import { AssetsIcon, MemoIcon, PlusIcon, TodoIcon } from "./icons";
import { sectionOf, type Section } from "./sections";
import styles from "./BottomTabs.module.css";

const TABS: Array<{ section: Section; href: string; label: string; Icon: typeof TodoIcon }> = [
  { section: "todo", href: "/today", label: "할 일", Icon: TodoIcon },
  { section: "memo", href: "/memo", label: "메모", Icon: MemoIcon },
  { section: "assets", href: "/assets", label: "자산", Icon: AssetsIcon },
];

export interface BottomTabsProps {
  pathname: string | null;
  onQuickAdd: () => void;
  className?: string;
}

/** Under 900px: 할 일 / 메모 / 자산 tabs and the round ink + button. */
export function BottomTabs({ pathname, onQuickAdd, className }: BottomTabsProps) {
  const current = sectionOf(pathname);
  return (
    <div className={cx(styles.root, className)}>
      <nav aria-label="주 메뉴" className={styles.tabs}>
        {TABS.map(({ section, href, label, Icon }) => {
          const on = section === current;
          return (
            <Link
              key={section}
              href={href}
              className={cx(styles.tab, on && styles.on)}
              aria-current={on ? "page" : undefined}
            >
              <Icon strokeWidth={on ? 2 : 1.8} />
              <span className={on ? "hl" : undefined}>{label}</span>
            </Link>
          );
        })}
      </nav>
      <button type="button" className={styles.fab} aria-label="빠른 추가" onClick={onQuickAdd}>
        <PlusIcon size={20} />
      </button>
    </div>
  );
}

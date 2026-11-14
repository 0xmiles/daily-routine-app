import Link from "next/link";
import { cx } from "@/ui/primitives";
import styles from "./TodoSegment.module.css";

export type TodoView = "today" | "calendar" | "list";

const ITEMS: Array<{ view: TodoView; href: string; label: string }> = [
  { view: "today", href: "/today", label: "오늘" },
  { view: "calendar", href: "/calendar", label: "달력" },
  { view: "list", href: "/list", label: "목록" },
];

export interface TodoSegmentProps {
  active: TodoView;
  /**
   * `page` (default): placed inside a 할 일 page; hidden at ≥900px because the
   * shell's top bar shows the segment there. `bar`: the top-bar copy.
   */
  variant?: "page" | "bar";
  className?: string;
}

/** 오늘 · 달력 · 목록 switch inside the 할 일 tab. The selected one is highlighted. */
export function TodoSegment({ active, variant = "page", className }: TodoSegmentProps) {
  return (
    <nav aria-label="할 일 보기" className={cx(styles.segment, styles[variant], className)}>
      {ITEMS.map((item) => {
        const on = item.view === active;
        return (
          <Link
            key={item.view}
            href={item.href}
            className={cx(styles.item, on && styles.on)}
            aria-current={on ? "page" : undefined}
          >
            <span className={on ? "hl" : undefined}>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/** Which segment a pathname belongs to, or null outside the 할 일 tab. */
export function todoViewOf(pathname: string | null): TodoView | null {
  if (!pathname) return null;
  if (pathname === "/today" || pathname.startsWith("/today/")) return "today";
  if (pathname === "/calendar" || pathname.startsWith("/calendar/")) return "calendar";
  if (pathname === "/list" || pathname.startsWith("/list/")) return "list";
  return null;
}

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
  /** Kept for callers; the segment lives only in the shell's top bar now. */
  variant?: "bar";
  className?: string;
}

/**
 * 오늘 · 달력 · 목록 switch inside the 할 일 tab. Rendered once, by the shell's
 * top bar, so it sits in the same place on all three views. The selected one is
 * highlighted (marker underlay, spec §5.7 rule 4).
 */
export function TodoSegment({ active, className }: TodoSegmentProps) {
  return (
    <nav aria-label="할 일 보기" className={cx(styles.segment, className)}>
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

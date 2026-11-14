import type { Recurrence, Todo } from "@/shared/contracts";
import { seoulToday } from "@/shared/time";
import { todayBucket } from "./rules";

// Display strings for todo rows. All dates are Seoul calendar dates.

const WEEKDAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"] as const;
/** Korean week order (Monday first) for labels and pickers. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

export function weekdayName(day: number): string {
  return WEEKDAY_NAMES[day] ?? "";
}

/** "매일", "매주 토", "매주 월, 수", "평일마다", "매월 5일" */
export function recurrenceLabel(r: Recurrence): string {
  switch (r.freq) {
    case "daily":
      return "매일";
    case "weekly": {
      const days = WEEK_ORDER.filter((d) => r.weekdays.includes(d));
      if (days.length === 7) return "매일";
      if (days.length === 5 && !r.weekdays.includes(0) && !r.weekdays.includes(6)) return "평일마다";
      return `매주 ${days.map(weekdayName).join(", ")}`;
    }
    case "monthly":
      return `매월 ${r.day}일`;
  }
}

function dayNumber(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

/** Whole calendar days from `a` to `b` ('YYYY-MM-DD'). */
export function daysBetween(a: string, b: string): number {
  return Math.round(dayNumber(b) - dayNumber(a));
}

/** "16일" (this month), "12월 3일" (this year), "2027년 1월 3일". */
export function shortDate(date: string, today: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (date.slice(0, 7) === today.slice(0, 7)) return `${d}일`;
  if (date.slice(0, 4) === today.slice(0, 4)) return `${m}월 ${d}일`;
  return `${y}년 ${m}월 ${d}일`;
}

export interface DueLabel {
  text: string;
  /** Overdue: drawn in --sun. */
  late: boolean;
}

function withTime(text: string, time: string | null): string {
  return time ? `${text} ${time}` : text;
}

/**
 * The right-hand text of a todo row.
 * - late: "어제까지", "3일 전까지", or "09:00까지" when today's time has passed
 * - today: "18:00" or "오늘"; tomorrow: "내일" / "내일 08:00"; later: "16일 18:00"
 * - recurring: "매주 토", "매일 07:00"
 * - undated: null
 */
export function dueLabel(todo: Todo, now: Date): DueLabel | null {
  if (!todo.dueDate) return null;
  const today = seoulToday(now);
  const bucket = todayBucket(todo, now);

  if (bucket === "overdue") {
    const daysLate = daysBetween(todo.dueDate, today);
    if (daysLate <= 0) return { text: `${todo.dueTime}까지`, late: true };
    return { text: daysLate === 1 ? "어제까지" : `${daysLate}일 전까지`, late: true };
  }
  if (bucket === "done") return { text: withTime(shortDate(todo.dueDate, today), todo.dueTime), late: false };
  if (todo.recurrence) return { text: withTime(recurrenceLabel(todo.recurrence), todo.dueTime), late: false };
  if (bucket === "today") return { text: todo.dueTime ?? "오늘", late: false };

  const ahead = daysBetween(today, todo.dueDate);
  return { text: withTime(ahead === 1 ? "내일" : shortDate(todo.dueDate, today), todo.dueTime), late: false };
}

/** Splits text into digit runs (drawn with `.num`) and the rest. */
export function splitNumbers(text: string): Array<{ text: string; num: boolean }> {
  const parts: Array<{ text: string; num: boolean }> = [];
  for (const match of text.matchAll(/(\d[\d:]*)|(\D+)/g)) {
    parts.push({ text: match[0], num: match[1] !== undefined });
  }
  return parts;
}

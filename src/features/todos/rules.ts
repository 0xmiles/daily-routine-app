import type { Recurrence, Todo } from "@/shared/contracts";
import { addDays, seoulDateTimeToDate, seoulToday, weekdayOf } from "@/shared/time";

// Pure todo rules, shared by the API and the UI. Every "today" / due / notify
// calculation is done on the Seoul calendar (the server runs in UTC).

export type TodoBucket = "overdue" | "today" | "upcoming" | "nodate" | "done";

export interface NotifySettings {
  defaultOffsetMin: number;
  dateOnlyNotifyTime: string; // 'HH:MM' Seoul
}

const BUCKET_ORDER: Record<TodoBucket, number> = { overdue: 0, today: 1, upcoming: 2, nodate: 3, done: 4 };

/**
 * Where a todo sits relative to `now` (Seoul). A todo due today whose time has
 * already passed is overdue; a date-only todo is overdue from the next day.
 */
export function todayBucket(todo: Todo, now: Date): TodoBucket {
  if (todo.doneAt) return "done";
  if (!todo.dueDate) return "nodate";
  const today = seoulToday(now);
  if (todo.dueDate < today) return "overdue";
  if (todo.dueDate > today) return "upcoming";
  if (todo.dueTime && now.getTime() > seoulDateTimeToDate(todo.dueDate, todo.dueTime).getTime()) return "overdue";
  return "today";
}

function parseYmd(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split("-").map(Number);
  return { y, m, d };
}

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Monthly occurrence date in month (y, m): `day`, clamped to the month's last day. */
function monthlyDate(y: number, m: number, day: number): string {
  return ymd(y, m, Math.min(day, daysInMonth(y, m)));
}

function weekdaysOf(r: Extract<Recurrence, { freq: "weekly" }>, fallbackDate: string): number[] {
  const days = r.weekdays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  return days.length > 0 ? days : [weekdayOf(fallbackDate)];
}

/** True when the recurrence has an occurrence on `date`. */
export function occursOn(r: Recurrence, date: string): boolean {
  switch (r.freq) {
    case "daily":
      return true;
    case "weekly":
      return weekdaysOf(r, date).includes(weekdayOf(date));
    case "monthly": {
      const { y, m } = parseYmd(date);
      return monthlyDate(y, m, r.day) === date;
    }
  }
}

/**
 * The next occurrence strictly after `fromDate` ('YYYY-MM-DD').
 * Monthly days past the end of a month (e.g. 31) clamp to that month's last day.
 */
export function nextOccurrence(r: Recurrence, fromDate: string): string {
  switch (r.freq) {
    case "daily":
      return addDays(fromDate, 1);
    case "weekly": {
      const days = weekdaysOf(r, fromDate);
      for (let i = 1; i <= 7; i++) {
        const candidate = addDays(fromDate, i);
        if (days.includes(weekdayOf(candidate))) return candidate;
      }
      return addDays(fromDate, 7); // unreachable: every weekday appears within 7 days
    }
    case "monthly": {
      const { y, m } = parseYmd(fromDate);
      const day = Math.min(Math.max(Math.trunc(r.day), 1), 31);
      const thisMonth = monthlyDate(y, m, day);
      if (thisMonth > fromDate) return thisMonth;
      return m === 12 ? monthlyDate(y + 1, 1, day) : monthlyDate(y, m + 1, day);
    }
  }
}

/** The first occurrence on or after `fromDate`. */
export function firstOccurrence(r: Recurrence, fromDate: string): string {
  return occursOn(r, fromDate) ? fromDate : nextOccurrence(r, fromDate);
}

/**
 * When to notify for a todo, or null (notifications off, no due date, or done).
 * - with a time: due time minus `offsetMin` (null → settings.defaultOffsetMin)
 * - date only: settings.dateOnlyNotifyTime on the due date (the offset does not apply)
 */
export function notifyAt(todo: Todo, s: NotifySettings): Date | null {
  if (!todo.notify.enabled || !todo.dueDate || todo.doneAt) return null;
  if (!todo.dueTime) return seoulDateTimeToDate(todo.dueDate, s.dateOnlyNotifyTime);
  const offsetMin = todo.notify.offsetMin ?? s.defaultOffsetMin;
  return new Date(seoulDateTimeToDate(todo.dueDate, todo.dueTime).getTime() - offsetMin * 60_000);
}

function dueKey(todo: Todo): string {
  // Date-only sorts after timed todos on the same day ("by end of day").
  return `${todo.dueDate ?? "9999-12-31"} ${todo.dueTime ?? "24:00"}`;
}

/**
 * List order: overdue → today → upcoming → nodate (→ done last).
 * Dated buckets sort by due date/time (oldest first); nodate keeps input order;
 * done sorts by most recently completed.
 */
export function sortForList(todos: Todo[], now: Date): Todo[] {
  return todos
    .map((todo, index) => ({ todo, index, bucket: todayBucket(todo, now) }))
    .sort((a, b) => {
      const byBucket = BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket];
      if (byBucket !== 0) return byBucket;
      if (a.bucket === "done") {
        const byDone = (b.todo.doneAt ?? "").localeCompare(a.todo.doneAt ?? "");
        if (byDone !== 0) return byDone;
      } else if (a.bucket !== "nodate") {
        const byDue = dueKey(a.todo).localeCompare(dueKey(b.todo));
        if (byDue !== 0) return byDue;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.todo);
}

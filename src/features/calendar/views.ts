// 달력 views (일 / 주 / 월). A plain module so the server page can read `?view=` too.

export type CalendarView = "day" | "week" | "month";

export function isCalendarView(value: unknown): value is CalendarView {
  return value === "day" || value === "week" || value === "month";
}

import type { CalendarEvent, EventRef, Scope } from "@/shared/contracts";
import { addDays, seoulParts, weekdayOf } from "@/shared/time";

// Pure helpers for CalendarEvent display, shared by the today screen, the
// month grid and the event sheets. All dates are Seoul calendar dates.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateString(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Whole days from `a` to `b` ('YYYY-MM-DD'). */
export function daysBetween(a: string, b: string): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

/** `${calendarId}:${eventId}` — the memo link key (Track C). */
export function eventKeyOf(event: Pick<CalendarEvent, "calendarId" | "id">): string {
  return `${event.calendarId}:${event.id}`;
}

/** Seoul date + time of a timed event boundary. */
export function seoulOf(iso: string): { date: string; time: string } {
  const { date, time } = seoulParts(new Date(iso));
  return { date, time };
}

const MAX_SPAN_DAYS = 62;

/** Seoul dates an event covers. All-day `end` is exclusive (Google convention). */
export function eventDays(event: CalendarEvent): string[] {
  let first: string;
  let last: string;
  if (event.allDay) {
    first = event.start.slice(0, 10);
    const endExclusive = event.end.slice(0, 10);
    last = endExclusive > first ? addDays(endExclusive, -1) : first;
  } else {
    first = seoulOf(event.start).date;
    // An event ending exactly at midnight does not cover the next day.
    const endMs = new Date(event.end).getTime();
    const startMs = new Date(event.start).getTime();
    last = endMs > startMs ? seoulParts(new Date(endMs - 1)).date : first;
  }
  const days: string[] = [];
  for (let d = first, i = 0; d <= last && i < MAX_SPAN_DAYS; d = addDays(d, 1), i++) days.push(d);
  return days;
}

export function coversDate(event: CalendarEvent, date: string): boolean {
  return eventDays(event).includes(date);
}

/** All-day first, then by start time, then title. */
export function compareEvents(a: CalendarEvent, b: CalendarEvent): number {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  const byStart = new Date(a.start).getTime() - new Date(b.start).getTime();
  if (byStart !== 0 && !Number.isNaN(byStart)) return byStart;
  return (a.title ?? "").localeCompare(b.title ?? "", "ko");
}

/** Personal and work events on `date` (holidays are shown on the date itself, not as rows). */
export function eventsOn(events: CalendarEvent[], date: string): CalendarEvent[] {
  return events.filter((e) => e.source !== "holiday" && coversDate(e, date)).sort(compareEvents);
}

/** Holiday name on `date`, if any. */
export function holidayOn(events: CalendarEvent[], date: string): string | null {
  const holiday = events.find((e) => e.source === "holiday" && coversDate(e, date));
  return holiday ? (holiday.title ?? "공휴일") : null;
}

export type DayTone = "ink" | "sat" | "sun";

/** Korean wall-calendar colors: weekdays ink, Saturday blue, Sunday and holidays red. */
export function dayTone(date: string, isHoliday: boolean): DayTone {
  if (isHoliday) return "sun";
  const weekday = weekdayOf(date);
  if (weekday === 0) return "sun";
  if (weekday === 6) return "sat";
  return "ink";
}

export function scopeOf(event: CalendarEvent): Scope {
  return event.source === "work" ? "work" : "personal";
}

/** Title to show. Busy-only work blocks have no title → "회사 일정". */
export function displayTitle(event: CalendarEvent): string {
  if (event.busyOnly || !event.title) return event.source === "holiday" ? "공휴일" : "회사 일정";
  return event.title;
}

/** Start time label for a row on `date`: 'HH:MM', '종일', or '이어서' for a timed event that began earlier. */
export function startLabel(event: CalendarEvent, date: string): string {
  if (event.allDay) return "종일";
  const start = seoulOf(event.start);
  return start.date === date ? start.time : "이어서";
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** '11월 16일 월요일' */
export function koreanDay(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${m}월 ${d}일 ${WEEKDAYS[weekdayOf(date)]}요일`;
}

/** '11월 16일 월요일 10:00–11:00', '11월 16일 월요일 종일', or a span across days. */
export function eventWhen(event: CalendarEvent): string {
  if (event.allDay) {
    const days = eventDays(event);
    const first = days[0];
    const last = days[days.length - 1];
    return first === last ? `${koreanDay(first)} 종일` : `${koreanDay(first)}부터 ${koreanDay(last)}까지 종일`;
  }
  const start = seoulOf(event.start);
  const end = seoulOf(event.end);
  if (start.date === end.date || (end.time === "00:00" && daysBetween(start.date, end.date) === 1)) {
    return `${koreanDay(start.date)} ${start.time}–${end.time === "00:00" && start.date !== end.date ? "24:00" : end.time}`;
  }
  return `${koreanDay(start.date)} ${start.time}부터 ${koreanDay(end.date)} ${end.time}까지`;
}

/** EventRef for the memo API (Track C). Holidays have no memo. */
export function toEventRef(event: CalendarEvent): EventRef {
  return {
    eventKey: eventKeyOf(event),
    calendarId: event.calendarId,
    eventId: event.id,
    recurringEventId: event.recurringEventId,
    source: event.source === "work" ? "work" : "personal",
    title: displayTitle(event),
    start: event.start,
    end: event.end,
    allDay: event.allDay,
    deleted: false,
  };
}

/** The instance of the same recurring series that comes right before `event`. */
export function previousInstance(event: CalendarEvent, events: CalendarEvent[]): CalendarEvent | null {
  if (!event.recurringEventId) return null;
  const startMs = new Date(event.start).getTime();
  let best: CalendarEvent | null = null;
  let bestMs = -Infinity;
  for (const other of events) {
    if (other.recurringEventId !== event.recurringEventId || other.id === event.id) continue;
    const ms = new Date(other.start).getTime();
    if (ms < startMs && ms > bestMs) {
      best = other;
      bestMs = ms;
    }
  }
  return best;
}

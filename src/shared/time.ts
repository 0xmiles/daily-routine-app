import { APP_TZ } from "./contracts";

// All calendar math is done in Asia/Seoul. The server runs in UTC, so never use
// `new Date().getDate()` / `toLocaleDateString()` without a timeZone.
//
// Date strings are 'YYYY-MM-DD', time strings are 'HH:MM' (24h), both in Seoul.
// Seoul has had a fixed +09:00 offset (no DST) since 1988.

const SEOUL_OFFSET = "+09:00";
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const KOREAN_WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  weekday: "short",
  hourCycle: "h23",
});

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function parseDate(date: string): { y: number; m: number; d: number } {
  const match = DATE_RE.exec(date);
  if (!match) throw new RangeError(`Expected 'YYYY-MM-DD', got '${date}'`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatUtcDate(ms: number): string {
  const dt = new Date(ms);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** Seoul calendar date/time/weekday of an instant. weekday: 0 = Sunday. */
export function seoulParts(d: Date): { date: string; time: string; weekday: number } {
  const parts: Record<string, string> = {};
  for (const p of partsFormatter.formatToParts(d)) parts[p.type] = p.value;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    weekday: WEEKDAY_INDEX[parts.weekday],
  };
}

/** Today's date in Seoul as 'YYYY-MM-DD'. */
export function seoulToday(now: Date = new Date()): string {
  return seoulParts(now).date;
}

/** The instant of a Seoul wall-clock date + time ('HH:MM'). */
export function seoulDateTimeToDate(date: string, time: string): Date {
  parseDate(date);
  if (!TIME_RE.test(time)) throw new RangeError(`Expected 'HH:MM', got '${time}'`);
  return new Date(`${date}T${time}:00${SEOUL_OFFSET}`);
}

/** Calendar-day arithmetic on a 'YYYY-MM-DD' string. */
export function addDays(date: string, n: number): string {
  const { y, m, d } = parseDate(date);
  return formatUtcDate(Date.UTC(y, m - 1, d + n));
}

/** Weekday of a 'YYYY-MM-DD' calendar date. 0 = Sunday … 6 = Saturday. */
export function weekdayOf(date: string): number {
  const { y, m, d } = parseDate(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** '2026-11-14' → '11월 14일 토요일' */
export function formatKoreanDate(date: string): string {
  const { m, d } = parseDate(date);
  return `${m}월 ${d}일 ${KOREAN_WEEKDAYS[weekdayOf(date)]}요일`;
}

/** ISO instant → '11월 14일 오전 9:12' (Seoul wall clock, 12-hour). */
export function formatKoreanTimestamp(iso: string): string {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) throw new RangeError(`Invalid timestamp '${iso}'`);
  const { date, time } = seoulParts(instant);
  const { m, d } = parseDate(date);
  const [hh, mm] = time.split(":");
  const hour = Number(hh);
  const meridiem = hour < 12 ? "오전" : "오후";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${m}월 ${d}일 ${meridiem} ${hour12}:${mm}`;
}

import { addDays, seoulParts, seoulToday } from "@/shared/time";

// Date helpers for the assets feature. Safe for both browser and server
// (no Node-only imports). Everything is Asia/Seoul.

const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;

/** Instant → ISO with a fixed +09:00 offset, second precision: '2026-11-10T09:12:33+09:00'. */
export function toSeoulIso(at: Date | string): string {
  const ms = new Date(at).getTime();
  if (Number.isNaN(ms)) throw new RangeError(`Invalid instant '${String(at)}'`);
  return `${new Date(ms + SEOUL_OFFSET_MS).toISOString().slice(0, 19)}+09:00`;
}

/** Seoul calendar date ('YYYY-MM-DD') of an instant. */
export function seoulDateOf(at: Date | string): string {
  return seoulParts(new Date(at)).date;
}

/** 'YYYY-MM' of a 'YYYY-MM-DD' date. */
export function monthOfDate(date: string): string {
  return date.slice(0, 7);
}

/** This month in Seoul, 'YYYY-MM'. */
export function seoulMonth(now: Date = new Date()): string {
  return monthOfDate(seoulToday(now));
}

/** First and last calendar day of a 'YYYY-MM' month. */
export function monthBounds(month: string): { first: string; last: string } {
  const first = `${month}-01`;
  return { first, last: addDays(`${shiftMonth(month, 1)}-01`, -1) };
}

/** 'YYYY-MM' shifted by n months. */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const index = y * 12 + (m - 1) + n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** Whole calendar days from `from` to `to` (both 'YYYY-MM-DD'). */
export function daysBetween(from: string, to: string): number {
  const utc = (d: string) => {
    const [y, m, day] = d.split("-").map(Number);
    return Date.UTC(y, m - 1, day);
  };
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

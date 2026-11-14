import type { EventRef } from "@/shared/contracts";
import { addDays, formatKoreanDate, seoulParts } from "@/shared/time";

// Text for the event label on an event memo block.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function seoul(iso: string): { date: string; time: string } | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : seoulParts(d);
}

/** Seoul date 'YYYY-MM-DD' the event starts on (for `/calendar?date=`). */
export function eventDateOf(ref: EventRef): string | null {
  if (ref.allDay) return DATE_RE.test(ref.start) ? ref.start : (seoul(ref.start)?.date ?? null);
  return seoul(ref.start)?.date ?? null;
}

/**
 * '11월 16일 월요일 10:00–11:00', '11월 16일 월요일 종일',
 * '11월 16일 월요일 23:00–11월 17일 화요일 01:00'.
 * All-day `end` is exclusive (Google Calendar convention).
 */
export function formatEventWhen(ref: EventRef): string {
  if (ref.allDay) {
    const start = eventDateOf(ref);
    if (!start) return "";
    const lastDay = DATE_RE.test(ref.end) ? addDays(ref.end, -1) : start;
    if (lastDay > start) return `${formatKoreanDate(start)}–${formatKoreanDate(lastDay)}`;
    return `${formatKoreanDate(start)} 종일`;
  }
  const start = seoul(ref.start);
  if (!start) return "";
  const end = seoul(ref.end);
  if (!end) return `${formatKoreanDate(start.date)} ${start.time}`;
  if (end.date === start.date) return `${formatKoreanDate(start.date)} ${start.time}–${end.time}`;
  return `${formatKoreanDate(start.date)} ${start.time}–${formatKoreanDate(end.date)} ${end.time}`;
}

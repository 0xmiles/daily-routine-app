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

// ---- memo files: title, preview, list time --------------------------------

/** A list marker (`-`, `*`, `1.`) and indent at the start of a line. */
const LINE_MARKER = /^\s*(?:[-*]\s+|\d+[.)]\s+)?/;
const MAX_PREVIEW = 140;

/** A memo line as plain text: no indent, list marker or `**` bold markers. */
export function plainLine(line: string): string {
  return line.replace(LINE_MARKER, "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/^[-*]$/, "").trim();
}

interface MemoText {
  content: string;
  eventRef: EventRef | null;
}

function textLines(content: string): string[] {
  return content
    .split("\n")
    .map(plainLine)
    .filter((line) => line !== "");
}

/**
 * The file's name in the list: an event memo is named after its event; any
 * other memo after its first line with text. "" when there is no text yet.
 */
export function memoTitle(memo: MemoText): string {
  if (memo.eventRef) return memo.eventRef.title;
  return textLines(memo.content)[0] ?? "";
}

/** The text under the title in the list (the lines after the title, on one line). */
export function memoPreview(memo: MemoText): string {
  const lines = textLines(memo.content);
  const body = memo.eventRef ? lines : lines.slice(1);
  const text = body.join(" ");
  return text.length > MAX_PREVIEW ? `${text.slice(0, MAX_PREVIEW)}…` : text;
}

/**
 * When a memo was last edited, short: '오후 3:12' today, '어제', '11월 3일'
 * this year, '2025년 11월 3일' before.
 */
export function formatMemoTime(iso: string, now: Date = new Date()): string {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return "";
  const { date, time } = seoulParts(instant);
  const today = seoulParts(now).date;
  if (date === today) {
    const [hh, mm] = time.split(":");
    const hour = Number(hh);
    return `${hour < 12 ? "오전" : "오후"} ${hour % 12 === 0 ? 12 : hour % 12}:${mm}`;
  }
  if (date === addDays(today, -1)) return "어제";
  const [y, m, d] = date.split("-").map(Number);
  if (date.slice(0, 4) === today.slice(0, 4)) return `${m}월 ${d}일`;
  return `${y}년 ${m}월 ${d}일`;
}

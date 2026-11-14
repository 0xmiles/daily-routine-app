import { seoulIso } from "@/features/shell/slots";
import type { NewPersonalEvent } from "@/shared/contracts";
import { addDays, weekdayOf } from "@/shared/time";

// Form logic shared by the full event editor and quick add (일정): what the
// fields hold, how they turn into an API body, and the small time sums the
// fields need. All dates and times are Seoul wall clock.

export interface EventFormState {
  title: string;
  date: string;
  allDay: boolean;
  /** 'HH:MM' */
  startTime: string;
  endTime: string;
  /** Days between start and end date (keeps multi-day events intact when editing). */
  spanDays: number;
  memo: string;
}

/** Validates the form and builds the API body, or returns a sentence saying what to fix. */
export function buildEventInput(form: EventFormState): NewPersonalEvent | { error: string } {
  const title = form.title.trim();
  if (!title) return { error: "제목을 적어 주세요." };
  if (!form.date) return { error: "날짜를 골라 주세요." };
  if (form.allDay) {
    return { title, start: form.date, end: addDays(form.date, Math.max(1, form.spanDays)), allDay: true };
  }
  if (!form.startTime || !form.endTime) return { error: "시작 시간과 끝나는 시간을 골라 주세요." };
  let span = form.spanDays;
  if (span === 0 && form.endTime <= form.startTime) {
    if (form.endTime === "00:00") span = 1;
    else return { error: "끝나는 시간은 시작 시간보다 늦어야 해요." };
  }
  return {
    title,
    start: seoulIso(form.date, form.startTime),
    end: seoulIso(addDays(form.date, span), form.endTime),
    allDay: false,
  };
}

const DAY_MINUTES = 24 * 60;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

const pad2 = (n: number) => String(n).padStart(2, "0");
const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const toTime = (minutes: number) => `${pad2(Math.floor(minutes / 60) % 24)}:${pad2(minutes % 60)}`;

/** '15:00' → '16:00'; '23:00' → '00:00' (the form reads that as midnight the next day). */
export function oneHourAfter(time: string): string {
  if (!TIME_RE.test(time)) return "";
  return toTime(Math.min(toMinutes(time) + 60, DAY_MINUTES));
}

/**
 * The end time after the start moves from `prevStart` to `nextStart`, keeping
 * the length. A timed event can run to midnight at most, so a longer one stops
 * at '00:00'. Leaves `prevEnd` alone when a field is empty.
 */
export function followEnd(prevStart: string, prevEnd: string, nextStart: string): string {
  if (!TIME_RE.test(prevStart) || !TIME_RE.test(prevEnd) || !TIME_RE.test(nextStart)) return prevEnd;
  let length = toMinutes(prevEnd) - toMinutes(prevStart);
  if (length <= 0) length = prevEnd === "00:00" ? length + DAY_MINUTES : 60;
  return toTime(Math.min(toMinutes(nextStart) + length, DAY_MINUTES));
}

/** '2026-11-16' → '11월 16일(월)' */
export function shortKoreanDay(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${m}월 ${d}일(${WEEKDAYS[weekdayOf(date)]})`;
}

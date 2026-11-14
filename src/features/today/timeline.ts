import type { CalendarEvent } from "@/shared/contracts";
import { seoulOf } from "./eventUtils";

// Placement on an hour ruler, shared by the day ruler (오늘, 달력 › 일) and the
// week grid (달력 › 주). Minutes count from 00:00 Seoul on the given date.

export const HOUR_PX = 40;
export const MIN_BLOCK_PX = 24;
const DEFAULT_START_HOUR = 9;
const DEFAULT_END_HOUR = 21;

export const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
export const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

export interface Placed {
  event: CalendarEvent;
  start: number; // minutes from 00:00 on `date`
  end: number;
  lane: number;
  lanes: number;
}

/** Minutes on `date` covered by a timed event, clipped to the day (at least 15). */
export function span(event: CalendarEvent, date: string): { start: number; end: number } {
  const s = seoulOf(event.start);
  const e = seoulOf(event.end);
  const start = s.date < date ? 0 : minutesOf(s.time);
  const end = e.date > date ? 24 * 60 : minutesOf(e.time);
  return { start, end: Math.max(end, start + 15) };
}

/** Timed events on `date`, with side-by-side lanes for the ones that overlap. */
export function place(events: CalendarEvent[], date: string): Placed[] {
  const items = events
    .map((event) => ({ event, ...span(event, date), lane: 0, lanes: 1 }))
    .sort((a, b) => a.start - b.start || b.end - a.end);
  let cluster: Placed[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((p) => p.lane + 1));
    for (const p of cluster) p.lanes = lanes;
    cluster = [];
  };
  for (const item of items) {
    if (item.start >= clusterEnd) flush();
    const used = new Set(cluster.filter((p) => p.end > item.start).map((p) => p.lane));
    let lane = 0;
    while (used.has(lane)) lane++;
    item.lane = lane;
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  flush();
  return items;
}

/** The ruler's first and last hour line: 09–21, widened to fit every placed event. */
export function hourRange(placed: readonly Placed[]): { startHour: number; endHour: number } {
  let startHour = DEFAULT_START_HOUR;
  let endHour = DEFAULT_END_HOUR;
  for (const p of placed) {
    startHour = Math.min(startHour, Math.floor(p.start / 60));
    endHour = Math.max(endHour, Math.ceil(p.end / 60));
  }
  return { startHour, endHour };
}

/** Hours from `startHour` up to and including `endHour`. */
export function hoursBetween(startHour: number, endHour: number): number[] {
  const hours: number[] = [];
  for (let h = startHour; h <= endHour; h++) hours.push(h);
  return hours;
}

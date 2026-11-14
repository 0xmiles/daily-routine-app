"use client";

import { useState, type KeyboardEvent } from "react";
import type { CalendarEvent } from "@/shared/contracts";
import { seoulParts } from "@/shared/time";
import { Tag, cx } from "@/ui/primitives";
import { displayTitle, eventKeyOf, scopeOf, seoulOf } from "./eventUtils";
import styles from "./DayTimeline.module.css";

export interface DayTimelineProps {
  date: string;
  /** Personal and work events on `date` (holidays already removed). */
  events: CalendarEvent[];
  /** Current instant when `date` is today (draws the --sun now line), else null. */
  now: Date | null;
  memoKeys: ReadonlySet<string>;
  onOpen: (event: CalendarEvent) => void;
  /** Tapping an empty hour row: start a new event at that hour ('HH:00'). Omit to make the ruler read-only. */
  onCreate?: (startTime: string) => void;
}

const HOUR_PX = 40;
const DEFAULT_START = 9;
const DEFAULT_END = 21;
const MIN_BLOCK_PX = 24;
/** Blocks shorter than this (an hour or less) get one line: title, then time and place beside it. */
const TWO_LINE_PX = 40;

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

interface Placed {
  event: CalendarEvent;
  start: number; // minutes from 00:00 on `date`
  end: number;
  lane: number;
  lanes: number;
}

/** Minutes on `date` covered by a timed event, clipped to the day. */
function span(event: CalendarEvent, date: string): { start: number; end: number } {
  const s = seoulOf(event.start);
  const e = seoulOf(event.end);
  const start = s.date < date ? 0 : minutesOf(s.time);
  const end = e.date > date ? 24 * 60 : minutesOf(e.time);
  return { start, end: Math.max(end, start + 15) };
}

/** Side-by-side lanes for overlapping events. */
function place(events: CalendarEvent[], date: string): Placed[] {
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

/** Arrow keys inside the hour rows: index of the row to focus next, or null for other keys. */
function nextRow(key: string, index: number, last: number): number | null {
  if (key === "ArrowDown") return Math.min(index + 1, last);
  if (key === "ArrowUp") return Math.max(index - 1, 0);
  if (key === "Home") return 0;
  if (key === "End") return last;
  return null;
}

/**
 * The day's hour ruler (09–21, widened to fit events) with blocks and the now
 * line. With `onCreate`, every hour row behind the blocks is a button that
 * starts a new event at that hour; the rows are one tab stop (↑/↓ move).
 */
export function DayTimeline({ date, events, now, memoKeys, onOpen, onCreate }: DayTimelineProps) {
  const [focusHour, setFocusHour] = useState<number | null>(null);
  const allDay = events.filter((e) => e.allDay);
  const placed = place(
    events.filter((e) => !e.allDay),
    date,
  );

  const nowTime = now ? seoulParts(now).time : null;
  const nowMinutes = nowTime ? minutesOf(nowTime) : null;
  let startHour = DEFAULT_START;
  let endHour = DEFAULT_END;
  for (const p of placed) {
    startHour = Math.min(startHour, Math.floor(p.start / 60));
    endHour = Math.max(endHour, Math.ceil(p.end / 60));
  }
  const hours: number[] = [];
  for (let h = startHour; h <= endHour; h++) hours.push(h);
  // One row per hour between the lines (the bottom line starts no row).
  const rows = hours.slice(0, -1);
  const tabHour = focusHour !== null && rows.includes(focusHour) ? focusHour : rows[0];
  const top = (minutes: number) => ((minutes - startHour * 60) / 60) * HOUR_PX;
  const showNow = nowMinutes !== null && nowMinutes >= startHour * 60 && nowMinutes <= endHour * 60;
  const nowTop = nowMinutes === null ? 0 : top(nowMinutes);

  function onRowKey(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = nextRow(e.key, index, rows.length - 1);
    if (next === null) return;
    e.preventDefault();
    e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
  }

  return (
    <div className={styles.root}>
      {allDay.length > 0 && (
        <ul className={styles.allDay} aria-label="종일 일정">
          {allDay.map((event) => (
            <li key={eventKeyOf(event)}>
              <button type="button" className={styles.chip} onClick={() => onOpen(event)}>
                <span className={styles.chipTitle}>{event.busyOnly ? "바쁨" : displayTitle(event)}</span>
                <Tag scope={scopeOf(event)} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.ruler} style={{ height: (endHour - startHour) * HOUR_PX }}>
        {hours.map((h) => (
          <div key={h} className={styles.hour} style={{ top: top(h * 60) }} aria-hidden="true">
            <span className={cx("num", styles.hourLabel)}>{hourLabel(h)}</span>
          </div>
        ))}
        {showNow && (
          <div className={styles.now} style={{ top: nowTop }} role="img" aria-label={`지금 ${nowTime}`} />
        )}
        <ul className={styles.blocks}>
          {placed.map((p) => {
            const height = Math.max(MIN_BLOCK_PX, top(p.end) - top(p.start) - 2);
            const s = seoulOf(p.event.start);
            const e = seoulOf(p.event.end);
            return (
              <li
                key={eventKeyOf(p.event)}
                className={styles.slot}
                style={{
                  top: top(p.start) + 1,
                  height,
                  left: `calc(${(p.lane / p.lanes) * 100}% + 8px)`,
                  width: `calc(${100 / p.lanes}% - 12px)`,
                }}
              >
                <button
                  type="button"
                  className={cx(
                    styles.block,
                    height < TWO_LINE_PX && styles.oneLine,
                    p.event.source === "work" && styles.work,
                    p.event.busyOnly && styles.busy,
                  )}
                  onClick={() => onOpen(p.event)}
                >
                  <span className={styles.blockTitle}>
                    <span className={styles.titleText}>{p.event.busyOnly ? "바쁨" : displayTitle(p.event)}</span>
                    {memoKeys.has(eventKeyOf(p.event)) && <span className={styles.memo}>메모</span>}
                  </span>
                  <small className={styles.blockMeta}>
                    <span className="num">
                      {s.date === date ? s.time : "00:00"}–{e.date === date ? e.time : "24:00"}
                    </span>
                    {p.event.location && <span>{p.event.location}</span>}
                    <span>{scopeOf(p.event) === "work" ? "회사" : "개인"}</span>
                  </small>
                </button>
              </li>
            );
          })}
        </ul>
        {onCreate && (
          <div role="toolbar" aria-orientation="vertical" aria-label="빈 시간에 새 일정 만들기" className={styles.rows}>
            {rows.map((h, index) => (
              <button
                key={h}
                type="button"
                className={styles.row}
                style={{ top: top(h * 60), height: HOUR_PX }}
                aria-label={`${hourLabel(h)}에 새 일정 만들기`}
                tabIndex={h === tabHour ? 0 : -1}
                onFocus={() => setFocusHour(h)}
                onKeyDown={(e) => onRowKey(e, index)}
                onClick={() => onCreate(hourLabel(h))}
              >
                <span className={styles.rowHint} aria-hidden="true">
                  + 새 일정
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

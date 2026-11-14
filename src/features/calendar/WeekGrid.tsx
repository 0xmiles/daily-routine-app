"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import timeline from "@/features/today/DayTimeline.module.css";
import {
  dayTone,
  displayTitle,
  eventKeyOf,
  eventsOn,
  holidayOn,
  koreanDay,
  scopeOf,
  seoulOf,
} from "@/features/today/eventUtils";
import {
  HOUR_PX,
  MIN_BLOCK_PX,
  hourLabel,
  hourRange,
  hoursBetween,
  minutesOf,
  place,
  type Placed,
} from "@/features/today/timeline";
import type { CalendarEvent } from "@/shared/contracts";
import { addDays, seoulParts, weekdayOf } from "@/shared/time";
import { dayHue, hueStyle } from "@/ui/hues";
import { cx } from "@/ui/primitives";
import { shortKoreanDay } from "./eventForm";
import styles from "./WeekGrid.module.css";

export interface WeekGridProps {
  /** The seven days shown, Sunday first (see `weekDays`). */
  days: string[];
  today: string;
  /** Loaded events for the week; holidays colour the header and are not drawn as blocks. */
  events: CalendarEvent[];
  /** Current instant (draws the now line in today's column), or null. */
  now: Date | null;
  memoKeys: ReadonlySet<string>;
  onOpen: (event: CalendarEvent) => void;
  /** An empty hour cell: start a new event on `date` at `startTime` ('HH:00'). */
  onCreate: (date: string, startTime: string) => void;
  /** A day header: show that day on its own. */
  onPickDay: (date: string) => void;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** Sunday-first week containing `date` (the same weeks as the month grid). */
export function weekDays(date: string): string[] {
  const sunday = addDays(date, -weekdayOf(date));
  return Array.from({ length: 7 }, (_, i) => addDays(sunday, i));
}

interface Day {
  date: string;
  holiday: string | null;
  allDay: CalendarEvent[];
  placed: Placed[];
}

type Cell = { col: number; row: number };

/** Arrow keys in the hour cells: ↑/↓ an hour, ←/→ a day, Home/End the first/last hour. */
function moveCell(key: string, { col, row }: Cell, lastRow: number): Cell | null {
  if (key === "ArrowUp") return { col, row: Math.max(row - 1, 0) };
  if (key === "ArrowDown") return { col, row: Math.min(row + 1, lastRow) };
  if (key === "ArrowLeft") return { col: Math.max(col - 1, 0), row };
  if (key === "ArrowRight") return { col: Math.min(col + 1, 6), row };
  if (key === "Home") return { col, row: 0 };
  if (key === "End") return { col, row: lastRow };
  return null;
}

/**
 * 달력 › 주: seven day columns (일 → 토) on one hour ruler. The header row stays
 * on screen while scrolling; all-day events and holidays sit in a row under it.
 * Every empty hour cell is a button that starts a new event there; the cells
 * are one tab stop (arrow keys move between hours and days).
 */
export function WeekGrid({ days, today, events, now, memoKeys, onOpen, onCreate, onPickDay }: WeekGridProps) {
  const [focus, setFocus] = useState<Cell | null>(null);
  const root = useRef<HTMLDivElement>(null);

  const week: Day[] = days.map((date) => {
    const onDay = eventsOn(events, date);
    return {
      date,
      holiday: holidayOn(events, date),
      allDay: onDay.filter((e) => e.allDay),
      placed: place(
        onDay.filter((e) => !e.allDay),
        date,
      ),
    };
  });
  const { startHour, endHour } = hourRange(week.flatMap((d) => d.placed));
  const hours = hoursBetween(startHour, endHour);
  const rows = hours.slice(0, -1);
  const top = (minutes: number) => ((minutes - startHour * 60) / 60) * HOUR_PX;
  const nowAt = now ? seoulParts(now) : null;
  const nowMinutes = nowAt ? minutesOf(nowAt.time) : -1;
  const nowShown = nowMinutes >= startHour * 60 && nowMinutes <= endHour * 60;
  const hasAllDayRow = week.some((d) => d.holiday || d.allDay.length > 0);

  const todayCol = days.indexOf(today);
  const tab: Cell =
    focus && focus.row < rows.length ? focus : { col: todayCol === -1 ? 0 : todayCol, row: 0 };

  function onCellKey(e: KeyboardEvent<HTMLButtonElement>, cell: Cell) {
    const next = moveCell(e.key, cell, rows.length - 1);
    if (!next) return;
    e.preventDefault();
    root.current?.querySelector<HTMLButtonElement>(`[data-cell="${next.col}:${next.row}"]`)?.focus();
  }

  return (
    <div className={styles.week} ref={root}>
      <div className={styles.head}>
        <span aria-hidden="true" />
        {week.map(({ date, holiday }) => {
          const weekday = weekdayOf(date);
          const tone = dayTone(date, holiday !== null);
          const isToday = date === today;
          return (
            <button
              key={date}
              type="button"
              className={cx(styles.dayHead, tone !== "ink" && styles[tone], isToday && styles.today)}
              style={hueStyle(dayHue(weekday))}
              aria-label={`${koreanDay(date)}${holiday ? `, ${holiday}` : ""}, 하루로 보기`}
              aria-current={isToday ? "date" : undefined}
              onClick={() => onPickDay(date)}
            >
              <span className={styles.weekday}>{WEEKDAYS[weekday]}</span>
              <span className={cx("num", styles.dateNum)}>{Number(date.slice(8))}</span>
            </button>
          );
        })}
      </div>

      {hasAllDayRow && (
        <div className={styles.allDay}>
          <span className={styles.allDayLabel}>종일</span>
          {week.map(({ date, holiday, allDay }) => (
            <ul key={date} className={styles.allDayCell} aria-label={`${koreanDay(date)} 종일`}>
              {holiday && <li className={styles.holiday}>{holiday}</li>}
              {allDay.map((event) => (
                <li key={eventKeyOf(event)}>
                  <button
                    type="button"
                    className={cx(styles.chip, event.source === "work" && styles.chipWork)}
                    onClick={() => onOpen(event)}
                  >
                    {event.busyOnly ? "바쁨" : displayTitle(event)}
                  </button>
                </li>
              ))}
            </ul>
          ))}
        </div>
      )}

      <div className={styles.body} style={{ height: (endHour - startHour) * HOUR_PX }}>
        <div className={styles.gutter} aria-hidden="true">
          {hours.map((h) => (
            <span key={h} className={cx("num", styles.hourLabel)} style={{ top: top(h * 60) }}>
              {hourLabel(h)}
            </span>
          ))}
        </div>
        {week.map(({ date, placed }, col) => (
          <div
            key={date}
            role="group"
            aria-label={koreanDay(date)}
            className={cx(styles.col, date === today && styles.todayCol)}
          >
            <ul className={timeline.blocks}>
              {placed.map((p) => {
                const height = Math.max(MIN_BLOCK_PX, top(p.end) - top(p.start) - 2);
                const s = seoulOf(p.event.start);
                const e = seoulOf(p.event.end);
                const when = `${s.date === date ? s.time : "00:00"}–${e.date === date ? e.time : "24:00"}`;
                return (
                  <li
                    key={eventKeyOf(p.event)}
                    className={timeline.slot}
                    style={{
                      top: top(p.start) + 1,
                      height,
                      left: `calc(${(p.lane / p.lanes) * 100}% + 1px)`,
                      width: `calc(${100 / p.lanes}% - 2px)`,
                    }}
                  >
                    <button
                      type="button"
                      className={cx(
                        timeline.block,
                        timeline.compact,
                        p.event.source === "work" && timeline.work,
                        p.event.busyOnly && timeline.busy,
                      )}
                      onClick={() => onOpen(p.event)}
                    >
                      <span className={timeline.compactTitle}>{p.event.busyOnly ? "바쁨" : displayTitle(p.event)}</span>
                      <span className="sr-only">
                        , {when}, {scopeOf(p.event) === "work" ? "회사" : "개인"}
                        {memoKeys.has(eventKeyOf(p.event)) ? ", 메모 있음" : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {nowAt?.date === date && nowShown && (
              <div
                className={timeline.now}
                style={{ top: top(nowMinutes) }}
                role="img"
                aria-label={`지금 ${nowAt.time}`}
              />
            )}
            {rows.map((h, row) => (
              <button
                key={h}
                type="button"
                className={timeline.row}
                style={{ top: top(h * 60), height: HOUR_PX }}
                data-cell={`${col}:${row}`}
                aria-label={`${shortKoreanDay(date)} ${hourLabel(h)}에 새 일정 만들기`}
                tabIndex={tab.col === col && tab.row === row ? 0 : -1}
                onFocus={() => setFocus({ col, row })}
                onKeyDown={(e) => onCellKey(e, { col, row })}
                onClick={() => onCreate(date, hourLabel(h))}
              >
                <span className={timeline.rowHint} aria-hidden="true">
                  +
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

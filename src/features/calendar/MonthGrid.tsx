"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import { dayTone, eventDays, koreanDay } from "@/features/today/eventUtils";
import type { CalendarEvent, Todo } from "@/shared/contracts";
import { addDays, weekdayOf } from "@/shared/time";
import { dayHue, hueStyle } from "@/ui/hues";
import { cx } from "@/ui/primitives";
import styles from "./MonthGrid.module.css";

export interface MonthGridProps {
  /** 'YYYY-MM' */
  month: string;
  today: string;
  /** Selected day ('YYYY-MM-DD'); it is the one Tab stop of the grid. */
  selected: string | null;
  events: CalendarEvent[];
  todos: Todo[];
  onSelect: (date: string) => void;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const MAX_MARKS = 3;

type Mark = "work" | "personal" | "todo";

interface DayInfo {
  work: number;
  personal: number;
  holiday: string | null;
  todos: number;
}

/** Sunday-first cells covering the whole month (5 or 6 weeks). */
export function monthCells(month: string): string[] {
  const first = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const nextFirst = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const last = addDays(nextFirst, -1);
  const start = addDays(first, -weekdayOf(first));
  const end = addDays(last, 6 - weekdayOf(last));
  const cells: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) cells.push(d);
  return cells;
}

function indexDays(events: CalendarEvent[], todos: Todo[]): Map<string, DayInfo> {
  const map = new Map<string, DayInfo>();
  const at = (date: string) => {
    let info = map.get(date);
    if (!info) {
      info = { work: 0, personal: 0, holiday: null, todos: 0 };
      map.set(date, info);
    }
    return info;
  };
  for (const event of events) {
    for (const date of eventDays(event)) {
      const info = at(date);
      if (event.source === "holiday") info.holiday ??= event.title ?? "공휴일";
      else if (event.source === "work") info.work++;
      else info.personal++;
    }
  }
  for (const todo of todos) {
    if (todo.dueDate && !todo.doneAt) at(todo.dueDate).todos++;
  }
  return map;
}

/** Up to three marks; a due todo always keeps its square. */
function marksOf(info: DayInfo | undefined): Mark[] {
  if (!info) return [];
  const dots: Mark[] = [...Array<Mark>(info.work).fill("work"), ...Array<Mark>(info.personal).fill("personal")];
  if (info.todos === 0) return dots.slice(0, MAX_MARKS);
  return [...dots.slice(0, MAX_MARKS - 1), "todo"];
}

function labelOf(date: string, info: DayInfo | undefined): string {
  const parts = [koreanDay(date)];
  if (info?.holiday) parts.push(info.holiday);
  const events = (info?.work ?? 0) + (info?.personal ?? 0);
  if (events > 0) parts.push(`일정 ${events}개`);
  if (info?.todos) parts.push(`할 일 마감 ${info.todos}개`);
  return parts.join(", ");
}

const ARROW_DELTA: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

/**
 * Wall-calendar month: Sunday column red, Saturday blue, holidays red, today
 * circled with the highlighter. Under each date: filled dot = 회사, outlined
 * dot = 개인, red square = 할 일 마감.
 */
export function MonthGrid({ month, today, selected, events, todos, onSelect }: MonthGridProps) {
  const cells = monthCells(month);
  const info = indexDays(events, todos);
  const [y, m] = month.split("-").map(Number);
  const root = useRef<HTMLDivElement>(null);
  const focusAfterMove = useRef(false);
  const tabStop = selected && cells.includes(selected) ? selected : cells.includes(today) ? today : `${month}-01`;

  // Keep keyboard focus on the selected day after arrow keys (also across months).
  useEffect(() => {
    if (!focusAfterMove.current) return;
    focusAfterMove.current = false;
    root.current?.querySelector<HTMLButtonElement>(`[data-date="${tabStop}"]`)?.focus();
  }, [tabStop]);

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, date: string) {
    const delta = ARROW_DELTA[e.key];
    if (delta === undefined) return;
    e.preventDefault();
    focusAfterMove.current = true;
    onSelect(addDays(date, delta));
  }

  return (
    <div className={styles.grid} ref={root}>
      {WEEKDAYS.map((w, i) => (
        <div
          key={w}
          data-testid="weekday"
          aria-hidden="true"
          className={cx(styles.weekday, i === 0 && styles.sun, i === 6 && styles.sat)}
          style={hueStyle(dayHue(i))}
        >
          {w}
        </div>
      ))}
      <div role="group" aria-label={`${y}년 ${m}월`} className={styles.days}>
        {cells.map((date) => {
          const day = info.get(date);
          const outside = !date.startsWith(month);
          const tone = dayTone(date, Boolean(day?.holiday));
          const isToday = date === today;
          const isSelected = date === selected;
          return (
            <button
              key={date}
              type="button"
              data-date={date}
              className={cx(
                styles.day,
                tone !== "ink" && styles[tone],
                outside && styles.outside,
                isToday && styles.today,
                isSelected && styles.selected,
              )}
              aria-label={labelOf(date, day)}
              aria-pressed={isSelected}
              aria-current={isToday ? "date" : undefined}
              tabIndex={date === tabStop ? 0 : -1}
              onClick={() => onSelect(date)}
              onKeyDown={(e) => onKeyDown(e, date)}
            >
              <span className={cx("num", styles.n)}>{Number(date.slice(8))}</span>
              <span className={styles.marks} aria-hidden="true">
                {marksOf(day).map((mark, i) => (
                  <i key={i} data-mark={mark} className={styles[mark]} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

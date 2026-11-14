"use client";

import { useCallback, useEffect, useEffectEvent, useId, useRef, useState, type TouchEvent } from "react";
import { fetchEvents } from "@/features/calendar/client";
import { EventDetailSheet } from "@/features/calendar/EventDetailSheet";
import { fetchEventKeys } from "@/features/memo/client";
import { ConnectPersonalHint } from "@/features/shell/ConnectPersonalHint";
import { onDataChanged } from "@/features/shell/events";
import { ChevronLeftIcon, ChevronRightIcon } from "@/features/shell/icons";
import { setPersonalConnected } from "@/features/shell/personalConnection";
import { useIsWide } from "@/features/shell/useMediaQuery";
import { completeTodo, fetchTodos, TODOS_CHANGED_EVENT, uncompleteTodo } from "@/features/todos/client";
import { todayBucket } from "@/features/todos/rules";
import { TodoEditorSheet } from "@/features/todos/TodoEditorSheet";
import { TodoRow } from "@/features/todos/TodoRow";
import { TodoSection } from "@/features/todos/TodoSection";
import type { CalendarEvent, EventsResponse, Todo } from "@/shared/contracts";
import { addDays, seoulToday, weekdayOf } from "@/shared/time";
import { dayHue, hueStyle } from "@/ui/hues";
import { Button, cx } from "@/ui/primitives";
import { DateLeaf, type LeafCounts } from "./DateLeaf";
import { DayTimeline } from "./DayTimeline";
import { EventRow } from "./EventRow";
import { eventKeyOf, eventsOn, holidayOn } from "./eventUtils";
import { useNow } from "./useNow";
import styles from "./TodayPage.module.css";

export interface TodayPageProps {
  /** Day to show first ('YYYY-MM-DD', from `?date=`). */
  initialDate: string;
  /** Seoul today as computed by the server render (used until the client clock is known). */
  today: string;
}

type EventsState = { date: string; res: EventsResponse } | { date: string; error: true } | null;
type TodosState = { date: string; list: Todo[] } | null;

const EMPTY_KEYS: ReadonlySet<string> = new Set();
const SWIPE_PX = 60;

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest('input, textarea, select, [contenteditable="true"], [role="radiogroup"], [role="slider"]') !== null
  );
}

/**
 * 할 일 › 오늘: one 일력 page for the day, its events and todos. Swipe or ←/→
 * turns the page (`?date=` follows). At 900px and wider: leaf | 09–21 time
 * ruler with the now line | todos.
 */
export function TodayPage({ initialDate, today: serverToday }: TodayPageProps) {
  // null = "follow today": the page turns over by itself at Seoul midnight
  // (e.g. the iPhone app is resumed the next morning). A specific day stays put.
  const [pinnedDate, setPinnedDate] = useState<string | null>(initialDate === serverToday ? null : initialDate);
  const [enter, setEnter] = useState<"next" | "prev" | null>(null);
  const [events, setEvents] = useState<EventsState>(null);
  const [memoKeys, setMemoKeys] = useState<ReadonlySet<string>>(EMPTY_KEYS);
  const [todos, setTodos] = useState<TodosState>(null);
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const [reloadEvents, setReloadEvents] = useState(0);
  const wide = useIsWide();
  const clock = useNow();
  const today = clock ? seoulToday(clock) : serverToday;
  const date = pinnedDate ?? today;
  const isToday = date === today;
  const eventsHeading = useId();
  const touch = useRef<{ x: number; y: number; at: number } | null>(null);

  // --- data -------------------------------------------------------------------------

  useEffect(() => {
    let alive = true;
    fetchEvents(date, date).then(
      (res) => {
        if (!alive) return;
        setEvents({ date, res });
        setPersonalConnected(res.personalConnected);
      },
      () => alive && setEvents({ date, error: true }),
    );
    fetchEventKeys().then(
      (keys) => alive && setMemoKeys(new Set(keys)),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [date, reloadEvents]);

  const todoRequest = useRef(0);
  const loadTodos = useCallback(() => {
    const request = ++todoRequest.current;
    const forDate = date;
    fetchTodos(isToday ? "today" : "all").then(
      (list) => {
        if (request !== todoRequest.current) return; // a newer day was asked for
        setTodos({ date: forDate, list: isToday ? list : list.filter((t) => t.dueDate === forDate) });
      },
      () => {},
    );
  }, [date, isToday]);

  useEffect(() => {
    loadTodos();
    window.addEventListener(TODOS_CHANGED_EVENT, loadTodos);
    return () => window.removeEventListener(TODOS_CHANGED_EVENT, loadTodos);
  }, [loadTodos]);

  useEffect(() => {
    const offData = onDataChanged((kind) => {
      if (kind === "event" || kind === "memo") setReloadEvents((n) => n + 1);
    });
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      setReloadEvents((n) => n + 1);
      loadTodos();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      offData();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [loadTodos]);

  // --- turning pages ------------------------------------------------------------------

  function show(next: string, direction: "next" | "prev" | null) {
    setEnter(direction);
    setPinnedDate(next === today ? null : next);
    setSelected(null);
    const href = next === today ? "/today" : `/today?date=${next}`;
    window.history.replaceState(window.history.state, "", href);
  }
  const go = (delta: number) => show(addDays(date, delta), delta > 0 ? "next" : "prev");

  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    if (isTypingTarget(e.target) || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
    e.preventDefault();
    go(e.key === "ArrowRight" ? 1 : -1);
  });

  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKeyDown(e);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);

  function onTouchStart(e: TouchEvent) {
    if (e.touches.length !== 1 || isTypingTarget(e.target)) {
      touch.current = null;
      return;
    }
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY, at: Date.now() };
  }

  function onTouchEnd(e: TouchEvent) {
    const start = touch.current;
    touch.current = null;
    if (!start || e.changedTouches.length === 0) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - start.at < 800) {
      go(dx < 0 ? 1 : -1);
    }
  }

  // --- derived ------------------------------------------------------------------------

  const loaded = events !== null && events.date === date && "res" in events ? events.res : null;
  const failed = events !== null && events.date === date && "error" in events;
  const allEvents = loaded?.events ?? [];
  const dayEvents = eventsOn(allEvents, date);
  const holiday = holidayOn(allEvents, date);
  const dayTodos = todos?.date === date ? todos.list : null;
  const now = clock ?? new Date();

  const counts: LeafCounts | null =
    (loaded || failed) && dayTodos
      ? {
          events: dayEvents.length,
          todos: dayTodos.length,
          done: dayTodos.filter((t) => t.doneAt !== null).length,
          late: dayTodos.filter((t) => todayBucket(t, now) === "overdue").length,
        }
      : null;

  const openEvent = (event: CalendarEvent) => setSelected(event);

  return (
    <div
      className={styles.page}
      style={hueStyle(dayHue(holiday ? 0 : weekdayOf(date)))}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div className={styles.leafCol}>
        <DateLeaf key={date} date={date} counts={counts} holiday={holiday} enter={enter} />
        <div className={styles.dayNav}>
          {!isToday && (
            <button type="button" className={styles.backToday} onClick={() => show(today, date < today ? "next" : "prev")}>
              오늘로 돌아가기
            </button>
          )}
          <button type="button" className={styles.navButton} aria-label="전날 보기" onClick={() => go(-1)}>
            <ChevronLeftIcon />
          </button>
          <button type="button" className={styles.navButton} aria-label="다음 날 보기" onClick={() => go(1)}>
            <ChevronRightIcon />
          </button>
        </div>
      </div>
      <div className={styles.perf} aria-hidden="true">
        <i />
      </div>

      <section className={styles.eventsCol} aria-labelledby={eventsHeading}>
        <div className={styles.secHead}>
          <h2 id={eventsHeading} className={styles.heading}>
            일정
          </h2>
          {loaded && dayEvents.length > 0 && (
            <span className={styles.count}>
              <span className="num">{dayEvents.length}</span>개
            </span>
          )}
        </div>

        {!loaded && !failed && <p className={styles.note}>일정을 불러오고 있어요.</p>}
        {failed && (
          <div className={styles.problem} role="alert">
            <p className={styles.note}>일정을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 불러와 주세요.</p>
            <Button variant="outline" onClick={() => setReloadEvents((n) => n + 1)}>
              다시 불러오기
            </Button>
          </div>
        )}
        {loaded && dayEvents.length === 0 && (
          <p className={styles.empty}>{isToday ? "오늘은 일정이 없어요." : "이날은 일정이 없어요."}</p>
        )}

        {loaded && dayEvents.length > 0 && wide !== true && (
          <ul className={cx(styles.list, styles.mobileOnly)}>
            {dayEvents.map((event) => (
              <EventRow
                key={eventKeyOf(event)}
                event={event}
                date={date}
                hasMemo={memoKeys.has(eventKeyOf(event))}
                onOpen={openEvent}
              />
            ))}
          </ul>
        )}
        {wide !== false && (
          <div className={styles.desktopOnly}>
            <DayTimeline
              date={date}
              events={dayEvents}
              now={isToday ? clock : null}
              memoKeys={memoKeys}
              onOpen={openEvent}
            />
          </div>
        )}

        {loaded && !loaded.personalConnected && <ConnectPersonalHint className={styles.hint} />}
        {loaded && loaded.workStatus === "error" && (
          <p className={styles.hintText}>회사 캘린더를 읽지 못했어요. 설정에서 회사 캘린더 연결을 확인해 주세요.</p>
        )}
      </section>

      <div className={styles.todoCol}>
        {isToday ? <TodoSection view="today" /> : <DayTodos date={date} todos={dayTodos} now={now} />}
      </div>

      <EventDetailSheet
        event={selected}
        events={allEvents}
        onClose={() => setSelected(null)}
        onChanged={() => setReloadEvents((n) => n + 1)}
      />
    </div>
  );
}

/** Todos due on a day other than today (the today section only knows today). */
function DayTodos({ date, todos, now }: { date: string; todos: Todo[] | null; now: Date }) {
  const headingId = useId();
  const [editing, setEditing] = useState<{ todo: Todo | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(todo: Todo, done: boolean) {
    setError(null);
    try {
      if (done) await completeTodo(todo.id);
      else await uncompleteTodo(todo.id);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "할 일을 바꾸지 못했어요. 다시 눌러 주세요.");
    }
  }

  return (
    <section aria-labelledby={headingId} className={styles.dayTodos}>
      <div className={styles.secHead}>
        <h2 id={headingId} className={styles.heading}>
          할 일
        </h2>
      </div>
      {todos === null && <p className={styles.note}>할 일을 불러오고 있어요.</p>}
      {todos !== null && todos.length === 0 && <p className={styles.empty}>이날 마감인 할 일은 없어요.</p>}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {todos !== null && todos.length > 0 && (
        <ul className={styles.todoList}>
          {todos.map((todo) => (
            <TodoRow key={todo.id} todo={todo} now={now} onToggle={toggle} onOpen={(t) => setEditing({ todo: t })} />
          ))}
        </ul>
      )}
      <button type="button" className={styles.addTodo} onClick={() => setEditing({ todo: null })}>
        이날 할 일 추가
      </button>
      <TodoEditorSheet
        open={editing !== null}
        todo={editing?.todo ?? null}
        defaultDueDate={date}
        onClose={() => setEditing(null)}
      />
    </section>
  );
}

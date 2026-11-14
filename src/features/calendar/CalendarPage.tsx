"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { fetchEvents } from "@/features/calendar/client";
import { fetchEventKeys } from "@/features/memo/client";
import { ConnectPersonalHint } from "@/features/shell/ConnectPersonalHint";
import { onDataChanged } from "@/features/shell/events";
import { ChevronLeftIcon, ChevronRightIcon } from "@/features/shell/icons";
import { setPersonalConnected } from "@/features/shell/personalConnection";
import { readPref, writePref } from "@/features/shell/prefs";
import { DayTimeline } from "@/features/today/DayTimeline";
import { EventRow } from "@/features/today/EventRow";
import { eventKeyOf, eventsOn, holidayOn } from "@/features/today/eventUtils";
import { useNow } from "@/features/today/useNow";
import { fetchTodos, TODOS_CHANGED_EVENT } from "@/features/todos/client";
import { TodoEditorSheet } from "@/features/todos/TodoEditorSheet";
import type { CalendarEvent, EventsResponse, Todo } from "@/shared/contracts";
import { addDays, seoulToday, weekdayOf } from "@/shared/time";
import { Button, Tag, cx } from "@/ui/primitives";
import { EventDetailSheet } from "./EventDetailSheet";
import { EventEditorSheet } from "./EventEditorSheet";
import { MonthGrid, monthCells } from "./MonthGrid";
import { isCalendarView, type CalendarView } from "./views";
import { WeekGrid, weekDays } from "./WeekGrid";
import styles from "./CalendarPage.module.css";

export interface CalendarPageProps {
  /** Selected day from `?date=` ('YYYY-MM-DD'); its day, week or month is shown. */
  initialDate: string;
  /** Seoul today from the server render (until the client clock is known). */
  today: string;
  /** From `?view=`. Without it, the view last picked on this device (월 at first). */
  initialView?: CalendarView;
}

type EventsState = { range: string; res: EventsResponse } | { range: string; error: true } | null;

const WEEKDAY_NAMES = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];
const EMPTY_KEYS: ReadonlySet<string> = new Set();
const VIEW_PREF = "calendarView";

const VIEWS: Array<{ view: CalendarView; label: string; name: string }> = [
  { view: "day", label: "일", name: "하루" },
  { view: "week", label: "주", name: "한 주" },
  { view: "month", label: "월", name: "한 달" },
];

const STEP_LABELS: Record<CalendarView, { prev: string; next: string; back: string }> = {
  day: { prev: "전날", next: "다음 날", back: "오늘" },
  week: { prev: "이전 주", next: "다음 주", back: "이번 주" },
  month: { prev: "이전 달", next: "다음 달", back: "이번 달" },
};

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** The days a view shows around `date`: the day, its Sunday-first week, or the month grid's weeks. */
function rangeOf(view: CalendarView, date: string): { from: string; to: string } {
  if (view === "day") return { from: date, to: date };
  const days = view === "week" ? weekDays(date) : monthCells(date.slice(0, 7));
  return { from: days[0], to: days[days.length - 1] };
}

/** Month view keeps its old address; 일 and 주 add `view=` so a reload or a shared link opens the same view. */
function hrefOf(view: CalendarView, date: string): string {
  return view === "month" ? `/calendar?date=${date}` : `/calendar?view=${view}&date=${date}`;
}

/** '11월 15일–21일', or '11월 29일–12월 5일' across months. */
function weekLabel(days: string[]): string {
  const [, m1, d1] = days[0].split("-").map(Number);
  const [, m2, d2] = days[6].split("-").map(Number);
  return m1 === m2 ? `${m1}월 ${d1}일–${d2}일` : `${m1}월 ${d1}일–${m2}월 ${d2}일`;
}

// Read once after hydration; the server and the first client render use the default.
const noopSubscribe = () => () => {};
function useStoredView(): CalendarView | null {
  return useSyncExternalStore(
    noopSubscribe,
    () => {
      const stored = readPref<unknown>(VIEW_PREF, null);
      return isCalendarView(stored) ? stored : null;
    },
    () => null,
  );
}

/**
 * 할 일 › 달력: 일 / 주 / 월. 월 is the month grid with the picked day's events
 * and due todos below (beside, on Mac); 주 is seven day columns on an hour
 * ruler; 일 is one day's ruler. In 일 and 주, tapping an empty hour starts a new
 * event there. The view picked last is remembered on this device.
 */
export function CalendarPage({ initialDate, today: serverToday, initialView }: CalendarPageProps) {
  const [selected, setSelected] = useState(initialDate);
  const [chosenView, setChosenView] = useState<CalendarView | null>(initialView ?? null);
  const storedView = useStoredView();
  const view = chosenView ?? storedView ?? "month";
  const [events, setEvents] = useState<EventsState>(null);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [memoKeys, setMemoKeys] = useState<ReadonlySet<string>>(EMPTY_KEYS);
  const [detail, setDetail] = useState<CalendarEvent | null>(null);
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null);
  /** A new event: from "이날 일정 만들기" (date only) or a tapped hour (date and hour). */
  const [creating, setCreating] = useState<{ date: string; startTime?: string } | null>(null);
  const [reload, setReload] = useState(0);
  const agendaHeading = useId();
  const clock = useNow();
  const today = clock ? seoulToday(clock) : serverToday;

  const month = selected.slice(0, 7);
  const [year, monthNumber] = month.split("-").map(Number);
  const days = weekDays(selected);
  const { from, to } = rangeOf(view, selected);
  const range = `${from}~${to}`;

  useEffect(() => {
    let alive = true;
    fetchEvents(from, to).then(
      (res) => {
        if (!alive) return;
        setEvents({ range: `${from}~${to}`, res });
        setPersonalConnected(res.personalConnected);
      },
      () => alive && setEvents({ range: `${from}~${to}`, error: true }),
    );
    fetchEventKeys().then(
      (keys) => alive && setMemoKeys(new Set(keys)),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [from, to, reload]);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchTodos("all").then(
        (list) => alive && setTodos(list),
        () => {},
      );
    void load();
    window.addEventListener(TODOS_CHANGED_EVENT, load);
    const offData = onDataChanged((kind) => {
      if (kind === "event" || kind === "memo") setReload((n) => n + 1);
    });
    return () => {
      alive = false;
      window.removeEventListener(TODOS_CHANGED_EVENT, load);
      offData();
    };
  }, []);

  function show(date: string, nextView: CalendarView = view) {
    setSelected(date);
    window.history.replaceState(window.history.state, "", hrefOf(nextView, date));
  }

  /** Only a choice made here is remembered; an address with `view=` never writes it. */
  function chooseView(next: CalendarView, date = selected) {
    setChosenView(next);
    writePref(VIEW_PREF, next);
    show(date, next);
  }

  function step(delta: number) {
    if (view === "day") return show(addDays(selected, delta));
    if (view === "week") return show(addDays(selected, delta * 7));
    const target = shiftMonth(month, delta);
    show(today.startsWith(target) ? today : `${target}-01`);
  }

  const showsToday =
    view === "day" ? selected === today : view === "week" ? days.includes(today) : today.startsWith(month);
  const labels = STEP_LABELS[view];

  const loaded = events?.range === range && "res" in events ? events.res : null;
  const failed = events?.range === range && "error" in events;
  const allEvents = loaded?.events ?? [];
  const dayEvents = eventsOn(allEvents, selected);
  const holiday = holidayOn(allEvents, selected);
  const dayTodos = todos.filter((t) => t.dueDate === selected && !t.doneAt);
  const selectedDay = Number(selected.slice(8));

  const notices = (
    <>
      {failed && (
        <div className={styles.problem} role="alert">
          <p className={styles.note}>일정을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 불러와 주세요.</p>
          <Button variant="outline" onClick={() => setReload((n) => n + 1)}>
            다시 불러오기
          </Button>
        </div>
      )}
      {loaded && !loaded.personalConnected && <ConnectPersonalHint className={styles.hint} />}
      {loaded?.workStatus === "error" && (
        <p className={styles.note}>회사 캘린더를 읽지 못했어요. 설정에서 회사 캘린더 연결을 확인해 주세요.</p>
      )}
    </>
  );

  const dayHeading = (
    <div className={styles.secHead}>
      <h2 id={agendaHeading} className={styles.heading}>
        <span>
          <span className="num">{selectedDay}</span>일 {WEEKDAY_NAMES[weekdayOf(selected)]}
        </span>
        {holiday && <span className={styles.holiday}>{holiday}</span>}
      </h2>
      {loaded && dayEvents.length > 0 && (
        <span className={styles.count}>
          일정 <span className="num">{dayEvents.length}</span>개
        </span>
      )}
    </div>
  );

  const dueTodos = dayTodos.length > 0 && (
    <>
      <h3 className={styles.subHeading}>마감인 할 일</h3>
      <ul className={styles.list}>
        {dayTodos.map((todo) => (
          <li key={todo.id}>
            <button type="button" className={styles.todoRow} onClick={() => setEditingTodo(todo)}>
              <span className={styles.todoLead}>
                <i className={styles.legendTodo} aria-hidden="true" />
                {todo.dueTime && <span className={cx("num", styles.todoTime)}>{todo.dueTime}</span>}
              </span>
              <span className={styles.todoTitle}>{todo.title}</span>
              <Tag scope={todo.scope} />
            </button>
          </li>
        ))}
      </ul>
    </>
  );

  return (
    <div className={styles.page}>
      <ViewSwitch view={view} onChange={(next) => chooseView(next)} />

      <header className={styles.head}>
        <div>
          <div className={styles.year}>
            <span className="num">{year}</span>년
          </div>
          <h1 className={styles.month}>
            {monthNumber}
            <span className={styles.monthUnit}>월</span>
          </h1>
        </div>
        <div className={styles.arrows}>
          {!showsToday && (
            <button type="button" className={styles.thisMonth} onClick={() => show(today)}>
              {labels.back}
            </button>
          )}
          <button type="button" className={styles.arrow} aria-label={labels.prev} onClick={() => step(-1)}>
            <ChevronLeftIcon />
          </button>
          <button type="button" className={styles.arrow} aria-label={labels.next} onClick={() => step(1)}>
            <ChevronRightIcon />
          </button>
        </div>
      </header>

      {view === "month" && (
        <div className={styles.body}>
          <div className={styles.gridCol}>
            <MonthGrid
              month={month}
              today={today}
              selected={selected}
              events={allEvents}
              todos={todos}
              onSelect={(date) => show(date)}
            />
            <p className={styles.legend}>
              <span>
                <i className={styles.legendWork} aria-hidden="true" />
                회사
              </span>
              <span>
                <i className={styles.legendPersonal} aria-hidden="true" />
                개인
              </span>
              <span>
                <i className={styles.legendTodo} aria-hidden="true" />
                할 일 마감
              </span>
            </p>
            {notices}
          </div>

          <section className={styles.agenda} aria-labelledby={agendaHeading}>
            {dayHeading}

            {!loaded && !failed && <p className={styles.note}>일정을 불러오고 있어요.</p>}
            {loaded && dayEvents.length === 0 && dayTodos.length === 0 && (
              <p className={styles.empty}>{selected === today ? "오늘은 일정이 없어요." : "이날은 일정이 없어요."}</p>
            )}
            {dayEvents.length > 0 && (
              <ul className={styles.list}>
                {dayEvents.map((event) => (
                  <EventRow
                    key={eventKeyOf(event)}
                    event={event}
                    date={selected}
                    hasMemo={memoKeys.has(eventKeyOf(event))}
                    onOpen={setDetail}
                  />
                ))}
              </ul>
            )}

            {dueTodos}

            {loaded?.personalConnected && (
              <button type="button" className={styles.addEvent} onClick={() => setCreating({ date: selected })}>
                이날 일정 만들기
              </button>
            )}
          </section>
        </div>
      )}

      {view === "week" && (
        <section className={styles.weekView} aria-labelledby={agendaHeading}>
          <div className={styles.secHead}>
            <h2 id={agendaHeading} className={styles.heading}>
              {weekLabel(days)}
            </h2>
          </div>
          {!loaded && !failed && <p className={styles.note}>일정을 불러오고 있어요.</p>}
          <WeekGrid
            days={days}
            today={today}
            events={allEvents}
            now={clock}
            memoKeys={memoKeys}
            onOpen={setDetail}
            onCreate={(date, startTime) => setCreating({ date, startTime })}
            onPickDay={(date) => chooseView("day", date)}
          />
          {notices}
        </section>
      )}

      {view === "day" && (
        <section className={styles.dayView} aria-labelledby={agendaHeading}>
          {dayHeading}
          {!loaded && !failed && <p className={styles.note}>일정을 불러오고 있어요.</p>}
          {loaded && dayEvents.length === 0 && (
            <p className={styles.empty}>{selected === today ? "오늘은 일정이 없어요." : "이날은 일정이 없어요."}</p>
          )}
          <DayTimeline
            date={selected}
            events={dayEvents}
            now={selected === today ? clock : null}
            memoKeys={memoKeys}
            onOpen={setDetail}
            onCreate={(startTime) => setCreating({ date: selected, startTime })}
          />
          {dueTodos}
          {notices}
        </section>
      )}

      <EventDetailSheet
        event={detail}
        events={allEvents}
        onClose={() => setDetail(null)}
        onChanged={() => setReload((n) => n + 1)}
      />
      <TodoEditorSheet open={editingTodo !== null} todo={editingTodo} onClose={() => setEditingTodo(null)} />
      {creating && (
        <EventEditorSheet
          open
          initialDate={creating.date}
          initialStartTime={creating.startTime}
          onClose={() => setCreating(null)}
          onSaved={() => setReload((n) => n + 1)}
        />
      )}
    </div>
  );
}

/** 일 / 주 / 월 as one radio group: arrow keys move the choice, like the kinds in quick add. */
function ViewSwitch({ view, onChange }: { view: CalendarView; onChange: (view: CalendarView) => void }) {
  const radios = useRef<Array<HTMLButtonElement | null>>([]);

  function onKey(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const back = e.key === "ArrowLeft" || e.key === "ArrowUp";
    if (!back && e.key !== "ArrowRight" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const next = (index + (back ? -1 : 1) + VIEWS.length) % VIEWS.length;
    onChange(VIEWS[next].view);
    radios.current[next]?.focus();
  }

  return (
    <div className={styles.viewBar}>
      <div role="radiogroup" aria-label="달력 보기" className={styles.views}>
        {VIEWS.map((v, index) => {
          const on = v.view === view;
          return (
            <button
              key={v.view}
              ref={(el) => {
                radios.current[index] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`${v.label}, ${v.name}씩 보기`}
              tabIndex={on ? 0 : -1}
              className={cx(styles.viewOption, on && styles.viewOn)}
              onClick={() => onChange(v.view)}
              onKeyDown={(e) => onKey(e, index)}
            >
              {v.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

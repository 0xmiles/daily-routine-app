"use client";

import { useEffect, useId, useState } from "react";
import { fetchEvents } from "@/features/calendar/client";
import { fetchEventKeys } from "@/features/memo/client";
import { ConnectPersonalHint } from "@/features/shell/ConnectPersonalHint";
import { onDataChanged } from "@/features/shell/events";
import { ChevronLeftIcon, ChevronRightIcon } from "@/features/shell/icons";
import { setPersonalConnected } from "@/features/shell/personalConnection";
import { TodoSegment } from "@/features/shell/TodoSegment";
import { EventRow } from "@/features/today/EventRow";
import { eventKeyOf, eventsOn, holidayOn } from "@/features/today/eventUtils";
import { useNow } from "@/features/today/useNow";
import { fetchTodos, TODOS_CHANGED_EVENT } from "@/features/todos/client";
import { TodoEditorSheet } from "@/features/todos/TodoEditorSheet";
import type { CalendarEvent, EventsResponse, Todo } from "@/shared/contracts";
import { seoulToday, weekdayOf } from "@/shared/time";
import { Button, Tag, cx } from "@/ui/primitives";
import { EventDetailSheet } from "./EventDetailSheet";
import { EventEditorSheet } from "./EventEditorSheet";
import { MonthGrid, monthCells } from "./MonthGrid";
import styles from "./CalendarPage.module.css";

export interface CalendarPageProps {
  /** Selected day from `?date=` ('YYYY-MM-DD'); its month is shown. */
  initialDate: string;
  /** Seoul today from the server render (until the client clock is known). */
  today: string;
}

type EventsState = { month: string; res: EventsResponse } | { month: string; error: true } | null;

const WEEKDAY_NAMES = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];
const EMPTY_KEYS: ReadonlySet<string> = new Set();

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** 할 일 › 달력: month grid; picking a day lists its events and due todos below (beside, on Mac). */
export function CalendarPage({ initialDate, today: serverToday }: CalendarPageProps) {
  const [selected, setSelected] = useState(initialDate);
  const [events, setEvents] = useState<EventsState>(null);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [memoKeys, setMemoKeys] = useState<ReadonlySet<string>>(EMPTY_KEYS);
  const [detail, setDetail] = useState<CalendarEvent | null>(null);
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null);
  const [creating, setCreating] = useState(false);
  const [reload, setReload] = useState(0);
  const agendaHeading = useId();
  const clock = useNow();
  const today = clock ? seoulToday(clock) : serverToday;

  const month = selected.slice(0, 7);
  const cells = monthCells(month);
  const from = cells[0];
  const to = cells[cells.length - 1];
  const [year, monthNumber] = month.split("-").map(Number);

  useEffect(() => {
    let alive = true;
    fetchEvents(from, to).then(
      (res) => {
        if (!alive) return;
        setEvents({ month, res });
        setPersonalConnected(res.personalConnected);
      },
      () => alive && setEvents({ month, error: true }),
    );
    fetchEventKeys().then(
      (keys) => alive && setMemoKeys(new Set(keys)),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [month, from, to, reload]);

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

  function select(date: string) {
    setSelected(date);
    window.history.replaceState(window.history.state, "", `/calendar?date=${date}`);
  }

  function goMonth(delta: number) {
    const target = shiftMonth(month, delta);
    select(today.startsWith(target) ? today : `${target}-01`);
  }

  const loaded = events?.month === month && "res" in events ? events.res : null;
  const failed = events?.month === month && "error" in events;
  const allEvents = loaded?.events ?? [];
  const dayEvents = eventsOn(allEvents, selected);
  const holiday = holidayOn(allEvents, selected);
  const dayTodos = todos.filter((t) => t.dueDate === selected && !t.doneAt);
  const selectedDay = Number(selected.slice(8));

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div>
          <div className={styles.year}>
            <span className="num">{year}</span>년
          </div>
          <h1 className={styles.month}>{monthNumber}월</h1>
        </div>
        <div className={styles.arrows}>
          {!today.startsWith(month) && (
            <button type="button" className={styles.thisMonth} onClick={() => select(today)}>
              이번 달
            </button>
          )}
          <button type="button" className={styles.arrow} aria-label="이전 달" onClick={() => goMonth(-1)}>
            <ChevronLeftIcon />
          </button>
          <button type="button" className={styles.arrow} aria-label="다음 달" onClick={() => goMonth(1)}>
            <ChevronRightIcon />
          </button>
        </div>
      </header>
      <TodoSegment active="calendar" />

      <div className={styles.body}>
        <div className={styles.gridCol}>
          <MonthGrid
            month={month}
            today={today}
            selected={selected}
            events={allEvents}
            todos={todos}
            onSelect={select}
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
        </div>

        <section className={styles.agenda} aria-labelledby={agendaHeading}>
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

          {dayTodos.length > 0 && (
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
          )}

          {loaded?.personalConnected && (
            <button type="button" className={styles.addEvent} onClick={() => setCreating(true)}>
              이날 일정 만들기
            </button>
          )}
        </section>
      </div>

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
          initialDate={selected}
          onClose={() => setCreating(false)}
          onSaved={() => setReload((n) => n + 1)}
        />
      )}
    </div>
  );
}

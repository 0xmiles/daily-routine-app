"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import type { Recurrence, Scope, Todo } from "@/shared/contracts";
import { addDays, seoulToday, weekdayOf } from "@/shared/time";
import { Button, cx, Sheet } from "@/ui/primitives";
import { createTodo, deleteTodo, updateTodo, type TodoInput } from "./client";
import { WEEK_ORDER, weekdayName } from "./format";
import styles from "./TodoEditorSheet.module.css";

export interface TodoEditorSheetProps {
  open: boolean;
  /** The todo to edit. Omit (or null) to add a new one. */
  todo?: Todo | null;
  onClose: () => void;
  /** After a successful save (the sheet closes itself via onClose). */
  onSaved?: (todo: Todo) => void;
  /** After a successful delete. */
  onDeleted?: (id: string) => void;
  /** Due date prefilled for a new todo, e.g. today from the today view. */
  defaultDueDate?: string | null;
  /** Title prefilled for a new todo, e.g. what was typed in quick add before "자세히". */
  defaultTitle?: string;
}

/** Add/edit sheet: 제목, 회사/개인, 마감 날짜·시간, 반복, 알림. */
export function TodoEditorSheet({
  open,
  todo,
  onClose,
  onSaved,
  onDeleted,
  defaultDueDate,
  defaultTitle,
}: TodoEditorSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title={todo ? "할 일 고치기" : "할 일 추가"}>
      {/* Sheet unmounts its content when closed, so each opening starts from fresh state. */}
      <TodoForm
        key={todo?.id ?? "new"}
        todo={todo ?? null}
        onClose={onClose}
        onSaved={onSaved}
        onDeleted={onDeleted}
        defaultDueDate={defaultDueDate ?? null}
        defaultTitle={defaultTitle ?? ""}
      />
    </Sheet>
  );
}

type Repeat = "none" | Recurrence["freq"];

const OFFSET_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "default", label: "기본값" },
  { value: "0", label: "마감 시각에" },
  { value: "10", label: "10분 전" },
  { value: "30", label: "30분 전" },
  { value: "60", label: "1시간 전" },
  { value: "120", label: "2시간 전" },
  { value: "1440", label: "하루 전" },
];

const SCOPES: Array<{ value: Scope; label: string }> = [
  { value: "personal", label: "개인" },
  { value: "work", label: "회사" },
];

function dayOfMonth(date: string): number {
  return Number(date.slice(8, 10));
}

interface TodoFormProps {
  todo: Todo | null;
  onClose: () => void;
  onSaved?: (todo: Todo) => void;
  onDeleted?: (id: string) => void;
  defaultDueDate: string | null;
  defaultTitle: string;
}

function TodoForm({ todo, onClose, onSaved, onDeleted, defaultDueDate, defaultTitle }: TodoFormProps) {
  const id = useId();
  const titleRef = useRef<HTMLInputElement>(null);
  const [today] = useState(() => seoulToday());

  const [title, setTitle] = useState(todo?.title ?? defaultTitle);
  const [scope, setScope] = useState<Scope>(todo?.scope ?? "personal");
  const [dueDate, setDueDate] = useState(todo ? (todo.dueDate ?? "") : (defaultDueDate ?? ""));
  const [dueTime, setDueTime] = useState(todo?.dueTime ?? "");
  const r = todo?.recurrence ?? null;
  const [repeat, setRepeat] = useState<Repeat>(r?.freq ?? "none");
  const [weekdays, setWeekdays] = useState<number[]>(r?.freq === "weekly" ? r.weekdays : []);
  const [monthDay, setMonthDay] = useState(r?.freq === "monthly" ? String(r.day) : "");
  const [notifyEnabled, setNotifyEnabled] = useState(todo?.notify.enabled ?? true);
  const ownOffset = todo?.notify.offsetMin ?? null;
  const [offset, setOffset] = useState(ownOffset === null ? "default" : String(ownOffset));

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const anchorDate = dueDate || today;
  const timeAllowed = dueDate !== "" || repeat !== "none";
  const offsetOptions =
    ownOffset !== null && !OFFSET_OPTIONS.some((o) => o.value === String(ownOffset))
      ? [...OFFSET_OPTIONS, { value: String(ownOffset), label: `${ownOffset}분 전` }]
      : OFFSET_OPTIONS;

  function changeRepeat(next: Repeat) {
    setRepeat(next);
    if (next === "weekly" && weekdays.length === 0) setWeekdays([weekdayOf(anchorDate)]);
    if (next === "monthly" && monthDay === "") setMonthDay(String(dayOfMonth(anchorDate)));
  }

  function toggleWeekday(day: number) {
    setWeekdays((days) => (days.includes(day) ? days.filter((d) => d !== day) : [...days, day]));
  }

  function changeDueDate(next: string) {
    setDueDate(next);
    if (next === "" && repeat === "none") setDueTime("");
  }

  function recurrence(): Recurrence | null | string {
    switch (repeat) {
      case "none":
        return null;
      case "daily":
        return { freq: "daily" };
      case "weekly":
        if (weekdays.length === 0) return "반복할 요일을 하나 이상 골라 주세요.";
        return { freq: "weekly", weekdays: [...weekdays].sort((a, b) => a - b) };
      case "monthly": {
        const day = Number(monthDay);
        if (!Number.isInteger(day) || day < 1 || day > 31) return "매월 반복할 날짜를 1일부터 31일 사이로 적어 주세요.";
        return { freq: "monthly", day };
      }
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const trimmed = title.trim();
    if (!trimmed) {
      setError("제목을 적어 주세요.");
      titleRef.current?.focus();
      return;
    }
    const rec = recurrence();
    if (typeof rec === "string") {
      setError(rec);
      return;
    }
    const input: TodoInput = {
      title: trimmed,
      scope,
      dueDate: dueDate || null,
      dueTime: timeAllowed && dueTime ? dueTime : null,
      recurrence: rec,
      notify: { enabled: notifyEnabled, offsetMin: offset === "default" ? null : Number(offset) },
    };
    setSaving(true);
    setError(null);
    try {
      const saved = todo ? await updateTodo(todo.id, input) : await createTodo(input);
      onSaved?.(saved);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "할 일을 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
      setSaving(false);
    }
  }

  async function remove() {
    if (!todo || saving) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await deleteTodo(todo.id);
      onDeleted?.(todo.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "할 일을 지우지 못했어요. 잠시 뒤 다시 시도해 주세요.");
      setSaving(false);
      setConfirmDelete(false);
    }
  }

  let notifyHint: string | null = null;
  if (notifyEnabled) {
    if (!dueDate && repeat === "none") notifyHint = "마감 날짜를 정하면 그때 알려드려요.";
    else if (!dueTime) notifyHint = "날짜만 정한 할 일은 그날 아침에 알려드려요.";
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <div className={styles.field}>
        <label htmlFor={`${id}-title`} className={styles.label}>
          제목
        </label>
        <input
          ref={titleRef}
          id={`${id}-title`}
          className={styles.input}
          type="text"
          value={title}
          maxLength={200}
          autoComplete="off"
          enterKeyHint="done"
          placeholder="무엇을 해야 하나요?"
          autoFocus={!todo}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <fieldset className={styles.fieldset}>
        <legend className={styles.label}>구분</legend>
        <div className={styles.segment}>
          {SCOPES.map((s) => (
            <label key={s.value} className={cx(styles.option, scope === s.value && styles.optionOn)}>
              <input
                type="radio"
                name={`${id}-scope`}
                value={s.value}
                checked={scope === s.value}
                onChange={() => setScope(s.value)}
                className={styles.srOnly}
              />
              {s.label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend className={styles.label}>마감</legend>
        <div className={styles.dueRow}>
          <input
            aria-label="마감 날짜"
            className={cx(styles.input, styles.dateInput, "num")}
            type="date"
            value={dueDate}
            onChange={(e) => changeDueDate(e.target.value)}
          />
          <input
            aria-label="마감 시간"
            className={cx(styles.input, styles.timeInput, "num")}
            type="time"
            value={timeAllowed ? dueTime : ""}
            disabled={!timeAllowed}
            onChange={(e) => setDueTime(e.target.value)}
          />
        </div>
        <div className={styles.chips}>
          <button type="button" className={styles.chip} onClick={() => changeDueDate(today)}>
            오늘
          </button>
          <button type="button" className={styles.chip} onClick={() => changeDueDate(addDays(today, 1))}>
            내일
          </button>
          {(dueDate || dueTime) && (
            <button
              type="button"
              className={styles.chip}
              onClick={() => {
                setDueDate("");
                setDueTime("");
              }}
            >
              마감 지우기
            </button>
          )}
        </div>
      </fieldset>

      <div className={styles.field}>
        <label htmlFor={`${id}-repeat`} className={styles.label}>
          반복
        </label>
        <select
          id={`${id}-repeat`}
          className={cx(styles.input, styles.select)}
          value={repeat}
          onChange={(e) => changeRepeat(e.target.value as Repeat)}
        >
          <option value="none">반복 안 함</option>
          <option value="daily">매일</option>
          <option value="weekly">매주</option>
          <option value="monthly">매월</option>
        </select>
        {repeat === "weekly" && (
          <div className={styles.weekdays} role="group" aria-label="반복할 요일">
            {WEEK_ORDER.map((day) => (
              <button
                key={day}
                type="button"
                aria-pressed={weekdays.includes(day)}
                className={cx(styles.weekday, weekdays.includes(day) && styles.weekdayOn)}
                onClick={() => toggleWeekday(day)}
              >
                {weekdayName(day)}
              </button>
            ))}
          </div>
        )}
        {repeat === "monthly" && (
          <div className={styles.monthly}>
            <span>매월</span>
            <input
              aria-label="매월 반복할 날짜"
              className={cx(styles.input, styles.dayInput, "num")}
              type="number"
              inputMode="numeric"
              min={1}
              max={31}
              value={monthDay}
              onChange={(e) => setMonthDay(e.target.value)}
            />
            <span>일</span>
          </div>
        )}
        {repeat !== "none" && (
          <p className={styles.hint}>
            {dueDate ? "끝냈다고 표시하면 다음 차례가 새로 생겨요." : "첫 차례는 오늘부터 가장 가까운 날로 잡혀요."}
          </p>
        )}
      </div>

      <fieldset className={styles.fieldset}>
        <legend className={styles.label}>알림</legend>
        <div className={styles.notifyRow}>
          <label className={styles.switch}>
            <input
              type="checkbox"
              className={styles.switchInput}
              checked={notifyEnabled}
              onChange={(e) => setNotifyEnabled(e.target.checked)}
            />
            <span>알림 받기</span>
          </label>
          {notifyEnabled && dueTime && timeAllowed && (
            <select
              aria-label="알림 시점"
              className={cx(styles.input, styles.select, styles.offset)}
              value={offset}
              onChange={(e) => setOffset(e.target.value)}
            >
              {offsetOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
        </div>
        {notifyHint && <p className={styles.hint}>{notifyHint}</p>}
      </fieldset>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <div className={styles.actions}>
        {todo && (
          <Button variant="ghost" onClick={remove} disabled={saving}>
            {confirmDelete ? "정말 삭제하기" : "삭제하기"}
          </Button>
        )}
        <Button type="submit" className={styles.save} disabled={saving}>
          {todo ? "저장하기" : "추가하기"}
        </Button>
      </div>
    </form>
  );
}

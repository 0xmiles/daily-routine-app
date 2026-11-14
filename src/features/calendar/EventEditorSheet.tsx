"use client";

import { useId, useState, type FormEvent } from "react";
import { createEvent, updateEvent } from "@/features/calendar/client";
import { ConnectPersonalHint } from "@/features/shell/ConnectPersonalHint";
import { NETWORK_ERROR, serverMessage } from "@/features/shell/errors";
import { emitDataChanged } from "@/features/shell/events";
import { usePersonalConnected } from "@/features/shell/personalConnection";
import { nextFullHourSlot } from "@/features/shell/slots";
import { daysBetween, seoulOf } from "@/features/today/eventUtils";
import type { CalendarEvent } from "@/shared/contracts";
import { Button, Sheet } from "@/ui/primitives";
import { buildEventInput, oneHourAfter, type EventFormState } from "./eventForm";
import styles from "./EventEditorSheet.module.css";

export interface EventEditorSheetProps {
  open: boolean;
  /** A personal event to edit. Omit to create a new one in the personal primary calendar. */
  event?: CalendarEvent | null;
  onClose: () => void;
  /** New event only: prefilled title (quick add "자세히") and date. */
  initialTitle?: string;
  initialDate?: string;
  /**
   * New event only: prefilled start and end ('HH:MM', Seoul), e.g. from a tapped
   * hour on the time ruler. Without an end the event lasts one hour; without
   * either it starts at the next full hour.
   */
  initialStartTime?: string;
  initialEndTime?: string;
  /** After a successful save (the sheet closes itself via onClose too). */
  onSaved?: () => void;
}

type InitialValues = Pick<EventEditorSheetProps, "initialTitle" | "initialDate" | "initialStartTime" | "initialEndTime">;

function initialState(event: CalendarEvent | null | undefined, initial: InitialValues): EventFormState {
  if (event) {
    if (event.allDay) {
      const date = event.start.slice(0, 10);
      const span = Math.max(1, daysBetween(date, event.end.slice(0, 10)));
      const slot = nextFullHourSlot();
      return { title: event.title ?? "", date, allDay: true, startTime: slot.startTime, endTime: slot.endTime, spanDays: span, memo: "" };
    }
    const start = seoulOf(event.start);
    const end = seoulOf(event.end);
    return {
      title: event.title ?? "",
      date: start.date,
      allDay: false,
      startTime: start.time,
      endTime: end.time,
      spanDays: Math.max(0, daysBetween(start.date, end.date)),
      memo: "",
    };
  }
  const slot = nextFullHourSlot();
  const startTime = initial.initialStartTime ?? slot.startTime;
  return {
    title: initial.initialTitle ?? "",
    date: initial.initialDate ?? slot.date,
    allDay: false,
    startTime,
    endTime: initial.initialEndTime ?? (initial.initialStartTime ? oneHourAfter(startTime) : slot.endTime),
    // Same day; an end of 00:00 (e.g. 23:00–00:00) is read as midnight the next day.
    spanDays: 0,
    memo: "",
  };
}

/** Create or edit a personal event (title, date, start/end or all-day, memo). */
export function EventEditorSheet({ open, event, onClose, onSaved, ...initial }: EventEditorSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title={event ? "일정 고치기" : "새 일정"}>
      <EventEditorForm event={event} onClose={onClose} onSaved={onSaved} {...initial} />
    </Sheet>
  );
}

function EventEditorForm({ event, onClose, onSaved, ...initial }: Omit<EventEditorSheetProps, "open">) {
  const isNew = !event;
  const personalConnected = usePersonalConnected(isNew);
  const [form, setForm] = useState<EventFormState>(() => initialState(event, initial));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const id = useId();

  if (isNew && personalConnected === false) {
    return <ConnectPersonalHint className={styles.hint} />;
  }

  const set = <K extends keyof EventFormState>(key: K, value: EventFormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    const input = buildEventInput(form);
    if ("error" in input) {
      setError(input.error);
      return;
    }
    const memo = form.memo.trim();
    setSaving(true);
    setError(null);
    try {
      if (event) {
        // Only send the memo when something was written, so an existing
        // Google description is never wiped by an empty field.
        await updateEvent(event.id, memo ? { ...input, description: memo } : input);
      } else {
        await createEvent(memo ? { ...input, description: memo } : input);
      }
      emitDataChanged("event");
      onSaved?.();
      onClose?.();
    } catch (err) {
      setError(serverMessage(err) ?? NETWORK_ERROR);
      setSaving(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <label className={styles.field}>
        <span className={styles.label}>제목</span>
        <input
          className={styles.input}
          value={form.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder="예: 치과 예약"
          autoFocus={isNew}
          required
        />
      </label>
      <div className={styles.row}>
        <label className={styles.field}>
          <span className={styles.label}>날짜</span>
          <input
            className={`${styles.input} num`}
            type="date"
            value={form.date}
            onChange={(e) => set("date", e.target.value)}
            required
          />
        </label>
        <label className={styles.check}>
          <input type="checkbox" checked={form.allDay} onChange={(e) => set("allDay", e.target.checked)} />
          <span>종일</span>
        </label>
      </div>
      {!form.allDay && (
        <div className={styles.row}>
          <label className={styles.field}>
            <span className={styles.label}>시작</span>
            <input
              className={`${styles.input} num`}
              type="time"
              value={form.startTime}
              onChange={(e) => set("startTime", e.target.value)}
              required
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>끝</span>
            <input
              className={`${styles.input} num`}
              type="time"
              value={form.endTime}
              onChange={(e) => set("endTime", e.target.value)}
              required
            />
          </label>
        </div>
      )}
      <label className={styles.field}>
        <span className={styles.label}>메모</span>
        <textarea
          className={styles.textarea}
          value={form.memo}
          onChange={(e) => set("memo", e.target.value)}
          rows={3}
          placeholder={event ? "적으면 Google 캘린더 설명을 이 내용으로 바꿔요." : "선택 사항이에요."}
          aria-describedby={`${id}-note`}
        />
      </label>
      <p id={`${id}-note`} className={styles.note}>
        {isNew ? "새 일정은 개인 Google 캘린더에 저장돼요." : "고친 내용은 개인 Google 캘린더에도 반영돼요."}
      </p>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.actions}>
        <Button variant="ghost" onClick={onClose}>
          취소
        </Button>
        <Button type="submit" disabled={saving}>
          {isNew ? "일정 만들기" : "고친 내용 저장하기"}
        </Button>
      </div>
    </form>
  );
}

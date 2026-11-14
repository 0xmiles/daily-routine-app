"use client";

import { useId, useState, type FormEvent } from "react";
import { createEvent, updateEvent } from "@/features/calendar/client";
import { ConnectPersonalHint } from "@/features/shell/ConnectPersonalHint";
import { NETWORK_ERROR, serverMessage } from "@/features/shell/errors";
import { emitDataChanged } from "@/features/shell/events";
import { usePersonalConnected } from "@/features/shell/personalConnection";
import { nextFullHourSlot, seoulIso } from "@/features/shell/slots";
import { daysBetween, seoulOf } from "@/features/today/eventUtils";
import type { CalendarEvent, NewPersonalEvent } from "@/shared/contracts";
import { addDays } from "@/shared/time";
import { Button, Sheet } from "@/ui/primitives";
import styles from "./EventEditorSheet.module.css";

export interface EventEditorSheetProps {
  open: boolean;
  /** A personal event to edit. Omit to create a new one in the personal primary calendar. */
  event?: CalendarEvent | null;
  onClose: () => void;
  /** New event only: prefilled title (quick add "자세히") and date. */
  initialTitle?: string;
  initialDate?: string;
  /** After a successful save (the sheet closes itself via onClose too). */
  onSaved?: () => void;
}

interface FormState {
  title: string;
  date: string;
  allDay: boolean;
  startTime: string;
  endTime: string;
  /** Days between start and end date (keeps multi-day events intact when editing). */
  spanDays: number;
  memo: string;
}

function initialState(event: CalendarEvent | null | undefined, initialTitle?: string, initialDate?: string): FormState {
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
  const date = initialDate ?? slot.date;
  return {
    title: initialTitle ?? "",
    date,
    allDay: false,
    startTime: slot.startTime,
    endTime: slot.endTime,
    // 23:00 → 00:00 ends on the next day.
    spanDays: slot.endTime <= slot.startTime ? 1 : 0,
    memo: "",
  };
}

/** Validates the form and builds the API body, or returns a sentence saying what to fix. */
export function buildEventInput(form: FormState): NewPersonalEvent | { error: string } {
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

/** Create or edit a personal event (title, date, start/end or all-day, memo). */
export function EventEditorSheet({ open, event, onClose, initialTitle, initialDate, onSaved }: EventEditorSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title={event ? "일정 고치기" : "새 일정"}>
      <EventEditorForm
        event={event}
        initialTitle={initialTitle}
        initialDate={initialDate}
        onClose={onClose}
        onSaved={onSaved}
      />
    </Sheet>
  );
}

function EventEditorForm({
  event,
  initialTitle,
  initialDate,
  onClose,
  onSaved,
}: Omit<EventEditorSheetProps, "open">) {
  const isNew = !event;
  const personalConnected = usePersonalConnected(isNew);
  const [form, setForm] = useState<FormState>(() => initialState(event, initialTitle, initialDate));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const id = useId();

  if (isNew && personalConnected === false) {
    return <ConnectPersonalHint className={styles.hint} />;
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

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

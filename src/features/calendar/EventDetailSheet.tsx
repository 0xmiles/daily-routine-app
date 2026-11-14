"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { deleteEvent, fetchEvents } from "@/features/calendar/client";
import { fetchEventKeys, openEventMemo } from "@/features/memo/client";
import { serverMessage } from "@/features/shell/errors";
import { emitDataChanged } from "@/features/shell/events";
import {
  displayTitle,
  eventKeyOf,
  eventWhen,
  previousInstance,
  scopeOf,
  toEventRef,
} from "@/features/today/eventUtils";
import type { CalendarEvent } from "@/shared/contracts";
import { addDays, seoulParts } from "@/shared/time";
import { Button, Sheet, Tag } from "@/ui/primitives";
import { EventEditorSheet } from "./EventEditorSheet";
import styles from "./EventDetailSheet.module.css";

export interface EventDetailSheetProps {
  /** The event to show; null keeps the sheet closed. */
  event: CalendarEvent | null;
  onClose: () => void;
  /** Events the screen already loaded; used to find the previous instance of a recurring event. */
  events?: CalendarEvent[];
  /** After the event was edited or deleted (the screen should refetch). */
  onChanged?: () => void;
}

/** How far back to look for the previous instance when it isn't among the loaded events. */
const LOOKBACK_DAYS = 35;

/**
 * Event detail: title, time, place, attendees, 회사/개인. Memo buttons for
 * every non-holiday event ("메모 쓰기" / "메모 보기", "지난 회의 메모 보기"),
 * and 수정 / 삭제 only for personal events.
 */
export function EventDetailSheet({ event, onClose, events = [], onChanged }: EventDetailSheetProps) {
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  return (
    <>
      <Sheet open={event !== null && editing === null} onClose={onClose} title={event ? displayTitle(event) : ""}>
        {event && (
          <Detail
            key={eventKeyOf(event)}
            event={event}
            events={events}
            onEdit={() => setEditing(event)}
            onClose={onClose}
            onChanged={onChanged}
          />
        )}
      </Sheet>
      {editing && (
        <EventEditorSheet
          open
          event={editing}
          onSaved={onChanged}
          onClose={() => {
            setEditing(null);
            onClose();
          }}
        />
      )}
    </>
  );
}

function startDateOf(event: CalendarEvent): string {
  return event.allDay ? event.start.slice(0, 10) : seoulParts(new Date(event.start)).date;
}

function Detail({
  event,
  events,
  onEdit,
  onClose,
  onChanged,
}: {
  event: CalendarEvent;
  events: CalendarEvent[];
  onEdit: () => void;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const router = useRouter();
  const isHoliday = event.source === "holiday";
  const editable = event.source === "personal" && !event.readOnly;
  const [memoKeys, setMemoKeys] = useState<Set<string> | null>(null);
  const [previous, setPrevious] = useState<CalendarEvent | null>(() => previousInstance(event, events));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isHoliday) return;
    let alive = true;
    fetchEventKeys()
      .then((keys) => alive && setMemoKeys(new Set(keys)))
      .catch(() => alive && setMemoKeys(new Set()));
    return () => {
      alive = false;
    };
  }, [isHoliday]);

  // The previous instance may be outside what the screen loaded (e.g. the today view).
  useEffect(() => {
    if (isHoliday || previous || !event.recurringEventId) return;
    let alive = true;
    const start = startDateOf(event);
    fetchEvents(addDays(start, -LOOKBACK_DAYS), addDays(start, -1))
      .then((res) => alive && setPrevious(previousInstance(event, res.events)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [event, isHoliday, previous]);

  const hasMemo = memoKeys?.has(eventKeyOf(event)) ?? false;
  const previousHasMemo = previous !== null && (memoKeys?.has(eventKeyOf(previous)) ?? false);

  async function openMemo(target: CalendarEvent) {
    setBusy(true);
    setError(null);
    try {
      await openEventMemo(toEventRef(target), (href) => router.push(href));
      onClose();
    } catch (err) {
      setError(serverMessage(err) ?? "메모를 열지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.");
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await deleteEvent(event.id);
      emitDataChanged("event");
      onChanged?.();
      onClose();
    } catch (err) {
      setError(serverMessage(err) ?? "일정을 삭제하지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.");
      setBusy(false);
    }
  }

  return (
    <div className={styles.detail}>
      <dl className={styles.info}>
        <div className={styles.infoRow}>
          <dt>시간</dt>
          <dd className="num">{eventWhen(event)}</dd>
        </div>
        {event.location && (
          <div className={styles.infoRow}>
            <dt>장소</dt>
            <dd>{event.location}</dd>
          </div>
        )}
        {event.attendeeCount !== null && event.attendeeCount > 0 && (
          <div className={styles.infoRow}>
            <dt>참석자</dt>
            <dd>
              <span className="num">{event.attendeeCount}</span>명
            </dd>
          </div>
        )}
        <div className={styles.infoRow}>
          <dt>구분</dt>
          <dd>{isHoliday ? "공휴일" : <Tag scope={scopeOf(event)} />}</dd>
        </div>
      </dl>

      {event.source === "work" && (
        <p className={styles.note}>
          {event.busyOnly && "회사 캘린더에서 바쁨으로만 공유된 일정이에요. "}
          회사 일정은 읽기 전용이에요. 메모는 이 앱에만 저장돼요.
        </p>
      )}
      {isHoliday && <p className={styles.note}>공휴일은 대한민국 공휴일 캘린더에서 가져와요. 읽기 전용이에요.</p>}

      {!isHoliday && (
        <div className={styles.memoActions}>
          <Button onClick={() => void openMemo(event)} disabled={busy}>
            {hasMemo ? "메모 보기" : "메모 쓰기"}
          </Button>
          {previous && previousHasMemo && (
            <Button variant="outline" onClick={() => void openMemo(previous)} disabled={busy}>
              지난 회의 메모 보기
            </Button>
          )}
        </div>
      )}

      {editable && !confirmDelete && (
        <div className={styles.editActions}>
          <Button variant="outline" onClick={onEdit} disabled={busy}>
            수정
          </Button>
          <Button variant="ghost" className={styles.danger} onClick={() => setConfirmDelete(true)} disabled={busy}>
            삭제
          </Button>
        </div>
      )}
      {editable && confirmDelete && (
        <div className={styles.confirm} role="group" aria-label="삭제 확인">
          <p className={styles.confirmText}>이 일정을 삭제할까요? 개인 Google 캘린더에서도 지워져요.</p>
          <div className={styles.editActions}>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={busy}>
              취소
            </Button>
            <Button className={styles.dangerFill} onClick={() => void remove()} disabled={busy}>
              일정 삭제하기
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}

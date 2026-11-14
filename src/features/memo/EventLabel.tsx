import Link from "next/link";
import type { EventRef } from "@/shared/contracts";
import { Tag, cx } from "@/ui/primitives";
import styles from "./EventLabel.module.css";
import { eventDateOf, formatEventWhen } from "./format";
import { CalendarIcon } from "./icons";

export interface EventLabelProps {
  eventRef: EventRef;
  className?: string;
}

/**
 * Name tag on top of an event memo block: title + 회사/개인 tag, then the
 * event's date and time and a "일정 보기" link back to that day in the calendar.
 * Events deleted in Google keep their memo and say "삭제된 일정".
 */
export function EventLabel({ eventRef, className }: EventLabelProps) {
  const date = eventDateOf(eventRef);
  return (
    <div className={cx(styles.label, className)} data-deleted={eventRef.deleted || undefined}>
      <div className={styles.top}>
        <span className={styles.icon}>
          <CalendarIcon />
        </span>
        <span className={styles.title}>{eventRef.title}</span>
        <Tag scope={eventRef.source} className={styles.tag} />
      </div>
      <div className={styles.bottom}>
        <span className={cx("num", styles.when)}>{formatEventWhen(eventRef)}</span>
        {eventRef.deleted ? (
          <span className={styles.deleted}>삭제된 일정</span>
        ) : date ? (
          <Link href={`/calendar?date=${date}`} className={styles.link}>
            일정 보기
          </Link>
        ) : null}
      </div>
    </div>
  );
}

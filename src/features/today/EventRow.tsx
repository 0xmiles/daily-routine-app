import type { CalendarEvent } from "@/shared/contracts";
import { Tag, cx } from "@/ui/primitives";
import { MemoIcon } from "@/features/shell/icons";
import { displayTitle, scopeOf, startLabel } from "./eventUtils";
import styles from "./EventRow.module.css";

export interface EventRowProps {
  event: CalendarEvent;
  /** The day the row is listed under (for 'HH:MM' vs '이어서'). */
  date: string;
  hasMemo?: boolean;
  onOpen: (event: CalendarEvent) => void;
}

/** One event line: time, title (busy-only → hatched 바쁨), place on a second line, memo mark, 회사/개인 tag. */
export function EventRow({ event, date, hasMemo = false, onOpen }: EventRowProps) {
  const time = startLabel(event, date);
  return (
    <li className={styles.item}>
      <button type="button" className={styles.row} onClick={() => onOpen(event)}>
        <span className={cx(styles.time, /\d/.test(time) && "num")}>{time}</span>
        <span className={styles.main}>
          <span className={styles.line}>
            {event.busyOnly ? (
              <span className={styles.busy}>바쁨</span>
            ) : (
              <span className={styles.title}>{displayTitle(event)}</span>
            )}
            {hasMemo && (
              <span className={styles.memo}>
                <MemoIcon size={11} strokeWidth={2} />
                메모
              </span>
            )}
          </span>
          {event.location && <span className={styles.place}>{event.location}</span>}
        </span>
        <Tag scope={scopeOf(event)} />
      </button>
    </li>
  );
}

import { weekdayOf } from "@/shared/time";
import { cx } from "@/ui/primitives";
import { dayTone, koreanDay } from "./eventUtils";
import styles from "./DateLeaf.module.css";

const WEEKDAY_NAMES = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];

export interface LeafCounts {
  /** Personal + work events on the day (holidays excluded). */
  events: number;
  /** Todos on the day, done or not. */
  todos: number;
  done: number;
  /** Open todos past their due date (desktop shows it as a third line). */
  late?: number;
}

export interface DateLeafProps {
  date: string;
  /** null while loading. */
  counts: LeafCounts | null;
  /** Holiday name; the date turns red like a wall calendar. */
  holiday?: string | null;
  /** Slide in from the side after a swipe / arrow key (respects reduced motion). */
  enter?: "next" | "prev" | null;
  className?: string;
}

/** One torn-off page of a daily calendar: year and month, weekday, the big date and a one-line summary. */
export function DateLeaf({ date, counts, holiday = null, enter = null, className }: DateLeafProps) {
  const [year, month, day] = date.split("-").map(Number);
  const tone = dayTone(date, Boolean(holiday));
  const toneClass = styles[tone];

  return (
    <section
      className={cx(styles.leaf, enter === "next" && styles.enterNext, enter === "prev" && styles.enterPrev, className)}
      aria-label={holiday ? `${koreanDay(date)} ${holiday}` : koreanDay(date)}
    >
      <div className={styles.ym}>
        <span>
          <span className={cx("num", styles.year)}>{year}</span>
          {"  "}
          {month}월
        </span>
        <span className={styles.right}>
          {holiday && <span className={cx(styles.pill, styles.holiday, toneClass)}>{holiday}</span>}
          <span className={cx(styles.pill, styles.weekday, toneClass)}>{WEEKDAY_NAMES[weekdayOf(date)]}</span>
        </span>
      </div>
      <div className={cx(styles.numeral, toneClass)} aria-hidden="true">
        {day}
      </div>
      <Summary counts={counts} />
    </section>
  );
}

function Summary({ counts }: { counts: LeafCounts | null }) {
  if (!counts) {
    return (
      <p className={styles.sum} data-testid="leaf-summary">
        <span className={styles.loading}>오늘 할 일을 세고 있어요.</span>
      </p>
    );
  }
  const { events, todos, done, late = 0 } = counts;
  return (
    <>
      <p className={styles.sum} data-testid="leaf-summary">
        <span className={styles.part}>
          {events > 0 ? (
            <>
              일정 <b className="num">{events}</b>개
            </>
          ) : (
            "일정 없음"
          )}
        </span>
        <span className={styles.comma}>, </span>
        <span className={styles.part}>
          {todos > 0 ? (
            <>
              할 일 <b className="num">{todos}</b>개 중 <b className="num">{done}</b>개 끝냄
            </>
          ) : (
            "할 일 없음"
          )}
        </span>
      </p>
      {late > 0 && (
        <p className={cx(styles.pill, styles.late)}>
          늦은 할 일 <span className="num">{late}</span>개
        </p>
      )}
    </>
  );
}

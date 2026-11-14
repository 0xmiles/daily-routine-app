"use client";

import { useEffect, useId, useRef, useState } from "react";
import { FEATURES } from "@/shared/features";
import { Button } from "@/ui/primitives";
import { fetchReminderSettings, saveReminderSettings } from "./client";
import type {
  ReminderSettings as Settings,
  ReminderSettingsPatch,
} from "./types";
import styles from "./ReminderSettings.module.css";

const WEEKDAYS = [
  "일요일",
  "월요일",
  "화요일",
  "수요일",
  "목요일",
  "금요일",
  "토요일",
];
const OFFSETS = [0, 5, 10, 15, 30, 60, 120, 1440];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const SAVE_DELAY_MS = 700;

type Part = "upload" | "todo";

export function offsetLabel(minutes: number): string {
  if (minutes === 0) return "마감 시각에";
  if (minutes === 1440) return "하루 전";
  if (minutes % 60 === 0) return `${minutes / 60}시간 전`;
  return `${minutes}분 전`;
}

/**
 * Settings → 거래내역 올리기 알림 (weekday + time, only while 자산 is on) and 할 일
 * 기본 알림 (minutes before a due time, time of day for date-only todos). Saves as you change.
 */
export function ReminderSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [status, setStatus] = useState<{
    part: Part;
    text: string;
    error: boolean;
  } | null>(null);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const ids = {
    upload: useId(),
    todo: useId(),
    dow: useId(),
    time: useId(),
    offset: useId(),
    dateOnly: useId(),
  };

  function load() {
    setLoadFailed(false);
    fetchReminderSettings().then(setSettings, () => setLoadFailed(true));
  }

  useEffect(() => {
    fetchReminderSettings().then(setSettings, () => setLoadFailed(true));
    const pending = timers.current;
    return () => {
      for (const t of Object.values(pending)) clearTimeout(t);
    };
  }, []);

  function save(part: Part, patch: ReminderSettingsPatch) {
    setSettings((s) => (s ? { ...s, ...patch } : s));
    saveReminderSettings(patch).then(
      (next) => {
        setSettings(next);
        setStatus({ part, text: "저장했어요.", error: false });
      },
      (err: unknown) => {
        setStatus({
          part,
          text:
            err instanceof Error && err.message
              ? err.message
              : "저장하지 못했어요. 다시 골라 주세요.",
          error: true,
        });
        load();
      },
    );
  }

  /** Time fields: wait until typing settles, then save if it is a valid 'HH:MM'. */
  function saveTimeLater(
    part: Part,
    key: "uploadReminderTime" | "dateOnlyNotifyTime",
    value: string,
  ) {
    setSettings((s) => (s ? { ...s, [key]: value } : s));
    clearTimeout(timers.current[key]);
    if (!TIME_RE.test(value)) return;
    timers.current[key] = setTimeout(
      () => save(part, { [key]: value }),
      SAVE_DELAY_MS,
    );
  }

  if (loadFailed) {
    return (
      <div className={styles.problem} role="alert">
        <p className={styles.desc}>
          알림 설정을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 불러와
          주세요.
        </p>
        <Button variant="outline" onClick={load}>
          다시 불러오기
        </Button>
      </div>
    );
  }
  if (!settings)
    return <p className={styles.desc}>알림 설정을 불러오고 있어요.</p>;

  const offsets = OFFSETS.includes(settings.defaultOffsetMin)
    ? OFFSETS
    : [...OFFSETS, settings.defaultOffsetMin].sort((a, b) => a - b);
  const statusFor = (part: Part) =>
    status?.part === part ? (
      <p
        className={status.error ? styles.error : styles.saved}
        role={status.error ? "alert" : "status"}
      >
        {status.text}
      </p>
    ) : null;

  return (
    <>
      {FEATURES.assets && (
        <section className={styles.section} aria-labelledby={ids.upload}>
          <h3 id={ids.upload} className={styles.heading}>
            거래내역 올리기 알림
          </h3>
          <p className={styles.desc}>
            매주 {WEEKDAYS[settings.uploadReminderDow]}{" "}
            <span className="num">{settings.uploadReminderTime}</span>에 신한
            거래내역을 올리라고 알려 드려요.
          </p>
          <div className={styles.fields}>
            <label className={styles.field} htmlFor={ids.dow}>
              <span className={styles.label}>요일</span>
              <select
                id={ids.dow}
                className={styles.control}
                value={settings.uploadReminderDow}
                onChange={(e) =>
                  save("upload", { uploadReminderDow: Number(e.target.value) })
                }
              >
                {WEEKDAYS.map((name, i) => (
                  <option key={name} value={i}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field} htmlFor={ids.time}>
              <span className={styles.label}>시간</span>
              <input
                id={ids.time}
                type="time"
                className={`${styles.control} num`}
                value={settings.uploadReminderTime}
                onChange={(e) =>
                  saveTimeLater("upload", "uploadReminderTime", e.target.value)
                }
                required
              />
            </label>
          </div>
          {statusFor("upload")}
        </section>
      )}

      <section className={styles.section} aria-labelledby={ids.todo}>
        <h3 id={ids.todo} className={styles.heading}>
          할 일 기본 알림
        </h3>
        <p className={styles.desc}>
          할 일마다 따로 바꿀 수 있어요. 여기서는 따로 정하지 않은 할 일의
          기본값을 정해요.
        </p>
        <div className={styles.fields}>
          <label className={styles.field} htmlFor={ids.offset}>
            <span className={styles.label}>마감 시간이 있으면</span>
            <select
              id={ids.offset}
              className={styles.control}
              value={settings.defaultOffsetMin}
              onChange={(e) =>
                save("todo", { defaultOffsetMin: Number(e.target.value) })
              }
            >
              {offsets.map((m) => (
                <option key={m} value={m}>
                  {offsetLabel(m)}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field} htmlFor={ids.dateOnly}>
            <span className={styles.label}>날짜만 있으면 그날</span>
            <input
              id={ids.dateOnly}
              type="time"
              className={`${styles.control} num`}
              value={settings.dateOnlyNotifyTime}
              onChange={(e) =>
                saveTimeLater("todo", "dateOnlyNotifyTime", e.target.value)
              }
              required
            />
          </label>
        </div>
        {statusFor("todo")}
      </section>
    </>
  );
}

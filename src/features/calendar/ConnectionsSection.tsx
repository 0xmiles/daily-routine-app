"use client";

import { useEffect, useId, useReducer, useState, useSyncExternalStore, type ReactNode } from "react";
import { Button, Sheet, cx, type ButtonVariant } from "@/ui/primitives";
import {
  CONNECT_PERSONAL_URL,
  CONNECT_WORK_URL,
  CalendarApiError,
  chooseSharedCalendar,
  disconnectWorkCalendar,
  fetchConnections,
  fetchSharedCalendars,
  type ConnectionsResponse,
  type SharedCalendar,
  type WorkConnectionStatus,
} from "./client";
import styles from "./ConnectionsSection.module.css";

// 설정 › 캘린더 연결. Personal calendar first (new events go there), then the
// read-only work calendar. The OAuth callbacks come back to /settings with
// ?personal=… or ?work=… and this section shows what happened.

const PERSONAL_NEEDED = "개인 캘린더를 먼저 연결해 주세요.";

const PERSONAL_FLAGS: Record<string, { text: string; tone: "done" | "attention" }> = {
  connected: { text: "개인 캘린더를 연결했어요. 새 일정은 이 계정에 저장돼요.", tone: "done" },
  work_account: { text: "회사 계정이 선택됐어요. 개인 캘린더로 쓸 개인 계정을 골라 다시 연결해 주세요.", tone: "attention" },
  scope: { text: "캘린더 권한이 빠져 있어요. 다시 연결하면서 캘린더 권한을 모두 허용해 주세요.", tone: "attention" },
  error: { text: "개인 캘린더를 연결하지 못했어요. 잠시 뒤 다시 연결해 주세요.", tone: "attention" },
};

const WORK_FLAGS: Record<string, { text: string; tone: "done" | "attention" }> = {
  connected: { text: "회사 캘린더를 연결했어요.", tone: "done" },
  blocked: {
    text: "회사 계정에서 외부 앱 연결이 막혀 있어요. 회사 캘린더를 개인 계정에 공유한 뒤 '공유받은 캘린더에서 고르기'를 눌러 주세요.",
    tone: "attention",
  },
  same_account: { text: "개인 캘린더와 같은 계정이 선택됐어요. 회사 계정을 골라 다시 연결해 주세요.", tone: "attention" },
  scope: { text: "캘린더 읽기 권한이 빠져 있어요. 다시 연결하면서 캘린더 권한을 허용해 주세요.", tone: "attention" },
  error: { text: "회사 캘린더를 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.", tone: "attention" },
};

const WORK_LABELS: Record<WorkConnectionStatus, string> = {
  connected: "연결됨",
  busy_only: "바쁨만 보여요",
  disconnected: "연결 안 됨",
  needs_reconnect: "다시 연결 필요",
  error: "읽지 못했어요",
};

type Tone = "on" | "off" | "alert";
const WORK_TONES: Record<WorkConnectionStatus, Tone> = {
  connected: "on",
  busy_only: "on",
  disconnected: "off",
  needs_reconnect: "alert",
  error: "alert",
};

function errorMessage(error: unknown): string {
  return error instanceof CalendarApiError ? error.message : "요청을 처리하지 못했어요. 잠시 뒤 다시 시도해 주세요.";
}

// The URL's query string, read without a hydration mismatch (server snapshot is empty).
const noopSubscribe = () => () => {};
function useLocationSearch(): string {
  return useSyncExternalStore(
    noopSubscribe,
    () => window.location.search,
    () => "",
  );
}

export interface ConnectionsSectionProps {
  /** Callback result flags. Defaults to the page URL's `?personal=` and `?work=`. */
  flags?: { personal?: string | null; work?: string | null };
}

export function ConnectionsSection({ flags }: ConnectionsSectionProps) {
  const headingId = useId();
  const search = useLocationSearch();
  const [flagsDismissed, setFlagsDismissed] = useState(false);
  const params = new URLSearchParams(search);
  const personalFlag = flagsDismissed ? undefined : PERSONAL_FLAGS[flags?.personal ?? params.get("personal") ?? ""];
  const workFlag = flagsDismissed ? undefined : WORK_FLAGS[flags?.work ?? params.get("work") ?? ""];

  const [data, setData] = useState<ConnectionsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, reload] = useReducer((n: number) => n + 1, 0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchConnections().then(
      (next) => {
        if (cancelled) return;
        setData(next);
        setLoadError(null);
      },
      (error: unknown) => {
        if (!cancelled) setLoadError(errorMessage(error));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  function dismissFlags() {
    const url = new URL(window.location.href);
    url.searchParams.delete("personal");
    url.searchParams.delete("work");
    window.history.replaceState(window.history.state, "", url);
    setFlagsDismissed(true);
  }

  async function disconnect() {
    setBusy(true);
    setActionError(null);
    try {
      setData(await disconnectWorkCalendar());
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const personal = data?.personal ?? null;
  const work = data?.work;

  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>
        캘린더 연결
      </h2>

      {!data ? (
        <div className={styles.loading} aria-live="polite">
          {loadError ? (
            <>
              <p className={styles.alertText}>{loadError}</p>
              <Button variant="outline" onClick={reload}>
                연결 상태 다시 확인하기
              </Button>
            </>
          ) : (
            <p className={styles.muted}>연결 상태를 확인하고 있어요.</p>
          )}
        </div>
      ) : (
        <>
          <AccountGroup
            title="개인 캘린더"
            summary="새 일정은 여기에 저장돼요."
            status={
              personal
                ? personal.status === "ok"
                  ? { label: "연결됨", tone: "on" }
                  : { label: "다시 연결 필요", tone: "alert" }
                : { label: "연결 안 됨", tone: "off" }
            }
          >
            {personal ? (
              <p className={styles.account}>{personal.email}</p>
            ) : (
              <p className={styles.detail}>개인 캘린더를 연결하면 새 일정을 추가할 수 있어요.</p>
            )}
            {personal?.status === "needs_reconnect" ? (
              <p className={styles.alertText}>연결이 끊겼어요. &apos;다시 연결하기&apos;를 눌러 이어 주세요.</p>
            ) : null}
            <div className={styles.actions}>
              <NavButton
                href={CONNECT_PERSONAL_URL}
                variant={personal?.status === "ok" ? "outline" : "ink"}
                ariaLabel={personal ? "개인 캘린더 다시 연결하기" : undefined}
              >
                {personal ? "다시 연결하기" : "개인 캘린더 연결하기"}
              </NavButton>
            </div>
            {personalFlag ? <FlagNotice flag={personalFlag} onDismiss={dismissFlags} /> : null}
          </AccountGroup>

          <AccountGroup
            title="회사 캘린더"
            summary="읽기만 해요."
            status={{ label: WORK_LABELS[work!.status], tone: WORK_TONES[work!.status] }}
          >
            <p className={styles.detail}>{workDetail(data)}</p>
            <div className={styles.actions}>
              <NavButton href={CONNECT_WORK_URL} variant={work!.via === "none" ? "ink" : "outline"}>
                회사 캘린더 연결하기
              </NavButton>
              <Button variant="outline" onClick={() => setPickerOpen(true)}>
                공유받은 캘린더에서 고르기
              </Button>
              {work!.via !== "none" ? (
                <Button variant="ghost" onClick={disconnect} disabled={busy}>
                  회사 캘린더 연결 끊기
                </Button>
              ) : null}
            </div>
            {work!.via === "none" && !workFlag ? (
              <p className={styles.hint}>
                회사 계정 연결이 Google 화면에서 막히면 이 화면으로 돌아와 &apos;공유받은 캘린더에서 고르기&apos;를 눌러
                주세요.
              </p>
            ) : null}
            {actionError ? (
              <p className={styles.alertText} role="alert">
                {actionError}
              </p>
            ) : null}
            {workFlag ? <FlagNotice flag={workFlag} onDismiss={dismissFlags} /> : null}
          </AccountGroup>

          <SharedCalendarPicker
            open={pickerOpen}
            hasPersonal={personal !== null}
            selectedId={work!.via === "personal_shared" ? work!.calendarId : null}
            onClose={() => setPickerOpen(false)}
            onChosen={(next) => {
              setData(next);
              setPickerOpen(false);
            }}
          />
        </>
      )}
    </section>
  );
}

function workDetail({ personal, work }: ConnectionsResponse): string {
  switch (work.status) {
    case "connected":
      return work.via === "work_account"
        ? `${work.email ?? "회사"} 계정의 일정을 보여 줘요.`
        : `개인 계정에 공유된 ${work.calendarId} 캘린더를 보여 줘요.`;
    case "busy_only":
      return "회사 정책 때문에 일정 제목 없이 바쁜 시간만 보여요.";
    case "needs_reconnect":
      if (work.via === "work_account") return "회사 계정 연결이 끊겼어요. '회사 캘린더 연결하기'를 눌러 다시 연결해 주세요.";
      return personal
        ? "개인 캘린더 연결이 끊겨서 공유받은 캘린더를 읽지 못해요. 개인 캘린더를 다시 연결해 주세요."
        : PERSONAL_NEEDED;
    case "error":
      return "회사 캘린더를 읽지 못했어요. 잠시 뒤 다시 열어 보고, 계속되면 다시 연결해 주세요.";
    default:
      return "회사 계정을 연결하거나, 개인 계정에 공유된 회사 캘린더를 골라 주세요.";
  }
}

function AccountGroup({
  title,
  summary,
  status,
  children,
}: {
  title: string;
  summary: string;
  status: { label: string; tone: Tone };
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <div role="group" aria-labelledby={titleId} className={styles.group}>
      <div className={styles.groupHead}>
        <h3 id={titleId} className={styles.groupTitle}>
          {title}
        </h3>
        <span className={cx(styles.status, styles[status.tone])}>
          <span className={styles.dot} aria-hidden="true" />
          {status.label}
        </span>
      </div>
      <p className={styles.summary}>{summary}</p>
      {children}
    </div>
  );
}

/** A button that navigates (GET form), so OAuth starts work even before hydration. */
function NavButton({
  href,
  variant,
  ariaLabel,
  children,
}: {
  href: string;
  variant: ButtonVariant;
  ariaLabel?: string;
  children: ReactNode;
}) {
  return (
    <form action={href} method="get" className={styles.navForm}>
      <Button type="submit" variant={variant} aria-label={ariaLabel}>
        {children}
      </Button>
    </form>
  );
}

function FlagNotice({ flag, onDismiss }: { flag: { text: string; tone: "done" | "attention" }; onDismiss: () => void }) {
  return (
    <div className={cx(styles.notice, flag.tone === "attention" && styles.noticeAttention)} role="status">
      <p className={styles.noticeText}>{flag.text}</p>
      <button type="button" className={styles.noticeClose} aria-label="알림 닫기" onClick={onDismiss}>
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false">
          <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

type PickerState =
  | { kind: "loading" }
  | { kind: "needs_personal" }
  | { kind: "error"; message: string }
  | { kind: "ready"; calendars: SharedCalendar[] };

function SharedCalendarPicker({
  open,
  hasPersonal,
  selectedId,
  onClose,
  onChosen,
}: {
  open: boolean;
  hasPersonal: boolean;
  selectedId: string | null;
  onClose: () => void;
  onChosen: (next: ConnectionsResponse) => void;
}) {
  const [state, setState] = useState<PickerState>({ kind: "loading" });
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !hasPersonal) return;
    let cancelled = false;
    fetchSharedCalendars().then(
      (calendars) => {
        if (!cancelled) setState({ kind: "ready", calendars });
      },
      (error: unknown) => {
        if (cancelled) return;
        setState(
          error instanceof CalendarApiError && error.status === 409
            ? { kind: "needs_personal" }
            : { kind: "error", message: errorMessage(error) },
        );
      },
    );
    return () => {
      cancelled = true;
      setState({ kind: "loading" });
      setSaveError(null);
    };
  }, [open, hasPersonal]);

  async function choose(id: string) {
    setSavingId(id);
    setSaveError(null);
    try {
      onChosen(await chooseSharedCalendar(id));
    } catch (error) {
      if (error instanceof CalendarApiError && error.status === 409) setState({ kind: "needs_personal" });
      else setSaveError(errorMessage(error));
    } finally {
      setSavingId(null);
    }
  }

  const view: PickerState = hasPersonal ? state : { kind: "needs_personal" };

  return (
    <Sheet open={open} onClose={onClose} title="공유받은 캘린더에서 고르기">
      <p className={styles.sheetIntro}>
        개인 계정에 공유된 회사 캘린더를 고르면 읽기 전용으로 보여요. 이 앱은 그 캘린더에 아무것도 쓰지 않아요.
      </p>
      <div aria-live="polite">
        {view.kind === "loading" ? <p className={styles.muted}>캘린더 목록을 불러오고 있어요.</p> : null}
        {view.kind === "needs_personal" ? (
          <div className={styles.sheetBlock}>
            <p className={styles.detail}>{PERSONAL_NEEDED}</p>
            <NavButton href={CONNECT_PERSONAL_URL} variant="ink">
              개인 캘린더 연결하기
            </NavButton>
          </div>
        ) : null}
        {view.kind === "error" ? <p className={styles.alertText}>{view.message}</p> : null}
        {view.kind === "ready" && view.calendars.length === 0 ? (
          <p className={styles.detail}>
            개인 계정에 공유된 캘린더가 없어요. 회사 캘린더를 개인 이메일과 공유하고 초대를 수락한 뒤 다시 열어 주세요.
          </p>
        ) : null}
      </div>
      {view.kind === "ready" && view.calendars.length > 0 ? (
        <ul className={styles.calendarList}>
          {view.calendars.map((calendar) => {
            const selected = calendar.id === selectedId;
            return (
              <li key={calendar.id}>
                <button
                  type="button"
                  className={styles.calendarOption}
                  aria-pressed={selected}
                  disabled={savingId !== null}
                  onClick={() => choose(calendar.id)}
                >
                  <span className={styles.calendarName}>
                    <span className={cx(selected && "hl")}>{calendar.name}</span>
                  </span>
                  <span className={styles.calendarId}>{calendar.id}</span>
                  {calendar.busyOnly ? <span className={styles.calendarNote}>바쁨만 보여요</span> : null}
                  {selected ? <span className={styles.calendarNote}>지금 보고 있어요</span> : null}
                  {savingId === calendar.id ? <span className={styles.calendarNote}>저장하고 있어요</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {saveError ? (
        <p className={styles.alertText} role="alert">
          {saveError}
        </p>
      ) : null}
    </Sheet>
  );
}

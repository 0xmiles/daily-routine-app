"use client";

import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { createEvent } from "@/features/calendar/client";
import { createTodo } from "@/features/todos/client";
import { seoulToday } from "@/shared/time";
import { Button, Sheet, cx } from "@/ui/primitives";
import { ConnectPersonalHint } from "./ConnectPersonalHint";
import { NETWORK_ERROR, serverMessage } from "./errors";
import { emitDataChanged } from "./events";
import { usePersonalConnected } from "./personalConnection";
import { nextFullHourSlot } from "./slots";
import styles from "./QuickAdd.module.css";

export type QuickAddKind = "todo" | "event";

export interface QuickAddProps {
  open: boolean;
  onClose: () => void;
  /** Saved: the shell closes the sheet and shows `message` briefly. */
  onSaved: (message: string) => void;
  /** "자세히": open the full editor for `kind`, carrying the typed title. */
  onMore: (kind: QuickAddKind, title: string) => void;
  defaultKind?: QuickAddKind;
}

/** ⌘N / + : pick 할 일 or 일정, type a title, Enter saves. Everything else is optional. */
export function QuickAdd({ open, onClose, onSaved, onMore, defaultKind = "todo" }: QuickAddProps) {
  return (
    <Sheet open={open} onClose={onClose} title="빠른 추가">
      <QuickAddForm onSaved={onSaved} onMore={onMore} defaultKind={defaultKind} />
    </Sheet>
  );
}

const KINDS: Array<{ kind: QuickAddKind; label: string }> = [
  { kind: "todo", label: "할 일" },
  { kind: "event", label: "일정" },
];

function slotSentence(now: Date): string {
  const slot = nextFullHourSlot(now);
  const day = slot.date === seoulToday(now) ? "오늘" : "내일";
  return `${day} ${slot.startTime}부터 1시간으로 잡아요.`;
}

function QuickAddForm({ onSaved, onMore, defaultKind }: Omit<QuickAddProps, "open" | "onClose">) {
  const [kind, setKind] = useState<QuickAddKind>(defaultKind ?? "todo");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const radios = useRef<Array<HTMLButtonElement | null>>([]);
  const personalConnected = usePersonalConnected(kind === "event");
  const blocked = kind === "event" && personalConnected === false;

  function choose(next: QuickAddKind) {
    setKind(next);
    setError(null);
  }

  function onRadioKey(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const next = (index + (e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1) + KINDS.length) % KINDS.length;
    choose(KINDS[next].kind);
    radios.current[next]?.focus();
  }

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || saving || blocked) return;
    setSaving(true);
    setError(null);
    try {
      if (kind === "todo") {
        await createTodo({ title: trimmed });
        emitDataChanged("todo");
        onSaved("할 일을 추가했어요. 날짜 없는 할 일은 목록에서 볼 수 있어요.");
      } else {
        const now = new Date();
        const slot = nextFullHourSlot(now);
        await createEvent({ title: trimmed, start: slot.start, end: slot.end, allDay: false });
        emitDataChanged("event");
        const day = slot.date === seoulToday(now) ? "오늘" : "내일";
        onSaved(`일정을 ${day} ${slot.startTime}에 추가했어요.`);
      }
    } catch (err) {
      setError(serverMessage(err) ?? NETWORK_ERROR);
      setSaving(false);
    }
  }

  function onTitleKey(e: KeyboardEvent<HTMLInputElement>) {
    // Enter that commits a Korean IME composition must not submit half a word.
    if (e.key === "Enter" && (e.nativeEvent.isComposing || e.keyCode === 229)) e.preventDefault();
  }

  return (
    <div className={styles.root}>
      <div role="radiogroup" aria-label="만들 것" className={styles.kinds}>
        {KINDS.map((k, index) => {
          const on = k.kind === kind;
          return (
            <button
              key={k.kind}
              ref={(el) => {
                radios.current[index] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              className={cx(styles.kind, on && styles.kindOn)}
              onClick={() => choose(k.kind)}
              onKeyDown={(e) => onRadioKey(e, index)}
            >
              {k.label}
            </button>
          );
        })}
      </div>

      {blocked ? (
        <ConnectPersonalHint className={styles.hint} />
      ) : (
        <form className={styles.form} onSubmit={submit}>
          <input
            className={styles.title}
            aria-label="제목"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={onTitleKey}
            placeholder={kind === "todo" ? "할 일을 적어 주세요" : "일정 이름을 적어 주세요"}
            enterKeyHint="done"
            autoComplete="off"
            autoFocus
          />
          <p className={styles.sub}>
            {kind === "todo" ? "제목만 적어도 저장돼요. 마감과 반복은 자세히에서 정해요." : slotSentence(new Date())}
          </p>
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          <div className={styles.actions}>
            <Button variant="ghost" onClick={() => onMore(kind, title.trim())}>
              자세히
            </Button>
            <Button type="submit" disabled={saving || !title.trim()}>
              {kind === "todo" ? "할 일 추가하기" : "일정 추가하기"}
            </Button>
          </div>
        </form>
      )}
      {blocked && (
        <div className={styles.actions}>
          <Button variant="ghost" onClick={() => choose("todo")}>
            할 일로 적기
          </Button>
        </div>
      )}
    </div>
  );
}

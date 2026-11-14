"use client";

import { useId, useState } from "react";
import type { Scope, Todo } from "@/shared/contracts";
import { Button, cx } from "@/ui/primitives";
import { sortForList, todayBucket, type TodoBucket } from "./rules";
import { TodoEditorSheet } from "./TodoEditorSheet";
import styles from "./TodoListPage.module.css";
import { TodoRow } from "./TodoRow";
import { useTodos } from "./useTodos";

type ScopeFilter = "all" | Scope;

const FILTERS: Array<{ value: ScopeFilter; label: string }> = [
  { value: "all", label: "전체" },
  { value: "work", label: "회사" },
  { value: "personal", label: "개인" },
];

const SECTIONS: Array<{ bucket: TodoBucket; title: string }> = [
  { bucket: "overdue", title: "지연" },
  { bucket: "today", title: "오늘" },
  { bucket: "upcoming", title: "다가오는 마감" },
  { bucket: "nodate", title: "날짜 없음" },
  { bucket: "done", title: "완료한 것" },
];

const EMPTY: Record<ScopeFilter, string> = {
  all: "할 일이 아직 없어요. 할 일 추가를 눌러 첫 할 일을 적어 보세요.",
  work: "회사 할 일이 없어요.",
  personal: "개인 할 일이 없어요.",
};

/** 할 일 › 목록: 지연 / 오늘 / 다가오는 마감 / 날짜 없음, 회사·개인 filter, 완료한 것 보기. */
export function TodoListPage() {
  const id = useId();
  const { todos, status, error, now, reload, toggle } = useTodos("all");
  const [filter, setFilter] = useState<ScopeFilter>("all");
  const [showDone, setShowDone] = useState(false);
  const [editor, setEditor] = useState<{ open: boolean; todo: Todo | null }>({ open: false, todo: null });
  const openEditor = (todo: Todo | null) => setEditor({ open: true, todo });

  const visible = sortForList(
    todos.filter((t) => filter === "all" || t.scope === filter),
    now,
  );
  const groups = new Map<TodoBucket, Todo[]>();
  for (const todo of visible) {
    const bucket = todayBucket(todo, now);
    groups.set(bucket, [...(groups.get(bucket) ?? []), todo]);
  }
  const sections = SECTIONS.filter((s) => (s.bucket !== "done" || showDone) && (groups.get(s.bucket)?.length ?? 0) > 0);
  const doneCount = groups.get("done")?.length ?? 0;

  return (
    <div className={styles.page}>
      <h1 className={styles.srOnly}>할 일 목록</h1>

      <div className={styles.toolbar}>
        <div className={styles.filters} role="radiogroup" aria-label="구분으로 거르기">
          {FILTERS.map((f) => (
            <label key={f.value} className={cx(styles.filter, filter === f.value && styles.filterOn)}>
              <input
                type="radio"
                name={`${id}-filter`}
                value={f.value}
                checked={filter === f.value}
                onChange={() => setFilter(f.value)}
                className={styles.srOnly}
              />
              <span className={filter === f.value ? "hl" : undefined}>{f.label}</span>
            </label>
          ))}
        </div>
        <div className={styles.tools}>
          <button
            type="button"
            className={cx(styles.toggle, showDone && styles.toggleOn)}
            aria-pressed={showDone}
            onClick={() => setShowDone((v) => !v)}
          >
            <span className={styles.toggleBox} aria-hidden="true" />
            완료한 것 보기
          </button>
          <Button variant="outline" className={styles.addButton} onClick={() => openEditor(null)}>
            할 일 추가
          </Button>
        </div>
      </div>

      {status === "loading" && <p className={styles.note}>할 일을 불러오고 있어요.</p>}
      {status === "error" && (
        <div className={styles.problem} role="alert">
          <p className={styles.note}>{error}</p>
          <Button variant="outline" onClick={() => void reload()}>
            다시 불러오기
          </Button>
        </div>
      )}
      {status === "ready" && error && (
        <p className={styles.inlineError} role="alert">
          {error}
        </p>
      )}

      {status === "ready" && sections.length === 0 && (
        <p className={styles.note}>
          {doneCount > 0 && !showDone ? "남은 할 일이 없어요. 모두 끝냈어요." : EMPTY[filter]}
        </p>
      )}

      {sections.map((s) => {
        const items = groups.get(s.bucket) ?? [];
        const headingId = `${id}-${s.bucket}`;
        return (
          <section key={s.bucket} className={styles.section} aria-labelledby={headingId}>
            <div className={styles.head}>
              <h2 id={headingId} className={cx(styles.heading, s.bucket === "overdue" && styles.headingLate)}>
                {s.title}
              </h2>
              <span className={cx(styles.count, "num")}>{items.length}</span>
            </div>
            <ul className={styles.list}>
              {items.map((todo) => (
                <TodoRow key={todo.id} todo={todo} now={now} onToggle={toggle} onOpen={openEditor} />
              ))}
            </ul>
          </section>
        );
      })}

      <TodoEditorSheet
        open={editor.open}
        todo={editor.todo}
        onClose={() => setEditor({ open: false, todo: null })}
      />
    </div>
  );
}

"use client";

import { useId, useState } from "react";
import type { Todo } from "@/shared/contracts";
import { seoulToday } from "@/shared/time";
import { Button, cx } from "@/ui/primitives";
import { sortForList } from "./rules";
import { TodoEditorSheet } from "./TodoEditorSheet";
import { TodoRow } from "./TodoRow";
import styles from "./TodoSection.module.css";
import { useTodos } from "./useTodos";

export interface TodoSectionProps {
  /** Only "today" for now: overdue, due today and today's recurring turn (plus ones finished today). */
  view: "today";
  className?: string;
}

/**
 * Self-contained "할 일" block for the today screen: loads its own data, shows
 * the heading with the open count, refreshes after toggles and edits, and has
 * an inline "할 일 추가" row (new todos default to today). No horizontal
 * padding: the parent column provides the gutter.
 */
export function TodoSection({ view, className }: TodoSectionProps) {
  const headingId = useId();
  const { todos, status, error, now, reload, toggle } = useTodos(view);
  const [editor, setEditor] = useState<{ open: boolean; todo: Todo | null }>({ open: false, todo: null });

  const sorted = sortForList(todos, now);
  const openCount = todos.filter((t) => !t.doneAt).length;
  const openEditor = (todo: Todo | null) => setEditor({ open: true, todo });

  return (
    <section className={cx(styles.section, className)} aria-labelledby={headingId}>
      <div className={styles.head}>
        <h2 id={headingId} className={styles.heading}>
          할 일
        </h2>
        {status === "ready" && todos.length > 0 && (
          <span className={styles.count}>
            {openCount > 0 ? (
              <>
                <span className="num">{openCount}</span>개 남음
              </>
            ) : (
              "모두 끝냄"
            )}
          </span>
        )}
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
      {status === "ready" && todos.length === 0 && <p className={styles.note}>오늘 마감인 할 일이 없어요.</p>}

      <ul className={styles.list}>
        {sorted.map((todo) => (
          <TodoRow key={todo.id} todo={todo} now={now} onToggle={toggle} onOpen={openEditor} />
        ))}
        <li>
          <button type="button" className={styles.add} onClick={() => openEditor(null)}>
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            할 일 추가
          </button>
        </li>
      </ul>

      <TodoEditorSheet
        open={editor.open}
        todo={editor.todo}
        defaultDueDate={seoulToday(now)}
        onClose={() => setEditor({ open: false, todo: null })}
      />
    </section>
  );
}

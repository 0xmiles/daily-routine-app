"use client";

import type { Todo } from "@/shared/contracts";
import { Checkbox, cx, Tag } from "@/ui/primitives";
import { dueLabel } from "./format";
import { NumText } from "./NumText";
import styles from "./TodoRow.module.css";

export interface TodoRowProps {
  todo: Todo;
  /** Called with the new done state when the checkbox changes. */
  onToggle: (todo: Todo, done: boolean) => void;
  /** Opens the editor for this todo. */
  onOpen: (todo: Todo) => void;
  /** Reference time for late/today labels. Defaults to now. */
  now?: Date;
  /** Show the 회사/개인 tag next to the title (default true). */
  showScope?: boolean;
}

/**
 * One todo line: checkbox, title (opens the editor), scope tag and due text.
 * Late todos get a --sun checkbox border and "어제까지" / "N일 전까지" in --sun.
 */
export function TodoRow({ todo, onToggle, onOpen, now, showScope = true }: TodoRowProps) {
  const label = dueLabel(todo, now ?? new Date());
  const done = todo.doneAt !== null;
  return (
    <li className={cx(styles.row, done && styles.done)}>
      <Checkbox
        checked={done}
        late={label?.late ?? false}
        onChange={(checked) => onToggle(todo, checked)}
        label={`${todo.title} 완료`}
      />
      <button type="button" className={styles.title} onClick={() => onOpen(todo)}>
        <span className={styles.titleText}>{todo.title}</span>
        {showScope && <Tag scope={todo.scope} className={styles.tag} />}
      </button>
      {label && (
        <span className={cx(styles.meta, label.late && styles.late)}>
          <NumText text={label.text} />
        </span>
      )}
    </li>
  );
}

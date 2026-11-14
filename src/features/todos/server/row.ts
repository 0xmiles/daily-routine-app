import type { TodoRow } from "@/server/db/schema";
import type { Todo } from "@/shared/contracts";
import type { TodoFields } from "./validate";

/** DB row → API shape. */
export function toTodo(row: TodoRow): Todo {
  return {
    id: row.id,
    title: row.title,
    scope: row.scope,
    dueDate: row.dueDate,
    dueTime: row.dueTime,
    doneAt: row.doneAt ? row.doneAt.toISOString() : null,
    recurrence: row.recurrence ?? null,
    seriesId: row.seriesId,
    notify: { enabled: row.notifyEnabled, offsetMin: row.notifyOffsetMin },
  };
}

/** The editable columns of a row. */
export function fieldsOf(row: TodoRow): TodoFields {
  return {
    title: row.title,
    scope: row.scope,
    dueDate: row.dueDate,
    dueTime: row.dueTime,
    recurrence: row.recurrence ?? null,
    seriesId: row.seriesId,
    notifyEnabled: row.notifyEnabled,
    notifyOffsetMin: row.notifyOffsetMin,
  };
}

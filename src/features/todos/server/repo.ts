import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, isNotNull, isNull, lte, ne, or } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { todos, type TodoRow } from "@/server/db/schema";
import type { Todo } from "@/shared/contracts";
import { seoulDateTimeToDate, seoulToday } from "@/shared/time";
import { nextOccurrence, sortForList } from "../rules";
import { rescheduleTodoNotification } from "./notify";
import { fieldsOf, toTodo } from "./row";
import { mergeTodoFields, NEW_TODO_FIELDS, type Parsed, type TodoCreateBody, type TodoPatchBody } from "./validate";

// Todo persistence. Every write re-plans the todo's notification in the same
// transaction, so a completed/moved/deleted todo never keeps a stale one.

export type TodoView = "today" | "all";

/**
 * `all`: every todo (done ones included), list-sorted.
 * `today`: open todos due today or earlier (overdue, due today, today's
 * recurring turn) plus those completed today, so the today view can show
 * them checked. Undated todos are never in `today`.
 */
export async function listTodos(db: Db, view: TodoView, now: Date): Promise<Todo[]> {
  const order = [asc(todos.createdAt), asc(todos.id)];
  let rows: TodoRow[];
  if (view === "all") {
    rows = await db.select().from(todos).orderBy(...order);
  } else {
    const today = seoulToday(now);
    const startOfToday = seoulDateTimeToDate(today, "00:00");
    rows = await db
      .select()
      .from(todos)
      .where(
        and(
          isNotNull(todos.dueDate),
          lte(todos.dueDate, today),
          or(isNull(todos.doneAt), gte(todos.doneAt, startOfToday)),
        ),
      )
      .orderBy(...order);
  }
  return sortForList(rows.map(toTodo), now);
}

/** updatedAt strictly after the previous value (keeps "never edited" = createdAt === updatedAt exact). */
function bump(previous: Date, now: Date): Date {
  return now.getTime() > previous.getTime() ? now : new Date(previous.getTime() + 1);
}

async function lockRow(db: Db, id: string): Promise<TodoRow | undefined> {
  const [row] = await db.select().from(todos).where(eq(todos.id, id)).for("update").limit(1);
  return row;
}

export async function createTodo(db: Db, body: TodoCreateBody, now: Date): Promise<Parsed<Todo>> {
  const merged = mergeTodoFields(NEW_TODO_FIELDS, body, now);
  if (!merged.ok) return merged;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(todos)
      .values({ ...merged.value, createdAt: now, updatedAt: now })
      .returning();
    await rescheduleTodoNotification(tx, row.id, now);
    return { ok: true, value: toTodo(row) };
  });
}

/** null when the todo does not exist. */
export async function updateTodo(db: Db, id: string, body: TodoPatchBody, now: Date): Promise<Parsed<Todo> | null> {
  return db.transaction(async (tx) => {
    const current = await lockRow(tx, id);
    if (!current) return null;
    const merged = mergeTodoFields(fieldsOf(current), body, now);
    if (!merged.ok) return merged;
    const [row] = await tx
      .update(todos)
      .set({ ...merged.value, updatedAt: bump(current.updatedAt, now) })
      .where(eq(todos.id, id))
      .returning();
    await rescheduleTodoNotification(tx, id, now);
    return { ok: true, value: toTodo(row) };
  });
}

/** false when the todo does not exist. Its notifications go with it (FK cascade). */
export async function deleteTodo(db: Db, id: string): Promise<boolean> {
  const deleted = await db.delete(todos).where(eq(todos.id, id)).returning({ id: todos.id });
  return deleted.length > 0;
}

/**
 * Marks a todo done and cancels its pending notification. For a recurring todo
 * it also creates the next occurrence (same seriesId and fields, due on the next
 * turn after max(due date, today)) and schedules that one's notification. The
 * next row's createdAt equals the completed row's doneAt, which is how
 * `uncompleteTodo` recognises it.
 *
 * Completing a todo that is already done changes nothing (`next: null`).
 * null when the todo does not exist.
 */
export async function completeTodo(
  db: Db,
  id: string,
  now: Date,
): Promise<{ completed: Todo; next: Todo | null } | null> {
  return db.transaction(async (tx) => {
    const current = await lockRow(tx, id);
    if (!current) return null;
    if (current.doneAt) return { completed: toTodo(current), next: null };

    const seriesId = current.recurrence ? (current.seriesId ?? randomUUID()) : current.seriesId;
    const [completed] = await tx
      .update(todos)
      .set({ doneAt: now, seriesId, updatedAt: bump(current.updatedAt, now) })
      .where(eq(todos.id, id))
      .returning();
    await rescheduleTodoNotification(tx, id, now);

    if (!current.recurrence || !seriesId) return { completed: toTodo(completed), next: null };

    const today = seoulToday(now);
    const from = current.dueDate && current.dueDate > today ? current.dueDate : today;
    const nextDue = nextOccurrence(current.recurrence, from);

    // An open occurrence on that date already exists (e.g. completed, reopened
    // and edited before): reuse it instead of creating a duplicate.
    const [existing] = await tx
      .select()
      .from(todos)
      .where(and(eq(todos.seriesId, seriesId), isNull(todos.doneAt), eq(todos.dueDate, nextDue), ne(todos.id, id)))
      .limit(1);
    if (existing) return { completed: toTodo(completed), next: toTodo(existing) };

    const [next] = await tx
      .insert(todos)
      .values({
        ...fieldsOf(current),
        seriesId,
        dueDate: nextDue,
        doneAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await rescheduleTodoNotification(tx, next.id, now);
    return { completed: toTodo(completed), next: toTodo(next) };
  });
}

/**
 * Reopens a todo and re-plans its notification. For a recurring todo, the next
 * occurrence that completing it created is removed if it is still untouched
 * (open and never edited), so reopening never leaves two open turns behind.
 * null when the todo does not exist.
 */
export async function uncompleteTodo(db: Db, id: string, now: Date): Promise<Todo | null> {
  return db.transaction(async (tx) => {
    const current = await lockRow(tx, id);
    if (!current) return null;
    if (!current.doneAt) return toTodo(current);

    const [row] = await tx
      .update(todos)
      .set({ doneAt: null, updatedAt: bump(current.updatedAt, now) })
      .where(eq(todos.id, id))
      .returning();

    if (current.seriesId) {
      await tx
        .delete(todos)
        .where(
          and(
            eq(todos.seriesId, current.seriesId),
            ne(todos.id, id),
            isNull(todos.doneAt),
            eq(todos.createdAt, current.doneAt),
            eq(todos.updatedAt, current.doneAt),
          ),
        );
    }
    await rescheduleTodoNotification(tx, id, now);
    return toTodo(row);
  });
}

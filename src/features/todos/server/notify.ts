import { and, eq, isNotNull, isNull, max } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { notifications, settings, todos } from "@/server/db/schema";
import type { Todo } from "@/shared/contracts";
import { seoulToday } from "@/shared/time";
import { notifyAt, type NotifySettings } from "../rules";
import { toTodo } from "./row";

// Keeps the `todo_due` rows in `notifications` in step with each todo.
// Track E's cron tick sends rows whose fireAt has passed and marks sentAt.

export const TODO_NOTIFICATION_URL = "/today";
const FALLBACK_SETTINGS: NotifySettings = { defaultOffsetMin: 30, dateOnlyNotifyTime: "09:00" };

/** Notification defaults from the settings row (id = 1). */
export async function loadNotifySettings(db: Db): Promise<NotifySettings> {
  const [row] = await db
    .select({ defaultOffsetMin: settings.defaultOffsetMin, dateOnlyNotifyTime: settings.dateOnlyNotifyTime })
    .from(settings)
    .where(eq(settings.id, 1))
    .limit(1);
  return row ?? FALLBACK_SETTINGS;
}

/**
 * Notification body: "18:00까지" (has a time), "오늘까지" (date only). When the
 * offset moves the notification to an earlier day, the due day is named:
 * "16일 18:00까지".
 */
export function todoNotificationBody(todo: Pick<Todo, "dueDate" | "dueTime">, fireAt: Date): string {
  if (!todo.dueTime || !todo.dueDate) return "오늘까지";
  const fireDate = seoulToday(fireAt);
  if (fireDate === todo.dueDate) return `${todo.dueTime}까지`;
  const [, m, d] = todo.dueDate.split("-").map(Number);
  const sameMonth = fireDate.slice(0, 7) === todo.dueDate.slice(0, 7);
  return `${sameMonth ? `${d}일` : `${m}월 ${d}일`} ${todo.dueTime}까지`;
}

async function replaceFor(db: Db, todo: Todo, s: NotifySettings, now: Date): Promise<void> {
  await db
    .delete(notifications)
    .where(and(eq(notifications.todoId, todo.id), eq(notifications.kind, "todo_due"), isNull(notifications.sentAt)));
  const fireAt = notifyAt(todo, s);
  if (!fireAt || fireAt.getTime() <= now.getTime()) return; // never schedule in the past
  await db.insert(notifications).values({
    kind: "todo_due",
    todoId: todo.id,
    fireAt,
    title: todo.title,
    body: todoNotificationBody(todo, fireAt),
    url: TODO_NOTIFICATION_URL,
  });
}

/**
 * Replaces the todo's unsent `todo_due` notification with one at `notifyAt`
 * (or removes it when the todo is done, deleted, undated or has notifications
 * off). Sent rows are kept. Call it after every create/update/complete/
 * uncomplete, inside the same transaction.
 */
export async function rescheduleTodoNotification(db: Db, todoId: string, now: Date = new Date()): Promise<void> {
  const [row] = await db.select().from(todos).where(eq(todos.id, todoId)).limit(1);
  if (!row) {
    await db
      .delete(notifications)
      .where(and(eq(notifications.todoId, todoId), eq(notifications.kind, "todo_due"), isNull(notifications.sentAt)));
    return;
  }
  await replaceFor(db, toTodo(row), await loadNotifySettings(db), now);
}

/**
 * Re-plans every open todo's notification, e.g. after the default offset or
 * the date-only time changed in settings.
 */
export async function rescheduleAllTodoNotifications(db: Db, now: Date = new Date()): Promise<void> {
  const s = await loadNotifySettings(db);
  const open = await db.select().from(todos).where(isNull(todos.doneAt));
  // A todo whose reminder already went out after its last edit stays as it is:
  // a new default offset must not send the same reminder twice.
  const sent = await db
    .select({ todoId: notifications.todoId, lastSentAt: max(notifications.sentAt) })
    .from(notifications)
    .where(and(eq(notifications.kind, "todo_due"), isNotNull(notifications.sentAt)))
    .groupBy(notifications.todoId);
  const lastSent = new Map(sent.map((r) => [r.todoId, r.lastSentAt]));
  for (const row of open) {
    const sentAt = lastSent.get(row.id);
    // new Date(): aggregate results can come back as strings on some drivers.
    if (sentAt && new Date(sentAt).getTime() >= row.updatedAt.getTime()) continue;
    await replaceFor(db, toTodo(row), s, now);
  }
}

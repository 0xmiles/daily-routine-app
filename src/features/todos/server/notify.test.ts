import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import { notifications, settings } from "@/server/db/schema";
import { createTestDb } from "@/server/db/test-db";
import { createTodo, updateTodo } from "./repo";
import { rescheduleAllTodoNotifications } from "./notify";

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
});

const at = (hhmm: string) => new Date(`2026-11-14T${hhmm}:00+09:00`);

async function dueTodoNotifiedAt1730(): Promise<string> {
  const created = await createTodo(db, { title: "분기 리포트", dueDate: "2026-11-14", dueTime: "18:00" }, at("17:00"));
  if (!created.ok) throw new Error(created.message);
  const id = created.value.id;
  // The 17:30 reminder (default 30 minutes before) went out.
  await db.update(notifications).set({ sentAt: at("17:30") }).where(eq(notifications.todoId, id));
  return id;
}

const unsent = (todoId: string) =>
  db
    .select()
    .from(notifications)
    .where(and(eq(notifications.todoId, todoId), eq(notifications.kind, "todo_due"), isNull(notifications.sentAt)));

it("changing the default offset does not re-notify a todo that was already notified", async () => {
  const id = await dueTodoNotifiedAt1730();
  await db.update(settings).set({ defaultOffsetMin: 10 }).where(eq(settings.id, 1));
  await rescheduleAllTodoNotifications(db, at("17:40"));
  expect(await unsent(id)).toHaveLength(0);
});

it("a todo edited after its reminder went out is planned again", async () => {
  const id = await dueTodoNotifiedAt1730();
  const moved = await updateTodo(db, id, { dueTime: "20:00" }, at("17:35"));
  expect(moved?.ok).toBe(true);
  await rescheduleAllTodoNotifications(db, at("17:40"));
  const rows = await unsent(id);
  expect(rows).toHaveLength(1);
  expect(rows[0].fireAt.toISOString()).toBe(at("19:30").toISOString());
});

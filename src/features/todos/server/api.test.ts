import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { DELETE, PATCH } from "@/app/api/todos/[id]/route";
import { POST as COMPLETE } from "@/app/api/todos/[id]/complete/route";
import { POST as UNCOMPLETE } from "@/app/api/todos/[id]/uncomplete/route";
import { GET, POST } from "@/app/api/todos/route";
import { sessionCookieFor } from "@/server/auth/session";
import type { Db } from "@/server/db/client";
import { notifications, settings, todos } from "@/server/db/schema";
import { createTestDb } from "@/server/db/test-db";
import type { Todo } from "@/shared/contracts";
import { addDays, seoulDateTimeToDate, seoulToday, weekdayOf } from "@/shared/time";
import { rescheduleTodoNotification } from "./notify";

let db: Db;
let cookie: string;

beforeEach(async () => {
  db = await createTestDb();
  cookie = await sessionCookieFor();
});

// Dates relative to the real clock so the tests do not depend on when they run.
const today = () => seoulToday();
const inDays = (n: number) => addDays(today(), n);

function req(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}): Request {
  const headers: Record<string, string> = {};
  if (init.auth !== false) headers.cookie = cookie;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return new Request(`http://localhost${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function create(body: Record<string, unknown>): Promise<Todo> {
  const res = await POST(req("/api/todos", { method: "POST", body }));
  expect(res.status).toBe(201);
  return ((await res.json()) as { todo: Todo }).todo;
}

async function listView(view: "today" | "all"): Promise<Todo[]> {
  const res = await GET(req(`/api/todos?view=${view}`));
  expect(res.status).toBe(200);
  return ((await res.json()) as { todos: Todo[] }).todos;
}

function pendingFor(todoId: string) {
  return db
    .select()
    .from(notifications)
    .where(and(eq(notifications.todoId, todoId), eq(notifications.kind, "todo_due"), isNull(notifications.sentAt)));
}

describe("todos API", () => {
  it("requires session", async () => {
    expect((await GET(req("/api/todos?view=today", { auth: false }))).status).toBe(401);
    expect((await POST(req("/api/todos", { method: "POST", body: { title: "x" }, auth: false }))).status).toBe(401);
    const id = "00000000-0000-4000-8000-000000000000";
    expect((await PATCH(req(`/api/todos/${id}`, { method: "PATCH", body: {}, auth: false }), ctx(id))).status).toBe(401);
    expect((await COMPLETE(req(`/api/todos/${id}/complete`, { method: "POST", auth: false }), ctx(id))).status).toBe(401);
  });

  it("title-only create works", async () => {
    const todo = await create({ title: "  우유 사기  " });
    expect(todo).toMatchObject({
      title: "우유 사기",
      scope: "personal",
      dueDate: null,
      dueTime: null,
      doneAt: null,
      recurrence: null,
      seriesId: null,
      notify: { enabled: true, offsetMin: null },
    });
    expect(await pendingFor(todo.id)).toHaveLength(0);
    expect((await listView("all")).map((t) => t.id)).toEqual([todo.id]);
  });

  it("rejects an empty title and a time without a date", async () => {
    const empty = await POST(req("/api/todos", { method: "POST", body: { title: "   " } }));
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as { message: string }).message).toContain("제목");
    const timeOnly = await POST(req("/api/todos", { method: "POST", body: { title: "x", dueTime: "18:00" } }));
    expect(timeOnly.status).toBe(400);
    const badJson = await POST(
      new Request("http://localhost/api/todos", { method: "POST", headers: { cookie }, body: "{" }),
    );
    expect(badJson.status).toBe(400);
  });

  it("schedules a notification with title, body and url", async () => {
    const due = inDays(2);
    const todo = await create({ title: "PR 리뷰", scope: "work", dueDate: due, dueTime: "18:00" });
    const rows = await pendingFor(todo.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: "PR 리뷰", body: "18:00까지", url: "/today" });
    expect(rows[0].fireAt.toISOString()).toBe(new Date(seoulDateTimeToDate(due, "18:00").getTime() - 30 * 60_000).toISOString());

    const dateOnly = await create({ title: "신한 거래내역 올리기", dueDate: due });
    const [row] = await pendingFor(dateOnly.id);
    expect(row.body).toBe("오늘까지");
    expect(row.fireAt.toISOString()).toBe(seoulDateTimeToDate(due, "09:00").toISOString());
  });

  it("uses settings defaults and never schedules in the past", async () => {
    await db.update(settings).set({ defaultOffsetMin: 60, dateOnlyNotifyTime: "07:30" }).where(eq(settings.id, 1));
    const due = inDays(3);
    const timed = await create({ title: "a", dueDate: due, dueTime: "18:00" });
    const [row] = await pendingFor(timed.id);
    expect(row.fireAt.toISOString()).toBe(seoulDateTimeToDate(due, "17:00").toISOString());

    const past = await create({ title: "지난 일", dueDate: inDays(-2) });
    expect(await pendingFor(past.id)).toHaveLength(0);
    const off = await create({ title: "알림 끔", dueDate: due, notify: { enabled: false } });
    expect(await pendingFor(off.id)).toHaveLength(0);
  });

  it("complete cancels pending notification", async () => {
    const todo = await create({ title: "보고서 제출", dueDate: inDays(1), dueTime: "18:00" });
    expect(await pendingFor(todo.id)).toHaveLength(1);

    const res = await COMPLETE(req(`/api/todos/${todo.id}/complete`, { method: "POST" }), ctx(todo.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { completed: Todo; next: Todo | null };
    expect(body.completed.doneAt).not.toBeNull();
    expect(body.next).toBeNull();
    expect(await pendingFor(todo.id)).toHaveLength(0);

    // Uncomplete brings the notification back.
    const undo = await UNCOMPLETE(req(`/api/todos/${todo.id}/uncomplete`, { method: "POST" }), ctx(todo.id));
    expect(undo.status).toBe(200);
    expect(((await undo.json()) as { todo: Todo }).todo.doneAt).toBeNull();
    expect(await pendingFor(todo.id)).toHaveLength(1);
  });

  it("reschedule replaces notification", async () => {
    const due = inDays(2);
    const todo = await create({ title: "PR 리뷰", dueDate: due, dueTime: "18:00" });

    const res = await PATCH(
      req(`/api/todos/${todo.id}`, { method: "PATCH", body: { dueDate: inDays(4), dueTime: "20:00" } }),
      ctx(todo.id),
    );
    expect(res.status).toBe(200);
    const rows = await pendingFor(todo.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].fireAt.toISOString()).toBe(seoulDateTimeToDate(inDays(4), "19:30").toISOString());
    expect(rows[0].body).toBe("20:00까지");

    // Own offset.
    await PATCH(req(`/api/todos/${todo.id}`, { method: "PATCH", body: { notify: { offsetMin: 120 } } }), ctx(todo.id));
    const [moved] = await pendingFor(todo.id);
    expect(moved.fireAt.toISOString()).toBe(seoulDateTimeToDate(inDays(4), "18:00").toISOString());

    // A sent notification is left alone; only unsent ones are replaced.
    await db.update(notifications).set({ sentAt: new Date() }).where(eq(notifications.todoId, todo.id));
    await PATCH(req(`/api/todos/${todo.id}`, { method: "PATCH", body: { title: "PR 다시 리뷰" } }), ctx(todo.id));
    const all = await db.select().from(notifications).where(eq(notifications.todoId, todo.id));
    expect(all).toHaveLength(2);
    expect(all.filter((n) => n.sentAt === null)[0].title).toBe("PR 다시 리뷰");

    // Removing the date removes the pending notification.
    await PATCH(req(`/api/todos/${todo.id}`, { method: "PATCH", body: { dueDate: null, dueTime: null } }), ctx(todo.id));
    expect(await pendingFor(todo.id)).toHaveLength(0);

    // Turning notifications off removes it too.
    await PATCH(req(`/api/todos/${todo.id}`, { method: "PATCH", body: { dueDate: due } }), ctx(todo.id));
    expect(await pendingFor(todo.id)).toHaveLength(1);
    await PATCH(req(`/api/todos/${todo.id}`, { method: "PATCH", body: { notify: { enabled: false } } }), ctx(todo.id));
    expect(await pendingFor(todo.id)).toHaveLength(0);
  });

  it("rescheduleTodoNotification is idempotent", async () => {
    const todo = await create({ title: "a", dueDate: inDays(1), dueTime: "10:00" });
    await rescheduleTodoNotification(db, todo.id);
    await rescheduleTodoNotification(db, todo.id);
    expect(await pendingFor(todo.id)).toHaveLength(1);
  });

  it("recurring complete schedules next", async () => {
    const due = inDays(1);
    const todo = await create({ title: "운동", dueDate: due, recurrence: { freq: "weekly", weekdays: [weekdayOf(due)] } });
    expect(todo.seriesId).not.toBeNull();

    const res = await COMPLETE(req(`/api/todos/${todo.id}/complete`, { method: "POST" }), ctx(todo.id));
    expect(res.status).toBe(200);
    const { completed, next } = (await res.json()) as { completed: Todo; next: Todo | null };
    expect(completed.doneAt).not.toBeNull();
    expect(next).not.toBeNull();
    expect(next).toMatchObject({
      title: "운동",
      scope: "personal",
      dueDate: addDays(due, 7),
      doneAt: null,
      seriesId: todo.seriesId,
      recurrence: { freq: "weekly", weekdays: [weekdayOf(due)] },
    });

    const rows = await db.select().from(todos).where(eq(todos.seriesId, todo.seriesId!));
    expect(rows).toHaveLength(2);
    expect(await pendingFor(todo.id)).toHaveLength(0);
    const nextRows = await pendingFor(next!.id);
    expect(nextRows).toHaveLength(1);
    expect(nextRows[0].fireAt.toISOString()).toBe(seoulDateTimeToDate(addDays(due, 7), "09:00").toISOString());
  });

  it("completing twice does not create a second next occurrence", async () => {
    const todo = await create({ title: "물 주기", dueDate: today(), recurrence: { freq: "daily" } });
    await COMPLETE(req(`/api/todos/${todo.id}/complete`, { method: "POST" }), ctx(todo.id));
    const again = await COMPLETE(req(`/api/todos/${todo.id}/complete`, { method: "POST" }), ctx(todo.id));
    expect(((await again.json()) as { next: Todo | null }).next).toBeNull();
    expect(await db.select().from(todos).where(eq(todos.seriesId, todo.seriesId!))).toHaveLength(2);
  });

  it("uncomplete of a recurring todo removes the untouched next occurrence", async () => {
    const todo = await create({ title: "물 주기", dueDate: today(), recurrence: { freq: "daily" } });
    const first = (await (await COMPLETE(req(`/api/todos/${todo.id}/complete`, { method: "POST" }), ctx(todo.id))).json()) as {
      next: Todo;
    };
    await UNCOMPLETE(req(`/api/todos/${todo.id}/uncomplete`, { method: "POST" }), ctx(todo.id));
    let series = await db.select().from(todos).where(eq(todos.seriesId, todo.seriesId!));
    expect(series.map((t) => t.id)).toEqual([todo.id]);
    expect(await pendingFor(first.next.id)).toHaveLength(0);

    // Complete → edit the next one → uncomplete keeps the edited next.
    const second = (await (await COMPLETE(req(`/api/todos/${todo.id}/complete`, { method: "POST" }), ctx(todo.id))).json()) as {
      next: Todo;
    };
    await PATCH(req(`/api/todos/${second.next.id}`, { method: "PATCH", body: { title: "물 많이 주기" } }), ctx(second.next.id));
    await UNCOMPLETE(req(`/api/todos/${todo.id}/uncomplete`, { method: "POST" }), ctx(todo.id));
    series = await db.select().from(todos).where(eq(todos.seriesId, todo.seriesId!));
    expect(series).toHaveLength(2);
  });

  it("recurring todo without a date starts at its first occurrence", async () => {
    const todo = await create({ title: "매일 일기", recurrence: { freq: "daily" } });
    expect(todo.dueDate).toBe(today());
  });

  it("today view excludes nodate", async () => {
    const nodate = await create({ title: "언젠가" });
    const dueToday = await create({ title: "오늘 마감", dueDate: today() });
    const overdue = await create({ title: "어제 마감", dueDate: inDays(-1) });
    const upcoming = await create({ title: "내일 마감", dueDate: inDays(1) });
    const doneToday = await create({ title: "끝낸 것", dueDate: today() });
    await COMPLETE(req(`/api/todos/${doneToday.id}/complete`, { method: "POST" }), ctx(doneToday.id));

    const ids = (await listView("today")).map((t) => t.id);
    expect(ids).toContain(dueToday.id);
    expect(ids).toContain(overdue.id);
    expect(ids).toContain(doneToday.id); // done today stays visible (checked) in the today view
    expect(ids).not.toContain(nodate.id);
    expect(ids).not.toContain(upcoming.id);
    expect(ids.indexOf(overdue.id)).toBeLessThan(ids.indexOf(dueToday.id));

    const all = (await listView("all")).map((t) => t.id);
    expect(all).toHaveLength(5);
  });

  it("rejects an unknown view", async () => {
    expect((await GET(req("/api/todos?view=week"))).status).toBe(400);
  });

  it("PATCH, complete and DELETE answer 404 for unknown ids", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    expect((await PATCH(req(`/api/todos/${missing}`, { method: "PATCH", body: { title: "x" } }), ctx(missing))).status).toBe(404);
    expect((await COMPLETE(req(`/api/todos/${missing}/complete`, { method: "POST" }), ctx(missing))).status).toBe(404);
    expect((await DELETE(req(`/api/todos/not-a-uuid`, { method: "DELETE" }), ctx("not-a-uuid"))).status).toBe(404);
  });

  it("DELETE removes the todo and its notifications", async () => {
    const todo = await create({ title: "a", dueDate: inDays(1), dueTime: "10:00" });
    const res = await DELETE(req(`/api/todos/${todo.id}`, { method: "DELETE" }), ctx(todo.id));
    expect(res.status).toBe(204);
    expect(await db.select().from(todos)).toHaveLength(0);
    expect(await db.select().from(notifications)).toHaveLength(0);
  });
});

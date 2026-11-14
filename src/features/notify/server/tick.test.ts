import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/cron/tick/route";
import type { Db } from "@/server/db/client";
import { notifications, pushSubscriptions, settings, todos } from "@/server/db/schema";
import { createTestDb } from "@/server/db/test-db";
import { TEST_ENV } from "@/server/env";
import { lastUploadSlot, runTick, UPLOAD_REMINDER, type PushSender } from "./tick";

const NOW = new Date("2026-11-14T09:00:00Z"); // Sat 18:00 KST
const SUB = { endpoint: "https://push.example.com/a", p256dh: "p256dh-a", auth: "auth-a" };

let db: Db;

/** Sender that records calls and answers 'ok' (or per-endpoint overrides). */
function recorder(answers: Record<string, "ok" | "gone" | Error> = {}) {
  const send = vi.fn<PushSender>(async (sub) => {
    const answer = answers[sub.endpoint] ?? "ok";
    if (answer instanceof Error) throw answer;
    return answer;
  });
  return send;
}

async function addTodoNotification(fireAt: Date, extra: { done?: boolean } = {}) {
  const [todo] = await db
    .insert(todos)
    .values({ title: "보고서 제출", dueDate: "2026-11-14", dueTime: "18:30", doneAt: extra.done ? NOW : null })
    .returning();
  const [row] = await db
    .insert(notifications)
    .values({ kind: "todo_due", todoId: todo.id, fireAt, title: "보고서 제출", body: "18:30까지", url: "/today" })
    .returning();
  return row;
}

beforeEach(async () => {
  db = await createTestDb();
  await db.insert(pushSubscriptions).values(SUB);
  // Keep the weekly upload reminder out of the way unless a test is about it.
  await db.update(settings).set({ lastUploadReminderSentAt: new Date("2099-01-01T00:00:00Z") }).where(eq(settings.id, 1));
});

describe("runTick: todo notifications", () => {
  it("sends due todo notification once", async () => {
    const row = await addTodoNotification(new Date(NOW.getTime() - 60_000));
    const send = recorder();

    expect(await runTick(db, NOW, send)).toEqual({ sent: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(SUB, { title: "보고서 제출", body: "18:30까지", url: "/today" });
    const [after] = await db.select().from(notifications).where(eq(notifications.id, row.id));
    expect(after.sentAt?.toISOString()).toBe(NOW.toISOString());

    const again = recorder();
    expect(await runTick(db, new Date(NOW.getTime() + 60_000), again)).toEqual({ sent: 0 });
    expect(again).not.toHaveBeenCalled();
  });

  it("does not send notifications that are not due yet", async () => {
    await addTodoNotification(new Date(NOW.getTime() + 60_000));
    const send = recorder();
    expect(await runTick(db, NOW, send)).toEqual({ sent: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("skips notifications older than 6h", async () => {
    const stale = await addTodoNotification(new Date(NOW.getTime() - 6 * 3_600_000 - 60_000));
    const fresh = await addTodoNotification(new Date(NOW.getTime() - 6 * 3_600_000 + 60_000));
    const send = recorder();

    expect(await runTick(db, NOW, send)).toEqual({ sent: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    const rows = await db.select().from(notifications);
    // Both are marked so the stale one never floods in later.
    expect(rows.find((r) => r.id === stale.id)?.sentAt).not.toBeNull();
    expect(rows.find((r) => r.id === fresh.id)?.sentAt).not.toBeNull();
  });

  it("gone subscription is deleted", async () => {
    const other = { endpoint: "https://push.example.com/b", p256dh: "p256dh-b", auth: "auth-b" };
    await db.insert(pushSubscriptions).values(other);
    await addTodoNotification(new Date(NOW.getTime() - 60_000));
    const send = recorder({ [SUB.endpoint]: "gone" });

    expect(await runTick(db, NOW, send)).toEqual({ sent: 1 });
    expect(send).toHaveBeenCalledTimes(2);
    const subs = await db.select().from(pushSubscriptions);
    expect(subs.map((s) => s.endpoint)).toEqual([other.endpoint]);
  });

  it("never notifies a completed todo", async () => {
    await addTodoNotification(new Date(NOW.getTime() - 60_000), { done: true });
    const send = recorder();
    expect(await runTick(db, NOW, send)).toEqual({ sent: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps a notification for the next tick when every send fails", async () => {
    const row = await addTodoNotification(new Date(NOW.getTime() - 60_000));
    const failing = recorder({ [SUB.endpoint]: new Error("network down") });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await runTick(db, NOW, failing)).toEqual({ sent: 0 });
    const [mid] = await db.select().from(notifications).where(eq(notifications.id, row.id));
    expect(mid.sentAt).toBeNull();

    const ok = recorder();
    expect(await runTick(db, new Date(NOW.getTime() + 60_000), ok)).toEqual({ sent: 1 });
    expect(ok).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe("runTick: weekly upload reminder", () => {
  it("lastUploadSlot finds the latest Sunday 20:00 KST at or before now", () => {
    expect(lastUploadSlot(new Date("2026-11-15T11:05:00Z"), 0, "20:00").toISOString()).toBe("2026-11-15T11:00:00.000Z");
    expect(lastUploadSlot(new Date("2026-11-15T10:55:00Z"), 0, "20:00").toISOString()).toBe("2026-11-08T11:00:00.000Z");
    expect(lastUploadSlot(new Date("2026-11-15T11:00:00Z"), 0, "20:00").toISOString()).toBe("2026-11-15T11:00:00.000Z");
    // Thursday 09:00 KST, from a Saturday.
    expect(lastUploadSlot(NOW, 4, "09:00").toISOString()).toBe("2026-11-12T00:00:00.000Z");
  });

  it("weekly upload reminder fires once after sunday 20:00 KST", async () => {
    // Last sent the previous Sunday evening.
    await db
      .update(settings)
      .set({ lastUploadReminderSentAt: new Date("2026-11-08T11:01:00Z") })
      .where(eq(settings.id, 1));

    const before = recorder();
    const on = { uploadReminder: true };
    expect(await runTick(db, new Date("2026-11-15T10:55:00Z"), before, on)).toEqual({ sent: 0 }); // 19:55 KST
    expect(before).not.toHaveBeenCalled();

    const at = new Date("2026-11-15T11:05:00Z"); // 20:05 KST
    const send = recorder();
    expect(await runTick(db, at, send, on)).toEqual({ sent: 1 });
    expect(send).toHaveBeenCalledWith(SUB, UPLOAD_REMINDER);
    expect(UPLOAD_REMINDER.title).toBe("신한 거래내역을 올릴 때예요");
    expect(UPLOAD_REMINDER.url).toBe("/assets");

    const again = recorder();
    expect(await runTick(db, at, again, on)).toEqual({ sent: 0 });
    expect(again).not.toHaveBeenCalled();

    const [row] = await db.select().from(settings);
    expect(row.lastUploadReminderSentAt?.toISOString()).toBe(at.toISOString());
  });

  it("sends no upload reminder while 자산 is turned off", async () => {
    await db
      .update(settings)
      .set({ lastUploadReminderSentAt: new Date("2026-11-08T11:01:00Z") })
      .where(eq(settings.id, 1));
    const send = recorder();
    expect(await runTick(db, new Date("2026-11-15T11:05:00Z"), send)).toEqual({ sent: 0 });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("POST /api/cron/tick", () => {
  const url = "http://localhost/api/cron/tick";

  it("tick requires bearer", async () => {
    expect((await POST(new Request(url, { method: "POST" }))).status).toBe(401);
    const wrong = new Request(url, { method: "POST", headers: { authorization: "Bearer not-the-secret" } });
    expect((await POST(wrong)).status).toBe(401);
    const noScheme = new Request(url, { method: "POST", headers: { authorization: TEST_ENV.CRON_SECRET as string } });
    expect((await POST(noScheme)).status).toBe(401);
  });

  it("runs the tick with the right bearer", async () => {
    await db.delete(pushSubscriptions); // no real push requests leave the test
    const res = await POST(
      new Request(url, { method: "POST", headers: { authorization: `Bearer ${TEST_ENV.CRON_SECRET}` } }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: 0 });
  });
});

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/todos/server/notify", () => ({
  rescheduleAllTodoNotifications: vi.fn(async () => {}),
}));

import { DELETE as unsubscribe, POST as subscribe } from "@/app/api/push/subscribe/route";
import { GET as getReminders, PUT as putReminders } from "@/app/api/settings/reminders/route";
import { rescheduleAllTodoNotifications } from "@/features/todos/server/notify";
import { sessionCookieFor } from "@/server/auth/session";
import type { Db } from "@/server/db/client";
import { pushSubscriptions, settings } from "@/server/db/schema";
import { createTestDb } from "@/server/db/test-db";

let db: Db;
let cookie: string;

const subscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc",
  expirationTime: null,
  keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" },
};

function req(url: string, method: string, body?: unknown, withCookie = true) {
  return new Request(`http://localhost${url}`, {
    method,
    headers: { ...(withCookie ? { cookie } : {}), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(async () => {
  db = await createTestDb();
  cookie = await sessionCookieFor();
  vi.mocked(rescheduleAllTodoNotifications).mockClear();
});

describe("/api/push/subscribe", () => {
  it("requires session", async () => {
    expect((await subscribe(req("/api/push/subscribe", "POST", subscription, false))).status).toBe(401);
    expect((await unsubscribe(req("/api/push/subscribe", "DELETE", { endpoint: subscription.endpoint }, false))).status).toBe(401);
  });

  it("stores a subscription and updates its keys on re-subscribe", async () => {
    expect((await subscribe(req("/api/push/subscribe", "POST", subscription))).status).toBe(201);
    const renewed = { ...subscription, keys: { p256dh: "new-p256dh", auth: "new-auth" } };
    expect((await subscribe(req("/api/push/subscribe", "POST", renewed))).status).toBe(201);
    const rows = await db.select().from(pushSubscriptions);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ endpoint: subscription.endpoint, p256dh: "new-p256dh", auth: "new-auth" });
  });

  it("rejects a malformed subscription", async () => {
    const res = await subscribe(req("/api/push/subscribe", "POST", { endpoint: "not a url" }));
    expect(res.status).toBe(400);
    expect((await res.json()).message).toContain("알림");
    expect(await db.select().from(pushSubscriptions)).toHaveLength(0);
  });

  it("accepts only known push services as endpoints", async () => {
    const keys = subscription.keys;
    for (const endpoint of [
      "https://web.push.apple.com/QGuQyavXutnMH",
      "https://updates.push.services.mozilla.com/wpush/v2/abc",
      "https://wns2-sg2p.notify.windows.com/w/?token=abc",
    ]) {
      expect((await subscribe(req("/api/push/subscribe", "POST", { endpoint, keys }))).status).toBe(201);
    }
    for (const endpoint of [
      "https://internal-host/hook",
      "https://169.254.169.254/latest",
      "https://fcm.googleapis.com.evil.example/x",
      "http://fcm.googleapis.com/fcm/send/abc",
    ]) {
      expect((await subscribe(req("/api/push/subscribe", "POST", { endpoint, keys }))).status).toBe(400);
    }
  });

  it("DELETE removes the subscription", async () => {
    await subscribe(req("/api/push/subscribe", "POST", subscription));
    const res = await unsubscribe(req("/api/push/subscribe", "DELETE", { endpoint: subscription.endpoint }));
    expect(res.status).toBe(204);
    expect(await db.select().from(pushSubscriptions)).toHaveLength(0);
  });
});

describe("/api/settings/reminders", () => {
  it("requires session", async () => {
    expect((await getReminders(req("/api/settings/reminders", "GET", undefined, false))).status).toBe(401);
  });

  it("GET returns the defaults", async () => {
    const res = await getReminders(req("/api/settings/reminders", "GET"));
    expect(await res.json()).toEqual({
      uploadReminderDow: 0,
      uploadReminderTime: "20:00",
      defaultOffsetMin: 30,
      dateOnlyNotifyTime: "09:00",
    });
  });

  it("PUT changes the upload schedule without firing for a slot already past", async () => {
    const res = await putReminders(req("/api/settings/reminders", "PUT", { uploadReminderDow: 1, uploadReminderTime: "08:30" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ uploadReminderDow: 1, uploadReminderTime: "08:30", defaultOffsetMin: 30 });
    const [row] = await db.select().from(settings).where(eq(settings.id, 1));
    expect(row.lastUploadReminderSentAt).not.toBeNull();
    expect(rescheduleAllTodoNotifications).not.toHaveBeenCalled();
  });

  it("PUT default offset re-plans todo notifications", async () => {
    const res = await putReminders(req("/api/settings/reminders", "PUT", { defaultOffsetMin: 60 }));
    expect(res.status).toBe(200);
    expect((await res.json()).defaultOffsetMin).toBe(60);
    expect(rescheduleAllTodoNotifications).toHaveBeenCalledTimes(1);
  });

  it("PUT rejects bad values", async () => {
    for (const body of [{ uploadReminderDow: 7 }, { uploadReminderTime: "25:00" }, { defaultOffsetMin: -5 }, {}]) {
      const res = await putReminders(req("/api/settings/reminders", "PUT", body));
      expect(res.status).toBe(400);
    }
    const [row] = await db.select().from(settings);
    expect(row.uploadReminderDow).toBe(0);
  });
});

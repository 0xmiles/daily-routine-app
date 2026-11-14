import { and, eq, inArray, isNotNull, isNull, lt, lte, or } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { notifications, pushSubscriptions, settings, todos } from "@/server/db/schema";
import { addDays, seoulDateTimeToDate, seoulParts } from "@/shared/time";

// One cron tick (every minute, POST /api/cron/tick):
//   1. todo notifications whose fireAt has passed are sent once;
//      ones more than 6 hours late are only marked (no flood after downtime);
//   2. the weekly 신한 upload reminder is sent once after its Seoul slot;
//   3. subscriptions the push service reports as gone (404/410) are deleted.
//
// Rows are claimed (sentAt set) before sending, so two overlapping ticks never
// send the same notification twice. If every send for a row fails with an
// error (not "gone"), the claim is released so the next tick retries it.

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** What the service worker shows: title, body, and the page to open on click. */
export interface PushPayload {
  title: string;
  body: string;
  url: string;
}

/** 'gone' = the subscription no longer exists (404/410) and should be deleted. Throws on other failures. */
export type PushSender = (sub: PushTarget, payload: PushPayload) => Promise<"ok" | "gone">;

export const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

export const UPLOAD_REMINDER: PushPayload = {
  title: "신한 거래내역을 올릴 때예요",
  body: "이번 주 거래내역 엑셀을 올리면 잔액이 최신으로 맞춰져요.",
  url: "/assets",
};

/** The latest weekly slot (Seoul weekday `dow` 0=Sun at `time` 'HH:MM') at or before `now`. */
export function lastUploadSlot(now: Date, dow: number, time: string): Date {
  const { date, weekday } = seoulParts(now);
  const back = (weekday - dow + 7) % 7;
  const slot = seoulDateTimeToDate(addDays(date, -back), time);
  return slot.getTime() > now.getTime() ? seoulDateTimeToDate(addDays(date, -back - 7), time) : slot;
}

export async function runTick(db: Db, now: Date, send: PushSender): Promise<{ sent: number }> {
  const subs = await db.select().from(pushSubscriptions);
  const gone = new Set<string>();
  let sent = 0;

  /** Sends to every live subscription. Returns how many succeeded and how many threw. */
  async function deliver(payload: PushPayload): Promise<{ delivered: number; failed: number }> {
    let delivered = 0;
    let failed = 0;
    for (const sub of subs) {
      if (gone.has(sub.endpoint)) continue;
      try {
        const result = await send({ endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth }, payload);
        if (result === "gone") gone.add(sub.endpoint);
        else delivered++;
      } catch (error) {
        failed++;
        console.warn("[push] send failed:", error instanceof Error ? error.message : error);
      }
    }
    sent += delivered;
    return { delivered, failed };
  }

  // 1a. Too late to be useful: mark without sending.
  await db
    .update(notifications)
    .set({ sentAt: now })
    .where(and(isNull(notifications.sentAt), lt(notifications.fireAt, new Date(now.getTime() - STALE_AFTER_MS))));

  // 1b. Claim everything due.
  const due = await db
    .update(notifications)
    .set({ sentAt: now })
    .where(and(isNull(notifications.sentAt), lte(notifications.fireAt, now)))
    .returning();

  if (due.length > 0) {
    // A completed todo never notifies, even if its row slipped through.
    const todoIds = [...new Set(due.map((n) => n.todoId).filter((id): id is string => id !== null))];
    const doneIds = new Set(
      todoIds.length === 0
        ? []
        : (
            await db
              .select({ id: todos.id })
              .from(todos)
              .where(and(inArray(todos.id, todoIds), isNotNull(todos.doneAt)))
          ).map((r) => r.id),
    );

    due.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime());
    for (const n of due) {
      if (n.todoId && doneIds.has(n.todoId)) continue;
      const { delivered, failed } = await deliver({ title: n.title, body: n.body, url: n.url });
      if (delivered === 0 && failed > 0) {
        await db.update(notifications).set({ sentAt: null }).where(eq(notifications.id, n.id));
      }
    }
  }

  // 2. Weekly upload reminder: once per slot, claimed atomically.
  const [s] = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
  if (s) {
    const slot = lastUploadSlot(now, s.uploadReminderDow, s.uploadReminderTime);
    const claimed = await db
      .update(settings)
      .set({ lastUploadReminderSentAt: now })
      .where(
        and(
          eq(settings.id, 1),
          or(isNull(settings.lastUploadReminderSentAt), lt(settings.lastUploadReminderSentAt, slot)),
        ),
      )
      .returning({ id: settings.id });
    if (claimed.length > 0) {
      const { delivered, failed } = await deliver(UPLOAD_REMINDER);
      if (delivered === 0 && failed > 0) {
        await db
          .update(settings)
          .set({ lastUploadReminderSentAt: s.lastUploadReminderSentAt })
          .where(eq(settings.id, 1));
      }
    }
  }

  // 3. Forget subscriptions the push service no longer knows.
  if (gone.size > 0) {
    await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.endpoint, [...gone]));
  }

  return { sent };
}

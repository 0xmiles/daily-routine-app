import { eq } from "drizzle-orm";
import { z } from "zod";
import type { ReminderSettings } from "@/features/notify/types";
import { rescheduleAllTodoNotifications } from "@/features/todos/server/notify";
import { withUser } from "@/server/auth/session";
import type { Db } from "@/server/db/client";
import { getDb } from "@/server/db/client";
import { settings, type SettingsRow } from "@/server/db/schema";
import { json, problem } from "@/shared/http";

const TIME = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const patchSchema = z
  .object({
    uploadReminderDow: z.number().int().min(0).max(6),
    uploadReminderTime: TIME,
    defaultOffsetMin: z.number().int().min(0).max(7 * 24 * 60),
    dateOnlyNotifyTime: TIME,
  })
  .partial()
  .strict()
  .refine((patch) => Object.keys(patch).length > 0);

function toSettings(row: SettingsRow): ReminderSettings {
  return {
    uploadReminderDow: row.uploadReminderDow,
    uploadReminderTime: row.uploadReminderTime,
    defaultOffsetMin: row.defaultOffsetMin,
    dateOnlyNotifyTime: row.dateOnlyNotifyTime,
  };
}

async function readRow(db: Db): Promise<SettingsRow> {
  const [row] = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
  if (row) return row;
  const [created] = await db.insert(settings).values({ id: 1 }).onConflictDoNothing().returning();
  return created ?? (await db.select().from(settings).where(eq(settings.id, 1)))[0];
}

export const GET = withUser(async () => json(toSettings(await readRow(getDb()))));

/**
 * Partial update. Moving the upload slot counts as "already reminded" up to now,
 * so a slot that is suddenly in the past doesn't fire right away. Changing the
 * todo defaults re-plans pending todo notifications.
 */
export const PUT = withUser(async (req) => {
  let raw: unknown = null;
  try {
    raw = await req.json();
  } catch {
    // handled below
  }
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) return problem(400, "알림 설정을 저장하지 못했어요. 요일과 시간을 다시 골라 주세요.");
  const patch = parsed.data;
  const now = new Date();

  const row = await getDb().transaction(async (tx) => {
    const before = await readRow(tx);
    const uploadMoved =
      (patch.uploadReminderDow !== undefined && patch.uploadReminderDow !== before.uploadReminderDow) ||
      (patch.uploadReminderTime !== undefined && patch.uploadReminderTime !== before.uploadReminderTime);
    const todoDefaultsChanged =
      (patch.defaultOffsetMin !== undefined && patch.defaultOffsetMin !== before.defaultOffsetMin) ||
      (patch.dateOnlyNotifyTime !== undefined && patch.dateOnlyNotifyTime !== before.dateOnlyNotifyTime);

    const [updated] = await tx
      .update(settings)
      .set({ ...patch, ...(uploadMoved ? { lastUploadReminderSentAt: now } : {}) })
      .where(eq(settings.id, 1))
      .returning();
    if (todoDefaultsChanged) await rescheduleAllTodoNotifications(tx, now);
    return updated;
  });

  return json(toSettings(row));
});

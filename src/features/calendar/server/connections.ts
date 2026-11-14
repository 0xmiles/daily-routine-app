import { eq } from "drizzle-orm";
import type { OAuth2Tokens } from "arctic";
import { z } from "zod";
import type { Db } from "@/server/db/client";
import { settings } from "@/server/db/schema";
import type { ConnectionsResponse, SharedCalendar } from "../client";
import { GoogleApiError, listCalendarList } from "./calendar-api";
import {
  CalendarHttpError,
  PERSONAL_NOT_CONNECTED_MESSAGE,
  invalidateEventsCache,
  probeWorkCalendar,
} from "./events";
import { deleteGoogleAccount, findGoogleAccount, getAccessToken, saveGoogleTokens } from "./google-oauth";

const CALENDAR_NOT_FOUND_MESSAGE = "고른 캘린더를 개인 계정에서 찾지 못했어요. 목록을 새로 고친 뒤 다시 골라 주세요.";
const CALENDAR_LIST_FAILED_MESSAGE = "개인 계정의 캘린더 목록을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.";
const BAD_CHOICE_MESSAGE = "연결 방법을 읽지 못했어요. 공유받은 캘린더를 다시 골라 주세요.";

// Google-provided public calendars (holidays, birthdays, week numbers) are not work calendars.
const GOOGLE_PUBLIC_CALENDAR_SUFFIX = "@group.v.calendar.google.com";

async function readSettings(db: Db) {
  const [row] = await db
    .select({ via: settings.workCalendarVia, calendarId: settings.workCalendarId })
    .from(settings)
    .where(eq(settings.id, 1))
    .limit(1);
  return row ?? { via: "none" as const, calendarId: null };
}

/** GET /api/settings/connections */
export async function getConnections(db: Db): Promise<ConnectionsResponse> {
  // Probe first: it may refresh tokens or mark an account needs_reconnect.
  const status = await probeWorkCalendar(db);
  const [personal, work, s] = await Promise.all([findGoogleAccount(db, "personal"), findGoogleAccount(db, "work"), readSettings(db)]);
  return {
    personal: personal ? { email: personal.email, status: personal.status } : null,
    work: {
      via: s.via,
      email: s.via === "work_account" ? (work?.email ?? null) : null,
      calendarId: s.via === "none" ? null : s.calendarId,
      status,
    },
  };
}

async function personalToken(db: Db): Promise<string> {
  const token = await getAccessToken(db, "personal");
  if (!token) throw new CalendarHttpError(409, PERSONAL_NOT_CONNECTED_MESSAGE);
  return token;
}

async function sharedCalendars(token: string): Promise<SharedCalendar[]> {
  let entries;
  try {
    entries = await listCalendarList(token);
  } catch (error) {
    if (error instanceof GoogleApiError) throw new CalendarHttpError(502, CALENDAR_LIST_FAILED_MESSAGE);
    throw error;
  }
  return entries
    .filter((entry) => entry.accessRole !== "owner" && !entry.id.endsWith(GOOGLE_PUBLIC_CALENDAR_SUFFIX))
    .map((entry) => ({
      id: entry.id,
      name: entry.summaryOverride?.trim() || entry.summary?.trim() || entry.id,
      busyOnly: entry.accessRole === "freeBusyReader",
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

/** GET /api/settings/connections/shared-calendars — calendars shared to the personal account (not owned by it). */
export async function listSharedCalendars(db: Db): Promise<SharedCalendar[]> {
  return sharedCalendars(await personalToken(db));
}

const choiceSchema = z.discriminatedUnion("via", [
  z.object({ via: z.literal("personal_shared"), calendarId: z.string().min(1).max(1024) }),
  z.object({ via: z.literal("none") }),
]);

/**
 * PUT /api/settings/connections
 *   { via: 'personal_shared', calendarId } — read the work calendar through the personal account.
 *   { via: 'none' } — stop showing work events and forget the work account's tokens.
 */
export async function setWorkCalendar(db: Db, body: unknown): Promise<ConnectionsResponse> {
  const parsed = choiceSchema.safeParse(body);
  if (!parsed.success) throw new CalendarHttpError(400, BAD_CHOICE_MESSAGE);
  const choice = parsed.data;

  if (choice.via === "none") {
    await deleteGoogleAccount(db, "work");
    await db.update(settings).set({ workCalendarVia: "none", workCalendarId: null }).where(eq(settings.id, 1));
  } else {
    const calendars = await sharedCalendars(await personalToken(db));
    if (!calendars.some((c) => c.id === choice.calendarId)) throw new CalendarHttpError(400, CALENDAR_NOT_FOUND_MESSAGE);
    await db
      .update(settings)
      .set({ workCalendarVia: "personal_shared", workCalendarId: choice.calendarId })
      .where(eq(settings.id, 1));
  }
  invalidateEventsCache(db);
  return getConnections(db);
}

/** Work account OAuth succeeded: store its (read-only) tokens and read its primary calendar. */
export async function connectWorkAccount(db: Db, tokens: OAuth2Tokens, email: string): Promise<void> {
  await saveGoogleTokens(db, "work", tokens, email);
  await db
    .update(settings)
    .set({ workCalendarVia: "work_account", workCalendarId: email.toLowerCase() })
    .where(eq(settings.id, 1));
  invalidateEventsCache(db);
}

/** Personal account OAuth succeeded: store its tokens (new events go to its primary calendar). */
/**
 * True when `email` is the work account, either connected directly or as the
 * shared calendar (whose id is the work address). New events go to the personal
 * account's primary calendar, so the personal connection must never be one of these.
 */
export async function isKnownWorkIdentity(db: Db, email: string): Promise<boolean> {
  const target = email.trim().toLowerCase();
  const work = await findGoogleAccount(db, "work");
  if (work && work.email.toLowerCase() === target) return true;
  const [row] = await db.select({ id: settings.workCalendarId }).from(settings).where(eq(settings.id, 1));
  return !!row?.id && row.id.trim().toLowerCase() === target;
}

export async function connectPersonalAccount(db: Db, tokens: OAuth2Tokens, email: string): Promise<void> {
  await saveGoogleTokens(db, "personal", tokens, email);
  invalidateEventsCache(db);
}

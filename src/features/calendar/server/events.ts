import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/server/db/client";
import { googleAccounts, settings, type GoogleAccountRow, type SettingsRow } from "@/server/db/schema";
import type { CalendarEvent, CalendarSource, EventsResponse, WorkCalendarStatus } from "@/shared/contracts";
import { problem } from "@/shared/http";
import type { WorkConnectionStatus } from "../client";
import { addDays, seoulParts, seoulToday } from "@/shared/time";
import {
  GoogleApiError,
  deletePrimaryEvent,
  getPrimaryEvent,
  insertPrimaryEvent,
  listCalendarEvents,
  patchPrimaryEvent,
  queryFreeBusy,
  type GoogleEvent,
} from "./calendar-api";
import { findGoogleAccount, getAccessToken, markNeedsReconnect, type GoogleRole } from "./google-oauth";

// Events are never stored: they are read from Google on demand and merged.
//   personal  — the personal account's `primary` (the only calendar the app writes to)
//   work      — the work account's primary (work token) or a calendar shared to
//               the personal account (personal token); read-only. If its events
//               are not readable (403/404) we fall back to free/busy blocks.
//   holiday   — Google's Korean holiday calendar (public; any token can read it)

export const PERSONAL_CALENDAR_ID = "primary";
export const HOLIDAY_CALENDAR_ID = "ko.south_korea#holiday@group.v.calendar.google.com";
export const MAX_RANGE_DAYS = 100;
const CACHE_TTL_MS = 60 * 1000;

export const PERSONAL_NOT_CONNECTED_MESSAGE = "개인 캘린더를 먼저 연결해 주세요.";
const PERSONAL_RECONNECT_MESSAGE = "개인 캘린더 연결이 끊겼어요. 설정에서 다시 연결해 주세요.";
const NOT_PERSONAL_MESSAGE = "회사 일정과 공휴일은 이 앱에서 고칠 수 없어요. 개인 일정만 고칠 수 있어요.";
const ALREADY_DELETED_MESSAGE = "이미 삭제된 일정이에요. 목록을 새로 고쳐 주세요.";
const GOOGLE_UNAVAILABLE_MESSAGE = "Google 캘린더에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.";
const GOOGLE_REFUSED_MESSAGE = "Google이 이 일정을 고치지 못하게 했어요. 내가 만든 일정인지 확인해 주세요.";
const TITLE_REQUIRED_MESSAGE = "일정 제목을 적어 주세요.";
const TITLE_TOO_LONG_MESSAGE = "일정 제목이 너무 길어요. 500자 안으로 줄여 주세요.";
const BAD_BODY_MESSAGE = "일정 정보를 읽지 못했어요. 제목, 시작, 끝, 종일 여부를 함께 보내 주세요.";
const TIME_FORMAT_MESSAGE = "날짜나 시간 형식이 맞지 않아요. 날짜와 시간을 다시 골라 주세요.";
const END_BEFORE_START_MESSAGE = "끝나는 시간이 시작 시간보다 늦어야 해요. 시간을 다시 골라 주세요.";
const ALL_DAY_CHANGE_MESSAGE = "종일 여부를 바꿀 때는 시작과 끝을 함께 보내 주세요.";

/** An error with a user-facing message and an HTTP status for the route. */
export class CalendarHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CalendarHttpError";
  }
}

const forbidden = () => new CalendarHttpError(403, NOT_PERSONAL_MESSAGE);

/** Maps errors thrown by this module to `{ message }` responses. Unknown errors are rethrown. */
export function calendarErrorResponse(error: unknown): Response {
  if (error instanceof CalendarHttpError) return problem(error.status, error.message);
  if (error instanceof GoogleApiError) {
    return error.status === 403 ? problem(403, GOOGLE_REFUSED_MESSAGE) : problem(502, GOOGLE_UNAVAILABLE_MESSAGE);
  }
  throw error;
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/;
const HAS_OFFSET_RE = /(?:Z|[+-]\d{2}:\d{2})$/;

function isCalendarDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  try {
    return addDays(value, 0) === value;
  } catch {
    return false;
  }
}

/** Any instant → 'YYYY-MM-DDTHH:MM:SS+09:00' (Seoul wall clock). */
export function toSeoulIso(value: string | Date): string {
  const instant = typeof value === "string" ? new Date(value) : value;
  const { date, time } = seoulParts(instant);
  return `${date}T${time}:${String(instant.getUTCSeconds()).padStart(2, "0")}+09:00`;
}

/** Accepts ISO with or without offset (no offset = Seoul time). */
function normalizeDateTime(value: string): string | null {
  if (!DATETIME_RE.test(value) || !isCalendarDate(value.slice(0, 10))) return null;
  const instant = new Date(HAS_OFFSET_RE.test(value) ? value : `${value}+09:00`);
  return Number.isNaN(instant.getTime()) ? null : toSeoulIso(instant);
}

/** Inclusive Seoul date range → [timeMin, timeMax) instants for Google. */
function rangeToInstants(from: string, to: string): { timeMin: string; timeMax: string } {
  return { timeMin: `${from}T00:00:00+09:00`, timeMax: `${addDays(to, 1)}T00:00:00+09:00` };
}

/** null if `from..to` (inclusive, 'YYYY-MM-DD') is a valid range, else a user-facing message. */
export function validateRange(from: string | null, to: string | null): string | null {
  if (!from || !to || !isCalendarDate(from) || !isCalendarDate(to)) {
    return "기간을 읽지 못했어요. from과 to를 YYYY-MM-DD 형식으로 보내 주세요.";
  }
  if (to < from) return "기간의 끝이 시작보다 빨라요. from과 to를 바꿔 보내 주세요.";
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (days > MAX_RANGE_DAYS) return `한 번에 ${MAX_RANGE_DAYS}일까지 불러올 수 있어요. 기간을 줄여 주세요.`;
  return null;
}

// ---------------------------------------------------------------------------
// Google event → CalendarEvent
// ---------------------------------------------------------------------------

function isHolidayObservance(event: GoogleEvent): boolean {
  // Google's Korean holiday calendar also lists observances (기념일), which are not red days.
  const description = event.description?.trim() ?? "";
  return description.startsWith("기념일") || description.startsWith("Observance");
}

/**
 * allDay: start/end are 'YYYY-MM-DD' with Google's exclusive end date
 * (a one-day event on 11-14 has end '11-15'). Timed: ISO with +09:00.
 */
export function mapGoogleEvent(event: GoogleEvent, source: CalendarSource, calendarId: string): CalendarEvent | null {
  if (event.status === "cancelled" || !event.start || !event.end) return null;
  const allDay = Boolean(event.start.date);
  const start = allDay ? event.start.date : event.start.dateTime && toSeoulIso(event.start.dateTime);
  const end = allDay ? event.end.date : event.end.dateTime && toSeoulIso(event.end.dateTime);
  if (!start || !end) return null;

  const summary = event.summary?.trim() || null;
  if (source === "holiday" && (!summary || isHolidayObservance(event))) return null;

  // Work events without a title or marked private show only as busy time.
  const busyOnly =
    source === "work" && (!summary || event.visibility === "private" || event.visibility === "confidential");
  const title = busyOnly ? null : (summary ?? "(제목 없음)");

  return {
    id: event.id,
    calendarId,
    source,
    title,
    busyOnly,
    start,
    end,
    allDay,
    location: busyOnly ? null : event.location?.trim() || null,
    attendeeCount: busyOnly || !event.attendees ? null : event.attendees.filter((a) => !a.resource).length,
    recurringEventId: event.recurringEventId ?? null,
    readOnly: source !== "personal",
  };
}

function busyBlock(calendarId: string, busy: { start: string; end: string }): CalendarEvent {
  return {
    id: `busy:${Date.parse(busy.start)}-${Date.parse(busy.end)}`,
    calendarId,
    source: "work",
    title: null,
    busyOnly: true,
    start: toSeoulIso(busy.start),
    end: toSeoulIso(busy.end),
    allDay: false,
    location: null,
    attendeeCount: null,
    recurringEventId: null,
    readOnly: true,
  };
}

function byStart(a: CalendarEvent, b: CalendarEvent): number {
  // 'YYYY-MM-DD' sorts before 'YYYY-MM-DDT…', so all-day events lead their day.
  if (a.start !== b.start) return a.start < b.start ? -1 : 1;
  if (a.end !== b.end) return a.end < b.end ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Connection state
// ---------------------------------------------------------------------------

interface ConnectionState {
  settings: Pick<SettingsRow, "workCalendarVia" | "workCalendarId">;
  personal: GoogleAccountRow | null;
  work: GoogleAccountRow | null;
}

async function loadConnectionState(db: Db): Promise<ConnectionState> {
  const [row] = await db
    .select({ workCalendarVia: settings.workCalendarVia, workCalendarId: settings.workCalendarId })
    .from(settings)
    .where(eq(settings.id, 1))
    .limit(1);
  const accounts = await db.select().from(googleAccounts);
  return {
    settings: row ?? { workCalendarVia: "none", workCalendarId: null },
    personal: accounts.find((a) => a.role === "personal") ?? null,
    work: accounts.find((a) => a.role === "work") ?? null,
  };
}

type WorkSource =
  | { state: "none" }
  | { state: "needs_reconnect" }
  | { state: "ready"; role: GoogleRole; token: string; apiCalendarId: string; calendarId: string };

async function resolveWorkSource(db: Db, state: ConnectionState, personalToken: string | null): Promise<WorkSource> {
  const { workCalendarVia: via, workCalendarId } = state.settings;
  if (via === "work_account") {
    if (!state.work) return { state: "none" };
    const token = await getAccessToken(db, "work");
    if (!token) return { state: "needs_reconnect" };
    return { state: "ready", role: "work", token, apiCalendarId: "primary", calendarId: workCalendarId ?? state.work.email };
  }
  if (via === "personal_shared") {
    if (!workCalendarId) return { state: "none" };
    if (!personalToken) return { state: "needs_reconnect" };
    return { state: "ready", role: "personal", token: personalToken, apiCalendarId: workCalendarId, calendarId: workCalendarId };
  }
  return { state: "none" };
}

interface WorkRead {
  events: CalendarEvent[];
  status: WorkCalendarStatus;
  unauthorized?: boolean;
}

async function readWorkEvents(
  db: Db,
  source: Extract<WorkSource, { state: "ready" }>,
  timeMin: string,
  timeMax: string,
  opts: { maxResults?: number } = {},
): Promise<WorkRead> {
  try {
    const items = await listCalendarEvents(source.token, source.apiCalendarId, timeMin, timeMax, opts);
    const events = items.flatMap((item) => mapGoogleEvent(item, "work", source.calendarId) ?? []);
    return { events, status: "connected" };
  } catch (error) {
    if (!(error instanceof GoogleApiError)) return { events: [], status: "error" };
    if (error.status === 401) {
      await markNeedsReconnect(db, source.role);
      return { events: [], status: "error", unauthorized: true };
    }
    if (error.status !== 403 && error.status !== 404) return { events: [], status: "error" };
  }
  // Events are hidden from us (e.g. shared as "free/busy only"): show busy blocks.
  try {
    const busy = await queryFreeBusy(source.token, source.apiCalendarId, timeMin, timeMax);
    return { events: busy.map((b) => busyBlock(source.calendarId, b)), status: "busy_only" };
  } catch {
    return { events: [], status: "error" };
  }
}

/** Live status of the work calendar for the settings screen (one small read today). */
export async function probeWorkCalendar(db: Db): Promise<WorkConnectionStatus> {
  const state = await loadConnectionState(db);
  const personalToken = state.settings.workCalendarVia === "personal_shared" ? await getAccessToken(db, "personal") : null;
  const source = await resolveWorkSource(db, state, personalToken);
  if (source.state === "none") return "disconnected";
  if (source.state === "needs_reconnect") return "needs_reconnect";
  const today = seoulToday();
  const { timeMin, timeMax } = rangeToInstants(today, today);
  const read = await readWorkEvents(db, source, timeMin, timeMax, { maxResults: 1 });
  if (read.unauthorized) return "needs_reconnect";
  return read.status === "connected" || read.status === "busy_only" ? read.status : "error";
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

interface CacheEntry {
  expiresAt: number;
  value: EventsResponse;
}
// Per database (one in production; a fresh one per test), keyed by range + connection state.
const caches = new WeakMap<Db, Map<string, CacheEntry>>();

export function invalidateEventsCache(db: Db): void {
  caches.delete(db);
}

function cacheKey(from: string, to: string, state: ConnectionState): string {
  const { personal, work, settings: s } = state;
  return [from, to, s.workCalendarVia, s.workCalendarId, personal?.email, personal?.status, work?.email, work?.status].join("|");
}

/** Personal primary events, or null when the personal token was rejected (401). */
async function readPersonalEvents(db: Db, token: string, timeMin: string, timeMax: string): Promise<CalendarEvent[] | null> {
  try {
    const items = await listCalendarEvents(token, PERSONAL_CALENDAR_ID, timeMin, timeMax);
    return items.flatMap((item) => mapGoogleEvent(item, "personal", PERSONAL_CALENDAR_ID) ?? []);
  } catch (error) {
    if (error instanceof GoogleApiError && error.status === 401) {
      await markNeedsReconnect(db, "personal");
      return null;
    }
    throw error;
  }
}

/**
 * Merged events for the inclusive Seoul date range `from..to`, cached for 60s.
 * Without a personal connection the work and holiday calendars still load
 * (holidays need some token: personal, else the work account's).
 * Throws GoogleApiError if the personal calendar cannot be read for other reasons.
 */
export async function listEvents(
  db: Db,
  from: string,
  to: string,
  options: { fresh?: boolean } = {},
): Promise<EventsResponse> {
  const state = await loadConnectionState(db);
  const key = cacheKey(from, to, state);
  let cache = caches.get(db);
  // `fresh`: the browser just wrote an event, possibly through another server
  // instance whose write didn't clear this instance's cache.
  const hit = options.fresh ? undefined : cache?.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const personalToken = state.personal ? await getAccessToken(db, "personal") : null;
  if (state.personal && !personalToken) {
    // Connected but no token: either the grant was revoked (now needs_reconnect) or Google was unreachable.
    const row = await findGoogleAccount(db, "personal");
    if (row?.status === "ok") throw new CalendarHttpError(503, GOOGLE_UNAVAILABLE_MESSAGE);
  }
  const work = await resolveWorkSource(db, state, personalToken);
  const holidayToken = personalToken ?? (work.state === "ready" ? work.token : null);
  const idleWorkStatus: WorkCalendarStatus = work.state === "none" ? "disconnected" : "error";
  if (!personalToken && work.state !== "ready") {
    return { events: [], workStatus: idleWorkStatus, personalConnected: false };
  }

  const { timeMin, timeMax } = rangeToInstants(from, to);
  const [personal, holidays, workRead] = await Promise.all([
    personalToken ? readPersonalEvents(db, personalToken, timeMin, timeMax) : Promise.resolve(null),
    holidayToken
      ? listCalendarEvents(holidayToken, HOLIDAY_CALENDAR_ID, timeMin, timeMax).catch(() => [] as GoogleEvent[])
      : Promise.resolve([] as GoogleEvent[]),
    work.state === "ready"
      ? readWorkEvents(db, work, timeMin, timeMax)
      : Promise.resolve<WorkRead>({ events: [], status: idleWorkStatus }),
  ]);

  const events = [
    ...(personal ?? []),
    ...holidays.flatMap((item) => mapGoogleEvent(item, "holiday", HOLIDAY_CALENDAR_ID) ?? []),
    ...workRead.events,
  ].sort(byStart);
  const value: EventsResponse = { events, workStatus: workRead.status, personalConnected: personal !== null };

  if (!cache) caches.set(db, (cache = new Map()));
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  return value;
}

// ---------------------------------------------------------------------------
// Writing — personal `primary` only
// ---------------------------------------------------------------------------

/**
 * The [id] route param as an event id in the personal primary calendar.
 * Accepts a bare Google event id or the eventKey form `primary:<id>`.
 * Anything aimed at another calendar (a calendarId hint, an eventKey of a work
 * or holiday calendar, a busy block) is refused with 403 before calling Google.
 */
export function resolvePersonalEventId(rawId: string, calendarIdHint?: unknown): string {
  if (calendarIdHint !== undefined && calendarIdHint !== null && calendarIdHint !== PERSONAL_CALENDAR_ID) throw forbidden();
  let id = rawId;
  const colon = id.lastIndexOf(":");
  if (colon !== -1) {
    if (id.slice(0, colon) !== PERSONAL_CALENDAR_ID) throw forbidden();
    id = id.slice(colon + 1);
  }
  // Google event ids (and recurring instance ids) are base32hex plus '_'.
  if (!/^[A-Za-z0-9_-]{1,1024}$/.test(id)) throw forbidden();
  return id;
}

/** Throws 403 when a request body names a calendar other than personal primary. */
export function assertPersonalTarget(body: unknown): void {
  if (body && typeof body === "object" && "calendarId" in body) resolvePersonalEventId("x", (body as { calendarId: unknown }).calendarId);
}

async function requirePersonalToken(db: Db): Promise<string> {
  const token = await getAccessToken(db, "personal");
  if (token) return token;
  const row = await findGoogleAccount(db, "personal");
  if (!row) throw new CalendarHttpError(409, PERSONAL_NOT_CONNECTED_MESSAGE);
  if (row.status === "needs_reconnect") throw new CalendarHttpError(409, PERSONAL_RECONNECT_MESSAGE);
  throw new CalendarHttpError(503, GOOGLE_UNAVAILABLE_MESSAGE);
}

const eventFields = z.object({
  title: z.string(),
  start: z.string(),
  end: z.string(),
  allDay: z.boolean(),
  description: z.string().max(8000).optional(),
});
const newEventSchema = eventFields;
const patchSchema = eventFields.partial();

export type EventPatch = z.infer<typeof patchSchema>;

function validTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) throw new CalendarHttpError(400, TITLE_REQUIRED_MESSAGE);
  if (trimmed.length > 500) throw new CalendarHttpError(400, TITLE_TOO_LONG_MESSAGE);
  return trimmed;
}

/** allDay end is exclusive; an end equal to the start means "that one day". */
function normalizeTimes(allDay: boolean, start: string, end: string): { start: string; end: string } {
  if (allDay) {
    if (!isCalendarDate(start) || !isCalendarDate(end)) throw new CalendarHttpError(400, TIME_FORMAT_MESSAGE);
    if (end < start) throw new CalendarHttpError(400, END_BEFORE_START_MESSAGE);
    return { start, end: end === start ? addDays(start, 1) : end };
  }
  const s = normalizeDateTime(start);
  const e = normalizeDateTime(end);
  if (!s || !e) throw new CalendarHttpError(400, TIME_FORMAT_MESSAGE);
  if (Date.parse(e) <= Date.parse(s)) throw new CalendarHttpError(400, END_BEFORE_START_MESSAGE);
  return { start: s, end: e };
}

function googleTime(allDay: boolean, value: string, forPatch: boolean): Record<string, unknown> {
  if (allDay) return forPatch ? { date: value, dateTime: null } : { date: value };
  return forPatch ? { dateTime: value, timeZone: "Asia/Seoul", date: null } : { dateTime: value, timeZone: "Asia/Seoul" };
}

function toPersonal(event: GoogleEvent): CalendarEvent {
  const mapped = mapGoogleEvent(event, "personal", PERSONAL_CALENDAR_ID);
  if (!mapped) throw new CalendarHttpError(404, ALREADY_DELETED_MESSAGE);
  return mapped;
}

/** Looks the id up in personal primary. Not there → 403 (it belongs to another calendar). */
async function findPersonalEvent(db: Db, token: string, eventId: string): Promise<GoogleEvent> {
  let event: GoogleEvent;
  try {
    event = await getPrimaryEvent(token, eventId);
  } catch (error) {
    if (error instanceof GoogleApiError) {
      if (error.status === 404 || error.status === 400 || error.status === 403) throw forbidden();
      if (error.status === 410) throw new CalendarHttpError(404, ALREADY_DELETED_MESSAGE);
      if (error.status === 401) {
        await markNeedsReconnect(db, "personal");
        throw new CalendarHttpError(409, PERSONAL_RECONNECT_MESSAGE);
      }
    }
    throw error;
  }
  if (event.status === "cancelled") throw new CalendarHttpError(404, ALREADY_DELETED_MESSAGE);
  return event;
}

/** POST: creates an event in personal primary. `body` is the raw JSON body. */
export async function createPersonalEvent(db: Db, body: unknown): Promise<CalendarEvent> {
  assertPersonalTarget(body);
  const parsed = newEventSchema.safeParse(body);
  if (!parsed.success) throw new CalendarHttpError(400, BAD_BODY_MESSAGE);
  const input = parsed.data;
  const title = validTitle(input.title);
  const times = normalizeTimes(input.allDay, input.start, input.end);
  const token = await requirePersonalToken(db);

  const created = await insertPrimaryEvent(token, {
    summary: title,
    description: input.description,
    start: googleTime(input.allDay, times.start, false),
    end: googleTime(input.allDay, times.end, false),
  });
  invalidateEventsCache(db);
  return toPersonal(created);
}

/** PATCH: updates an event that exists in personal primary. */
export async function updatePersonalEvent(db: Db, rawId: string, calendarIdHint: unknown, body: unknown): Promise<CalendarEvent> {
  const eventId = resolvePersonalEventId(rawId, calendarIdHint);
  assertPersonalTarget(body);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) throw new CalendarHttpError(400, BAD_BODY_MESSAGE);
  const patch = parsed.data;
  const token = await requirePersonalToken(db);
  const existing = await findPersonalEvent(db, token, eventId);
  const current = toPersonal(existing);

  const changes: Record<string, unknown> = {};
  if (patch.title !== undefined) changes.summary = validTitle(patch.title);
  if (patch.description !== undefined) changes.description = patch.description;
  if (patch.start !== undefined || patch.end !== undefined || patch.allDay !== undefined) {
    const allDay = patch.allDay ?? current.allDay;
    if (allDay !== current.allDay && (patch.start === undefined || patch.end === undefined)) {
      throw new CalendarHttpError(400, ALL_DAY_CHANGE_MESSAGE);
    }
    const times = normalizeTimes(allDay, patch.start ?? current.start, patch.end ?? current.end);
    changes.start = googleTime(allDay, times.start, true);
    changes.end = googleTime(allDay, times.end, true);
  }
  if (Object.keys(changes).length === 0) return current;

  const updated = await patchPrimaryEvent(token, eventId, changes);
  invalidateEventsCache(db);
  return toPersonal(updated);
}

/** DELETE: removes an event that exists in personal primary (one instance, for recurring events). */
export async function deletePersonalEvent(db: Db, rawId: string, calendarIdHint: unknown): Promise<void> {
  const eventId = resolvePersonalEventId(rawId, calendarIdHint);
  const token = await requirePersonalToken(db);
  await findPersonalEvent(db, token, eventId);
  await deletePrimaryEvent(token, eventId);
  invalidateEventsCache(db);
}

import type { CalendarEvent, EventsResponse, NewPersonalEvent } from "@/shared/contracts";

// Browser-side calls to the calendar and connection APIs. Every function throws
// `CalendarApiError` (with the server's Korean `message`) when the call fails.

export type WorkCalendarVia = "work_account" | "personal_shared" | "none";
/** connected · busy_only (바쁨만) · disconnected (연결 안 됨) · needs_reconnect (다시 연결 필요) · error */
export type WorkConnectionStatus = "connected" | "busy_only" | "disconnected" | "needs_reconnect" | "error";

export interface ConnectionsResponse {
  /** The personal Google account whose `primary` calendar receives new events. */
  personal: { email: string; status: "ok" | "needs_reconnect" } | null;
  work: {
    via: WorkCalendarVia;
    /** The directly connected work account (via 'work_account' only). */
    email: string | null;
    calendarId: string | null;
    status: WorkConnectionStatus;
  };
}

/** A calendar shared to the personal account (not owned by it). */
export interface SharedCalendar {
  id: string;
  name: string;
  /** Shared as free/busy only: events will show as busy blocks. */
  busyOnly: boolean;
}

/** Start URLs for the OAuth flows (navigate the browser to them). */
export const CONNECT_PERSONAL_URL = "/api/connect/personal";
export const CONNECT_WORK_URL = "/api/connect/work";

export class CalendarApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CalendarApiError";
  }
}

const NETWORK_MESSAGE = "서버에 연결하지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.";
const FALLBACK_MESSAGE = "요청을 처리하지 못했어요. 잠시 뒤 다시 시도해 주세요.";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: init.body ? { "Content-Type": "application/json", ...init.headers } : init.headers,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new CalendarApiError(0, NETWORK_MESSAGE);
  }
  if (!res.ok) {
    let message = FALLBACK_MESSAGE;
    try {
      const body = (await res.json()) as { message?: unknown };
      if (typeof body.message === "string" && body.message) message = body.message;
    } catch {
      // Keep the fallback message.
    }
    throw new CalendarApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// --- events -----------------------------------------------------------------------

// The server caches events for 60 seconds per instance. For a minute after
// this browser writes an event, reads ask for a fresh copy so the change shows
// even when the write and the read land on different server instances.
const FRESH_AFTER_WRITE_MS = 60_000;
let lastWriteAt = Number.NEGATIVE_INFINITY;

async function wrote<T>(result: Promise<T>): Promise<T> {
  const value = await result;
  lastWriteAt = Date.now();
  return value;
}

/** Events for the inclusive Seoul date range `from..to` ('YYYY-MM-DD'). */
export function fetchEvents(from: string, to: string): Promise<EventsResponse> {
  const query = new URLSearchParams({ from, to });
  if (Date.now() - lastWriteAt < FRESH_AFTER_WRITE_MS) query.set("fresh", "1");
  return request<EventsResponse>(`/api/calendar/events?${query}`);
}

/**
 * Creates a personal event (always the personal primary calendar).
 * Timed: `start`/`end` ISO (an offset-less 'YYYY-MM-DDTHH:MM' is read as Seoul time).
 * All-day: 'YYYY-MM-DD'; `end` is exclusive, and `end === start` means that one day.
 */
export function createEvent(event: NewPersonalEvent): Promise<CalendarEvent> {
  return wrote(request<CalendarEvent>("/api/calendar/events", { method: "POST", body: JSON.stringify(event) }));
}

/** Updates a personal event. When `allDay` changes, send `start` and `end` too. */
export function updateEvent(id: string, patch: Partial<NewPersonalEvent>): Promise<CalendarEvent> {
  return wrote(
    request<CalendarEvent>(`/api/calendar/events/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  );
}

export function deleteEvent(id: string): Promise<void> {
  return wrote(request<void>(`/api/calendar/events/${encodeURIComponent(id)}`, { method: "DELETE" }));
}

// --- connections --------------------------------------------------------------------

export function fetchConnections(): Promise<ConnectionsResponse> {
  return request<ConnectionsResponse>("/api/settings/connections");
}

/** Calendars shared to the personal account. 409 when no personal calendar is connected. */
export async function fetchSharedCalendars(): Promise<SharedCalendar[]> {
  return (await request<{ calendars: SharedCalendar[] }>("/api/settings/connections/shared-calendars")).calendars;
}

/** Reads the work calendar through the personal account's shared calendar `calendarId`. */
export function chooseSharedCalendar(calendarId: string): Promise<ConnectionsResponse> {
  return request<ConnectionsResponse>("/api/settings/connections", {
    method: "PUT",
    body: JSON.stringify({ via: "personal_shared", calendarId }),
  });
}

/** Stops showing the work calendar (and forgets the work account's tokens). */
export function disconnectWorkCalendar(): Promise<ConnectionsResponse> {
  return request<ConnectionsResponse>("/api/settings/connections", {
    method: "PUT",
    body: JSON.stringify({ via: "none" }),
  });
}

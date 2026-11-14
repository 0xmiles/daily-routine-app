// Thin Google Calendar v3 REST client (fetch-based, so tests can stub fetch).
// Writes are only exposed for the personal `primary` calendar: the calendar id
// is a constant in those paths and is never taken from input.

const API = "https://www.googleapis.com/calendar/v3";
const MAX_PAGES = 10;

export class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string | null,
  ) {
    super(`Google Calendar API ${status}${reason ? ` (${reason})` : ""}`);
    this.name = "GoogleApiError";
  }
}

export interface GoogleEventTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export interface GoogleEvent {
  id: string;
  status?: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  description?: string;
  location?: string;
  visibility?: "default" | "public" | "private" | "confidential";
  start?: GoogleEventTime;
  end?: GoogleEventTime;
  recurringEventId?: string;
  attendees?: Array<{ email?: string; resource?: boolean }>;
}

export interface GoogleCalendarListEntry {
  id: string;
  summary?: string;
  summaryOverride?: string;
  accessRole: "freeBusyReader" | "reader" | "writer" | "owner";
  primary?: boolean;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  query?: Record<string, string | undefined>;
  body?: unknown;
}

async function request<T>(token: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const url = new URL(`${API}${path}`);
  for (const [key, value] of Object.entries(opts.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    cache: "no-store",
  });
  if (!res.ok) {
    let reason: string | null = null;
    try {
      const data = (await res.json()) as { error?: { errors?: Array<{ reason?: string }>; status?: string } };
      reason = data.error?.errors?.[0]?.reason ?? data.error?.status ?? null;
    } catch {
      // Non-JSON error body.
    }
    throw new GoogleApiError(res.status, reason);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

const enc = encodeURIComponent;

/** Expanded (singleEvents) events in [timeMin, timeMax), following pagination. */
export async function listCalendarEvents(
  token: string,
  calendarId: string,
  timeMin: string,
  timeMax: string,
  opts: { maxResults?: number } = {},
): Promise<GoogleEvent[]> {
  const items: GoogleEvent[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await request<{ items?: GoogleEvent[]; nextPageToken?: string }>(
      token,
      `/calendars/${enc(calendarId)}/events`,
      {
        query: {
          singleEvents: "true",
          orderBy: "startTime",
          timeMin,
          timeMax,
          timeZone: "Asia/Seoul",
          maxResults: String(opts.maxResults ?? 2500),
          pageToken,
        },
      },
    );
    items.push(...(data.items ?? []));
    pageToken = data.nextPageToken;
    if (!pageToken || opts.maxResults) break;
  }
  return items;
}

/** Busy intervals of one calendar (freebusy.query — a read, despite being a POST). */
export async function queryFreeBusy(
  token: string,
  calendarId: string,
  timeMin: string,
  timeMax: string,
): Promise<Array<{ start: string; end: string }>> {
  const data = await request<{
    calendars?: Record<string, { busy?: Array<{ start: string; end: string }>; errors?: Array<{ reason?: string }> }>;
  }>(token, "/freeBusy", {
    method: "POST",
    body: { timeMin, timeMax, timeZone: "Asia/Seoul", items: [{ id: calendarId }] },
  });
  const entry = data.calendars?.[calendarId];
  if (!entry || entry.errors?.length) throw new GoogleApiError(404, entry?.errors?.[0]?.reason ?? "notFound");
  return entry.busy ?? [];
}

export async function listCalendarList(token: string): Promise<GoogleCalendarListEntry[]> {
  const items: GoogleCalendarListEntry[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await request<{ items?: GoogleCalendarListEntry[]; nextPageToken?: string }>(
      token,
      "/users/me/calendarList",
      { query: { maxResults: "250", pageToken } },
    );
    items.push(...(data.items ?? []));
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return items;
}

// --- personal primary only -----------------------------------------------------

export function getPrimaryEvent(token: string, eventId: string): Promise<GoogleEvent> {
  return request<GoogleEvent>(token, `/calendars/primary/events/${enc(eventId)}`);
}

export function insertPrimaryEvent(token: string, body: Record<string, unknown>): Promise<GoogleEvent> {
  return request<GoogleEvent>(token, "/calendars/primary/events", { method: "POST", body });
}

export function patchPrimaryEvent(token: string, eventId: string, body: Record<string, unknown>): Promise<GoogleEvent> {
  return request<GoogleEvent>(token, `/calendars/primary/events/${enc(eventId)}`, { method: "PATCH", body });
}

export function deletePrimaryEvent(token: string, eventId: string): Promise<void> {
  return request<void>(token, `/calendars/primary/events/${enc(eventId)}`, { method: "DELETE" });
}

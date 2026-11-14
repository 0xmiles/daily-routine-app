import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, PATCH } from "@/app/api/calendar/events/[id]/route";
import { GET, POST } from "@/app/api/calendar/events/route";
import { sessionCookieFor } from "@/server/auth/session";
import type { Db } from "@/server/db/client";
import { settings } from "@/server/db/schema";
import { createTestDb } from "@/server/db/test-db";
import type { CalendarEvent, EventsResponse } from "@/shared/contracts";
import { HOLIDAY_CALENDAR_ID } from "./events";
import { findGoogleAccount } from "./google-oauth";
import { googleError, jsonResponse, mockGoogleFetch, seedGoogleAccount, type RecordedCall } from "./test-google";

const APP = "http://localhost:3000";
const PERSONAL_TOKEN = "Bearer personal-access-token";
const WORK_TOKEN = "Bearer work-access-token";

let db: Db;
let cookie: string;

beforeEach(async () => {
  db = await createTestDb();
  cookie = await sessionCookieFor();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function eventsPath(calendarId: string) {
  return `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
}

function isList(call: RecordedCall, calendarId: string) {
  return call.method === "GET" && call.url.pathname === eventsPath(calendarId);
}

async function useWorkAccount() {
  await seedGoogleAccount(db, "work", { email: "me@company.com" });
  await db.update(settings).set({ workCalendarVia: "work_account", workCalendarId: "me@company.com" }).where(eq(settings.id, 1));
}

async function useSharedCalendar(calendarId = "boss@company.com") {
  await db.update(settings).set({ workCalendarVia: "personal_shared", workCalendarId: calendarId }).where(eq(settings.id, 1));
}

function getEvents(from = "2026-11-14", to = "2026-11-14") {
  return GET(new Request(`${APP}/api/calendar/events?from=${from}&to=${to}`, { headers: { cookie } }));
}

const personalItems = [
  {
    id: "p1",
    summary: "브런치",
    location: "연남동",
    start: { dateTime: "2026-11-14T03:00:00Z" },
    end: { dateTime: "2026-11-14T04:30:00Z" },
    attendees: [{ email: "a@x.com" }, { email: "b@x.com" }, { email: "room@x.com", resource: true }],
  },
  { id: "p2", summary: "여행", start: { date: "2026-11-14" }, end: { date: "2026-11-16" } },
  { id: "p3", status: "cancelled", start: { date: "2026-11-14" }, end: { date: "2026-11-15" } },
  { id: "p4", visibility: "private", summary: "병원", start: { dateTime: "2026-11-14T17:00:00+09:00" }, end: { dateTime: "2026-11-14T18:00:00+09:00" } },
];

const workItems = [
  {
    id: "w1",
    summary: "주간 회의",
    recurringEventId: "wr",
    start: { dateTime: "2026-11-14T10:00:00+09:00" },
    end: { dateTime: "2026-11-14T11:00:00+09:00" },
    location: "3층",
  },
  { id: "w2", summary: "비공개 면담", visibility: "private", location: "5층", start: { dateTime: "2026-11-14T14:00:00+09:00" }, end: { dateTime: "2026-11-14T15:00:00+09:00" } },
  { id: "w3", start: { dateTime: "2026-11-14T16:00:00+09:00" }, end: { dateTime: "2026-11-14T16:30:00+09:00" } },
];

const holidayItems = [
  { id: "h1", summary: "임시공휴일", description: "공휴일", start: { date: "2026-11-14" }, end: { date: "2026-11-15" } },
  { id: "h2", summary: "농업인의 날", description: "기념일\n기념일을 숨기려면 Google Calendar 설정으로 이동하세요.", start: { date: "2026-11-14" }, end: { date: "2026-11-15" } },
];

describe("GET /api/calendar/events", () => {
  it("requires a session", async () => {
    expect((await GET(new Request(`${APP}/api/calendar/events?from=2026-11-14&to=2026-11-14`))).status).toBe(401);
  });

  it("rejects a bad range", async () => {
    mockGoogleFetch(() => undefined);
    expect((await getEvents("2026-11-15", "2026-11-14")).status).toBe(400);
    expect((await getEvents("2026-11-1", "2026-11-14")).status).toBe(400);
    expect((await getEvents("2026-01-01", "2026-12-31")).status).toBe(400);
  });

  it("merges personal, work and holiday events with source and readOnly", async () => {
    await seedGoogleAccount(db, "personal");
    await useWorkAccount();
    const google = mockGoogleFetch((call) => {
      // The work account's own primary calendar is read with the WORK token.
      if (isList(call, "primary") && call.auth === WORK_TOKEN) return jsonResponse({ items: workItems });
      if (isList(call, "primary") && call.auth === PERSONAL_TOKEN) return jsonResponse({ items: personalItems });
      if (isList(call, HOLIDAY_CALENDAR_ID)) return jsonResponse({ items: holidayItems });
    });

    const res = await getEvents();
    expect(res.status).toBe(200);
    const body = (await res.json()) as EventsResponse;
    expect(body.personalConnected).toBe(true);
    expect(body.workStatus).toBe("connected");

    const byId = Object.fromEntries(body.events.map((e) => [e.id, e])) as Record<string, CalendarEvent>;
    expect(Object.keys(byId).sort()).toEqual(["h1", "p1", "p2", "p4", "w1", "w2", "w3"]);

    expect(byId.p1).toEqual({
      id: "p1",
      calendarId: "primary",
      source: "personal",
      title: "브런치",
      busyOnly: false,
      start: "2026-11-14T12:00:00+09:00",
      end: "2026-11-14T13:30:00+09:00",
      allDay: false,
      location: "연남동",
      attendeeCount: 2,
      recurringEventId: null,
      readOnly: false,
    });
    expect(byId.p2).toMatchObject({ allDay: true, start: "2026-11-14", end: "2026-11-16", readOnly: false });
    // My own private event still shows its title.
    expect(byId.p4).toMatchObject({ title: "병원", busyOnly: false });

    expect(byId.w1).toMatchObject({
      calendarId: "me@company.com",
      source: "work",
      title: "주간 회의",
      busyOnly: false,
      readOnly: true,
      recurringEventId: "wr",
      start: "2026-11-14T10:00:00+09:00",
    });
    expect(byId.w2).toMatchObject({ source: "work", title: null, busyOnly: true, location: null, readOnly: true });
    expect(byId.w3).toMatchObject({ source: "work", title: null, busyOnly: true });

    expect(byId.h1).toMatchObject({ source: "holiday", title: "임시공휴일", allDay: true, readOnly: true, calendarId: HOLIDAY_CALENDAR_ID });

    // Sorted by start; all-day before timed on the same day.
    expect(body.events.map((e) => e.start)).toEqual([...body.events.map((e) => e.start)].sort());

    const personalCall = google.calls.find((c) => c.url.pathname === eventsPath("primary"))!;
    expect(personalCall.url.searchParams.get("timeMin")).toBe("2026-11-14T00:00:00+09:00");
    expect(personalCall.url.searchParams.get("timeMax")).toBe("2026-11-15T00:00:00+09:00");
    expect(personalCall.url.searchParams.get("singleEvents")).toBe("true");
    expect(personalCall.url.searchParams.get("orderBy")).toBe("startTime");
    expect(google.calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("falls back to freebusy when work events 403", async () => {
    await seedGoogleAccount(db, "personal");
    await useSharedCalendar("boss@company.com");
    const google = mockGoogleFetch((call) => {
      if (isList(call, "primary")) return jsonResponse({ items: [] });
      if (isList(call, HOLIDAY_CALENDAR_ID)) return jsonResponse({ items: [] });
      if (isList(call, "boss@company.com")) return googleError(403, "forbidden");
      if (call.method === "POST" && call.url.pathname === "/calendar/v3/freeBusy") {
        const body = JSON.parse(call.body!);
        expect(body.items).toEqual([{ id: "boss@company.com" }]);
        expect(body.timeMin).toBe("2026-11-14T00:00:00+09:00");
        return jsonResponse({
          calendars: { "boss@company.com": { busy: [{ start: "2026-11-14T01:00:00Z", end: "2026-11-14T02:00:00Z" }] } },
        });
      }
    });

    const body = (await (await getEvents()).json()) as EventsResponse;
    expect(body.workStatus).toBe("busy_only");
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({
      calendarId: "boss@company.com",
      source: "work",
      title: null,
      busyOnly: true,
      start: "2026-11-14T10:00:00+09:00",
      end: "2026-11-14T11:00:00+09:00",
      allDay: false,
      readOnly: true,
    });
    // Shared calendar is read with the personal token.
    expect(google.calls.find((c) => c.url.pathname === "/calendar/v3/freeBusy")!.auth).toBe(PERSONAL_TOKEN);
  });

  it("reports error and keeps personal events when work freebusy also fails", async () => {
    await seedGoogleAccount(db, "personal");
    await useSharedCalendar("boss@company.com");
    mockGoogleFetch((call) => {
      if (isList(call, "primary")) return jsonResponse({ items: personalItems.slice(0, 1) });
      if (isList(call, HOLIDAY_CALENDAR_ID)) return jsonResponse({ items: [] });
      if (isList(call, "boss@company.com")) return googleError(404, "notFound");
      if (call.url.pathname === "/calendar/v3/freeBusy") {
        return jsonResponse({ calendars: { "boss@company.com": { errors: [{ reason: "notFound" }] } } });
      }
    });
    const body = (await (await getEvents()).json()) as EventsResponse;
    expect(body.workStatus).toBe("error");
    expect(body.events.map((e) => e.id)).toEqual(["p1"]);
  });

  it("no personal connection returns personalConnected:false and empty events", async () => {
    const google = mockGoogleFetch(() => undefined);
    const res = await getEvents();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ events: [], workStatus: "disconnected", personalConnected: false });
    expect(google.calls).toHaveLength(0);
  });

  it("without a personal connection, work and holiday events load with the work token", async () => {
    await useWorkAccount();
    const google = mockGoogleFetch((call) => {
      if (isList(call, "primary")) return jsonResponse({ items: workItems.slice(0, 1) });
      if (isList(call, HOLIDAY_CALENDAR_ID)) return jsonResponse({ items: holidayItems });
    });
    const body = (await (await getEvents()).json()) as EventsResponse;
    expect(body.personalConnected).toBe(false);
    expect(body.workStatus).toBe("connected");
    expect(body.events.map((e) => [e.id, e.source])).toEqual([
      ["h1", "holiday"],
      ["w1", "work"],
    ]);
    expect(google.calls.length).toBeGreaterThan(0);
    expect(google.calls.every((c) => c.auth === WORK_TOKEN)).toBe(true);
  });

  it("caches the same range for 60 seconds", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-14T00:00:00Z"));
    await seedGoogleAccount(db, "personal");
    const google = mockGoogleFetch((call) => {
      if (isList(call, "primary")) return jsonResponse({ items: personalItems.slice(0, 1) });
      if (isList(call, HOLIDAY_CALENDAR_ID)) return jsonResponse({ items: [] });
    });
    await getEvents();
    const first = google.calls.length;
    expect(first).toBe(2);

    vi.setSystemTime(new Date("2026-11-14T00:00:59Z"));
    expect(((await (await getEvents()).json()) as EventsResponse).events).toHaveLength(1);
    expect(google.calls.length).toBe(first);

    // A different range is a different cache entry.
    await getEvents("2026-11-14", "2026-11-15");
    expect(google.calls.length).toBe(first * 2);

    vi.setSystemTime(new Date("2026-11-14T00:01:01Z"));
    await getEvents();
    expect(google.calls.length).toBe(first * 3);
  });

  it("fresh=1 skips the cached copy (another server instance may have written)", async () => {
    await seedGoogleAccount(db, "personal");
    const google = mockGoogleFetch((call) => {
      if (isList(call, "primary")) return jsonResponse({ items: personalItems.slice(0, 1) });
      if (isList(call, HOLIDAY_CALENDAR_ID)) return jsonResponse({ items: [] });
    });
    await getEvents();
    const first = google.calls.length;
    await GET(new Request(`${APP}/api/calendar/events?from=2026-11-14&to=2026-11-14&fresh=1`, { headers: { cookie } }));
    expect(google.calls.length).toBe(first * 2);
  });

  it("marks the personal account needs_reconnect when Google answers 401", async () => {
    await seedGoogleAccount(db, "personal");
    mockGoogleFetch((call) => {
      if (isList(call, "primary")) return googleError(401, "authError");
      if (isList(call, HOLIDAY_CALENDAR_ID)) return jsonResponse({ items: [] });
    });
    const body = (await (await getEvents()).json()) as EventsResponse;
    expect(body.personalConnected).toBe(false);
    expect((await findGoogleAccount(db, "personal"))!.status).toBe("needs_reconnect");
  });
});

describe("writes", () => {
  function post(body: unknown) {
    return POST(new Request(`${APP}/api/calendar/events`, { method: "POST", headers: { cookie }, body: JSON.stringify(body) }));
  }
  function patch(id: string, body: unknown, query = "") {
    return PATCH(
      new Request(`${APP}/api/calendar/events/${encodeURIComponent(id)}${query}`, {
        method: "PATCH",
        headers: { cookie },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id }) },
    );
  }
  function del(id: string, query = "") {
    return DELETE(
      new Request(`${APP}/api/calendar/events/${encodeURIComponent(id)}${query}`, { method: "DELETE", headers: { cookie } }),
      { params: Promise.resolve({ id }) },
    );
  }

  it("rejects writes to non-primary calendars", async () => {
    await seedGoogleAccount(db, "personal");
    await useWorkAccount();
    const google = mockGoogleFetch((call) => {
      // The work event does not exist in the personal primary calendar.
      if (call.method === "GET" && call.url.pathname.startsWith(`${eventsPath("primary")}/`)) return googleError(404, "notFound");
    });

    // A work event id: looked up (read) in personal primary, not found → 403.
    const r1 = await patch("w1", { title: "바꿔 보기" });
    expect(r1.status).toBe(403);
    expect((await r1.json()).message).toContain("개인 일정만");
    const r2 = await del("w1");
    expect(r2.status).toBe(403);

    // Explicit work calendar targets are refused before any Google call.
    const before = google.calls.length;
    expect((await patch("w1", { title: "x" }, "?calendarId=me%40company.com")).status).toBe(403);
    expect((await patch("w1", { title: "x", calendarId: "me@company.com" })).status).toBe(403);
    expect((await patch("me@company.com:w1", { title: "x" })).status).toBe(403);
    expect((await del(`${HOLIDAY_CALENDAR_ID}:h1`)).status).toBe(403);
    expect((await patch("busy:1763082000000-1763085600000", { title: "x" })).status).toBe(403);
    expect((await post({ title: "x", start: "2026-11-14", end: "2026-11-14", allDay: true, calendarId: "me@company.com" })).status).toBe(403);
    expect(google.calls.length).toBe(before);

    // Zero Google write requests in total.
    expect(google.nonGetCalls()).toHaveLength(0);
    expect(google.calls.every((c) => c.url.pathname.startsWith(`${eventsPath("primary")}/`))).toBe(true);
  });

  it("writes without personal connection return 409 without calling Google", async () => {
    await useWorkAccount();
    const google = mockGoogleFetch(() => undefined);
    for (const res of [
      await post({ title: "점심", start: "2026-11-14T12:00:00+09:00", end: "2026-11-14T13:00:00+09:00", allDay: false }),
      await patch("p1", { title: "x" }),
      await del("p1"),
    ]) {
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ message: "개인 캘린더를 먼저 연결해 주세요." });
    }
    expect(google.calls).toHaveLength(0);
  });

  it("POST creates a timed event on personal primary", async () => {
    await seedGoogleAccount(db, "personal");
    const google = mockGoogleFetch((call) => {
      if (call.method === "POST" && call.url.pathname === eventsPath("primary")) {
        return jsonResponse({ id: "new1", ...JSON.parse(call.body!) });
      }
    });
    const res = await post({ title: " 저녁 약속 ", start: "2026-11-14T19:00", end: "2026-11-14T20:30", allDay: false, description: "합정" });
    expect(res.status).toBe(201);
    expect(JSON.parse(google.calls[0].body!)).toEqual({
      summary: "저녁 약속",
      description: "합정",
      start: { dateTime: "2026-11-14T19:00:00+09:00", timeZone: "Asia/Seoul" },
      end: { dateTime: "2026-11-14T20:30:00+09:00", timeZone: "Asia/Seoul" },
    });
    expect(await res.json()).toMatchObject({
      id: "new1",
      calendarId: "primary",
      source: "personal",
      title: "저녁 약속",
      start: "2026-11-14T19:00:00+09:00",
      readOnly: false,
    });
  });

  it("POST all-day with the same start and end date makes a one-day event", async () => {
    await seedGoogleAccount(db, "personal");
    const google = mockGoogleFetch((call) => {
      if (call.method === "POST" && call.url.pathname === eventsPath("primary")) return jsonResponse({ id: "d1", ...JSON.parse(call.body!) });
    });
    const res = await post({ title: "휴가", start: "2026-11-20", end: "2026-11-20", allDay: true });
    expect(res.status).toBe(201);
    expect(JSON.parse(google.calls[0].body!)).toMatchObject({ start: { date: "2026-11-20" }, end: { date: "2026-11-21" } });
  });

  it("POST validates input without calling Google", async () => {
    await seedGoogleAccount(db, "personal");
    const google = mockGoogleFetch(() => undefined);
    const noTitle = await post({ title: "  ", start: "2026-11-14T19:00", end: "2026-11-14T20:00", allDay: false });
    expect(noTitle.status).toBe(400);
    expect((await noTitle.json()).message).toBe("일정 제목을 적어 주세요.");
    const backwards = await post({ title: "a", start: "2026-11-14T19:00", end: "2026-11-14T18:00", allDay: false });
    expect(backwards.status).toBe(400);
    expect((await post({ title: "a", start: "내일", end: "모레", allDay: false })).status).toBe(400);
    expect(google.calls).toHaveLength(0);
  });

  it("PATCH and DELETE an event in personal primary", async () => {
    await seedGoogleAccount(db, "personal");
    const existing = { id: "p1", summary: "브런치", start: { dateTime: "2026-11-14T03:00:00Z" }, end: { dateTime: "2026-11-14T04:00:00Z" } };
    const google = mockGoogleFetch((call) => {
      const path = `${eventsPath("primary")}/p1`;
      if (call.url.pathname !== path) return undefined;
      if (call.method === "GET") return jsonResponse(existing);
      if (call.method === "PATCH") return jsonResponse({ ...existing, ...JSON.parse(call.body!) });
      if (call.method === "DELETE") return new Response(null, { status: 204 });
    });

    const res = await patch("p1", { title: "늦은 브런치", start: "2026-11-14T13:00:00+09:00", end: "2026-11-14T14:00:00+09:00" });
    expect(res.status).toBe(200);
    const sent = JSON.parse(google.calls.find((c) => c.method === "PATCH")!.body!);
    expect(sent).toEqual({
      summary: "늦은 브런치",
      start: { dateTime: "2026-11-14T13:00:00+09:00", timeZone: "Asia/Seoul", date: null },
      end: { dateTime: "2026-11-14T14:00:00+09:00", timeZone: "Asia/Seoul", date: null },
    });
    expect(await res.json()).toMatchObject({ id: "p1", title: "늦은 브런치", start: "2026-11-14T13:00:00+09:00" });

    // The eventKey form `primary:<id>` is accepted too.
    expect((await del("primary:p1")).status).toBe(204);
    expect(google.calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
  });

  it("PATCH end before the existing start is rejected before writing", async () => {
    await seedGoogleAccount(db, "personal");
    const google = mockGoogleFetch((call) => {
      if (call.method === "GET") {
        return jsonResponse({ id: "p1", summary: "a", start: { dateTime: "2026-11-14T03:00:00Z" }, end: { dateTime: "2026-11-14T04:00:00Z" } });
      }
    });
    expect((await patch("p1", { end: "2026-11-14T11:00:00+09:00" })).status).toBe(400);
    expect(google.nonGetCalls()).toHaveLength(0);
  });

  it("a successful write clears the events cache", async () => {
    await seedGoogleAccount(db, "personal");
    let listed = 0;
    mockGoogleFetch((call) => {
      if (isList(call, "primary")) {
        listed++;
        return jsonResponse({ items: [] });
      }
      if (isList(call, HOLIDAY_CALENDAR_ID)) return jsonResponse({ items: [] });
      if (call.method === "POST") return jsonResponse({ id: "n", ...JSON.parse(call.body!) });
    });
    await getEvents();
    await getEvents();
    expect(listed).toBe(1);
    await post({ title: "새 일정", start: "2026-11-14", end: "2026-11-15", allDay: true });
    await getEvents();
    expect(listed).toBe(2);
  });
});

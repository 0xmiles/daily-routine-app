import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as workCallbackGET } from "@/app/api/connect/work/callback/route";
import { GET as workStartGET } from "@/app/api/connect/work/route";
import { GET as sharedGET } from "@/app/api/settings/connections/shared-calendars/route";
import { GET as connectionsGET, PUT as connectionsPUT } from "@/app/api/settings/connections/route";
import { sessionCookieFor } from "@/server/auth/session";
import { decrypt } from "@/server/crypto";
import type { Db } from "@/server/db/client";
import { settings } from "@/server/db/schema";
import { createTestDb } from "@/server/db/test-db";
import type { ConnectionsResponse, SharedCalendar } from "../client";
import { WORK_SCOPES, findGoogleAccount } from "./google-oauth";
import {
  fakeIdToken,
  googleError,
  isTokenEndpoint,
  jsonResponse,
  mockGoogleFetch,
  seedGoogleAccount,
  tokenEndpointResponse,
  type RecordedCall,
} from "./test-google";

const APP = "http://localhost:3000";

let db: Db;
let session: string;

beforeEach(async () => {
  db = await createTestDb();
  session = await sessionCookieFor();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function readSettings() {
  const [row] = await db.select().from(settings).where(eq(settings.id, 1));
  return row;
}

function workCallback(query: string) {
  return workCallbackGET(
    new Request(`${APP}/api/connect/work/callback?${query}`, {
      headers: { cookie: `${session}; drs_oauth_work=st4te.v3rifier` },
    }),
  );
}

const calendarList = [
  { id: "me@example.com", summary: "me@example.com", accessRole: "owner", primary: true },
  { id: "me@company.com", summary: "회사", accessRole: "reader" },
  { id: "team@company.com", summary: "팀 일정", summaryOverride: "우리 팀", accessRole: "freeBusyReader" },
  { id: "ko.south_korea#holiday@group.v.calendar.google.com", summary: "대한민국의 휴일", accessRole: "reader" },
  { id: "family@group.calendar.google.com", summary: "가족", accessRole: "owner" },
];

const isCalendarList = (c: RecordedCall) => c.method === "GET" && c.url.pathname === "/calendar/v3/users/me/calendarList";

function put(body: unknown) {
  return connectionsPUT(
    new Request(`${APP}/api/settings/connections`, { method: "PUT", headers: { cookie: session }, body: JSON.stringify(body) }),
  );
}

describe("work account connect", () => {
  it("requires a session", async () => {
    expect((await workStartGET(new Request(`${APP}/api/connect/work`))).status).toBe(401);
  });

  it("asks Google for read-only scopes with offline access and the account chooser", async () => {
    const res = await workStartGET(new Request(`${APP}/api/connect/work`, { headers: { cookie: session } }));
    expect(res.status).toBe(302);
    const url = new URL(res.headers.get("location")!);
    const scope = url.searchParams.get("scope")!;
    expect(scope).toBe(WORK_SCOPES.join(" "));
    expect(scope).not.toContain("calendar.events");
    expect(scope.split(" ").filter((s) => s.startsWith("https://"))).toEqual([
      "https://www.googleapis.com/auth/calendar.readonly",
    ]);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("select_account consent");
    expect(url.searchParams.get("login_hint")).toBeNull();
    expect(url.searchParams.get("redirect_uri")).toBe(`${APP}/api/connect/work/callback`);
    expect(res.headers.getSetCookie().some((c) => c.startsWith("drs_oauth_work="))).toBe(true);
  });

  it("work callback with admin_policy_enforced error redirects with blocked flag", async () => {
    const google = mockGoogleFetch(() => undefined);
    for (const error of ["admin_policy_enforced", "org_internal", "access_denied"]) {
      const res = await workCallback(`error=${error}&state=st4te`);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(`${APP}/settings?work=blocked`);
    }
    expect(google.calls).toHaveLength(0);
    expect(await findGoogleAccount(db, "work")).toBeNull();
    expect((await readSettings()).workCalendarVia).toBe("none");
  });

  it("an org policy error from the token exchange is also reported as blocked", async () => {
    mockGoogleFetch((call) => {
      if (isTokenEndpoint(call)) return jsonResponse({ error: "admin_policy_enforced" }, 400);
    });
    const res = await workCallback("code=c0de&state=st4te");
    expect(res.headers.get("location")).toBe(`${APP}/settings?work=blocked`);
  });

  it("saves the work account and reads its primary calendar", async () => {
    mockGoogleFetch((call) => {
      if (isTokenEndpoint(call)) {
        return tokenEndpointResponse({
          access_token: "work-at",
          refresh_token: "work-rt",
          scope: WORK_SCOPES.join(" "),
          id_token: fakeIdToken({ email: "Me@Company.com", email_verified: true }),
        });
      }
    });
    const res = await workCallback("code=c0de&state=st4te");
    expect(res.headers.get("location")).toBe(`${APP}/settings?work=connected`);
    const row = (await findGoogleAccount(db, "work"))!;
    expect(row.email).toBe("me@company.com");
    expect(decrypt(row.accessTokenEnc)).toBe("work-at");
    expect(decrypt(row.refreshTokenEnc!)).toBe("work-rt");
    expect(await readSettings()).toMatchObject({ workCalendarVia: "work_account", workCalendarId: "me@company.com" });
  });

  it("refuses the personal calendar's account as the work account", async () => {
    await seedGoogleAccount(db, "personal", { email: "me@example.com" });
    mockGoogleFetch((call) => {
      if (isTokenEndpoint(call)) {
        return tokenEndpointResponse({ refresh_token: "rt", scope: WORK_SCOPES.join(" "), id_token: fakeIdToken({ email: "me@example.com" }) });
      }
    });
    const res = await workCallback("code=c0de&state=st4te");
    expect(res.headers.get("location")).toBe(`${APP}/settings?work=same_account`);
    expect(await findGoogleAccount(db, "work")).toBeNull();
  });

  it("a state mismatch is an error, not blocked", async () => {
    mockGoogleFetch(() => undefined);
    const res = await workCallback("code=c0de&state=forged");
    expect(res.headers.get("location")).toBe(`${APP}/settings?work=error`);
  });

  it("without a session the callback goes to /login", async () => {
    const res = await workCallbackGET(new Request(`${APP}/api/connect/work/callback?code=c&state=s`));
    expect(res.headers.get("location")).toBe(`${APP}/login`);
  });
});

describe("GET /api/settings/connections", () => {
  it("requires a session", async () => {
    expect((await connectionsGET(new Request(`${APP}/api/settings/connections`))).status).toBe(401);
  });

  function get() {
    return connectionsGET(new Request(`${APP}/api/settings/connections`, { headers: { cookie: session } }));
  }

  it("reports nothing connected", async () => {
    const google = mockGoogleFetch(() => undefined);
    expect(await (await get()).json()).toEqual({
      personal: null,
      work: { via: "none", email: null, calendarId: null, status: "disconnected" },
    });
    expect(google.calls).toHaveLength(0);
  });

  it("reports a connected personal calendar and work account", async () => {
    await seedGoogleAccount(db, "personal", { email: "me@example.com" });
    await seedGoogleAccount(db, "work", { email: "me@company.com" });
    await db.update(settings).set({ workCalendarVia: "work_account", workCalendarId: "me@company.com" }).where(eq(settings.id, 1));
    mockGoogleFetch((call) => {
      if (call.url.pathname === "/calendar/v3/calendars/primary/events" && call.auth === "Bearer work-access-token") {
        return jsonResponse({ items: [] });
      }
    });
    expect(await (await get()).json()).toEqual({
      personal: { email: "me@example.com", status: "ok" },
      work: { via: "work_account", email: "me@company.com", calendarId: "me@company.com", status: "connected" },
    });
  });

  it("reports busy_only when only free/busy is readable", async () => {
    await seedGoogleAccount(db, "personal");
    await db.update(settings).set({ workCalendarVia: "personal_shared", workCalendarId: "boss@company.com" }).where(eq(settings.id, 1));
    mockGoogleFetch((call) => {
      if (call.url.pathname.endsWith("/events")) return googleError(404, "notFound");
      if (call.url.pathname === "/calendar/v3/freeBusy") return jsonResponse({ calendars: { "boss@company.com": { busy: [] } } });
    });
    const body = (await (await get()).json()) as ConnectionsResponse;
    expect(body.work).toEqual({ via: "personal_shared", email: null, calendarId: "boss@company.com", status: "busy_only" });
  });

  it("reports needs_reconnect when the work account's grant is gone", async () => {
    await seedGoogleAccount(db, "work", { status: "needs_reconnect" });
    await db.update(settings).set({ workCalendarVia: "work_account", workCalendarId: "me@company.com" }).where(eq(settings.id, 1));
    mockGoogleFetch(() => undefined);
    expect(((await (await get()).json()) as ConnectionsResponse).work.status).toBe("needs_reconnect");
  });
});

describe("shared calendars", () => {
  it("lists calendars shared to the personal account, not owned or Google-provided ones", async () => {
    await seedGoogleAccount(db, "personal");
    mockGoogleFetch((call) => {
      if (isCalendarList(call)) return jsonResponse({ items: calendarList });
    });
    const res = await sharedGET(new Request(`${APP}/api/settings/connections/shared-calendars`, { headers: { cookie: session } }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { calendars: SharedCalendar[] }).calendars).toEqual([
      { id: "team@company.com", name: "우리 팀", busyOnly: true },
      { id: "me@company.com", name: "회사", busyOnly: false },
    ]);
  });

  it("needs a personal connection first (409)", async () => {
    const google = mockGoogleFetch(() => undefined);
    const res = await sharedGET(new Request(`${APP}/api/settings/connections/shared-calendars`, { headers: { cookie: session } }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ message: "개인 캘린더를 먼저 연결해 주세요." });
    const putRes = await put({ via: "personal_shared", calendarId: "me@company.com" });
    expect(putRes.status).toBe(409);
    expect(google.calls).toHaveLength(0);
  });

  it("PUT via personal_shared stores calendarId", async () => {
    await seedGoogleAccount(db, "personal");
    mockGoogleFetch((call) => {
      if (isCalendarList(call)) return jsonResponse({ items: calendarList });
      if (call.url.pathname.endsWith("/events")) return jsonResponse({ items: [] });
    });
    const res = await put({ via: "personal_shared", calendarId: "me@company.com" });
    expect(res.status).toBe(200);
    expect(await readSettings()).toMatchObject({ workCalendarVia: "personal_shared", workCalendarId: "me@company.com" });
    expect(((await res.json()) as ConnectionsResponse).work).toEqual({
      via: "personal_shared",
      email: null,
      calendarId: "me@company.com",
      status: "connected",
    });
  });

  it("PUT refuses a calendar that is not shared to the personal account", async () => {
    await seedGoogleAccount(db, "personal");
    mockGoogleFetch((call) => {
      if (isCalendarList(call)) return jsonResponse({ items: calendarList });
    });
    for (const calendarId of ["someone@else.com", "me@example.com"]) {
      const res = await put({ via: "personal_shared", calendarId });
      expect(res.status).toBe(400);
    }
    expect((await readSettings()).workCalendarVia).toBe("none");
    expect((await put({ via: "work_account" })).status).toBe(400);
  });

  it("PUT via none disconnects the work calendar and forgets the work tokens", async () => {
    await seedGoogleAccount(db, "work");
    await db.update(settings).set({ workCalendarVia: "work_account", workCalendarId: "me@company.com" }).where(eq(settings.id, 1));
    mockGoogleFetch(() => undefined);
    const res = await put({ via: "none" });
    expect(res.status).toBe(200);
    expect(await readSettings()).toMatchObject({ workCalendarVia: "none", workCalendarId: null });
    expect(await findGoogleAccount(db, "work")).toBeNull();
  });
});

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionsResponse, SharedCalendar } from "./client";
import { ConnectionsSection } from "./ConnectionsSection";

const BLOCKED =
  "회사 계정에서 외부 앱 연결이 막혀 있어요. 회사 캘린더를 개인 계정에 공유한 뒤 '공유받은 캘린더에서 고르기'를 눌러 주세요.";

const nothing: ConnectionsResponse = {
  personal: null,
  work: { via: "none", email: null, calendarId: null, status: "disconnected" },
};

interface Routes {
  connections?: ConnectionsResponse;
  shared?: { status: number; body: unknown };
  put?: ConnectionsResponse;
}

function mockApi(routes: Routes) {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const method = init?.method ?? "GET";
      calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (path === "/api/settings/connections" && method === "GET") return json(200, routes.connections ?? nothing);
      if (path === "/api/settings/connections" && method === "PUT") return json(200, routes.put ?? nothing);
      if (path === "/api/settings/connections/shared-calendars") {
        return json(routes.shared?.status ?? 200, routes.shared?.body ?? { calendars: [] });
      }
      throw new Error(`Unmocked ${method} ${path}`);
    }),
  );
  return calls;
}

beforeEach(() => {
  window.history.replaceState(null, "", "/settings");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ConnectionsSection", () => {
  it("shows the personal calendar first, then the read-only work calendar", async () => {
    mockApi({
      connections: {
        personal: { email: "me@gmail.com", status: "ok" },
        work: { via: "work_account", email: "me@company.com", calendarId: "me@company.com", status: "busy_only" },
      },
    });
    render(<ConnectionsSection />);
    const personal = await screen.findByRole("group", { name: "개인 캘린더" });
    const work = screen.getByRole("group", { name: "회사 캘린더" });
    expect(personal.compareDocumentPosition(work) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(within(personal).getByText("새 일정은 여기에 저장돼요.")).toBeTruthy();
    expect(within(personal).getByText("me@gmail.com")).toBeTruthy();
    expect(within(personal).getByText("연결됨")).toBeTruthy();
    expect(within(personal).getByRole("button", { name: "개인 캘린더 다시 연결하기" }).textContent).toBe("다시 연결하기");

    expect(within(work).getByText("읽기만 해요.")).toBeTruthy();
    expect(within(work).getByText("바쁨만 보여요")).toBeTruthy();
    expect(within(work).getByRole("button", { name: "회사 캘린더 연결하기" })).toBeTruthy();
    expect(within(work).getByRole("button", { name: "공유받은 캘린더에서 고르기" })).toBeTruthy();
  });

  it("offers to connect a personal calendar when there is none", async () => {
    mockApi({ connections: nothing });
    render(<ConnectionsSection />);
    const personal = await screen.findByRole("group", { name: "개인 캘린더" });
    expect(within(personal).getByText("연결 안 됨")).toBeTruthy();
    const button = within(personal).getByRole("button", { name: "개인 캘린더 연결하기" });
    expect(button.closest("form")?.getAttribute("action")).toBe("/api/connect/personal");
    expect(within(screen.getByRole("group", { name: "회사 캘린더" })).getByText("연결 안 됨")).toBeTruthy();
  });

  it("shows needs-reconnect for the work account", async () => {
    mockApi({
      connections: {
        personal: { email: "me@gmail.com", status: "ok" },
        work: { via: "work_account", email: "me@company.com", calendarId: "me@company.com", status: "needs_reconnect" },
      },
    });
    render(<ConnectionsSection />);
    const work = await screen.findByRole("group", { name: "회사 캘린더" });
    expect(await within(work).findByText("다시 연결 필요")).toBeTruthy();
  });

  it("shows the blocked message after ?work=blocked", async () => {
    window.history.replaceState(null, "", "/settings?work=blocked");
    mockApi({ connections: nothing });
    render(<ConnectionsSection />);
    expect(await screen.findByText(BLOCKED)).toBeTruthy();
  });

  it("shows ?personal=connected feedback and can dismiss it", async () => {
    window.history.replaceState(null, "", "/settings?personal=connected");
    mockApi({ connections: { ...nothing, personal: { email: "me@gmail.com", status: "ok" } } });
    render(<ConnectionsSection />);
    expect(await screen.findByText("개인 캘린더를 연결했어요. 새 일정은 이 계정에 저장돼요.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "알림 닫기" }));
    expect(screen.queryByText("개인 캘린더를 연결했어요. 새 일정은 이 계정에 저장돼요.")).toBeNull();
    expect(window.location.search).toBe("");
  });

  it("picks a shared calendar from the sheet", async () => {
    const calendars: SharedCalendar[] = [
      { id: "team@company.com", name: "우리 팀", busyOnly: true },
      { id: "me@company.com", name: "회사", busyOnly: false },
    ];
    const after: ConnectionsResponse = {
      personal: { email: "me@gmail.com", status: "ok" },
      work: { via: "personal_shared", email: null, calendarId: "me@company.com", status: "connected" },
    };
    const calls = mockApi({
      connections: { ...nothing, personal: { email: "me@gmail.com", status: "ok" } },
      shared: { status: 200, body: { calendars } },
      put: after,
    });
    render(<ConnectionsSection />);
    await userEvent.click(await screen.findByRole("button", { name: "공유받은 캘린더에서 고르기" }));
    const sheet = await screen.findByRole("dialog", { name: "공유받은 캘린더에서 고르기" });
    expect(within(sheet).getByText("바쁨만 보여요")).toBeTruthy();
    await userEvent.click(await within(sheet).findByRole("button", { name: /회사/ }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ via: "personal_shared", calendarId: "me@company.com" });
    const work = screen.getByRole("group", { name: "회사 캘린더" });
    expect(within(work).getByText("연결됨")).toBeTruthy();
    expect(within(work).getByText(/me@company\.com/)).toBeTruthy();
  });

  it("asks to connect the personal calendar first when the picker gets 409", async () => {
    mockApi({
      connections: { ...nothing, personal: { email: "me@gmail.com", status: "needs_reconnect" } },
      shared: { status: 409, body: { message: "개인 캘린더를 먼저 연결해 주세요." } },
    });
    render(<ConnectionsSection />);
    await userEvent.click(await screen.findByRole("button", { name: "공유받은 캘린더에서 고르기" }));
    const sheet = await screen.findByRole("dialog");
    expect(await within(sheet).findByText("개인 캘린더를 먼저 연결해 주세요.")).toBeTruthy();
    const connect = within(sheet).getByRole("button", { name: "개인 캘린더 연결하기" });
    expect(connect.closest("form")?.getAttribute("action")).toBe("/api/connect/personal");
  });
});

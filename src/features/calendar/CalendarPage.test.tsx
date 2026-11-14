import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEvent, Todo } from "@/shared/contracts";

vi.mock("next/navigation", () => ({
  usePathname: () => "/calendar",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/features/calendar/client", () => ({
  fetchEvents: vi.fn(),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
}));
vi.mock("@/features/memo/client", () => ({ fetchEventKeys: vi.fn(async () => []), openEventMemo: vi.fn() }));
vi.mock("@/features/todos/client", () => ({ TODOS_CHANGED_EVENT: "drs:todos-changed", fetchTodos: vi.fn() }));
vi.mock("@/features/todos/TodoEditorSheet", () => ({ TodoEditorSheet: () => null }));

import { fetchEvents } from "@/features/calendar/client";
import { fetchTodos } from "@/features/todos/client";
import { CalendarPage } from "./CalendarPage";

const meeting: CalendarEvent = {
  id: "w1",
  calendarId: "work@company.com",
  source: "work",
  title: "주간 회의",
  busyOnly: false,
  start: "2026-11-16T10:00:00+09:00",
  end: "2026-11-16T11:00:00+09:00",
  allDay: false,
  location: null,
  attendeeCount: 5,
  recurringEventId: null,
  readOnly: true,
};
const report: Todo = {
  id: "t1",
  title: "보고서 제출",
  scope: "work",
  dueDate: "2026-11-16",
  dueTime: "18:00",
  doneAt: null,
  recurrence: null,
  seriesId: null,
  notify: { enabled: true, offsetMin: null },
};

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-14T03:00:00Z")); // Sat 12:00 KST
});
afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  window.history.replaceState(null, "", "/calendar");
  vi.mocked(fetchEvents).mockReset();
  vi.mocked(fetchEvents).mockResolvedValue({ events: [meeting], workStatus: "connected", personalConnected: false });
  vi.mocked(fetchTodos).mockResolvedValue([report]);
});

describe("CalendarPage", () => {
  it("shows the month heading and loads the whole visible grid", async () => {
    render(<CalendarPage initialDate="2026-11-14" today="2026-11-14" />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("11월");
    await waitFor(() => expect(fetchEvents).toHaveBeenCalledWith("2026-11-01", "2026-12-05"));
    expect(await screen.findByText("오늘은 일정이 없어요.")).toBeTruthy();
    // Personal calendar not connected: quiet line, no "create" button.
    expect(screen.getByRole("link", { name: "설정에서 연결하기" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "이날 일정 만들기" })).toBeNull();
  });

  it("picking a day lists its events and due todos", async () => {
    render(<CalendarPage initialDate="2026-11-14" today="2026-11-14" />);
    await userEvent.click(await screen.findByRole("button", { name: /^11월 16일 월요일, 일정 1개, 할 일 마감 1개$/ }));
    expect(window.location.search).toBe("?date=2026-11-16");
    const agenda = screen.getByRole("region", { name: /16일 월요일/ });
    expect(within(agenda).getByText("주간 회의")).toBeTruthy();
    expect(within(agenda).getByText("보고서 제출")).toBeTruthy();
    expect(within(agenda).getByText("18:00")).toBeTruthy();
  });

  it("next month moves the grid and fetches its range", async () => {
    render(<CalendarPage initialDate="2026-11-14" today="2026-11-14" />);
    await userEvent.click(screen.getByRole("button", { name: "다음 달" }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("12월");
    await waitFor(() => expect(fetchEvents).toHaveBeenLastCalledWith("2026-11-29", "2027-01-02"));
    expect(window.location.search).toBe("?date=2026-12-01");
    await userEvent.click(screen.getByRole("button", { name: "이번 달" }));
    expect(window.location.search).toBe("?date=2026-11-14");
  });
});

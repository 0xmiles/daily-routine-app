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
  localStorage.clear();
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

const storedView = () => localStorage.getItem("daily:calendarView");
const viewRadio = (label: string) => screen.getByRole("radio", { name: new RegExp(`^${label},`) });

describe("CalendarPage views (일 / 주 / 월)", () => {
  it("switches views, fetches each view's days, remembers the choice and keeps 일/주 in the address", async () => {
    render(<CalendarPage initialDate="2026-11-14" today="2026-11-14" />);
    expect(viewRadio("월").getAttribute("aria-checked")).toBe("true");

    await userEvent.click(viewRadio("주"));
    expect(viewRadio("주").getAttribute("aria-checked")).toBe("true");
    await waitFor(() => expect(fetchEvents).toHaveBeenLastCalledWith("2026-11-08", "2026-11-14"));
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("11월 8일–14일");
    expect(window.location.search).toBe("?view=week&date=2026-11-14");
    expect(storedView()).toBe('"week"');

    await userEvent.click(viewRadio("일"));
    await waitFor(() => expect(fetchEvents).toHaveBeenLastCalledWith("2026-11-14", "2026-11-14"));
    expect(screen.getByRole("toolbar", { name: "빈 시간에 새 일정 만들기" })).toBeTruthy();
    expect(window.location.search).toBe("?view=day&date=2026-11-14");

    await userEvent.click(viewRadio("월"));
    await waitFor(() => expect(fetchEvents).toHaveBeenLastCalledWith("2026-11-01", "2026-12-05"));
    expect(window.location.search).toBe("?date=2026-11-14");
    expect(storedView()).toBe('"month"');
  });

  it("arrow keys move the view choice", async () => {
    render(<CalendarPage initialDate="2026-11-14" today="2026-11-14" />);
    viewRadio("월").focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(viewRadio("주").getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(viewRadio("주"));
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    expect(viewRadio("일").getAttribute("aria-checked")).toBe("true");
  });

  it("opens the view picked last on this device; an address with view= wins and is not saved", async () => {
    localStorage.setItem("daily:calendarView", '"week"');
    const { unmount } = render(<CalendarPage initialDate="2026-11-14" today="2026-11-14" />);
    expect(viewRadio("주").getAttribute("aria-checked")).toBe("true");
    await waitFor(() => expect(fetchEvents).toHaveBeenLastCalledWith("2026-11-08", "2026-11-14"));
    unmount();

    render(<CalendarPage initialDate="2026-11-14" today="2026-11-14" initialView="day" />);
    expect(viewRadio("일").getAttribute("aria-checked")).toBe("true");
    await waitFor(() => expect(fetchEvents).toHaveBeenLastCalledWith("2026-11-14", "2026-11-14"));
    expect(storedView()).toBe('"week"');
  });

  it("주: previous and next move by a week", async () => {
    render(<CalendarPage initialDate="2026-11-14" today="2026-11-14" initialView="week" />);
    expect(screen.queryByRole("button", { name: "이번 주" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "다음 주" }));
    await waitFor(() => expect(fetchEvents).toHaveBeenLastCalledWith("2026-11-15", "2026-11-21"));
    expect(window.location.search).toBe("?view=week&date=2026-11-21");
    await userEvent.click(screen.getByRole("button", { name: "이전 주" }));
    await userEvent.click(screen.getByRole("button", { name: "이전 주" }));
    await waitFor(() => expect(fetchEvents).toHaveBeenLastCalledWith("2026-11-01", "2026-11-07"));
    await userEvent.click(screen.getByRole("button", { name: "이번 주" }));
    expect(window.location.search).toBe("?view=week&date=2026-11-14");
  });

  it("일: previous and next move by a day", async () => {
    render(<CalendarPage initialDate="2026-11-14" today="2026-11-14" initialView="day" />);
    await userEvent.click(screen.getByRole("button", { name: "다음 날" }));
    await waitFor(() => expect(fetchEvents).toHaveBeenLastCalledWith("2026-11-15", "2026-11-15"));
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("15일 일요일");
    await userEvent.click(screen.getByRole("button", { name: "전날" }));
    await userEvent.click(screen.getByRole("button", { name: "전날" }));
    await waitFor(() => expect(fetchEvents).toHaveBeenLastCalledWith("2026-11-13", "2026-11-13"));
    expect(window.location.search).toBe("?view=day&date=2026-11-13");
    await userEvent.click(screen.getByRole("button", { name: "오늘" }));
    expect(window.location.search).toBe("?view=day&date=2026-11-14");
  });

  it("주: an empty hour opens a new event on that day at that hour; an event opens its detail", async () => {
    vi.mocked(fetchEvents).mockResolvedValue({ events: [meeting], workStatus: "connected", personalConnected: true });
    render(<CalendarPage initialDate="2026-11-16" today="2026-11-14" initialView="week" />);
    await waitFor(() => expect(fetchEvents).toHaveBeenLastCalledWith("2026-11-15", "2026-11-21"));

    const monday = screen.getByRole("group", { name: "11월 16일 월요일" });
    await userEvent.click(await within(monday).findByText("주간 회의"));
    expect(screen.getByRole("dialog", { name: "주간 회의" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "닫기" }));

    await userEvent.click(screen.getByRole("button", { name: "11월 18일(수) 15:00에 새 일정 만들기" }));
    const dialog = screen.getByRole("dialog", { name: "새 일정" });
    expect(within(dialog).getByLabelText<HTMLInputElement>("날짜").value).toBe("2026-11-18");
    expect(within(dialog).getByLabelText<HTMLInputElement>("시작").value).toBe("15:00");
    expect(within(dialog).getByLabelText<HTMLInputElement>("끝").value).toBe("16:00");
  });

  it("주: a day header shows that day on its own", async () => {
    render(<CalendarPage initialDate="2026-11-14" today="2026-11-14" initialView="week" />);
    await userEvent.click(screen.getByRole("button", { name: "11월 12일 목요일, 하루로 보기" }));
    expect(viewRadio("일").getAttribute("aria-checked")).toBe("true");
    await waitFor(() => expect(fetchEvents).toHaveBeenLastCalledWith("2026-11-12", "2026-11-12"));
    expect(window.location.search).toBe("?view=day&date=2026-11-12");
    expect(storedView()).toBe('"day"');
  });

  it("일: an empty hour opens a new event on the shown day", async () => {
    vi.mocked(fetchEvents).mockResolvedValue({ events: [meeting], workStatus: "connected", personalConnected: true });
    render(<CalendarPage initialDate="2026-11-16" today="2026-11-14" initialView="day" />);
    expect(await screen.findByText("주간 회의")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "09:00에 새 일정 만들기" }));
    const dialog = screen.getByRole("dialog", { name: "새 일정" });
    expect(within(dialog).getByLabelText<HTMLInputElement>("날짜").value).toBe("2026-11-16");
    expect(within(dialog).getByLabelText<HTMLInputElement>("시작").value).toBe("09:00");
  });
});

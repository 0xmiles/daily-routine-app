import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEvent, EventsResponse, Todo } from "@/shared/contracts";

vi.mock("next/navigation", () => ({
  usePathname: () => "/today",
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
vi.mock("@/features/memo/client", () => ({
  fetchEventKeys: vi.fn(async () => []),
  openEventMemo: vi.fn(),
}));
vi.mock("@/features/todos/client", () => ({
  TODOS_CHANGED_EVENT: "drs:todos-changed",
  fetchTodos: vi.fn(async () => []),
  completeTodo: vi.fn(),
  uncompleteTodo: vi.fn(),
}));
vi.mock("@/features/todos/TodoSection", () => ({
  TodoSection: () => <section aria-label="오늘 할 일" />,
}));
vi.mock("@/features/todos/TodoEditorSheet", () => ({ TodoEditorSheet: () => null }));
vi.mock("@/features/todos/TodoRow", () => ({
  TodoRow: ({ todo }: { todo: Todo }) => <li>{todo.title}</li>,
}));

import { createEvent, fetchEvents } from "@/features/calendar/client";
import { fetchEventKeys } from "@/features/memo/client";
import { fetchTodos } from "@/features/todos/client";
import { TodayPage } from "./TodayPage";

const brunch: CalendarEvent = {
  id: "p1",
  calendarId: "primary",
  source: "personal",
  title: "브런치",
  busyOnly: false,
  start: "2026-11-14T12:00:00+09:00",
  end: "2026-11-14T13:00:00+09:00",
  allDay: false,
  location: "연남동",
  attendeeCount: null,
  recurringEventId: null,
  readOnly: false,
};
const busy: CalendarEvent = {
  ...brunch,
  id: "w1",
  calendarId: "work@company.com",
  source: "work",
  title: null,
  busyOnly: true,
  start: "2026-11-14T15:00:00+09:00",
  end: "2026-11-14T16:00:00+09:00",
  location: null,
  readOnly: true,
};

function todo(id: string, done = false): Todo {
  return {
    id,
    title: `할 일 ${id}`,
    scope: "personal",
    dueDate: "2026-11-14",
    dueTime: null,
    doneAt: done ? "2026-11-14T01:00:00.000Z" : null,
    recurrence: null,
    seriesId: null,
    notify: { enabled: true, offsetMin: null },
  };
}

function respond(events: CalendarEvent[], extra: Partial<EventsResponse> = {}) {
  vi.mocked(fetchEvents).mockResolvedValue({ events, workStatus: "connected", personalConnected: true, ...extra });
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-14T03:00:00Z")); // Sat 12:00 KST
});
afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  window.history.replaceState(null, "", "/today");
  vi.mocked(fetchEvents).mockReset();
  vi.mocked(fetchEventKeys).mockResolvedValue([]);
  vi.mocked(fetchTodos).mockResolvedValue([]);
});

describe("TodayPage", () => {
  it("turns to the next day at Seoul midnight while showing today", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    try {
      vi.setSystemTime(new Date("2026-11-14T14:59:50Z")); // Sat 23:59:50 KST
      respond([]);
      await act(async () => {
        render(<TodayPage initialDate="2026-11-14" today="2026-11-14" />);
      });
      expect(fetchEvents).toHaveBeenLastCalledWith("2026-11-14", "2026-11-14");
      await act(async () => {
        vi.advanceTimersByTime(30_000); // the shared clock ticks past midnight
      });
      expect(fetchEvents).toHaveBeenLastCalledWith("2026-11-15", "2026-11-15");
    } finally {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-14T03:00:00Z"));
    }
  });

  it("phones get the time ruler too: blocks show time, place and tag; busy-only shows 바쁨 and memo mark shows", async () => {
    respond([busy, brunch]); // beforeEach: narrow screen
    vi.mocked(fetchEventKeys).mockResolvedValue(["primary:p1"]);
    render(<TodayPage initialDate="2026-11-14" today="2026-11-14" />);

    const block = (await screen.findByText("브런치")).closest("button") as HTMLElement;
    expect(within(block).getByText("12:00–13:00")).toBeTruthy();
    expect(within(block).getByText("연남동")).toBeTruthy();
    expect(within(block).getByText("개인")).toBeTruthy();
    await waitFor(() => expect(within(block).getByText("메모")).toBeTruthy());

    const busyBlock = screen.getByText("바쁨").closest("button") as HTMLElement;
    expect(within(busyBlock).getByText("15:00–16:00")).toBeTruthy();
    expect(within(busyBlock).getByText("회사")).toBeTruthy();
    expect(within(busyBlock).queryByText("메모")).toBeNull();
    expect(screen.getByRole("toolbar", { name: "빈 시간에 새 일정 만들기" })).toBeTruthy();
    expect(fetchEvents).toHaveBeenCalledWith("2026-11-14", "2026-11-14");
  });

  it("summary counts events and todos", async () => {
    respond([busy, brunch]);
    vi.mocked(fetchTodos).mockResolvedValue([todo("a", true), todo("b"), todo("c"), todo("d")]);
    render(<TodayPage initialDate="2026-11-14" today="2026-11-14" />);
    await waitFor(() =>
      expect(screen.getByTestId("leaf-summary").textContent).toBe("일정 2개, 할 일 4개 중 1개 끝냄"),
    );
    expect(fetchTodos).toHaveBeenCalledWith("today");
    expect(screen.getByRole("region", { name: "오늘 할 일" })).toBeTruthy();
  });

  it("empty day says so, and that an hour can be tapped", async () => {
    respond([]);
    render(<TodayPage initialDate="2026-11-14" today="2026-11-14" />);
    expect(await screen.findByText("오늘은 일정이 없어요.")).toBeTruthy();
    expect(screen.getByText("시간대를 누르면 그 시간에 새 일정을 만들어요.")).toBeTruthy();
  });

  it("tapping an empty hour opens a new event on that day at that hour, and the day reloads after saving", async () => {
    respond([brunch]);
    render(<TodayPage initialDate="2026-11-16" today="2026-11-14" />);
    await screen.findByText("이날은 일정이 없어요.");
    const loads = vi.mocked(fetchEvents).mock.calls.length;

    await userEvent.click(screen.getByRole("button", { name: "15:00에 새 일정 만들기" }));
    const dialog = screen.getByRole("dialog", { name: "새 일정" });
    expect((within(dialog).getByLabelText("날짜") as HTMLInputElement).value).toBe("2026-11-16");
    expect((within(dialog).getByLabelText("시작") as HTMLInputElement).value).toBe("15:00");
    expect((within(dialog).getByLabelText("끝") as HTMLInputElement).value).toBe("16:00");

    await userEvent.type(within(dialog).getByLabelText("제목"), "치과");
    await userEvent.click(within(dialog).getByRole("button", { name: "일정 만들기" }));
    expect(createEvent).toHaveBeenCalledWith({
      title: "치과",
      start: "2026-11-16T15:00:00+09:00",
      end: "2026-11-16T16:00:00+09:00",
      allDay: false,
    });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "새 일정" })).toBeNull());
    await waitFor(() => expect(vi.mocked(fetchEvents).mock.calls.length).toBeGreaterThan(loads));
    expect(fetchEvents).toHaveBeenLastCalledWith("2026-11-16", "2026-11-16");
  });

  it("an hour tap without a personal calendar asks to connect it instead of showing the form", async () => {
    respond([], { personalConnected: false });
    render(<TodayPage initialDate="2026-11-14" today="2026-11-14" />);
    await screen.findByText("오늘은 일정이 없어요.");
    expect(screen.queryByText("시간대를 누르면 그 시간에 새 일정을 만들어요.")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "10:00에 새 일정 만들기" }));
    const dialog = screen.getByRole("dialog", { name: "새 일정" });
    expect(within(dialog).getByText(/개인 캘린더를 연결하면 새 일정을 추가할 수 있어요\./)).toBeTruthy();
    expect(within(dialog).queryByLabelText("제목")).toBeNull();
  });

  it("without a personal calendar it still shows work events and a quiet connect line", async () => {
    respond([busy], { personalConnected: false });
    render(<TodayPage initialDate="2026-11-14" today="2026-11-14" />);
    expect(await screen.findByText("바쁨")).toBeTruthy();
    expect(screen.getByText(/개인 캘린더를 연결하면 새 일정을 추가할 수 있어요\./)).toBeTruthy();
    expect(screen.getByRole("link", { name: "설정에서 연결하기" }).getAttribute("href")).toBe("/settings");
  });

  it("ArrowRight turns to the next day and keeps ?date= in sync", async () => {
    respond([]);
    render(<TodayPage initialDate="2026-11-14" today="2026-11-14" />);
    await screen.findByText("오늘은 일정이 없어요.");

    fireEvent.keyDown(document, { key: "ArrowRight" });
    await waitFor(() => expect(fetchEvents).toHaveBeenLastCalledWith("2026-11-15", "2026-11-15"));
    expect(window.location.search).toBe("?date=2026-11-15");
    expect(screen.getByText("15").className).toContain("sun"); // Sunday
    expect(await screen.findByText("이날은 일정이 없어요.")).toBeTruthy();
    expect(fetchTodos).toHaveBeenLastCalledWith("all");

    fireEvent.keyDown(document, { key: "ArrowLeft" });
    await waitFor(() => expect(window.location.search).toBe(""));
    expect(screen.getByText("14")).toBeTruthy();
  });

  it("swiping left turns to the next day", async () => {
    respond([]);
    const { container } = render(<TodayPage initialDate="2026-11-14" today="2026-11-14" />);
    const page = container.firstElementChild as HTMLElement;
    fireEvent.touchStart(page, { touches: [{ clientX: 300, clientY: 200 }] });
    fireEvent.touchEnd(page, { changedTouches: [{ clientX: 180, clientY: 210 }] });
    await waitFor(() => expect(window.location.search).toBe("?date=2026-11-15"));
  });

  it("a swipe that starts on an hour row still turns the page and opens nothing", async () => {
    respond([]);
    render(<TodayPage initialDate="2026-11-14" today="2026-11-14" />);
    await screen.findByText("오늘은 일정이 없어요.");
    const row = screen.getByRole("button", { name: "13:00에 새 일정 만들기" });
    fireEvent.touchStart(row, { touches: [{ clientX: 300, clientY: 200 }] });
    const notPrevented = fireEvent.touchEnd(row, { changedTouches: [{ clientX: 180, clientY: 205 }] });
    expect(notPrevented).toBe(false); // the swipe swallows the tap
    await waitFor(() => expect(window.location.search).toBe("?date=2026-11-15"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a holiday turns the leaf red and is not listed as an event", async () => {
    const holiday: CalendarEvent = {
      ...brunch,
      id: "h1",
      calendarId: "ko.south_korea#holiday@group.v.calendar.google.com",
      source: "holiday",
      title: "기독탄신일",
      start: "2026-12-25",
      end: "2026-12-26",
      allDay: true,
      location: null,
      readOnly: true,
    };
    respond([holiday]);
    render(<TodayPage initialDate="2026-12-25" today="2026-11-14" />);
    expect(await screen.findByText("기독탄신일")).toBeTruthy();
    expect(screen.getByText("25").className).toContain("sun");
    expect(await screen.findByText("이날은 일정이 없어요.")).toBeTruthy();
  });

  it("tapping an event opens its detail sheet", async () => {
    respond([brunch]);
    render(<TodayPage initialDate="2026-11-14" today="2026-11-14" />);
    await userEvent.click(await screen.findByText("브런치"));
    const dialog = screen.getByRole("dialog", { name: "브런치" });
    expect(within(dialog).getByText("11월 14일 토요일 12:00–13:00")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "수정" })).toBeTruthy();
  });
});

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEvent, Todo } from "@/shared/contracts";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/calendar",
  useRouter: () => ({ push: nav.push, replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/features/calendar/client", () => ({
  fetchEvents: vi.fn(async () => ({ events: [], workStatus: "connected", personalConnected: true })),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(async () => undefined),
}));
vi.mock("@/features/memo/client", () => ({
  fetchEventKeys: vi.fn(async () => []),
  openEventMemo: vi.fn(async (_ref: unknown, navigate: (href: string) => void) => {
    navigate("/memo?block=b1");
    return { id: "b1" };
  }),
}));

import { deleteEvent, fetchEvents } from "@/features/calendar/client";
import { fetchEventKeys, openEventMemo } from "@/features/memo/client";
import { EventDetailSheet } from "./EventDetailSheet";
import { MonthGrid } from "./MonthGrid";

const base: CalendarEvent = {
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
const weekly: CalendarEvent = {
  ...base,
  id: "w_20261116",
  calendarId: "work@company.com",
  source: "work",
  title: "주간 회의",
  start: "2026-11-16T10:00:00+09:00",
  end: "2026-11-16T11:00:00+09:00",
  location: "3층 회의실",
  attendeeCount: 6,
  recurringEventId: "w",
  readOnly: true,
};
const lastWeek: CalendarEvent = {
  ...weekly,
  id: "w_20261109",
  start: "2026-11-09T10:00:00+09:00",
  end: "2026-11-09T11:00:00+09:00",
};
const twoWeeksAgo: CalendarEvent = {
  ...weekly,
  id: "w_20261102",
  start: "2026-11-02T10:00:00+09:00",
  end: "2026-11-02T11:00:00+09:00",
};

function dueTodo(dueDate: string): Todo {
  return {
    id: `t-${dueDate}`,
    title: "보고서",
    scope: "work",
    dueDate,
    dueTime: null,
    doneAt: null,
    recurrence: null,
    seriesId: null,
    notify: { enabled: true, offsetMin: null },
  };
}

function renderGrid(props: Partial<Parameters<typeof MonthGrid>[0]> = {}) {
  return render(
    <MonthGrid
      month="2026-11"
      today="2026-11-14"
      selected="2026-11-14"
      events={[]}
      todos={[]}
      onSelect={() => {}}
      {...props}
    />,
  );
}

const dayButton = (name: RegExp) => screen.getByRole("button", { name });

beforeEach(() => {
  vi.mocked(fetchEventKeys).mockResolvedValue([]);
  vi.mocked(fetchEvents).mockClear();
  vi.mocked(openEventMemo).mockClear();
  nav.push.mockClear();
});

describe("MonthGrid", () => {
  it("november 2026 starts on sunday column", () => {
    renderGrid();
    const headers = screen.getAllByTestId("weekday").map((el) => el.textContent);
    expect(headers).toEqual(["일", "월", "화", "수", "목", "금", "토"]);
    const days = within(screen.getByRole("group", { name: "2026년 11월" })).getAllByRole("button");
    expect(days).toHaveLength(35); // Nov 1 (Sun) … Dec 5 (Sat)
    expect(days[0].textContent).toBe("1");
    expect(days[0].getAttribute("aria-label")).toMatch(/^11월 1일 일요일/);
    expect(days[0].className).toContain("sun");
    expect(days[0].className).not.toContain("outside");
    expect(days[6].className).toContain("sat"); // Nov 7
    expect(days[30].className).toContain("outside"); // Dec 1
  });

  it("today has marker class", () => {
    renderGrid({ selected: "2026-11-20" });
    const today = dayButton(/^11월 14일 토요일/);
    expect(today.className).toContain("today");
    expect(today.getAttribute("aria-current")).toBe("date");
    expect(dayButton(/^11월 13일/).className).not.toContain("today");
  });

  it("holiday cell is red", () => {
    const holiday: CalendarEvent = {
      ...base,
      id: "h",
      source: "holiday",
      title: "임시공휴일",
      start: "2026-11-18",
      end: "2026-11-19",
      allDay: true,
      readOnly: true,
    };
    renderGrid({ events: [holiday] });
    expect(dayButton(/^11월 18일 수요일/).className).toContain("sun");
  });

  it("marks work (filled), personal (outline) and todo due (square), at most three", () => {
    const work = (id: string) => ({ ...weekly, id, recurringEventId: null });
    renderGrid({
      events: [base, work("a"), work("b"), work("c"), { ...weekly, id: "d", start: "2026-11-14T15:00:00+09:00", end: "2026-11-14T16:00:00+09:00" }],
      todos: [dueTodo("2026-11-16"), dueTodo("2026-11-14")],
    });
    const marks = (re: RegExp) =>
      Array.from(dayButton(re).querySelectorAll("[data-mark]")).map((el) => el.getAttribute("data-mark"));
    expect(marks(/^11월 16일/)).toEqual(["work", "work", "todo"]);
    expect(marks(/^11월 14일/)).toEqual(["work", "personal", "todo"]);
    expect(marks(/^11월 15일/)).toEqual([]);
  });

  it("selecting a day calls onSelect; arrow keys move by day and week", async () => {
    const onSelect = vi.fn();
    renderGrid({ onSelect });
    await userEvent.click(dayButton(/^11월 20일/));
    expect(onSelect).toHaveBeenLastCalledWith("2026-11-20");
    dayButton(/^11월 14일/).focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(onSelect).toHaveBeenLastCalledWith("2026-11-21");
    await userEvent.keyboard("{ArrowLeft}");
    expect(onSelect).toHaveBeenLastCalledWith("2026-11-13");
  });
});

describe("EventDetailSheet", () => {
  it("work event sheet has no edit buttons", async () => {
    render(<EventDetailSheet event={weekly} events={[weekly]} onClose={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: "주간 회의" });
    expect(within(dialog).getByText("회사 일정은 읽기 전용이에요. 메모는 이 앱에만 저장돼요.")).toBeTruthy();
    expect(within(dialog).getByText("3층 회의실")).toBeTruthy();
    expect(within(dialog).getByText("6")).toBeTruthy();
    expect(within(dialog).getByText("회사")).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "수정" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "삭제" })).toBeNull();
    expect(within(dialog).getByRole("button", { name: "메모 쓰기" })).toBeTruthy();
  });

  it("personal event sheet can edit and delete", async () => {
    const onChanged = vi.fn();
    const onClose = vi.fn();
    render(<EventDetailSheet event={base} onClose={onClose} onChanged={onChanged} />);
    expect(screen.getByRole("button", { name: "수정" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "삭제" }));
    await userEvent.click(screen.getByRole("button", { name: "일정 삭제하기" }));
    expect(deleteEvent).toHaveBeenCalledWith("p1");
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onChanged).toHaveBeenCalled();
  });

  it("수정 opens the editor filled with the event", async () => {
    render(<EventDetailSheet event={base} onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "수정" }));
    const editor = screen.getByRole("dialog", { name: "일정 고치기" });
    expect((within(editor).getByLabelText("제목") as HTMLInputElement).value).toBe("브런치");
    expect((within(editor).getByLabelText("시작") as HTMLInputElement).value).toBe("12:00");
  });

  it("memo button label switches when key exists", async () => {
    const { unmount } = render(<EventDetailSheet event={weekly} events={[weekly]} onClose={() => {}} />);
    expect(await screen.findByRole("button", { name: "메모 쓰기" })).toBeTruthy();
    unmount();

    vi.mocked(fetchEventKeys).mockResolvedValue(["work@company.com:w_20261116"]);
    render(<EventDetailSheet event={weekly} events={[weekly]} onClose={() => {}} />);
    expect(await screen.findByRole("button", { name: "메모 보기" })).toBeTruthy();
  });

  it("메모 쓰기 opens the event's memo block", async () => {
    const onClose = vi.fn();
    render(<EventDetailSheet event={weekly} events={[weekly]} onClose={onClose} />);
    await userEvent.click(await screen.findByRole("button", { name: "메모 쓰기" }));
    expect(openEventMemo).toHaveBeenCalledWith(
      expect.objectContaining({ eventKey: "work@company.com:w_20261116", source: "work", title: "주간 회의", recurringEventId: "w" }),
      expect.any(Function),
    );
    expect(nav.push).toHaveBeenCalledWith("/memo?block=b1");
    expect(onClose).toHaveBeenCalled();
  });

  it("지난 회의 메모 보기 uses the previous instance's eventKey", async () => {
    vi.mocked(fetchEventKeys).mockResolvedValue(["work@company.com:w_20261109", "work@company.com:w_20261102"]);
    render(<EventDetailSheet event={weekly} events={[twoWeeksAgo, weekly, lastWeek]} onClose={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: "지난 회의 메모 보기" }));
    expect(openEventMemo).toHaveBeenCalledWith(
      expect.objectContaining({ eventKey: "work@company.com:w_20261109" }),
      expect.any(Function),
    );
  });

  it("hides 지난 회의 메모 보기 when there is no previous instance with a memo", async () => {
    render(<EventDetailSheet event={weekly} events={[weekly, lastWeek]} onClose={() => {}} />);
    await screen.findByRole("button", { name: "메모 쓰기" });
    expect(screen.queryByRole("button", { name: "지난 회의 메모 보기" })).toBeNull();
  });

  it("looks further back when the previous instance wasn't loaded", async () => {
    vi.mocked(fetchEventKeys).mockResolvedValue(["work@company.com:w_20261109"]);
    vi.mocked(fetchEvents).mockResolvedValueOnce({ events: [lastWeek], workStatus: "connected", personalConnected: true });
    render(<EventDetailSheet event={weekly} events={[weekly]} onClose={() => {}} />);
    expect(await screen.findByRole("button", { name: "지난 회의 메모 보기" })).toBeTruthy();
    expect(fetchEvents).toHaveBeenCalledWith("2026-10-12", "2026-11-15");
  });

  it("busy-only work event is titled 회사 일정", () => {
    render(<EventDetailSheet event={{ ...weekly, title: null, busyOnly: true, location: null }} onClose={() => {}} />);
    expect(screen.getByRole("dialog", { name: "회사 일정" })).toBeTruthy();
    expect(screen.getByText(/바쁨으로만 공유된 일정이에요/)).toBeTruthy();
  });

  it("holiday has no memo or edit buttons", () => {
    render(
      <EventDetailSheet
        event={{ ...base, source: "holiday", title: "기독탄신일", start: "2026-12-25", end: "2026-12-26", allDay: true, readOnly: true }}
        onClose={() => {}}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "기독탄신일" });
    expect(within(dialog).getByText("12월 25일 금요일 종일")).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: /메모/ })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "수정" })).toBeNull();
  });
});

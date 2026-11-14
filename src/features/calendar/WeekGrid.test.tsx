import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CalendarEvent } from "@/shared/contracts";
import { WeekGrid, weekDays } from "./WeekGrid";

const base: CalendarEvent = {
  id: "p1",
  calendarId: "primary",
  source: "personal",
  title: "점심",
  busyOnly: false,
  start: "2026-11-16T12:00:00+09:00",
  end: "2026-11-16T13:00:00+09:00",
  allDay: false,
  location: null,
  attendeeCount: null,
  recurringEventId: null,
  readOnly: false,
};

const DAYS = weekDays("2026-11-18");

function renderWeek(events: CalendarEvent[], today = "2026-11-18") {
  const handlers = { onOpen: vi.fn(), onCreate: vi.fn(), onPickDay: vi.fn() };
  render(<WeekGrid days={DAYS} today={today} events={events} now={null} memoKeys={new Set()} {...handlers} />);
  return handlers;
}

describe("weekDays", () => {
  it("is the Sunday-first week around a day, like the month grid", () => {
    expect(weekDays("2026-11-18")).toEqual([
      "2026-11-15",
      "2026-11-16",
      "2026-11-17",
      "2026-11-18",
      "2026-11-19",
      "2026-11-20",
      "2026-11-21",
    ]);
    expect(weekDays("2026-11-15")[0]).toBe("2026-11-15");
    expect(weekDays("2026-11-21")[0]).toBe("2026-11-15");
  });
});

describe("WeekGrid", () => {
  it("heads each column with the weekday and date; today is marked, 일 and holidays red, 토 blue", () => {
    const holiday: CalendarEvent = {
      ...base,
      id: "h1",
      source: "holiday",
      calendarId: "holiday",
      title: "임시공휴일",
      start: "2026-11-17",
      end: "2026-11-18",
      allDay: true,
    };
    const { onPickDay } = renderWeek([holiday]);
    const sunday = screen.getByRole("button", { name: "11월 15일 일요일, 하루로 보기" });
    expect(sunday.className).toContain("sun");
    expect(sunday.textContent).toBe("일15");
    expect(screen.getByRole("button", { name: "11월 21일 토요일, 하루로 보기" }).className).toContain("sat");
    expect(screen.getByRole("button", { name: "11월 17일 화요일, 임시공휴일, 하루로 보기" }).className).toContain("sun");
    expect(within(screen.getByRole("list", { name: "11월 17일 화요일 종일" })).getByText("임시공휴일")).toBeTruthy();

    const today = screen.getByRole("button", { name: "11월 18일 수요일, 하루로 보기" });
    expect(today.getAttribute("aria-current")).toBe("date");
    expect(today.className).toContain("today");
    expect(today.getAttribute("style")).toContain("--hue: var(--aqua)");
    sunday.click();
    expect(onPickDay).toHaveBeenCalledWith("2026-11-15");
  });

  it("puts timed events in their day's column, side by side when they overlap; all-day ones go in the 종일 row", async () => {
    const meeting = {
      ...base,
      id: "w1",
      source: "work" as const,
      title: "회의",
      start: "2026-11-16T12:30:00+09:00",
      end: "2026-11-16T14:00:00+09:00",
    };
    const trip = { ...base, id: "a1", title: "출장", start: "2026-11-19", end: "2026-11-21", allDay: true };
    const { onOpen, onCreate } = renderWeek([base, meeting, trip]);

    const monday = screen.getByRole("group", { name: "11월 16일 월요일" });
    const lunch = within(monday).getByRole("button", { name: "점심, 12:00–13:00, 개인" });
    const work = within(monday).getByRole("button", { name: "회의, 12:30–14:00, 회사" });
    expect(work.className).toContain("work");
    expect((lunch.parentElement as HTMLElement).style.width).toContain("50%");
    expect(within(screen.getByRole("group", { name: "11월 17일 화요일" })).queryAllByRole("button", { name: /, 개인$/ })).toHaveLength(0);

    expect(within(screen.getByRole("list", { name: "11월 19일 목요일 종일" })).getByText("출장")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "11월 20일 금요일 종일" })).getByText("출장")).toBeTruthy();

    await userEvent.click(lunch);
    expect(onOpen).toHaveBeenCalledWith(base);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("an empty hour cell starts a new event on that day at that hour", async () => {
    const { onCreate } = renderWeek([]);
    const tuesday = screen.getByRole("group", { name: "11월 17일 화요일" });
    const cells = within(tuesday).getAllByRole("button");
    expect(cells[0].getAttribute("aria-label")).toBe("11월 17일(화) 09:00에 새 일정 만들기");
    expect(cells[cells.length - 1].getAttribute("aria-label")).toBe("11월 17일(화) 20:00에 새 일정 만들기");
    await userEvent.click(within(tuesday).getByRole("button", { name: "11월 17일(화) 15:00에 새 일정 만들기" }));
    expect(onCreate).toHaveBeenCalledWith("2026-11-17", "15:00");
  });

  it("the hour cells are one tab stop, starting at today; arrows move by hour and by day", async () => {
    renderWeek([]);
    const tabbable = screen
      .getAllByRole("button", { name: /에 새 일정 만들기$/ })
      .filter((b) => b.tabIndex === 0)
      .map((b) => b.getAttribute("aria-label"));
    expect(tabbable).toEqual(["11월 18일(수) 09:00에 새 일정 만들기"]);

    screen.getByRole("button", { name: "11월 18일(수) 09:00에 새 일정 만들기" }).focus();
    await userEvent.keyboard("{ArrowDown}{ArrowRight}");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("11월 19일(목) 10:00에 새 일정 만들기");
    expect((document.activeElement as HTMLButtonElement).tabIndex).toBe(0);
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}{End}");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("11월 17일(화) 20:00에 새 일정 만들기");
    await userEvent.keyboard("{Home}");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("11월 17일(화) 09:00에 새 일정 만들기");
  });

  it("widens the hours for the whole week to fit every event", () => {
    renderWeek([{ ...base, start: "2026-11-20T07:00:00+09:00", end: "2026-11-20T08:00:00+09:00" }]);
    const sunday = screen.getByRole("group", { name: "11월 15일 일요일" });
    expect(within(sunday).getAllByRole("button")[0].getAttribute("aria-label")).toBe(
      "11월 15일(일) 07:00에 새 일정 만들기",
    );
  });
});

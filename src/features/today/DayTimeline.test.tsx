import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CalendarEvent } from "@/shared/contracts";
import { DayTimeline } from "./DayTimeline";

const lunch: CalendarEvent = {
  id: "p1",
  calendarId: "primary",
  source: "personal",
  title: "점심",
  busyOnly: false,
  start: "2026-11-16T12:00:00+09:00",
  end: "2026-11-16T13:00:00+09:00",
  allDay: false,
  location: "연남동",
  attendeeCount: null,
  recurringEventId: null,
  readOnly: false,
};

const NO_KEYS: ReadonlySet<string> = new Set();

function renderTimeline(events: CalendarEvent[], handlers: { onOpen?: () => void; onCreate?: (t: string) => void } = {}) {
  const onOpen = handlers.onOpen ?? vi.fn();
  const onCreate = "onCreate" in handlers ? handlers.onCreate : vi.fn();
  render(
    <DayTimeline date="2026-11-16" events={events} now={null} memoKeys={NO_KEYS} onOpen={onOpen} onCreate={onCreate} />,
  );
  return { onOpen, onCreate };
}

const rowNames = () =>
  within(screen.getByRole("toolbar", { name: "빈 시간에 새 일정 만들기" }))
    .getAllByRole("button")
    .map((b) => b.getAttribute("aria-label"));

describe("DayTimeline", () => {
  it("has one button per hour, 09:00 to 20:00, that starts a new event at that hour", async () => {
    const { onCreate } = renderTimeline([]);
    const names = rowNames();
    expect(names[0]).toBe("09:00에 새 일정 만들기");
    expect(names[names.length - 1]).toBe("20:00에 새 일정 만들기");
    expect(names).toHaveLength(12);

    await userEvent.click(screen.getByRole("button", { name: "15:00에 새 일정 만들기" }));
    expect(onCreate).toHaveBeenCalledWith("15:00");
  });

  it("widens with the events, so early and late hours can be tapped too", () => {
    renderTimeline([
      { ...lunch, id: "a", start: "2026-11-16T07:30:00+09:00", end: "2026-11-16T08:00:00+09:00" },
      { ...lunch, id: "b", start: "2026-11-16T22:00:00+09:00", end: "2026-11-16T23:30:00+09:00" },
    ]);
    const names = rowNames();
    expect(names[0]).toBe("07:00에 새 일정 만들기");
    expect(names[names.length - 1]).toBe("23:00에 새 일정 만들기");
  });

  it("event blocks stay on top and open the event, not a new one", async () => {
    const { onOpen, onCreate } = renderTimeline([lunch]);
    await userEvent.click(screen.getByText("점심"));
    expect(onOpen).toHaveBeenCalledWith(lunch);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("an hour-long block shows its time, place and 개인 on one line", () => {
    renderTimeline([lunch]);
    const block = screen.getByText("점심").closest("button") as HTMLElement;
    expect(block.className).toContain("oneLine");
    expect(within(block).getByText("12:00–13:00")).toBeTruthy();
    expect(within(block).getByText("연남동")).toBeTruthy();
    expect(within(block).getByText("개인")).toBeTruthy();
  });

  it("the hour rows are one tab stop; arrow keys, Home and End move between hours", async () => {
    renderTimeline([]);
    const tabbable = within(screen.getByRole("toolbar")).getAllByRole("button").filter((b) => b.tabIndex === 0);
    expect(tabbable.map((b) => b.getAttribute("aria-label"))).toEqual(["09:00에 새 일정 만들기"]);

    await userEvent.tab();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("09:00에 새 일정 만들기");
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("11:00에 새 일정 만들기");
    expect((document.activeElement as HTMLButtonElement).tabIndex).toBe(0);
    await userEvent.keyboard("{End}");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("20:00에 새 일정 만들기");
    await userEvent.keyboard("{ArrowDown}{Home}{ArrowUp}");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("09:00에 새 일정 만들기");
  });

  it("without onCreate the ruler is read-only", () => {
    renderTimeline([lunch], { onCreate: undefined });
    expect(screen.queryByRole("toolbar")).toBeNull();
    expect(screen.queryByRole("button", { name: /새 일정 만들기/ })).toBeNull();
  });
});

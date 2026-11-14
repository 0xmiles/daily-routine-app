import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@/shared/contracts";
import { hourRange, hoursBetween, place, span } from "./timeline";

function timed(id: string, start: string, end: string): CalendarEvent {
  return {
    id,
    calendarId: "primary",
    source: "personal",
    title: id,
    busyOnly: false,
    start,
    end,
    allDay: false,
    location: null,
    attendeeCount: null,
    recurringEventId: null,
    readOnly: false,
  };
}

const DATE = "2026-11-16";

describe("span", () => {
  it("clips to the day and lasts at least 15 minutes", () => {
    expect(span(timed("a", "2026-11-15T22:00:00+09:00", "2026-11-16T02:00:00+09:00"), DATE)).toEqual({
      start: 0,
      end: 120,
    });
    expect(span(timed("b", "2026-11-16T23:00:00+09:00", "2026-11-17T01:00:00+09:00"), DATE)).toEqual({
      start: 1380,
      end: 1440,
    });
    expect(span(timed("c", "2026-11-16T10:00:00+09:00", "2026-11-16T10:00:00+09:00"), DATE)).toEqual({
      start: 600,
      end: 615,
    });
  });
});

describe("place", () => {
  it("puts overlapping events in side-by-side lanes and lets the next cluster start over", () => {
    const placed = place(
      [
        timed("late", "2026-11-16T16:00:00+09:00", "2026-11-16T17:00:00+09:00"),
        timed("b", "2026-11-16T12:30:00+09:00", "2026-11-16T13:30:00+09:00"),
        timed("a", "2026-11-16T12:00:00+09:00", "2026-11-16T13:00:00+09:00"),
      ],
      DATE,
    );
    expect(placed.map((p) => [p.event.id, p.lane, p.lanes])).toEqual([
      ["a", 0, 2],
      ["b", 1, 2],
      ["late", 0, 1],
    ]);
  });
});

describe("hourRange", () => {
  it("is 09–21 unless an event needs more", () => {
    expect(hourRange([])).toEqual({ startHour: 9, endHour: 21 });
    const placed = place(
      [
        timed("early", "2026-11-16T07:30:00+09:00", "2026-11-16T08:00:00+09:00"),
        timed("late", "2026-11-16T21:00:00+09:00", "2026-11-16T22:30:00+09:00"),
      ],
      DATE,
    );
    expect(hourRange(placed)).toEqual({ startHour: 7, endHour: 23 });
    expect(hoursBetween(7, 9)).toEqual([7, 8, 9]);
  });
});

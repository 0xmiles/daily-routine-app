import { describe, expect, it } from "vitest";
import type { Recurrence, Todo } from "@/shared/contracts";
import { firstOccurrence, nextOccurrence, notifyAt, occursOn, sortForList, todayBucket } from "./rules";

const DEFAULTS = { defaultOffsetMin: 30, dateOnlyNotifyTime: "09:00" };

function todo(partial: Partial<Todo> = {}): Todo {
  return {
    id: partial.id ?? "t1",
    title: "보고서 제출",
    scope: "personal",
    dueDate: null,
    dueTime: null,
    doneAt: null,
    recurrence: null,
    seriesId: null,
    notify: { enabled: true, offsetMin: null },
    ...partial,
  };
}

describe("todayBucket", () => {
  it("overdue uses Seoul date", () => {
    // 2026-11-14T15:30Z is 2026-11-15 00:30 in Seoul.
    const now = new Date("2026-11-14T15:30:00Z");
    expect(todayBucket(todo({ dueDate: "2026-11-14" }), now)).toBe("overdue");
    expect(todayBucket(todo({ dueDate: "2026-11-15" }), now)).toBe("today");
  });

  it("due time passed today is overdue", () => {
    // 09:30Z = 18:30 KST
    const now = new Date("2026-11-14T09:30:00Z");
    expect(todayBucket(todo({ dueDate: "2026-11-14", dueTime: "18:00" }), now)).toBe("overdue");
  });

  it("due time later today is today", () => {
    const now = new Date("2026-11-14T08:30:00Z"); // 17:30 KST
    expect(todayBucket(todo({ dueDate: "2026-11-14", dueTime: "18:00" }), now)).toBe("today");
  });

  it("future date is upcoming, no date is nodate, done wins", () => {
    const now = new Date("2026-11-14T03:00:00Z");
    expect(todayBucket(todo({ dueDate: "2026-11-16" }), now)).toBe("upcoming");
    expect(todayBucket(todo(), now)).toBe("nodate");
    expect(todayBucket(todo({ dueDate: "2026-11-01", doneAt: "2026-11-14T01:00:00.000Z" }), now)).toBe("done");
  });
});

describe("nextOccurrence", () => {
  it("weekly next occurrence", () => {
    expect(nextOccurrence({ freq: "weekly", weekdays: [6] }, "2026-11-14")).toBe("2026-11-21");
  });

  it("monthly day 31 clamps", () => {
    expect(nextOccurrence({ freq: "monthly", day: 31 }, "2026-11-14")).toBe("2026-11-30");
  });

  it("daily is the next calendar day", () => {
    expect(nextOccurrence({ freq: "daily" }, "2026-11-30")).toBe("2026-12-01");
  });

  it("weekly picks the nearest of several weekdays", () => {
    // 2026-11-14 is Saturday; Monday and Wednesday → Monday 16th.
    expect(nextOccurrence({ freq: "weekly", weekdays: [3, 1] }, "2026-11-14")).toBe("2026-11-16");
  });

  it("monthly rolls into the next month (and the next year)", () => {
    expect(nextOccurrence({ freq: "monthly", day: 31 }, "2026-11-30")).toBe("2026-12-31");
    expect(nextOccurrence({ freq: "monthly", day: 5 }, "2026-12-05")).toBe("2027-01-05");
    expect(nextOccurrence({ freq: "monthly", day: 30 }, "2027-01-30")).toBe("2027-02-28");
  });

  it("firstOccurrence includes the start date when it matches", () => {
    const sat: Recurrence = { freq: "weekly", weekdays: [6] };
    expect(occursOn(sat, "2026-11-14")).toBe(true);
    expect(firstOccurrence(sat, "2026-11-14")).toBe("2026-11-14");
    expect(firstOccurrence(sat, "2026-11-15")).toBe("2026-11-21");
  });
});

describe("notifyAt", () => {
  it("notifyAt with time", () => {
    const at = notifyAt(todo({ dueDate: "2026-11-16", dueTime: "18:00" }), DEFAULTS);
    expect(at?.toISOString()).toBe("2026-11-16T08:30:00.000Z");
  });

  it("notifyAt date only", () => {
    const at = notifyAt(todo({ dueDate: "2026-11-16" }), DEFAULTS);
    expect(at?.toISOString()).toBe("2026-11-16T00:00:00.000Z");
  });

  it("notifyAt disabled returns null", () => {
    const disabled = todo({ dueDate: "2026-11-16", dueTime: "18:00", notify: { enabled: false, offsetMin: null } });
    expect(notifyAt(disabled, DEFAULTS)).toBeNull();
  });

  it("uses the todo's own offset and the settings defaults", () => {
    const own = todo({ dueDate: "2026-11-16", dueTime: "18:00", notify: { enabled: true, offsetMin: 60 } });
    expect(notifyAt(own, DEFAULTS)?.toISOString()).toBe("2026-11-16T08:00:00.000Z");
    const settings = { defaultOffsetMin: 10, dateOnlyNotifyTime: "08:00" };
    expect(notifyAt(todo({ dueDate: "2026-11-16", dueTime: "18:00" }), settings)?.toISOString()).toBe(
      "2026-11-16T08:50:00.000Z",
    );
    expect(notifyAt(todo({ dueDate: "2026-11-16" }), settings)?.toISOString()).toBe("2026-11-15T23:00:00.000Z");
  });

  it("returns null without a due date or once done", () => {
    expect(notifyAt(todo(), DEFAULTS)).toBeNull();
    expect(notifyAt(todo({ dueDate: "2026-11-16", doneAt: "2026-11-14T01:00:00.000Z" }), DEFAULTS)).toBeNull();
  });
});

describe("sortForList", () => {
  it("orders overdue, today, upcoming, nodate, then done", () => {
    const now = new Date("2026-11-14T03:00:00Z"); // 12:00 KST
    const list = [
      todo({ id: "nodate" }),
      todo({ id: "upcoming-late", dueDate: "2026-11-20" }),
      todo({ id: "done", dueDate: "2026-11-14", doneAt: "2026-11-14T01:00:00.000Z" }),
      todo({ id: "today-dateonly", dueDate: "2026-11-14" }),
      todo({ id: "today-18", dueDate: "2026-11-14", dueTime: "18:00" }),
      todo({ id: "overdue-old", dueDate: "2026-11-10" }),
      todo({ id: "overdue-recent", dueDate: "2026-11-13" }),
      todo({ id: "upcoming-soon", dueDate: "2026-11-16", dueTime: "09:00" }),
    ];
    expect(sortForList(list, now).map((t) => t.id)).toEqual([
      "overdue-old",
      "overdue-recent",
      "today-18",
      "today-dateonly",
      "upcoming-soon",
      "upcoming-late",
      "nodate",
      "done",
    ]);
  });
});

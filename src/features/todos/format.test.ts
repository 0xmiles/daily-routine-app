import { describe, expect, it } from "vitest";
import type { Todo } from "@/shared/contracts";
import { dueLabel, recurrenceLabel, splitNumbers } from "./format";

function todo(partial: Partial<Todo> = {}): Todo {
  return {
    id: "t1",
    title: "x",
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

// 2026-11-14 (Sat) 12:00 KST
const NOW = new Date("2026-11-14T03:00:00Z");

describe("recurrenceLabel", () => {
  it("names daily, weekly and monthly", () => {
    expect(recurrenceLabel({ freq: "daily" })).toBe("매일");
    expect(recurrenceLabel({ freq: "weekly", weekdays: [6] })).toBe("매주 토");
    expect(recurrenceLabel({ freq: "weekly", weekdays: [0, 1, 3] })).toBe("매주 월, 수, 일");
    expect(recurrenceLabel({ freq: "weekly", weekdays: [1, 2, 3, 4, 5] })).toBe("평일마다");
    expect(recurrenceLabel({ freq: "monthly", day: 5 })).toBe("매월 5일");
  });
});

describe("dueLabel", () => {
  it("late todos say how late, in the late style", () => {
    expect(dueLabel(todo({ dueDate: "2026-11-13" }), NOW)).toEqual({ text: "어제까지", late: true });
    expect(dueLabel(todo({ dueDate: "2026-11-11" }), NOW)).toEqual({ text: "3일 전까지", late: true });
    expect(dueLabel(todo({ dueDate: "2026-11-14", dueTime: "09:00" }), NOW)).toEqual({ text: "09:00까지", late: true });
  });

  it("today shows the time, other days the day and time", () => {
    expect(dueLabel(todo({ dueDate: "2026-11-14", dueTime: "18:00" }), NOW)).toEqual({ text: "18:00", late: false });
    expect(dueLabel(todo({ dueDate: "2026-11-14" }), NOW)).toEqual({ text: "오늘", late: false });
    expect(dueLabel(todo({ dueDate: "2026-11-15" }), NOW)?.text).toBe("내일");
    expect(dueLabel(todo({ dueDate: "2026-11-15", dueTime: "08:00" }), NOW)?.text).toBe("내일 08:00");
    expect(dueLabel(todo({ dueDate: "2026-11-16", dueTime: "18:00" }), NOW)?.text).toBe("16일 18:00");
    expect(dueLabel(todo({ dueDate: "2026-12-03" }), NOW)?.text).toBe("12월 3일");
    expect(dueLabel(todo({ dueDate: "2027-01-03" }), NOW)?.text).toBe("2027년 1월 3일");
  });

  it("recurring todos show the rule", () => {
    expect(dueLabel(todo({ dueDate: "2026-11-14", recurrence: { freq: "weekly", weekdays: [6] } }), NOW)?.text).toBe(
      "매주 토",
    );
    expect(dueLabel(todo({ dueDate: "2026-11-15", dueTime: "07:00", recurrence: { freq: "daily" } }), NOW)?.text).toBe(
      "매일 07:00",
    );
  });

  it("undated todos have no label; done ones are never late", () => {
    expect(dueLabel(todo(), NOW)).toBeNull();
    expect(dueLabel(todo({ dueDate: "2026-11-13", doneAt: "2026-11-14T01:00:00.000Z" }), NOW)).toEqual({
      text: "13일",
      late: false,
    });
  });
});

describe("splitNumbers", () => {
  it("separates digit runs for the number font", () => {
    expect(splitNumbers("16일 18:00")).toEqual([
      { text: "16", num: true },
      { text: "일 ", num: false },
      { text: "18:00", num: true },
    ]);
    expect(splitNumbers("어제까지")).toEqual([{ text: "어제까지", num: false }]);
  });
});

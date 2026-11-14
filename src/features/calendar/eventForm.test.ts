import { describe, expect, it } from "vitest";
import { buildEventInput, followEnd, oneHourAfter, shortKoreanDay } from "./eventForm";

describe("oneHourAfter", () => {
  it("adds an hour and stops at midnight", () => {
    expect(oneHourAfter("15:00")).toBe("16:00");
    expect(oneHourAfter("09:30")).toBe("10:30");
    expect(oneHourAfter("23:00")).toBe("00:00");
    expect(oneHourAfter("23:30")).toBe("00:00");
    expect(oneHourAfter("")).toBe("");
  });
});

describe("followEnd", () => {
  it("keeps the length when the start moves", () => {
    expect(followEnd("15:00", "16:00", "17:00")).toBe("18:00");
    expect(followEnd("15:00", "16:30", "09:00")).toBe("10:30");
    expect(followEnd("23:00", "00:00", "10:00")).toBe("11:00");
  });

  it("stops at midnight, and leaves the end alone while a field is empty", () => {
    expect(followEnd("15:00", "17:00", "23:00")).toBe("00:00");
    expect(followEnd("15:00", "16:00", "")).toBe("16:00");
    expect(followEnd("", "16:00", "10:00")).toBe("16:00");
  });

  it("an end before the start counts as an hour", () => {
    expect(followEnd("15:00", "14:00", "10:00")).toBe("11:00");
  });

  it("whatever it gives passes the form's checks", () => {
    for (const start of ["00:00", "08:15", "22:45", "23:00", "23:59"]) {
      const end = followEnd("15:00", "16:00", start);
      const form = { title: "x", date: "2026-11-16", allDay: false, startTime: start, endTime: end, spanDays: 0, memo: "" };
      expect(buildEventInput(form)).not.toHaveProperty("error");
    }
  });
});

describe("shortKoreanDay", () => {
  it("writes the month, day and weekday", () => {
    expect(shortKoreanDay("2026-11-16")).toBe("11월 16일(월)");
    expect(shortKoreanDay("2026-11-14")).toBe("11월 14일(토)");
  });
});

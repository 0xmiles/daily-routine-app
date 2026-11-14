import { describe, expect, it } from "vitest";
import {
  addDays,
  formatKoreanDate,
  formatKoreanTimestamp,
  seoulDateTimeToDate,
  seoulParts,
  seoulToday,
  weekdayOf,
} from "./time";

describe("time (Asia/Seoul)", () => {
  it("seoulToday crosses midnight in Seoul before UTC does", () => {
    expect(seoulToday(new Date("2026-11-14T15:30:00Z"))).toBe("2026-11-15");
    expect(seoulToday(new Date("2026-11-14T14:59:59Z"))).toBe("2026-11-14");
  });

  it("formatKoreanDate", () => {
    expect(formatKoreanDate("2026-11-14")).toBe("11월 14일 토요일");
    expect(formatKoreanDate("2026-11-15")).toBe("11월 15일 일요일");
  });

  it("seoulDateTimeToDate", () => {
    expect(seoulDateTimeToDate("2026-11-16", "09:00").toISOString()).toBe("2026-11-16T00:00:00.000Z");
    expect(seoulDateTimeToDate("2026-11-16", "00:30").toISOString()).toBe("2026-11-15T15:30:00.000Z");
  });

  it("formatKoreanTimestamp", () => {
    expect(formatKoreanTimestamp("2026-11-14T00:12:00Z")).toBe("11월 14일 오전 9:12");
    expect(formatKoreanTimestamp("2026-11-14T03:05:00Z")).toBe("11월 14일 오후 12:05");
    expect(formatKoreanTimestamp("2026-11-14T15:00:00Z")).toBe("11월 15일 오전 12:00");
    expect(formatKoreanTimestamp("2026-11-14T22:40:00+09:00")).toBe("11월 14일 오후 10:40");
  });

  it("seoulParts", () => {
    expect(seoulParts(new Date("2026-11-14T15:30:00Z"))).toEqual({ date: "2026-11-15", time: "00:30", weekday: 0 });
    expect(seoulParts(new Date("2026-11-14T09:05:00Z"))).toEqual({ date: "2026-11-14", time: "18:05", weekday: 6 });
  });

  it("addDays crosses month and year boundaries", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-11-14", 0)).toBe("2026-11-14");
  });

  it("weekdayOf (0 = Sunday)", () => {
    expect(weekdayOf("2026-11-14")).toBe(6);
    expect(weekdayOf("2026-11-15")).toBe(0);
    expect(weekdayOf("2026-11-16")).toBe(1);
  });
});

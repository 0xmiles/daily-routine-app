import { describe, expect, it } from "vitest";
import type { EventRef } from "@/shared/contracts";
import { formatMemoTime, memoPreview, memoTitle, plainLine } from "./format";

const ref: EventRef = {
  eventKey: "c:e",
  calendarId: "c",
  eventId: "e",
  recurringEventId: null,
  source: "personal",
  title: "치과",
  start: "2026-11-16T10:00:00+09:00",
  end: "2026-11-16T11:00:00+09:00",
  allDay: false,
  deleted: false,
};

describe("memo file names and previews", () => {
  it("plainLine drops indent, list markers and bold markers", () => {
    expect(plainLine("    - **급함** 보고서")).toBe("급함 보고서");
    expect(plainLine("12. 둘째")).toBe("둘째");
    expect(plainLine("- ")).toBe("");
    expect(plainLine("-")).toBe("");
  });

  it("plainLine drops a heading's # and turns a --- divider into nothing", () => {
    expect(plainLine("## 회의")).toBe("회의");
    expect(plainLine("# **급함**")).toBe("급함");
    expect(plainLine("#### 넷")).toBe("#### 넷");
    expect(plainLine("---")).toBe("");
    expect(plainLine("-----  ")).toBe("");
  });

  it("names a memo after its first text line, past dividers and without #", () => {
    const memo = { content: "---\n# 이름\n본문\n---\n## 둘째", eventRef: null };
    expect(memoTitle(memo)).toBe("이름");
    expect(memoPreview(memo)).toBe("본문 둘째");
  });

  it("the first line with text is the title; the rest is the preview", () => {
    const memo = { content: "\n장보기\n- 우유\n\n  - **달걀**", eventRef: null };
    expect(memoTitle(memo)).toBe("장보기");
    expect(memoPreview(memo)).toBe("우유 달걀");
    expect(memoTitle({ content: "- \n", eventRef: null })).toBe("");
  });

  it("an event memo is named after its event and previews all of its text", () => {
    const memo = { content: "- 사랑니\n- 다음 예약", eventRef: ref };
    expect(memoTitle(memo)).toBe("치과");
    expect(memoPreview(memo)).toBe("사랑니 다음 예약");
  });

  it("long previews are cut with an ellipsis", () => {
    const preview = memoPreview({ content: `제목\n${"가".repeat(200)}`, eventRef: null });
    expect(preview).toHaveLength(141);
    expect(preview.endsWith("…")).toBe(true);
  });
});

describe("formatMemoTime", () => {
  const now = new Date("2026-11-14T06:00:00Z"); // 15:00 KST
  it("today shows the time, yesterday 어제, this year the date, older years the year too", () => {
    expect(formatMemoTime("2026-11-14T00:12:00Z", now)).toBe("오전 9:12");
    expect(formatMemoTime("2026-11-14T05:05:00Z", now)).toBe("오후 2:05");
    expect(formatMemoTime("2026-11-13T03:00:00Z", now)).toBe("어제");
    expect(formatMemoTime("2026-03-02T03:00:00Z", now)).toBe("3월 2일");
    expect(formatMemoTime("2025-12-31T03:00:00Z", now)).toBe("2025년 12월 31일");
    expect(formatMemoTime("nope", now)).toBe("");
  });
});

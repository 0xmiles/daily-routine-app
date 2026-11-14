import { describe, expect, it } from "vitest";
import type { BankAccount } from "@/shared/contracts";
import {
  flowSegments,
  formatMonthDay,
  formatWon,
  koreanCount,
  parseWonInput,
  passbookDate,
  segmentsText,
  staleNotice,
  summarySegments,
  uploadResultMessage,
} from "./format";

const account = (patch: Partial<BankAccount> = {}): BankAccount => ({
  id: "a",
  kind: "checking",
  name: "신한 입출금",
  numberMasked: null,
  balance: 1000,
  asOf: "2026-11-01",
  stale: true,
  manualValuation: null,
  ...patch,
});

describe("summary sentence", () => {
  it("uses native Korean counts", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(koreanCount)).toEqual([
      "한",
      "두",
      "세",
      "네",
      "다섯",
      "여섯",
      "일곱",
      "여덟",
      "아홉",
      "열",
    ]);
    expect(koreanCount(11)).toBeNull();
  });

  it("reads like the spec", () => {
    expect(segmentsText(summarySegments(3, 23_480_000))).toBe("세 계좌를 합치면 23,480,000원이에요.");
    expect(segmentsText(summarySegments(1, 1_234))).toBe("모두 1,234원이에요.");
    expect(segmentsText(summarySegments(12, 5))).toBe("12개 계좌를 합치면 5원이에요.");
  });
});

describe("flow sentence", () => {
  it("reads like the spec", () => {
    const flow = { month: "2026-11", deposit: 3_200_000, withdrawal: 984_400, transfer: 500_000 };
    expect(segmentsText(flowSegments(flow))).toBe(
      "11월에 3,200,000원 들어오고 984,400원 나갔어요. 내 계좌끼리 옮긴 500,000원은 뺐어요.",
    );
  });

  it("handles one-sided and empty months", () => {
    expect(segmentsText(flowSegments({ month: "2026-11", deposit: 0, withdrawal: 5_000, transfer: 0 }))).toBe(
      "11월에 5,000원 나갔어요.",
    );
    expect(segmentsText(flowSegments({ month: "2026-03", deposit: 7, withdrawal: 0, transfer: 0 }))).toBe(
      "3월에 7원 들어왔어요.",
    );
    expect(segmentsText(flowSegments({ month: "2026-11", deposit: 0, withdrawal: 0, transfer: 0 }))).toBe(
      "11월에는 아직 들어오거나 나간 돈이 없어요.",
    );
  });
});

describe("stale notice", () => {
  const now = new Date("2026-11-14T03:00:00Z");

  it("says when an investment amount was entered and offers to enter it again", () => {
    const notice = staleNotice(
      account({
        kind: "investment",
        name: "투자계좌",
        asOf: "2026-10-27",
        manualValuation: { amount: 5, enteredAt: "2026-10-27T10:00:00+09:00" },
      }),
      now,
    );
    expect(segmentsText(notice.segments)).toBe("투자계좌 금액은 18일 전에 입력했어요.");
    expect(notice.action).toBe("valuation");
  });

  it("offers an upload for an old bank balance", () => {
    const notice = staleNotice(account({ asOf: "2026-11-01" }), now);
    expect(segmentsText(notice.segments)).toBe("신한 입출금 잔액은 13일 전 기준이에요.");
    expect(notice.action).toBe("upload");
  });

  it("covers accounts without any amount yet", () => {
    const investment = staleNotice(account({ kind: "investment", name: "신한 투자", asOf: null, balance: null }), now);
    expect(segmentsText(investment.segments)).toBe("신한 투자 금액을 아직 입력하지 않았어요.");
    expect(investment.action).toBe("valuation");
    const bank = staleNotice(account({ asOf: null, balance: null }), now);
    expect(segmentsText(bank.segments)).toBe("신한 입출금 거래내역을 아직 올리지 않았어요.");
  });
});

describe("small formatters", () => {
  it("formats won, dates and passbook dates", () => {
    expect(formatWon(23_480_000)).toBe("23,480,000");
    expect(formatWon(-1_234)).toBe("-1,234");
    expect(formatMonthDay("2026-11-03")).toBe("11월 3일");
    expect(passbookDate("2026-11-03T08:30:00+09:00")).toBe("11.03");
    expect(passbookDate("2026-11-02T23:30:00Z")).toBe("11.03");
  });

  it("parses typed amounts", () => {
    expect(parseWonInput("5,000,000")).toBe(5_000_000);
    expect(parseWonInput(" 12000원 ")).toBe(12_000);
    expect(parseWonInput("0")).toBe(0);
    expect(parseWonInput("")).toBeNull();
    expect(parseWonInput("1.5")).toBeNull();
    expect(parseWonInput("-3")).toBeNull();
    expect(parseWonInput("오천")).toBeNull();
  });

  it("describes an upload result", () => {
    expect(uploadResultMessage("신한 입출금", 12, 3)).toBe(
      "신한 입출금에 거래 12건을 새로 넣었어요. 이미 있던 3건은 건너뛰었어요.",
    );
    expect(uploadResultMessage("신한 입출금", 4, 0)).toBe("신한 입출금에 거래 4건을 새로 넣었어요.");
    expect(uploadResultMessage("신한 입출금", 0, 4)).toBe("새 거래는 없었어요. 이미 있던 4건은 건너뛰었어요.");
    expect(uploadResultMessage("신한 입출금", 0, 0)).toBe("파일에 거래가 없어서 기준 시점만 새로 적었어요.");
  });
});

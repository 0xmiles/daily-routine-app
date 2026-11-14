import { describe, expect, it } from "vitest";
import {
  asOfDate,
  dedupeKey,
  detectTransfers,
  isStale,
  latestBalance,
  monthFlow,
  sortChronologically,
} from "./rules";

const coffeeA = {
  occurredAt: "2026-11-10T09:12:33+09:00",
  description: "커피",
  withdrawal: 4500,
  deposit: 0,
  balanceAfter: 5500,
};
const coffeeB = { ...coffeeA, balanceAfter: 1000 };

describe("dedupeKey", () => {
  it("dedupe keeps same-amount rows with different balance", () => {
    // Review Focus #2: two 4,500원 coffees at the same second, only the balance differs.
    expect(dedupeKey(coffeeA)).not.toBe(dedupeKey(coffeeB));
    expect(new Set([coffeeA, coffeeB].map(dedupeKey)).size).toBe(2);
  });

  it("is stable for the same row (re-upload) and a sha256 hex digest", () => {
    expect(dedupeKey({ ...coffeeA })).toBe(dedupeKey(coffeeA));
    expect(dedupeKey(coffeeA)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes with each field", () => {
    const base = dedupeKey(coffeeA);
    expect(dedupeKey({ ...coffeeA, occurredAt: "2026-11-10T09:12:34+09:00" })).not.toBe(base);
    expect(dedupeKey({ ...coffeeA, withdrawal: 4600 })).not.toBe(base);
    expect(dedupeKey({ ...coffeeA, deposit: 1 })).not.toBe(base);
    expect(dedupeKey({ ...coffeeA, description: "커피 두 잔" })).not.toBe(base);
  });

  it("does not depend on how the same instant is written", () => {
    expect(dedupeKey({ ...coffeeA, occurredAt: "2026-11-10T00:12:33.000Z" })).toBe(dedupeKey(coffeeA));
  });
});

describe("latestBalance", () => {
  it("uses the balance after the latest transaction", () => {
    expect(
      latestBalance([
        { occurredAt: "2026-11-10T09:00:00+09:00", withdrawal: 0, deposit: 3200000, balanceAfter: 3234567 },
        { occurredAt: "2026-11-03T08:30:00+09:00", withdrawal: 182000, deposit: 0, balanceAfter: 1336967 },
      ]),
    ).toBe(3234567);
  });

  it("follows the balance chain when two rows share the latest time", () => {
    // 10,000 → 5,500 → 1,000, given in either order
    const start = { occurredAt: "2026-11-09T08:00:00+09:00", withdrawal: 0, deposit: 10000, balanceAfter: 10000 };
    expect(latestBalance([start, coffeeA, coffeeB])).toBe(1000);
    expect(latestBalance([start, coffeeB, coffeeA])).toBe(1000);
  });

  it("falls back to the last row in file order when the chain is ambiguous", () => {
    const x = { occurredAt: "2026-11-10T09:00:00+09:00", withdrawal: 0, deposit: 0, balanceAfter: 700 };
    const y = { ...x, balanceAfter: 900 };
    expect(latestBalance([x, y])).toBe(900);
    expect(latestBalance([y, x])).toBe(700);
  });

  it("is null without transactions", () => {
    expect(latestBalance([])).toBeNull();
  });
});

describe("sortChronologically", () => {
  it("orders by time, then by the balance chain within the same second", () => {
    const sorted = sortChronologically([coffeeB, { ...coffeeA, occurredAt: "2026-11-10T09:12:33+09:00" }]);
    expect(sorted.map((t) => t.balanceAfter)).toEqual([5500, 1000]);
  });
});

describe("asOfDate", () => {
  it("asOf uses max periodEnd", () => {
    const uploads = [{ periodEnd: "2026-11-01" }, { periodEnd: "2026-11-10" }, { periodEnd: "2026-10-20" }];
    const txns = [{ occurredAt: "2026-11-08T12:00:00+09:00" }];
    expect(asOfDate(uploads, txns)).toBe("2026-11-10");
  });

  it("falls back to the latest transaction date (Seoul) for files without a period", () => {
    // 2026-11-08T15:30Z is 11월 9일 00:30 in Seoul
    expect(asOfDate([{ periodEnd: null }], [{ occurredAt: "2026-11-08T15:30:00Z" }])).toBe("2026-11-09");
    expect(asOfDate([{ periodEnd: "2026-11-01" }, { periodEnd: null }], [{ occurredAt: "2026-11-05T10:00:00+09:00" }])).toBe(
      "2026-11-05",
    );
  });

  it("is null with no period and no transactions", () => {
    expect(asOfDate([], [])).toBeNull();
    expect(asOfDate([{ periodEnd: null }], [])).toBeNull();
  });
});

describe("isStale", () => {
  it("stale after 7 days", () => {
    const now = new Date("2026-11-14T03:00:00Z"); // 11월 14일 12:00 Seoul
    expect(isStale("2026-11-14", now)).toBe(false);
    expect(isStale("2026-11-07", now)).toBe(false); // exactly 7 days
    expect(isStale("2026-11-06", now)).toBe(true); // 8 days
  });

  it("counts days in Seoul, not UTC", () => {
    const now = new Date("2026-11-14T15:30:00Z"); // already 11월 15일 00:30 in Seoul
    expect(isStale("2026-11-07", now)).toBe(true);
    expect(isStale("2026-11-08", now)).toBe(false);
  });

  it("is stale when there is no reference date", () => {
    expect(isStale(null, new Date())).toBe(true);
  });
});

describe("detectTransfers", () => {
  const checking = [
    { id: "c1", occurredAt: "2026-11-05T12:00:01+09:00", withdrawal: 500000, deposit: 0 },
    { id: "c2", occurredAt: "2026-11-05T13:00:00+09:00", withdrawal: 4500, deposit: 0 },
    { id: "c3", occurredAt: "2026-11-10T09:00:00+09:00", withdrawal: 0, deposit: 3200000 },
  ];
  const savings = [{ id: "s1", occurredAt: "2026-11-05T12:00:02+09:00", withdrawal: 0, deposit: 500000 }];

  it("pairs equal withdrawal and deposit on the same Seoul date across two accounts", () => {
    expect(detectTransfers({ checking, savings })).toEqual(new Set(["c1", "s1"]));
    expect(detectTransfers(new Map([["checking", checking], ["savings", savings]]))).toEqual(new Set(["c1", "s1"]));
  });

  it("does not pair within one account or across different Seoul dates", () => {
    const same = [
      { id: "a", occurredAt: "2026-11-05T12:00:00+09:00", withdrawal: 500000, deposit: 0 },
      { id: "b", occurredAt: "2026-11-05T12:05:00+09:00", withdrawal: 0, deposit: 500000 },
    ];
    expect(detectTransfers({ checking: same })).toEqual(new Set());

    // 23:50 Seoul on the 5th vs 00:10 Seoul on the 6th
    const late = [{ id: "w", occurredAt: "2026-11-05T14:50:00Z", withdrawal: 500000, deposit: 0 }];
    const early = [{ id: "d", occurredAt: "2026-11-05T15:10:00Z", withdrawal: 0, deposit: 500000 }];
    expect(detectTransfers({ checking: late, savings: early })).toEqual(new Set());
  });

  it("uses each transaction at most once", () => {
    const a = [
      { id: "w1", occurredAt: "2026-11-05T09:00:00+09:00", withdrawal: 500000, deposit: 0 },
      { id: "w2", occurredAt: "2026-11-05T15:00:00+09:00", withdrawal: 500000, deposit: 0 },
    ];
    const b = [{ id: "d1", occurredAt: "2026-11-05T15:00:05+09:00", withdrawal: 0, deposit: 500000 }];
    // the closest withdrawal in time wins
    expect(detectTransfers({ a, b })).toEqual(new Set(["w2", "d1"]));
  });
});

describe("monthFlow", () => {
  it("transfer pair excluded from flow", () => {
    const checking = [
      { id: "c0", occurredAt: "2026-11-03T08:30:00+09:00", withdrawal: 182000, deposit: 0 },
      { id: "c1", occurredAt: "2026-11-05T12:00:01+09:00", withdrawal: 500000, deposit: 0 },
      { id: "c2", occurredAt: "2026-11-09T18:20:00+09:00", withdrawal: 802400, deposit: 0 },
      { id: "c3", occurredAt: "2026-11-10T09:00:00+09:00", withdrawal: 0, deposit: 3200000 },
      { id: "c4", occurredAt: "2026-10-31T09:00:00+09:00", withdrawal: 10000, deposit: 0 },
    ];
    const savings = [{ id: "s1", occurredAt: "2026-11-05T12:00:02+09:00", withdrawal: 0, deposit: 500000 }];

    const transfers = detectTransfers({ checking, savings });
    const all = [...checking, ...savings].map((t) => ({ ...t, isTransfer: transfers.has(t.id) }));

    expect(monthFlow(all, "2026-11")).toEqual({ month: "2026-11", deposit: 3200000, withdrawal: 984400, transfer: 500000 });
  });

  it("uses the Seoul month", () => {
    // 2026-10-31T15:30Z is 11월 1일 00:30 in Seoul
    const txns = [{ occurredAt: "2026-10-31T15:30:00Z", withdrawal: 1000, deposit: 0, isTransfer: false }];
    expect(monthFlow(txns, "2026-11").withdrawal).toBe(1000);
    expect(monthFlow(txns, "2026-10").withdrawal).toBe(0);
  });

  it("counts a one-sided transfer mark once", () => {
    const txns = [{ occurredAt: "2026-11-02T10:00:00+09:00", withdrawal: 0, deposit: 70000, isTransfer: true }];
    expect(monthFlow(txns, "2026-11")).toEqual({ month: "2026-11", deposit: 0, withdrawal: 0, transfer: 70000 });
  });
});

import type { BankAccount, MonthFlow } from "@/shared/contracts";
import { seoulParts, seoulToday } from "@/shared/time";
import { daysBetween } from "./dates";

// Korean sentences and number formats for the assets screen. Client-safe.
// Sentences are built as segments so numbers can be rendered with `.num`.

/** Plain text, or a number to render in the number font. */
export type Segment = string | { num: string };

export function segmentsText(segments: readonly Segment[]): string {
  return segments.map((s) => (typeof s === "string" ? s : s.num)).join("");
}

const wonFormat = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });

/** 23480000 → '23,480,000' */
export function formatWon(amount: number): string {
  return wonFormat.format(amount);
}

const NATIVE_COUNTS = ["한", "두", "세", "네", "다섯", "여섯", "일곱", "여덟", "아홉", "열"] as const;

/** 1–10 → 한, 두, 세 … 열 (counting words before a noun). null otherwise. */
export function koreanCount(n: number): string | null {
  return Number.isInteger(n) && n >= 1 && n <= 10 ? NATIVE_COUNTS[n - 1] : null;
}

/** "세 계좌를 합치면 23,480,000원이에요." / one account: "모두 N원이에요." */
export function summarySegments(accountCount: number, total: number): Segment[] {
  const amount = { num: formatWon(total) };
  if (accountCount <= 1) return ["모두 ", amount, "원이에요."];
  const count = koreanCount(accountCount);
  return [count ? `${count} 계좌를 합치면 ` : `${accountCount}개 계좌를 합치면 `, amount, "원이에요."];
}

/** "11월에 3,200,000원 들어오고 984,400원 나갔어요. 내 계좌끼리 옮긴 500,000원은 뺐어요." */
export function flowSegments(flow: MonthFlow): Segment[] {
  const m = `${Number(flow.month.slice(5, 7))}월`;
  const segments: Segment[] = [];
  if (flow.deposit === 0 && flow.withdrawal === 0) {
    segments.push(`${m}에는 아직 들어오거나 나간 돈이 없어요.`);
  } else if (flow.withdrawal === 0) {
    segments.push(`${m}에 `, { num: formatWon(flow.deposit) }, "원 들어왔어요.");
  } else if (flow.deposit === 0) {
    segments.push(`${m}에 `, { num: formatWon(flow.withdrawal) }, "원 나갔어요.");
  } else {
    segments.push(`${m}에 `, { num: formatWon(flow.deposit) }, "원 들어오고 ", { num: formatWon(flow.withdrawal) }, "원 나갔어요.");
  }
  if (flow.transfer > 0) segments.push(" 내 계좌끼리 옮긴 ", { num: formatWon(flow.transfer) }, "원은 뺐어요.");
  return segments;
}

export interface StaleNotice {
  segments: Segment[];
  /** valuation: open the 평가금액 sheet; upload: pick a 거래내역 file. */
  action: "valuation" | "upload";
}

/** The warning sentence for an account whose 기준 시점 is old (spec §5.4). */
export function staleNotice(account: BankAccount, now: Date = new Date()): StaleNotice {
  const days = account.asOf ? daysBetween(account.asOf, seoulToday(now)) : null;
  if (account.kind === "investment" && (account.manualValuation || account.balance === null)) {
    if (!account.manualValuation || days === null) {
      return { segments: [`${account.name} 금액을 아직 입력하지 않았어요.`], action: "valuation" };
    }
    return { segments: [`${account.name} 금액은 `, { num: String(days) }, "일 전에 입력했어요."], action: "valuation" };
  }
  if (days === null) return { segments: [`${account.name} 거래내역을 아직 올리지 않았어요.`], action: "upload" };
  return { segments: [`${account.name} 잔액은 `, { num: String(days) }, "일 전 기준이에요."], action: "upload" };
}

/** '2026-11-03' → '11월 3일' */
export function formatMonthDay(date: string): string {
  return `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일`;
}

/** ISO instant → passbook date 'MM.DD' (Seoul). */
export function passbookDate(iso: string): string {
  const { date } = seoulParts(new Date(iso));
  return `${date.slice(5, 7)}.${date.slice(8, 10)}`;
}

/** '5,000,000', '12000원' → whole won; null when it is not a non-negative integer. */
export function parseWonInput(text: string): number | null {
  const cleaned = text.replace(/[\s,원₩]/g, "");
  if (!/^\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isSafeInteger(value) ? value : null;
}

/** What an upload did, as one or two sentences. */
export function uploadResultMessage(accountName: string, inserted: number, skipped: number): string {
  if (inserted === 0 && skipped === 0) return "파일에 거래가 없어서 기준 시점만 새로 적었어요.";
  if (inserted === 0) return `새 거래는 없었어요. 이미 있던 ${skipped}건은 건너뛰었어요.`;
  const added = `${accountName}에 거래 ${inserted}건을 새로 넣었어요.`;
  return skipped > 0 ? `${added} 이미 있던 ${skipped}건은 건너뛰었어요.` : added;
}

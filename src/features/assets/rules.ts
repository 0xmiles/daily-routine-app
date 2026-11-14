import { createHash } from "node:crypto";
import type { MonthFlow } from "@/shared/contracts";
import { seoulToday } from "@/shared/time";
import { daysBetween, seoulDateOf, toSeoulIso } from "./dates";

// Pure rules for balances, reference dates, transfers and monthly flow
// (spec §5.4). Server-side: dedupeKey uses node:crypto, so do not import this
// module from client components — use ./dates and ./format there.

type Instant = string | Date;

// ---------------------------------------------------------------------------
// Dedupe
// ---------------------------------------------------------------------------

export interface DedupeInput {
  occurredAt: Instant;
  withdrawal: number;
  deposit: number;
  balanceAfter: number;
  description: string;
}

/**
 * sha256(occurredAt|withdrawal|deposit|balanceAfter|description), hex.
 * occurredAt is normalized to Seoul ISO first, so the same instant always
 * hashes the same. Two same-amount rows at the same second differ by
 * balanceAfter, so both are kept (Review Focus #2).
 */
export function dedupeKey(row: DedupeInput): string {
  const parts = [toSeoulIso(row.occurredAt), row.withdrawal, row.deposit, row.balanceAfter, row.description.trim()];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

// ---------------------------------------------------------------------------
// Ordering and latest balance
// ---------------------------------------------------------------------------

export interface BalanceTxn {
  occurredAt: Instant;
  withdrawal: number;
  deposit: number;
  balanceAfter: number;
}

const ms = (at: Instant) => new Date(at).getTime();

/** The balance just before this transaction. */
const balanceBefore = (t: BalanceTxn) => t.balanceAfter + t.withdrawal - t.deposit;

/**
 * Rows sharing one timestamp, ordered by their balance chain (each row starts
 * from the previous row's balance). Where the chain does not decide, the input
 * order is kept.
 */
function orderTies<T extends BalanceTxn>(group: T[]): T[] {
  if (group.length < 2) return group;
  const remaining = [...group];
  const ordered: T[] = [];
  while (remaining.length > 0) {
    let next: number;
    if (ordered.length === 0) {
      next = remaining.findIndex((t) => !remaining.some((o) => o !== t && o.balanceAfter === balanceBefore(t)));
    } else {
      const last = ordered[ordered.length - 1];
      next = remaining.findIndex((t) => balanceBefore(t) === last.balanceAfter);
    }
    ordered.push(remaining.splice(next === -1 ? 0 : next, 1)[0]);
  }
  return ordered;
}

/** Oldest first; same-second rows follow the balance chain, else input order (stable). */
export function sortChronologically<T extends BalanceTxn>(txns: readonly T[]): T[] {
  const sorted = [...txns].sort((a, b) => ms(a.occurredAt) - ms(b.occurredAt));
  const out: T[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i + 1;
    while (j < sorted.length && ms(sorted[j].occurredAt) === ms(sorted[i].occurredAt)) j++;
    out.push(...orderTies(sorted.slice(i, j)));
    i = j;
  }
  return out;
}

/**
 * balanceAfter of the latest transaction. Ties on occurredAt are resolved by
 * the balance chain, then by the last row in input (file) order. Null when empty.
 */
export function latestBalance(txns: readonly BalanceTxn[]): number | null {
  if (txns.length === 0) return null;
  const sorted = sortChronologically(txns);
  return sorted[sorted.length - 1].balanceAfter;
}

// ---------------------------------------------------------------------------
// Reference date (기준 시점) and staleness
// ---------------------------------------------------------------------------

/**
 * Spec §5.4: the latest 조회 종료일 over all uploaded files; a file without a
 * period counts as its latest transaction date (Seoul). Because transactions in
 * a file with a period never fall after its periodEnd, this equals
 * max(all periodEnds, all transaction dates). Null when there is neither.
 */
export function asOfDate(
  uploads: readonly { periodEnd: string | null }[],
  txns: readonly { occurredAt: Instant }[],
): string | null {
  let best: string | null = null;
  const consider = (date: string | null) => {
    if (date && (best === null || date > best)) best = date;
  };
  for (const upload of uploads) consider(upload.periodEnd);
  for (const txn of txns) consider(seoulDateOf(txn.occurredAt));
  return best;
}

export const STALE_AFTER_DAYS = 7;

/** Days from `asOf` to today in Seoul. */
export function daysSince(asOf: string, now: Date): number {
  return daysBetween(asOf, seoulToday(now));
}

/** True when the reference date is more than 7 Seoul calendar days old (or missing). */
export function isStale(asOf: string | null, now: Date): boolean {
  if (!asOf) return true;
  return daysSince(asOf, now) > STALE_AFTER_DAYS;
}

// ---------------------------------------------------------------------------
// Transfers between own accounts
// ---------------------------------------------------------------------------

export interface TransferCandidate {
  id: string;
  occurredAt: Instant;
  withdrawal: number;
  deposit: number;
}

type ByAccount = ReadonlyMap<string, readonly TransferCandidate[]> | Readonly<Record<string, readonly TransferCandidate[]>>;

/**
 * Pairs a withdrawal in one account with an equal deposit in a different own
 * account on the same Seoul date. Each transaction is used at most once; a
 * withdrawal takes the unused deposit closest to it in time. Returns the ids of
 * both sides of every pair.
 */
export function detectTransfers(txnsByAccount: ByAccount): Set<string> {
  const entries: [string, readonly TransferCandidate[]][] =
    txnsByAccount instanceof Map ? [...txnsByAccount.entries()] : Object.entries(txnsByAccount);

  type Tagged = TransferCandidate & { accountId: string; at: number; date: string };
  const withdrawals: Tagged[] = [];
  const depositsByKey = new Map<string, Tagged[]>();
  for (const [accountId, txns] of entries) {
    for (const t of txns) {
      const tagged: Tagged = { ...t, accountId, at: ms(t.occurredAt), date: seoulDateOf(t.occurredAt) };
      if (t.withdrawal > 0 && t.deposit === 0) withdrawals.push(tagged);
      if (t.deposit > 0 && t.withdrawal === 0) {
        const key = `${tagged.date}|${t.deposit}`;
        const list = depositsByKey.get(key) ?? [];
        list.push(tagged);
        depositsByKey.set(key, list);
      }
    }
  }

  // Closest pairs first, so "each used once" picks the most likely partner.
  const pairs: { w: Tagged; d: Tagged; gap: number }[] = [];
  for (const w of withdrawals) {
    for (const d of depositsByKey.get(`${w.date}|${w.withdrawal}`) ?? []) {
      if (d.accountId !== w.accountId) pairs.push({ w, d, gap: Math.abs(d.at - w.at) });
    }
  }
  pairs.sort((a, b) => a.gap - b.gap || a.w.at - b.w.at || a.d.at - b.d.at);

  const used = new Set<string>();
  for (const { w, d } of pairs) {
    if (used.has(w.id) || used.has(d.id)) continue;
    used.add(w.id);
    used.add(d.id);
  }
  return used;
}

// ---------------------------------------------------------------------------
// Monthly flow
// ---------------------------------------------------------------------------

export interface FlowTxn {
  occurredAt: Instant;
  withdrawal: number;
  deposit: number;
  isTransfer: boolean;
}

/**
 * Deposits and withdrawals of a Seoul month ('YYYY-MM'), without transfers
 * between own accounts. Transfers are summed separately: a pair has both
 * sides, so `transfer` is the larger of the transfer withdrawals and transfer
 * deposits — a pair counts once, and a one-sided mark still shows up.
 */
export function monthFlow(txns: readonly FlowTxn[], month: string): MonthFlow {
  let deposit = 0;
  let withdrawal = 0;
  let transferOut = 0;
  let transferIn = 0;
  for (const t of txns) {
    if (seoulDateOf(t.occurredAt).slice(0, 7) !== month) continue;
    if (t.isTransfer) {
      transferOut += t.withdrawal;
      transferIn += t.deposit;
    } else {
      deposit += t.deposit;
      withdrawal += t.withdrawal;
    }
  }
  return { month, deposit, withdrawal, transfer: Math.max(transferOut, transferIn) };
}

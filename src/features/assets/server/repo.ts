import { and, asc, desc, eq, gte, inArray, lt, ne } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { bankAccounts, transactions, uploads, type BankAccountRow, type TransactionRow } from "@/server/db/schema";
import type { AccountKind, AssetsSummary, BankAccount, Txn } from "@/shared/contracts";
import { addDays, seoulDateTimeToDate, seoulToday } from "@/shared/time";
import { monthBounds, monthOfDate, seoulDateOf, seoulMonth, shiftMonth, toSeoulIso } from "../dates";
import type { ParsedStatement } from "../parse/shinhan";
import { asOfDate, dedupeKey, detectTransfers, isStale, latestBalance, monthFlow, sortChronologically } from "../rules";

// Data access for the assets feature. Route handlers call these with getDb();
// tests pass the PGlite test db. All writes of one upload run in one transaction.

const KIND_ORDER: Record<AccountKind, number> = { checking: 0, savings: 1, investment: 2 };
const DEFAULT_NAMES: Record<AccountKind, string> = {
  checking: "신한 입출금",
  savings: "신한 적금",
  investment: "신한 투자",
};
const INSERT_CHUNK = 500;

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export function toTxn(row: TransactionRow): Txn {
  return {
    id: row.id,
    accountId: row.accountId,
    occurredAt: toSeoulIso(row.occurredAt),
    description: row.description,
    withdrawal: row.withdrawal,
    deposit: row.deposit,
    balanceAfter: row.balanceAfter,
    isTransfer: row.isTransfer,
  };
}

/** Rows at the latest occurredAt of an account (ties included). */
async function latestTxnRows(db: Db, accountId: string): Promise<TransactionRow[]> {
  const rows = await db
    .select()
    .from(transactions)
    .where(eq(transactions.accountId, accountId))
    .orderBy(desc(transactions.occurredAt))
    .limit(50);
  if (rows.length === 0) return rows;
  const top = rows[0].occurredAt.getTime();
  return rows.filter((r) => r.occurredAt.getTime() === top).reverse();
}

async function toAccount(db: Db, row: BankAccountRow, now: Date): Promise<BankAccount> {
  const manualValuation =
    row.manualAmount !== null && row.manualEnteredAt !== null
      ? { amount: row.manualAmount, enteredAt: toSeoulIso(row.manualEnteredAt) }
      : null;

  let balance: number | null;
  let asOf: string | null;
  if (row.kind === "investment" && manualValuation && row.manualEnteredAt) {
    // 투자계좌: the entered valuation and its entry date are the balance and 기준 시점.
    balance = manualValuation.amount;
    asOf = seoulDateOf(row.manualEnteredAt);
  } else {
    balance = latestBalance(await latestTxnRows(db, row.id));
    asOf = row.asOf;
  }

  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    numberMasked: row.numberMasked,
    balance,
    asOf,
    stale: isStale(asOf, now),
    manualValuation,
  };
}

function sortAccounts(rows: BankAccountRow[]): BankAccountRow[] {
  return [...rows].sort(
    (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.createdAt.getTime() - b.createdAt.getTime(),
  );
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export async function findAccountRow(db: Db, id: string): Promise<BankAccountRow | null> {
  const [row] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, id));
  return row ?? null;
}

export async function listAccounts(db: Db, now = new Date()): Promise<BankAccount[]> {
  const rows = sortAccounts(await db.select().from(bankAccounts));
  return Promise.all(rows.map((row) => toAccount(db, row, now)));
}

export async function getAccount(db: Db, id: string, now = new Date()): Promise<BankAccount | null> {
  const row = await findAccountRow(db, id);
  return row ? toAccount(db, row, now) : null;
}

export async function createAccount(
  db: Db,
  input: { kind: AccountKind; name: string },
  now = new Date(),
): Promise<BankAccount> {
  const [row] = await db.insert(bankAccounts).values({ kind: input.kind, name: input.name }).returning();
  return toAccount(db, row, now);
}

export async function updateAccount(
  db: Db,
  id: string,
  patch: { name?: string; kind?: AccountKind },
  now = new Date(),
): Promise<BankAccount | null> {
  const values: Partial<Pick<BankAccountRow, "name" | "kind">> = {};
  if (patch.name !== undefined) values.name = patch.name;
  if (patch.kind !== undefined) values.kind = patch.kind;
  if (Object.keys(values).length === 0) return getAccount(db, id, now);
  const [row] = await db.update(bankAccounts).set(values).where(eq(bankAccounts.id, id)).returning();
  return row ? toAccount(db, row, now) : null;
}

export async function setValuation(db: Db, id: string, amount: number, now = new Date()): Promise<BankAccount | null> {
  const [row] = await db
    .update(bankAccounts)
    .set({ manualAmount: amount, manualEnteredAt: now })
    .where(eq(bankAccounts.id, id))
    .returning();
  return row ? toAccount(db, row, now) : null;
}

/** A default name that is not taken yet: "신한 입출금", then "신한 입출금 6789". */
async function defaultName(db: Db, kind: AccountKind, digits: string | null): Promise<string> {
  const base = DEFAULT_NAMES[kind];
  const taken = new Set((await db.select({ name: bankAccounts.name }).from(bankAccounts)).map((r) => r.name));
  if (!taken.has(base)) return base;
  if (digits) {
    const withDigits = `${base} ${digits.slice(-4)}`;
    if (!taken.has(withDigits)) return withDigits;
  }
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

/** An account's transactions between Seoul dates `from` and `to` (inclusive), oldest first. */
export async function listTxns(db: Db, accountId: string, range: { from?: string; to?: string } = {}): Promise<Txn[]> {
  const conditions = [eq(transactions.accountId, accountId)];
  if (range.from) conditions.push(gte(transactions.occurredAt, seoulDateTimeToDate(range.from, "00:00")));
  if (range.to) conditions.push(lt(transactions.occurredAt, seoulDateTimeToDate(addDays(range.to, 1), "00:00")));
  const rows = await db
    .select()
    .from(transactions)
    .where(and(...conditions))
    .orderBy(asc(transactions.occurredAt));
  return sortChronologically(rows).map(toTxn);
}

/** Sets isTransfer by hand; automatic detection will not change it again. */
export async function setTxnTransfer(db: Db, id: string, isTransfer: boolean): Promise<Txn | null> {
  const [row] = await db
    .update(transactions)
    .set({ isTransfer, transferOverridden: true })
    .where(eq(transactions.id, id))
    .returning();
  return row ? toTxn(row) : null;
}

/**
 * Re-detects transfers between own accounts for the Seoul months from
 * `firstMonth` to `lastMonth`. Rows whose transfer flag was set by hand
 * (transferOverridden) are neither paired nor changed.
 */
export async function redetectTransfers(db: Db, firstMonth: string, lastMonth: string): Promise<void> {
  const start = seoulDateTimeToDate(monthBounds(firstMonth).first, "00:00");
  const end = seoulDateTimeToDate(`${shiftMonth(lastMonth, 1)}-01`, "00:00");
  const rows = await db
    .select()
    .from(transactions)
    .where(
      and(
        gte(transactions.occurredAt, start),
        lt(transactions.occurredAt, end),
        eq(transactions.transferOverridden, false),
      ),
    );

  const byAccount = new Map<string, TransactionRow[]>();
  for (const row of rows) {
    const list = byAccount.get(row.accountId) ?? [];
    list.push(row);
    byAccount.set(row.accountId, list);
  }
  const transfers = detectTransfers(byAccount);

  const toTrue = rows.filter((r) => !r.isTransfer && transfers.has(r.id)).map((r) => r.id);
  const toFalse = rows.filter((r) => r.isTransfer && !transfers.has(r.id)).map((r) => r.id);
  if (toTrue.length) await db.update(transactions).set({ isTransfer: true }).where(inArray(transactions.id, toTrue));
  if (toFalse.length) await db.update(transactions).set({ isTransfer: false }).where(inArray(transactions.id, toFalse));
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export type ImportResult =
  | { kind: "ok"; account: BankAccount; inserted: number; skipped: number }
  | { kind: "needsAccount" }
  | { kind: "accountNotFound" }
  | { kind: "accountMismatch" };

/**
 * Stores a parsed statement, all or nothing:
 * - finds the account by `accountId`, else by the file's account digits, else
 *   creates it (kind from the file's hint, default 'checking'); without either
 *   it returns needsAccount and writes nothing.
 * - inserts rows, skipping ones already stored (same dedupe key);
 * - records an `uploads` row, moves 기준 시점 forward, and re-detects transfers
 *   for the months the file touches.
 */
export async function importStatement(
  db: Db,
  parsed: ParsedStatement,
  options: { accountId?: string | null; now?: Date } = {},
): Promise<ImportResult> {
  const now = options.now ?? new Date();
  return db.transaction(async (tx) => {
    let account: BankAccountRow | null;
    if (options.accountId) {
      account = await findAccountRow(tx, options.accountId);
      if (!account) return { kind: "accountNotFound" } as const;
      if (parsed.accountDigits && account.numberDigits && account.numberDigits !== parsed.accountDigits) {
        return { kind: "accountMismatch" } as const;
      }
      if (parsed.accountDigits && !account.numberDigits) {
        const [owner] = await tx
          .select({ id: bankAccounts.id })
          .from(bankAccounts)
          .where(and(eq(bankAccounts.numberDigits, parsed.accountDigits), ne(bankAccounts.id, account.id)));
        if (owner) return { kind: "accountMismatch" } as const;
        [account] = await tx
          .update(bankAccounts)
          .set({ numberDigits: parsed.accountDigits, numberMasked: parsed.numberMasked })
          .where(eq(bankAccounts.id, account.id))
          .returning();
      } else if (!account.numberMasked && parsed.numberMasked) {
        [account] = await tx
          .update(bankAccounts)
          .set({ numberMasked: parsed.numberMasked })
          .where(eq(bankAccounts.id, account.id))
          .returning();
      }
    } else if (parsed.accountDigits) {
      const [existing] = await tx.select().from(bankAccounts).where(eq(bankAccounts.numberDigits, parsed.accountDigits));
      if (existing) {
        account = existing;
      } else {
        const kind = parsed.kindHint ?? "checking";
        [account] = await tx
          .insert(bankAccounts)
          .values({
            kind,
            name: await defaultName(tx, kind, parsed.accountDigits),
            numberDigits: parsed.accountDigits,
            numberMasked: parsed.numberMasked,
          })
          .returning();
      }
    } else {
      return { kind: "needsAccount" } as const;
    }

    const accountId = account.id;
    let inserted = 0;
    const values = parsed.rows.map((row) => ({
      accountId,
      occurredAt: new Date(row.occurredAt),
      description: row.description,
      withdrawal: row.withdrawal,
      deposit: row.deposit,
      balanceAfter: row.balanceAfter,
      dedupeKey: dedupeKey(row),
    }));
    for (let i = 0; i < values.length; i += INSERT_CHUNK) {
      const result = await tx
        .insert(transactions)
        .values(values.slice(i, i + INSERT_CHUNK))
        .onConflictDoNothing({ target: [transactions.accountId, transactions.dedupeKey] })
        .returning({ id: transactions.id });
      inserted += result.length;
    }

    await tx.insert(uploads).values({
      accountId,
      uploadedAt: now,
      periodStart: parsed.periodStart,
      periodEnd: parsed.periodEnd,
      rowCount: parsed.rows.length,
      insertedCount: inserted,
    });

    // 기준 시점: latest period end so far (a period end after today is capped
    // to today, the day the file was downloaded); files without a period count
    // as their latest transaction date.
    const today = seoulToday(now);
    const fileEnd = parsed.periodEnd && parsed.periodEnd > today ? today : parsed.periodEnd;
    const asOf = asOfDate([{ periodEnd: account.asOf }, { periodEnd: fileEnd }], parsed.rows);
    if (asOf !== account.asOf) {
      await tx.update(bankAccounts).set({ asOf }).where(eq(bankAccounts.id, accountId));
      account = { ...account, asOf };
    }

    if (parsed.rows.length > 0) {
      const months = parsed.rows.map((r) => monthOfDate(seoulDateOf(r.occurredAt))).sort();
      await redetectTransfers(tx, months[0], months[months.length - 1]);
    }

    return {
      kind: "ok",
      account: await toAccount(tx, account, now),
      inserted,
      skipped: parsed.rows.length - inserted,
    } as const;
  });
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

/** All accounts, their total, and the flow of `month` (default: this Seoul month). */
export async function getSummary(db: Db, options: { now?: Date; month?: string } = {}): Promise<AssetsSummary> {
  const now = options.now ?? new Date();
  const month = options.month ?? seoulMonth(now);
  const accounts = await listAccounts(db, now);
  const total = accounts.reduce((sum, a) => sum + (a.balance ?? 0), 0);

  const { first } = monthBounds(month);
  const rows = await db
    .select({
      occurredAt: transactions.occurredAt,
      withdrawal: transactions.withdrawal,
      deposit: transactions.deposit,
      isTransfer: transactions.isTransfer,
    })
    .from(transactions)
    .where(
      and(
        gte(transactions.occurredAt, seoulDateTimeToDate(first, "00:00")),
        lt(transactions.occurredAt, seoulDateTimeToDate(`${shiftMonth(month, 1)}-01`, "00:00")),
      ),
    );

  return { accounts, total, flow: monthFlow(rows, month) };
}

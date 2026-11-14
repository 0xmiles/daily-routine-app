import { eq } from "drizzle-orm";
import * as XLSX from "xlsx";
import { beforeEach, describe, expect, it } from "vitest";
import { GET as getAccounts, POST as postAccount } from "@/app/api/assets/accounts/route";
import { PATCH as patchAccount } from "@/app/api/assets/accounts/[id]/route";
import { GET as getTxns } from "@/app/api/assets/accounts/[id]/txns/route";
import { PUT as putValuation } from "@/app/api/assets/accounts/[id]/valuation/route";
import { GET as getSummary } from "@/app/api/assets/summary/route";
import { PATCH as patchTxn } from "@/app/api/assets/txns/[id]/route";
import { POST as postUpload } from "@/app/api/assets/upload/route";
import { importStatement } from "@/features/assets/server/repo";
import { sessionCookieFor } from "@/server/auth/session";
import type { Db } from "@/server/db/client";
import { bankAccounts, transactions, uploads } from "@/server/db/schema";
import { createTestDb } from "@/server/db/test-db";
import type { AssetsSummary, BankAccount, Txn } from "@/shared/contracts";
import { seoulToday } from "@/shared/time";

let db: Db;
let cookie: string;

beforeEach(async () => {
  db = await createTestDb();
  cookie = await sessionCookieFor();
});

const HEADER = ["거래일자", "거래시간", "적요", "출금(원)", "입금(원)", "내용", "잔액(원)"];

function statement(
  rows: unknown[][],
  { account = "110-123-456789", period = "2026.11.01 ~ 2026.11.10", title = "입출금 거래내역조회" }: {
    account?: string | null;
    period?: string | null;
    title?: string;
  } = {},
): File {
  const aoa: unknown[][] = [[title], []];
  if (account) aoa.push([`계좌번호 : ${account}`]);
  if (period) aoa.push([`조회기간 : ${period}`]);
  aoa.push([], HEADER, ...rows);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "거래내역");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new File([buf], "거래내역.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

const NOV_ROWS = [
  ["2026.11.03", "08:30:00", "자동이체", "182,000", "", "관리비", "1,336,967"],
  ["2026.11.05", "12:00:01", "인터넷", "500,000", "", "적금", "836,967"],
  ["2026.11.09", "18:20:00", "카드", "802,400", "", "카드대금", "34,567"],
  ["2026.11.10", "09:00:00", "급여", "", "3,200,000", "", "3,234,567"],
];

async function upload(file: File, accountId?: string, withCookie = true): Promise<Response> {
  const form = new FormData();
  form.set("file", file);
  if (accountId) form.set("accountId", accountId);
  return postUpload(
    new Request("http://localhost/api/assets/upload", {
      method: "POST",
      body: form,
      headers: withCookie ? { cookie } : {},
    }),
  );
}

async function summary(month = "2026-11"): Promise<AssetsSummary> {
  const res = await getSummary(new Request(`http://localhost/api/assets/summary?month=${month}`, { headers: { cookie } }));
  expect(res.status).toBe(200);
  return res.json();
}

async function txnsOf(accountId: string, query = ""): Promise<Txn[]> {
  const res = await getTxns(
    new Request(`http://localhost/api/assets/accounts/${accountId}/txns${query}`, { headers: { cookie } }),
    { params: Promise.resolve({ id: accountId }) },
  );
  expect(res.status).toBe(200);
  return (await res.json()).txns;
}

function jsonRequest(url: string, method: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("auth", () => {
  it("every assets route requires a session", async () => {
    const id = "00000000-0000-0000-0000-000000000000";
    const params = { params: Promise.resolve({ id }) };
    const bare = (method = "GET") => new Request("http://localhost/api/assets/x", { method });
    expect((await upload(statement(NOV_ROWS), undefined, false)).status).toBe(401);
    expect((await getSummary(bare())).status).toBe(401);
    expect((await getAccounts(bare())).status).toBe(401);
    expect((await postAccount(bare("POST"))).status).toBe(401);
    expect((await patchAccount(bare("PATCH"), params)).status).toBe(401);
    expect((await getTxns(bare(), params)).status).toBe(401);
    expect((await putValuation(bare("PUT"), params)).status).toBe(401);
    expect((await patchTxn(bare("PATCH"), params)).status).toBe(401);
  });
});

describe("POST /api/assets/upload", () => {
  it("creates the account from the file's account number on first upload", async () => {
    const res = await upload(statement(NOV_ROWS));
    expect(res.status).toBe(200);
    const body: { account: BankAccount; inserted: number; skipped: number } = await res.json();

    expect(body.inserted).toBe(4);
    expect(body.skipped).toBe(0);
    expect(body.account).toMatchObject({
      kind: "checking",
      name: "신한 입출금",
      numberMasked: "110-***-456789",
      balance: 3234567,
      asOf: "2026-11-10",
      manualValuation: null,
    });

    const [row] = await db.select().from(bankAccounts);
    expect(row.numberDigits).toBe("110123456789");
    const [up] = await db.select().from(uploads);
    expect(up).toMatchObject({
      accountId: row.id,
      periodStart: "2026-11-01",
      periodEnd: "2026-11-10",
      rowCount: 4,
      insertedCount: 4,
    });
  });

  it("re-upload inserts 0", async () => {
    await upload(statement(NOV_ROWS));
    const res = await upload(statement(NOV_ROWS));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ inserted: 0, skipped: 4 });
    expect(await db.select().from(transactions)).toHaveLength(4);
    expect(await db.select().from(bankAccounts)).toHaveLength(1);
    expect(await db.select().from(uploads)).toHaveLength(2);
  });

  it("keeps two same-amount rows at the same second with different balances", async () => {
    const coffees = [
      ["2026.11.10", "09:12:33", "체크카드", "4,500", "", "커피", "5,500"],
      ["2026.11.10", "09:12:33", "체크카드", "4,500", "", "커피", "1,000"],
    ];
    const res = await upload(statement(coffees));
    expect(await res.json()).toMatchObject({ inserted: 2, skipped: 0, account: { balance: 1000 } });
    expect((await upload(statement(coffees))).status).toBe(200);
    expect(await db.select().from(transactions)).toHaveLength(2);
  });

  it("merges an overlapping period without duplicates", async () => {
    await upload(statement(NOV_ROWS.slice(0, 3), { period: "2026.11.01 ~ 2026.11.09" }));
    const res = await upload(statement(NOV_ROWS.slice(1), { period: "2026.11.04 ~ 2026.11.10" }));
    expect(await res.json()).toMatchObject({ inserted: 1, skipped: 2 });
    expect(await db.select().from(transactions)).toHaveLength(4);
  });

  it("bad file stores nothing", async () => {
    const broken = statement([...NOV_ROWS.slice(0, 2), ["어제", "", "카드", "802,400", "", "카드대금", "34,567"]]);
    const res = await upload(broken);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      message: "9번째 줄의 거래 날짜를 읽지 못했어요. 신한 인터넷뱅킹에서 받은 파일을 고치지 않고 그대로 올려 주세요.",
    });

    const notAStatement = new File(["안녕하세요"], "memo.csv", { type: "text/csv" });
    const res2 = await upload(notAStatement);
    expect(res2.status).toBe(422);
    expect((await res2.json()).message).toBe(
      "거래내역 표를 찾지 못했어요. 신한 인터넷뱅킹에서 받은 거래내역 엑셀인지 확인해 주세요.",
    );

    expect(await db.select().from(bankAccounts)).toHaveLength(0);
    expect(await db.select().from(transactions)).toHaveLength(0);
    expect(await db.select().from(uploads)).toHaveLength(0);
  });

  it("asks which account when the file has no account number", async () => {
    const file = statement(NOV_ROWS, { account: null });
    const res = await upload(file);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ message: "어느 계좌의 거래내역인지 골라 주세요.", needsAccount: true });
    expect(await db.select().from(transactions)).toHaveLength(0);

    const created = await postAccount(
      jsonRequest("http://localhost/api/assets/accounts", "POST", { kind: "checking", name: "생활비 통장" }),
    );
    const { account } = await created.json();
    const res2 = await upload(file, account.id);
    expect(res2.status).toBe(200);
    expect(await res2.json()).toMatchObject({ inserted: 4, account: { id: account.id, balance: 3234567 } });
  });

  it("rejects a chosen account whose number differs from the file", async () => {
    await upload(statement(NOV_ROWS));
    const [first] = await db.select().from(bankAccounts);
    const other = statement(NOV_ROWS, { account: "230-45-678901" });
    const res = await upload(other, first.id);
    expect(res.status).toBe(422);
    expect((await res.json()).message).toContain("계좌번호가 달라요");
    expect(await db.select().from(transactions)).toHaveLength(4);
  });

  it("rolls back the whole upload when a write fails", async () => {
    const parsed = {
      accountDigits: "110123456789",
      numberMasked: "110-***-456789",
      kindHint: null,
      periodStart: null,
      periodEnd: null,
      rows: [
        { occurredAt: "2026-11-10T09:00:00+09:00", description: "급여", withdrawal: 0, deposit: 3200000, balanceAfter: 3234567 },
        { occurredAt: "언젠가", description: "커피", withdrawal: 4500, deposit: 0, balanceAfter: 3230067 },
      ],
    };
    await expect(importStatement(db, parsed)).rejects.toThrow();
    expect(await db.select().from(bankAccounts)).toHaveLength(0);
    expect(await db.select().from(transactions)).toHaveLength(0);
    expect(await db.select().from(uploads)).toHaveLength(0);
  });

  it("returns 400 without a file and 404 for an unknown account", async () => {
    const res = await postUpload(
      new Request("http://localhost/api/assets/upload", { method: "POST", body: new FormData(), headers: { cookie } }),
    );
    expect(res.status).toBe(400);
    const res2 = await upload(statement(NOV_ROWS, { account: null }), "00000000-0000-0000-0000-000000000000");
    expect(res2.status).toBe(404);
  });

  it("older file uploaded later keeps latest balance", async () => {
    await upload(statement(NOV_ROWS));
    const october = statement(
      [
        ["2026.10.02", "10:00:00", "급여", "", "3,200,000", "", "3,400,000"],
        ["2026.10.20", "10:00:00", "카드", "1,881,033", "", "카드대금", "1,518,967"],
      ],
      { period: "2026.10.01 ~ 2026.10.31" },
    );
    const res = await upload(october);
    expect(await res.json()).toMatchObject({ inserted: 2, account: { balance: 3234567, asOf: "2026-11-10" } });

    const s = await summary();
    expect(s.accounts).toHaveLength(1);
    expect(s.accounts[0]).toMatchObject({ balance: 3234567, asOf: "2026-11-10" });
    expect(s.total).toBe(3234567);
  });

  it("uses the latest transaction date as 기준 시점 when the file has no period", async () => {
    const res = await upload(statement(NOV_ROWS.slice(0, 3), { period: null }));
    expect((await res.json()).account.asOf).toBe("2026-11-09");
  });
});

describe("transfers and flow", () => {
  const savingsRows = [["2026.11.05", "12:00:02", "입금", "", "500,000", "적금 납입", "2,500,000"]];

  it("detects transfers between own accounts and keeps them out of the month flow", async () => {
    await upload(statement(NOV_ROWS));
    await upload(statement(savingsRows, { account: "230-45-678901", title: "신한 적금 거래내역" }));

    const s = await summary();
    expect(s.accounts.map((a) => [a.kind, a.name])).toEqual([
      ["checking", "신한 입출금"],
      ["savings", "신한 적금"],
    ]);
    expect(s.total).toBe(3234567 + 2500000);
    expect(s.flow).toEqual({ month: "2026-11", deposit: 3200000, withdrawal: 984400, transfer: 500000 });

    const checkingTxns = await txnsOf(s.accounts[0].id);
    expect(checkingTxns.filter((t) => t.isTransfer).map((t) => t.description)).toEqual(["적금"]);
    expect((await txnsOf(s.accounts[1].id))[0].isTransfer).toBe(true);
  });

  it("a manual transfer choice is not overwritten by later detection", async () => {
    await upload(statement(NOV_ROWS));
    await upload(statement(savingsRows, { account: "230-45-678901", title: "신한 적금 거래내역" }));
    const s = await summary();
    const transfer = (await txnsOf(s.accounts[0].id)).find((t) => t.isTransfer)!;

    const res = await patchTxn(jsonRequest(`http://localhost/api/assets/txns/${transfer.id}`, "PATCH", { isTransfer: false }), {
      params: Promise.resolve({ id: transfer.id }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).txn).toMatchObject({ id: transfer.id, isTransfer: false });

    // Uploading again reruns detection for November; the override stays.
    await upload(statement(NOV_ROWS));
    const [row] = await db.select().from(transactions).where(eq(transactions.id, transfer.id));
    expect(row).toMatchObject({ isTransfer: false, transferOverridden: true });
    expect((await summary()).flow.withdrawal).toBe(984400 + 500000);
  });

  it("PATCH txn validates input and 404s for unknown ids", async () => {
    const id = "00000000-0000-0000-0000-000000000000";
    const res = await patchTxn(jsonRequest(`http://localhost/api/assets/txns/${id}`, "PATCH", { isTransfer: true }), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(404);
    const res2 = await patchTxn(jsonRequest(`http://localhost/api/assets/txns/${id}`, "PATCH", { isTransfer: "yes" }), {
      params: Promise.resolve({ id }),
    });
    expect(res2.status).toBe(400);
  });
});

describe("GET /api/assets/accounts/[id]/txns", () => {
  it("returns transactions in date order within from/to", async () => {
    const res = await upload(statement([...NOV_ROWS].reverse()));
    const { account } = await res.json();

    const all = await txnsOf(account.id);
    expect(all.map((t) => t.occurredAt)).toEqual([
      "2026-11-03T08:30:00+09:00",
      "2026-11-05T12:00:01+09:00",
      "2026-11-09T18:20:00+09:00",
      "2026-11-10T09:00:00+09:00",
    ]);
    expect(all[0]).toEqual({
      id: expect.any(String),
      accountId: account.id,
      occurredAt: "2026-11-03T08:30:00+09:00",
      description: "관리비",
      withdrawal: 182000,
      deposit: 0,
      balanceAfter: 1336967,
      isTransfer: false,
    });

    const some = await txnsOf(account.id, "?from=2026-11-05&to=2026-11-09");
    expect(some.map((t) => t.description)).toEqual(["적금", "카드대금"]);
  });

  it("rejects a bad date and 404s for an unknown account", async () => {
    const id = "00000000-0000-0000-0000-000000000000";
    const res = await getTxns(new Request(`http://localhost/api/assets/accounts/${id}/txns`, { headers: { cookie } }), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(404);
    const { account } = await (await upload(statement(NOV_ROWS))).json();
    const res2 = await getTxns(
      new Request(`http://localhost/api/assets/accounts/${account.id}/txns?from=11월`, { headers: { cookie } }),
      { params: Promise.resolve({ id: account.id }) },
    );
    expect(res2.status).toBe(400);
  });
});

describe("accounts", () => {
  it("creates, lists and renames accounts", async () => {
    const res = await postAccount(
      jsonRequest("http://localhost/api/assets/accounts", "POST", { kind: "investment", name: "신한투자증권" }),
    );
    expect(res.status).toBe(201);
    const { account } = await res.json();
    expect(account).toMatchObject({ kind: "investment", name: "신한투자증권", balance: null, asOf: null, stale: true });

    const renamed = await patchAccount(
      jsonRequest(`http://localhost/api/assets/accounts/${account.id}`, "PATCH", { name: "  ISA 계좌 " }),
      { params: Promise.resolve({ id: account.id }) },
    );
    expect((await renamed.json()).account.name).toBe("ISA 계좌");

    const list = await getAccounts(new Request("http://localhost/api/assets/accounts", { headers: { cookie } }));
    expect((await list.json()).accounts.map((a: BankAccount) => a.name)).toEqual(["ISA 계좌"]);
  });

  it("validates account input", async () => {
    const bad = await postAccount(jsonRequest("http://localhost/api/assets/accounts", "POST", { kind: "loan", name: "x" }));
    expect(bad.status).toBe(400);
    const empty = await postAccount(jsonRequest("http://localhost/api/assets/accounts", "POST", { kind: "savings", name: " " }));
    expect(empty.status).toBe(400);
    const id = "00000000-0000-0000-0000-000000000000";
    const missing = await patchAccount(jsonRequest(`http://localhost/api/assets/accounts/${id}`, "PATCH", { name: "a" }), {
      params: Promise.resolve({ id }),
    });
    expect(missing.status).toBe(404);
  });

  it("investment valuation sets balance and stale by enteredAt", async () => {
    const { account } = await (
      await postAccount(jsonRequest("http://localhost/api/assets/accounts", "POST", { kind: "investment", name: "신한 투자" }))
    ).json();

    const res = await putValuation(
      jsonRequest(`http://localhost/api/assets/accounts/${account.id}/valuation`, "PUT", { amount: 5_000_000 }),
      { params: Promise.resolve({ id: account.id }) },
    );
    expect(res.status).toBe(200);
    const saved: BankAccount = (await res.json()).account;
    expect(saved).toMatchObject({ balance: 5_000_000, asOf: seoulToday(), stale: false });
    expect(saved.manualValuation?.amount).toBe(5_000_000);

    // Entered 18 days ago → stale, and the reference date is the entry date.
    const enteredAt = new Date(Date.now() - 18 * 86_400_000);
    await db.update(bankAccounts).set({ manualEnteredAt: enteredAt }).where(eq(bankAccounts.id, account.id));
    const s = await summary();
    expect(s.accounts[0]).toMatchObject({ balance: 5_000_000, asOf: seoulToday(enteredAt), stale: true });
    expect(s.total).toBe(5_000_000);
  });

  it("rejects invalid valuations", async () => {
    const { account } = await (
      await postAccount(jsonRequest("http://localhost/api/assets/accounts", "POST", { kind: "investment", name: "신한 투자" }))
    ).json();
    const put = (amount: unknown) =>
      putValuation(jsonRequest(`http://localhost/api/assets/accounts/${account.id}/valuation`, "PUT", { amount }), {
        params: Promise.resolve({ id: account.id }),
      });
    expect((await put(-1)).status).toBe(400);
    expect((await put(1.5)).status).toBe(400);
    expect((await put("5,000")).status).toBe(400);
  });
});

describe("GET /api/assets/summary", () => {
  it("is empty without accounts", async () => {
    expect(await summary()).toEqual({
      accounts: [],
      total: 0,
      flow: { month: "2026-11", deposit: 0, withdrawal: 0, transfer: 0 },
    });
  });

  it("defaults the flow to this Seoul month", async () => {
    const res = await getSummary(new Request("http://localhost/api/assets/summary", { headers: { cookie } }));
    expect((await res.json()).flow.month).toBe(seoulToday().slice(0, 7));
  });
});

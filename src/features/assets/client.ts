import type { AccountKind, AssetsSummary, BankAccount, Txn } from "@/shared/contracts";

// Browser-side wrappers for /api/assets/*. Errors throw AssetsApiError whose
// message is the server's Korean `{ message }`, ready to show as-is.

export class AssetsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AssetsApiError";
  }
}

const NETWORK_MESSAGE = "서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 해 주세요.";
const UNKNOWN_MESSAGE = "요청을 처리하지 못했어요. 잠시 뒤에 다시 해 주세요.";

async function send(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { credentials: "same-origin", ...init });
  } catch {
    throw new AssetsApiError(NETWORK_MESSAGE, 0);
  }
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: unknown };
    if (typeof body.message === "string" && body.message) return body.message;
  } catch {
    // not JSON
  }
  return UNKNOWN_MESSAGE;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await send(url, init);
  if (!res.ok) throw new AssetsApiError(await errorMessage(res), res.status);
  return (await res.json()) as T;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

/** GET /api/assets/summary (flow of this Seoul month, or `month` 'YYYY-MM'). */
export function fetchSummary(month?: string): Promise<AssetsSummary> {
  const query = month ? `?month=${encodeURIComponent(month)}` : "";
  return request<AssetsSummary>(`/api/assets/summary${query}`);
}

/** GET /api/assets/accounts */
export async function fetchAccounts(): Promise<BankAccount[]> {
  return (await request<{ accounts: BankAccount[] }>("/api/assets/accounts")).accounts;
}

/** GET /api/assets/accounts/[id]/txns?from&to — Seoul dates 'YYYY-MM-DD', inclusive. Oldest first. */
export async function fetchTxns(accountId: string, range: { from?: string; to?: string } = {}): Promise<Txn[]> {
  const params = new URLSearchParams();
  if (range.from) params.set("from", range.from);
  if (range.to) params.set("to", range.to);
  const query = params.toString() ? `?${params.toString()}` : "";
  const url = `/api/assets/accounts/${encodeURIComponent(accountId)}/txns${query}`;
  return (await request<{ txns: Txn[] }>(url)).txns;
}

export type UploadResult =
  | { status: "ok"; account: BankAccount; inserted: number; skipped: number }
  /** 409: the file has no account number; ask which account and upload again with accountId. */
  | { status: "needsAccount"; message: string };

/**
 * POST /api/assets/upload. Resolves with needsAccount for a 409; throws
 * AssetsApiError for other failures (422 carries the reason to show).
 */
/** Vercel rejects function request bodies over 4.5 MB, so uploads stop at 4 MB (checked before sending, too). */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const UPLOAD_TOO_BIG_MESSAGE = "파일이 너무 커요. 조회 기간을 나눠서 4MB보다 작은 파일로 올려 주세요.";

export async function uploadStatement(file: File, accountId?: string): Promise<UploadResult> {
  if (file.size > MAX_UPLOAD_BYTES) throw new AssetsApiError(UPLOAD_TOO_BIG_MESSAGE, 413);
  const form = new FormData();
  form.set("file", file);
  if (accountId) form.set("accountId", accountId);
  const res = await send("/api/assets/upload", { method: "POST", body: form });
  if (res.status === 409) {
    const body = (await res.json().catch(() => ({}))) as { message?: string; needsAccount?: boolean };
    if (body.needsAccount) return { status: "needsAccount", message: body.message ?? "어느 계좌의 거래내역인지 골라 주세요." };
    throw new AssetsApiError(body.message ?? UNKNOWN_MESSAGE, 409);
  }
  if (!res.ok) throw new AssetsApiError(await errorMessage(res), res.status);
  const body = (await res.json()) as { account: BankAccount; inserted: number; skipped: number };
  return { status: "ok", ...body };
}

/** POST /api/assets/accounts */
export async function createAccount(input: { kind: AccountKind; name: string }): Promise<BankAccount> {
  return (await request<{ account: BankAccount }>("/api/assets/accounts", jsonInit("POST", input))).account;
}

/** PATCH /api/assets/accounts/[id] */
export async function updateAccount(id: string, patch: { name?: string; kind?: AccountKind }): Promise<BankAccount> {
  const url = `/api/assets/accounts/${encodeURIComponent(id)}`;
  return (await request<{ account: BankAccount }>(url, jsonInit("PATCH", patch))).account;
}

/** PUT /api/assets/accounts/[id]/valuation — 투자계좌 평가금액 (원). */
export async function setValuation(id: string, amount: number): Promise<BankAccount> {
  const url = `/api/assets/accounts/${encodeURIComponent(id)}/valuation`;
  return (await request<{ account: BankAccount }>(url, jsonInit("PUT", { amount }))).account;
}

/** PATCH /api/assets/txns/[id] — mark or unmark a transfer between own accounts. */
export async function setTxnTransfer(id: string, isTransfer: boolean): Promise<Txn> {
  const url = `/api/assets/txns/${encodeURIComponent(id)}`;
  return (await request<{ txn: Txn }>(url, jsonInit("PATCH", { isTransfer }))).txn;
}

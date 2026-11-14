import { z } from "zod";
import { problem } from "@/shared/http";
import { MAX_UPLOAD_BYTES, UPLOAD_TOO_BIG_MESSAGE } from "../client";

// Request parsing shared by the /api/assets/* route handlers.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (id: string) => UUID.test(id);

export const MESSAGES = {
  accountNotFound: "계좌를 찾지 못했어요. 화면을 새로 고친 뒤 다시 골라 주세요.",
  txnNotFound: "거래를 찾지 못했어요. 화면을 새로 고친 뒤 다시 해 주세요.",
  badBody: "보낸 내용을 읽지 못했어요. 화면을 새로 고친 뒤 다시 해 주세요.",
  needsAccount: "어느 계좌의 거래내역인지 골라 주세요.",
  noFile: "올릴 파일이 없어요. 거래내역 엑셀 파일을 골라 주세요.",
  tooBig: UPLOAD_TOO_BIG_MESSAGE,
  accountMismatch: "고른 계좌와 파일의 계좌번호가 달라요. 맞는 계좌를 골라 다시 올려 주세요.",
  badDate: "기간 형식이 맞지 않아요. 날짜를 2026-11-01처럼 보내 주세요.",
  badMonth: "달 형식이 맞지 않아요. 2026-11처럼 보내 주세요.",
  valuationKind: "평가금액은 투자계좌에만 입력할 수 있어요.",
} as const;

export { MAX_UPLOAD_BYTES };

export const kindSchema = z.enum(["checking", "savings", "investment"], {
  error: "계좌 종류는 입출금, 적금, 투자 중에서 골라 주세요.",
});
export const nameSchema = z
  .string({ error: "계좌 이름을 적어 주세요." })
  .trim()
  .min(1, { error: "계좌 이름을 적어 주세요." })
  .max(40, { error: "계좌 이름은 40자까지 쓸 수 있어요." });
export const amountSchema = z
  .number({ error: "금액은 0 이상의 원 단위 숫자로 적어 주세요." })
  .int({ error: "금액은 0 이상의 원 단위 숫자로 적어 주세요." })
  .min(0, { error: "금액은 0 이상의 원 단위 숫자로 적어 주세요." })
  .max(Number.MAX_SAFE_INTEGER, { error: "금액이 너무 커요. 다시 확인해 주세요." });

export const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Parses a JSON body with `schema`; a 400 problem Response when it does not match. */
export async function readJson<T>(req: Request, schema: z.ZodType<T>): Promise<{ data: T } | { error: Response }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { error: problem(400, MESSAGES.badBody) };
  }
  const result = schema.safeParse(body);
  if (!result.success) return { error: problem(400, result.error.issues[0]?.message ?? MESSAGES.badBody) };
  return { data: result.data };
}

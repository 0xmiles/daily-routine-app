import type { z } from "zod";
import { problem } from "@/shared/http";

// Request-body helpers for the memo routes.

const INVALID_BODY = "메모 요청 형식이 올바르지 않아요. 앱을 새로고침한 뒤 다시 시도해 주세요.";

/** Parses a JSON body with `schema`. Returns the data or a 400 problem response. */
export async function readBody<S extends z.ZodType>(
  req: Request,
  schema: S,
): Promise<{ ok: true; data: z.output<S> } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    const text = await req.text();
    raw = text.trim() === "" ? {} : JSON.parse(text);
  } catch {
    return { ok: false, response: problem(400, INVALID_BODY) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, response: problem(400, INVALID_BODY) };
  return { ok: true, data: parsed.data };
}

export const BLOCK_NOT_FOUND = "메모 블록을 찾지 못했어요. 다른 기기에서 지웠을 수 있으니 새로고침해 주세요.";

/**
 * The server's `{ message }` carried by a failed client call, if any.
 *
 * Client wrappers are expected to throw an Error whose `message` is the
 * server's message and whose `status` is the HTTP status (or to attach the
 * parsed body as `body`). Network failures and unknown shapes return null, so
 * callers fall back to their own sentence.
 */
export function serverMessage(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const e = error as { status?: unknown; message?: unknown; body?: { message?: unknown } | null };
  if (e.body && typeof e.body.message === "string" && e.body.message) return e.body.message;
  const status = typeof e.status === "number" ? e.status : null;
  if (status !== null && status >= 400 && status < 500 && typeof e.message === "string" && e.message) {
    return e.message;
  }
  return null;
}

export const NETWORK_ERROR = "저장하지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.";

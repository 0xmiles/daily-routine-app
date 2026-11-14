// Response helpers for Route Handlers. Error bodies are always `{ message }`.

/** JSON response. `init` may be a status code or a full ResponseInit. */
export function json(data: unknown, init?: number | ResponseInit): Response {
  const responseInit: ResponseInit = typeof init === "number" ? { status: init } : (init ?? {});
  return Response.json(data, responseInit);
}

/** Error response with body `{ message }`. `message` is shown to the user as-is. */
export function problem(status: number, message: string): Response {
  return json({ message }, status);
}

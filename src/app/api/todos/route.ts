import { createTodo, listTodos } from "@/features/todos/server/repo";
import { BAD_JSON_MESSAGE, parseCreateBody, readJson } from "@/features/todos/server/validate";
import { withUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { json, problem } from "@/shared/http";

export const dynamic = "force-dynamic";

/** GET /api/todos?view=today|all → { todos: Todo[] } (default view: all) */
export const GET = withUser(async (req) => {
  const view = new URL(req.url).searchParams.get("view") ?? "all";
  if (view !== "today" && view !== "all") {
    return problem(400, "보기 방식이 올바르지 않아요. view=today 또는 view=all로 요청해 주세요.");
  }
  return json({ todos: await listTodos(getDb(), view, new Date()) });
});

/** POST /api/todos { title, scope?, dueDate?, dueTime?, recurrence?, notify? } → 201 { todo } */
export const POST = withUser(async (req) => {
  const body = await readJson(req);
  if (body === undefined) return problem(400, BAD_JSON_MESSAGE);
  const parsed = parseCreateBody(body);
  if (!parsed.ok) return problem(400, parsed.message);
  const created = await createTodo(getDb(), parsed.value, new Date());
  if (!created.ok) return problem(400, created.message);
  return json({ todo: created.value }, 201);
});

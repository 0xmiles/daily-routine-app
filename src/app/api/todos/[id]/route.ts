import { deleteTodo, updateTodo } from "@/features/todos/server/repo";
import { BAD_JSON_MESSAGE, isUuid, parsePatchBody, readJson } from "@/features/todos/server/validate";
import { withUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { json, problem } from "@/shared/http";

const NOT_FOUND = "할 일을 찾을 수 없어요. 이미 지워졌을 수 있으니 목록을 새로 고쳐 주세요.";

/** PATCH /api/todos/:id { title?, scope?, dueDate?, dueTime?, recurrence?, notify? } → { todo } */
export const PATCH = withUser(async (req, _user, ctx: RouteContext<"/api/todos/[id]">) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return problem(404, NOT_FOUND);
  const body = await readJson(req);
  if (body === undefined) return problem(400, BAD_JSON_MESSAGE);
  const parsed = parsePatchBody(body);
  if (!parsed.ok) return problem(400, parsed.message);
  const updated = await updateTodo(getDb(), id, parsed.value, new Date());
  if (!updated) return problem(404, NOT_FOUND);
  if (!updated.ok) return problem(400, updated.message);
  return json({ todo: updated.value });
});

/** DELETE /api/todos/:id → 204 */
export const DELETE = withUser(async (_req, _user, ctx: RouteContext<"/api/todos/[id]">) => {
  const { id } = await ctx.params;
  if (!isUuid(id) || !(await deleteTodo(getDb(), id))) return problem(404, NOT_FOUND);
  return new Response(null, { status: 204 });
});

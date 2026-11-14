import { completeTodo } from "@/features/todos/server/repo";
import { isUuid } from "@/features/todos/server/validate";
import { withUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { json, problem } from "@/shared/http";

/** POST /api/todos/:id/complete → { completed: Todo, next: Todo | null } */
export const POST = withUser(async (_req, _user, ctx: RouteContext<"/api/todos/[id]/complete">) => {
  const { id } = await ctx.params;
  const result = isUuid(id) ? await completeTodo(getDb(), id, new Date()) : null;
  if (!result) return problem(404, "완료할 할 일을 찾을 수 없어요. 목록을 새로 고친 뒤 다시 시도해 주세요.");
  return json(result);
});

import { uncompleteTodo } from "@/features/todos/server/repo";
import { isUuid } from "@/features/todos/server/validate";
import { withUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { json, problem } from "@/shared/http";

/** POST /api/todos/:id/uncomplete → { todo: Todo } */
export const POST = withUser(async (_req, _user, ctx: RouteContext<"/api/todos/[id]/uncomplete">) => {
  const { id } = await ctx.params;
  const todo = isUuid(id) ? await uncompleteTodo(getDb(), id, new Date()) : null;
  if (!todo) return problem(404, "완료를 취소할 할 일을 찾을 수 없어요. 목록을 새로 고친 뒤 다시 시도해 주세요.");
  return json({ todo });
});

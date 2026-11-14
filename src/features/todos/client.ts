import type { Recurrence, Scope, Todo } from "@/shared/contracts";

// Browser-side wrappers for /api/todos. Non-2xx responses throw an Error whose
// message is the server's `{ message }` (already user-facing Korean).

export type TodoView = "today" | "all";

export interface TodoInput {
  title: string;
  scope?: Scope;
  dueDate?: string | null;
  dueTime?: string | null;
  recurrence?: Recurrence | null;
  notify?: { enabled?: boolean; offsetMin?: number | null };
}

export type TodoPatch = Partial<TodoInput>;

/**
 * Dispatched on `window` after every successful create/update/complete/
 * uncomplete/delete, so any mounted todo view (e.g. the today section after a
 * quick add) can refetch.
 */
export const TODOS_CHANGED_EVENT = "drs:todos-changed";

export class TodoApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "TodoApiError";
  }
}

const NETWORK_MESSAGE = "서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.";

async function request<T>(url: string, init: RequestInit, fallback: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      cache: "no-store",
      headers: init.body ? { "content-type": "application/json" } : undefined,
    });
  } catch {
    throw new TodoApiError(NETWORK_MESSAGE, 0);
  }
  if (!res.ok) {
    let message = fallback;
    try {
      const body = (await res.json()) as { message?: unknown };
      if (typeof body.message === "string" && body.message) message = body.message;
    } catch {
      // keep the fallback
    }
    throw new TodoApiError(message, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function announce(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(TODOS_CHANGED_EVENT));
}

const path = (id: string) => `/api/todos/${encodeURIComponent(id)}`;

export async function fetchTodos(view: TodoView): Promise<Todo[]> {
  const body = await request<{ todos: Todo[] }>(
    `/api/todos?view=${view}`,
    { method: "GET" },
    "할 일을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.",
  );
  return body.todos;
}

export async function createTodo(input: TodoInput): Promise<Todo> {
  const body = await request<{ todo: Todo }>(
    "/api/todos",
    { method: "POST", body: JSON.stringify(input) },
    "할 일을 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.",
  );
  announce();
  return body.todo;
}

export async function updateTodo(id: string, patch: TodoPatch): Promise<Todo> {
  const body = await request<{ todo: Todo }>(
    path(id),
    { method: "PATCH", body: JSON.stringify(patch) },
    "할 일을 고치지 못했어요. 잠시 뒤 다시 시도해 주세요.",
  );
  announce();
  return body.todo;
}

export async function completeTodo(id: string): Promise<{ completed: Todo; next: Todo | null }> {
  const body = await request<{ completed: Todo; next: Todo | null }>(
    `${path(id)}/complete`,
    { method: "POST" },
    "완료로 바꾸지 못했어요. 잠시 뒤 다시 시도해 주세요.",
  );
  announce();
  return body;
}

export async function uncompleteTodo(id: string): Promise<Todo> {
  const body = await request<{ todo: Todo }>(
    `${path(id)}/uncomplete`,
    { method: "POST" },
    "완료를 취소하지 못했어요. 잠시 뒤 다시 시도해 주세요.",
  );
  announce();
  return body.todo;
}

export async function deleteTodo(id: string): Promise<void> {
  await request<void>(path(id), { method: "DELETE" }, "할 일을 지우지 못했어요. 잠시 뒤 다시 시도해 주세요.");
  announce();
}

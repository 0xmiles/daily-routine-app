import { afterEach, describe, expect, it, vi } from "vitest";
import type { Todo } from "@/shared/contracts";
import { completeTodo, createTodo, deleteTodo, fetchTodos, TODOS_CHANGED_EVENT, uncompleteTodo, updateTodo } from "./client";

const sample: Todo = {
  id: "t1",
  title: "보고서 제출",
  scope: "work",
  dueDate: "2026-11-14",
  dueTime: null,
  doneAt: null,
  recurrence: null,
  seriesId: null,
  notify: { enabled: true, offsetMin: null },
};

function mockFetch(status: number, body?: unknown) {
  const fn = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
    async () =>
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("todos client", () => {
  it("fetchTodos reads the view", async () => {
    const fetchMock = mockFetch(200, { todos: [sample] });
    expect(await fetchTodos("today")).toEqual([sample]);
    expect(fetchMock).toHaveBeenCalledWith("/api/todos?view=today", expect.objectContaining({ cache: "no-store" }));
  });

  it("createTodo posts JSON and returns the todo", async () => {
    const fetchMock = mockFetch(201, { todo: sample });
    expect(await createTodo({ title: "보고서 제출" })).toEqual(sample);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/todos");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ title: "보고서 제출" });
  });

  it("throws an Error with the server's message on non-2xx", async () => {
    mockFetch(400, { message: "제목을 적어 주세요." });
    await expect(createTodo({ title: "" })).rejects.toThrow("제목을 적어 주세요.");
    mockFetch(500);
    await expect(fetchTodos("all")).rejects.toThrow(/할 일/);
  });

  it("update, complete, uncomplete and delete hit their routes", async () => {
    const fetchMock = mockFetch(200, { todo: sample });
    await updateTodo("t1", { title: "x" });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/todos/t1");

    mockFetch(200, { completed: sample, next: null });
    expect(await completeTodo("t1")).toEqual({ completed: sample, next: null });

    mockFetch(200, { todo: sample });
    expect(await uncompleteTodo("t1")).toEqual(sample);

    const del = mockFetch(204);
    await expect(deleteTodo("t1")).resolves.toBeUndefined();
    expect(del.mock.calls[0][1]?.method).toBe("DELETE");
  });

  it("announces changes so other views can refresh", async () => {
    const target = new EventTarget();
    vi.stubGlobal("window", target);
    const listener = vi.fn();
    target.addEventListener(TODOS_CHANGED_EVENT, listener);
    mockFetch(201, { todo: sample });
    await createTodo({ title: "a" });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

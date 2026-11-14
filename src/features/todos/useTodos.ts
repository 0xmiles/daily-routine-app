"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Todo } from "@/shared/contracts";
import { completeTodo, fetchTodos, TODOS_CHANGED_EVENT, uncompleteTodo, type TodoView } from "./client";

export type TodosStatus = "loading" | "ready" | "error";

export interface UseTodos {
  todos: Todo[];
  status: TodosStatus;
  /** Last load/toggle error (user-facing), or null. */
  error: string | null;
  /** Reference time for buckets/labels; refreshed every minute and after each load. */
  now: Date;
  reload: () => Promise<void>;
  /** Optimistically checks/unchecks, then lets the refetch settle the list. */
  toggle: (todo: Todo, done: boolean) => Promise<void>;
}

const messageOf = (error: unknown) =>
  error instanceof Error && error.message ? error.message : "할 일을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.";

/**
 * Loads todos for a view and keeps them fresh: refetches after any todo change
 * made through client.ts (TODOS_CHANGED_EVENT, e.g. quick add) and when the
 * page becomes visible again (another device may have changed them).
 */
export function useTodos(view: TodoView): UseTodos {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [status, setStatus] = useState<TodosStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const latest = useRef(0);

  const reload = useCallback((): Promise<void> => {
    const request = ++latest.current;
    return fetchTodos(view).then(
      (next) => {
        if (request !== latest.current) return;
        setTodos(next);
        setStatus("ready");
        setError(null);
        setNow(new Date());
      },
      (err: unknown) => {
        if (request !== latest.current) return;
        setError(messageOf(err));
        setStatus((s) => (s === "ready" ? "ready" : "error"));
      },
    );
  }, [view]);

  useEffect(() => {
    void reload();
    const onChanged = () => void reload();
    const onVisible = () => {
      if (document.visibilityState === "visible") void reload();
    };
    window.addEventListener(TODOS_CHANGED_EVENT, onChanged);
    document.addEventListener("visibilitychange", onVisible);
    const tick = window.setInterval(() => setNow(new Date()), 60_000);
    return () => {
      window.removeEventListener(TODOS_CHANGED_EVENT, onChanged);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(tick);
    };
  }, [reload]);

  const toggle = useCallback(
    async (todo: Todo, done: boolean) => {
      const doneAt = done ? new Date().toISOString() : null;
      setTodos((list) => list.map((t) => (t.id === todo.id ? { ...t, doneAt } : t)));
      try {
        // Success dispatches TODOS_CHANGED_EVENT, which refetches (next occurrence included).
        if (done) await completeTodo(todo.id);
        else await uncompleteTodo(todo.id);
      } catch (err) {
        await reload(); // undo the optimistic change
        setError(messageOf(err));
      }
    },
    [reload],
  );

  return { todos, status, error, now, reload, toggle };
}

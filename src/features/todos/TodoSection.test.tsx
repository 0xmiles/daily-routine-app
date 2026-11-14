import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Todo } from "@/shared/contracts";
import { addDays, seoulToday } from "@/shared/time";
import { TodoEditorSheet } from "./TodoEditorSheet";
import { TodoSection } from "./TodoSection";

function todo(partial: Partial<Todo>): Todo {
  return {
    id: "t1",
    title: "보고서 제출",
    scope: "work",
    dueDate: null,
    dueTime: null,
    doneAt: null,
    recurrence: null,
    seriesId: null,
    notify: { enabled: true, offsetMin: null },
    ...partial,
  };
}

type Handler = (url: string, init: RequestInit) => unknown;
let calls: Array<{ url: string; method: string; body: unknown }>;

function routeFetch(handler: Handler) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    calls.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const result = handler(url, { ...init, method });
    return new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json" } });
  });
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TodoSection", () => {
  it("loads today's todos, shows the heading with the open count, and refreshes after a toggle", async () => {
    const today = seoulToday();
    let server = [
      todo({ id: "late", title: "보고서 제출", dueDate: addDays(today, -1) }),
      todo({ id: "now", title: "PR 리뷰", dueDate: today }),
    ];
    routeFetch((url, init) => {
      if (url === "/api/todos?view=today") return { todos: server };
      if (url === "/api/todos/now/complete" && init.method === "POST") {
        server = server.map((t) => (t.id === "now" ? { ...t, doneAt: new Date().toISOString() } : t));
        return { completed: server[1], next: null };
      }
      throw new Error(`unexpected ${init.method} ${url}`);
    });

    render(<TodoSection view="today" />);
    const section = await screen.findByRole("region", { name: "할 일" });
    await within(section).findByText("보고서 제출");
    expect(within(section).getByText("어제까지").className).toContain("late");
    expect(section.textContent).toContain("2개 남음");

    await userEvent.click(within(section).getByRole("checkbox", { name: "PR 리뷰 완료" }));
    expect(calls.some((c) => c.url === "/api/todos/now/complete" && c.method === "POST")).toBe(true);
    await waitFor(() => expect(section.textContent).toContain("1개 남음"));
    expect(calls.filter((c) => c.url === "/api/todos?view=today").length).toBeGreaterThanOrEqual(2);
    expect((within(section).getByRole("checkbox", { name: "PR 리뷰 완료" }) as HTMLInputElement).checked).toBe(true);
  });

  it("inline 할 일 추가 opens the editor and saves a todo due today", async () => {
    const today = seoulToday();
    const server: Todo[] = [];
    routeFetch((url, init) => {
      if (url === "/api/todos?view=today") return { todos: server };
      if (url === "/api/todos" && init.method === "POST") {
        const created = todo({ id: "new", title: "우유 사기", scope: "personal", dueDate: today });
        server.push(created);
        return { todo: created };
      }
      throw new Error(`unexpected ${init.method} ${url}`);
    });

    render(<TodoSection view="today" />);
    expect(await screen.findByText("오늘 마감인 할 일이 없어요.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "할 일 추가" }));
    const dialog = screen.getByRole("dialog", { name: "할 일 추가" });
    await userEvent.type(within(dialog).getByLabelText("제목"), "우유 사기");
    await userEvent.click(within(dialog).getByRole("button", { name: "추가하기" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const post = calls.find((c) => c.url === "/api/todos" && c.method === "POST");
    expect(post?.body).toMatchObject({ title: "우유 사기", scope: "personal", dueDate: today, dueTime: null, recurrence: null });
    expect(await screen.findByText("우유 사기")).toBeTruthy();
  });
});

describe("TodoEditorSheet", () => {
  it("does not save without a title", async () => {
    routeFetch(() => {
      throw new Error("should not be called");
    });
    render(<TodoEditorSheet open onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "추가하기" }));
    expect(screen.getByRole("alert").textContent).toBe("제목을 적어 주세요.");
    expect(calls).toHaveLength(0);
  });

  it("edits a weekly todo and shows the server's error message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "마감 시간을 정하려면 마감 날짜도 골라 주세요." }), { status: 400 }),
    );
    const t = todo({ id: "w", title: "운동", dueDate: "2026-11-14", recurrence: { freq: "weekly", weekdays: [6] } });
    render(<TodoEditorSheet open todo={t} onClose={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: "할 일 고치기" });
    expect((within(dialog).getByLabelText("반복") as HTMLSelectElement).value).toBe("weekly");
    expect(within(dialog).getByRole("button", { name: "토" }).getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(within(dialog).getByRole("button", { name: "월" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "저장하기" }));
    expect(await within(dialog).findByText("마감 시간을 정하려면 마감 날짜도 골라 주세요.")).toBeTruthy();
    const [url, init] = vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/todos/w");
    expect(JSON.parse(String(init.body)).recurrence).toEqual({ freq: "weekly", weekdays: [1, 6] });
  });
});

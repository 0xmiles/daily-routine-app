import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Todo } from "@/shared/contracts";
import { addDays, seoulToday } from "@/shared/time";
import { TodoListPage } from "./TodoListPage";

function todo(partial: Partial<Todo>): Todo {
  return {
    id: "t",
    title: "x",
    scope: "personal",
    dueDate: null,
    dueTime: null,
    doneAt: null,
    recurrence: null,
    seriesId: null,
    notify: { enabled: true, offsetMin: null },
    ...partial,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TodoListPage", () => {
  it("groups into sections, filters by scope and reveals done todos", async () => {
    const today = seoulToday();
    const todos = [
      todo({ id: "a", title: "보고서 제출", scope: "work", dueDate: addDays(today, -1) }),
      todo({ id: "b", title: "장보기", dueDate: today }),
      todo({ id: "c", title: "PR 리뷰", scope: "work", dueDate: addDays(today, 3), dueTime: "18:00" }),
      todo({ id: "d", title: "책 읽기" }),
      todo({ id: "e", title: "끝난 일", dueDate: today, doneAt: new Date().toISOString() }),
    ];
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(JSON.stringify({ todos }), { status: 200, headers: { "content-type": "application/json" } }),
    );

    render(<TodoListPage />);
    const late = await screen.findByRole("region", { name: "지연" });
    expect(within(late).getByText("보고서 제출")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "오늘" })).getByText("장보기")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "다가오는 마감" })).getByText("PR 리뷰")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "날짜 없음" })).getByText("책 읽기")).toBeTruthy();
    expect(screen.queryByText("끝난 일")).toBeNull();
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/todos?view=all");

    await userEvent.click(screen.getByRole("radio", { name: "회사" }));
    expect(screen.queryByText("장보기")).toBeNull();
    expect(screen.queryByRole("region", { name: "날짜 없음" })).toBeNull();
    expect(screen.getByText("보고서 제출")).toBeTruthy();

    await userEvent.click(screen.getByRole("radio", { name: "전체" }));
    const toggle = screen.getByRole("button", { name: "완료한 것 보기" });
    await userEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(within(screen.getByRole("region", { name: "완료한 것" })).getByText("끝난 일")).toBeTruthy();
  });
});

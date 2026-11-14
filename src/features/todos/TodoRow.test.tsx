import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Todo } from "@/shared/contracts";
import { TodoRow } from "./TodoRow";

function todo(partial: Partial<Todo> = {}): Todo {
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

// 2026-11-14 (Sat) 12:00 KST
const NOW = new Date("2026-11-14T03:00:00Z");

describe("TodoRow", () => {
  it("overdue row shows 어제까지 in sun color class", () => {
    render(<TodoRow todo={todo({ dueDate: "2026-11-13" })} now={NOW} onToggle={() => {}} onOpen={() => {}} />);
    const late = screen.getByText("어제까지");
    expect(late.className).toContain("late");
    // The checkbox border turns --sun as well.
    expect(screen.getByRole("checkbox", { name: "보고서 제출 완료" }).closest("label")?.className).toContain("late");
  });

  it("weekly recurrence label 매주 토", () => {
    render(
      <TodoRow
        todo={todo({ title: "운동", scope: "personal", dueDate: "2026-11-14", recurrence: { freq: "weekly", weekdays: [6] } })}
        now={NOW}
        onToggle={() => {}}
        onOpen={() => {}}
      />,
    );
    const label = screen.getByText("매주 토");
    expect(label.className).not.toContain("late");
    expect(screen.getByRole("checkbox", { name: "운동 완료" }).closest("label")?.className).not.toContain("late");
  });

  it("other-day due shows 16일 18:00 with numbers in .num", () => {
    render(
      <TodoRow todo={todo({ dueDate: "2026-11-16", dueTime: "18:00" })} now={NOW} onToggle={() => {}} onOpen={() => {}} />,
    );
    const meta = screen.getByText((_, el) => el?.tagName === "SPAN" && el.className.includes("meta"));
    expect(meta.textContent).toBe("16일 18:00");
    expect(screen.getByText("18:00").className).toContain("num");
  });

  it("toggles and opens", async () => {
    const onToggle = vi.fn();
    const onOpen = vi.fn();
    const t = todo({ dueDate: "2026-11-14" });
    render(<TodoRow todo={t} now={NOW} onToggle={onToggle} onOpen={onOpen} />);
    await userEvent.click(screen.getByRole("checkbox", { name: "보고서 제출 완료" }));
    expect(onToggle).toHaveBeenCalledWith(t, true);
    await userEvent.click(screen.getByRole("button", { name: /보고서 제출/ }));
    expect(onOpen).toHaveBeenCalledWith(t);
  });

  it("done row is checked and shows the scope tag", () => {
    render(
      <TodoRow
        todo={todo({ dueDate: "2026-11-13", doneAt: "2026-11-14T01:00:00.000Z" })}
        now={NOW}
        onToggle={() => {}}
        onOpen={() => {}}
      />,
    );
    const box = screen.getByRole("checkbox", { name: "보고서 제출 완료" }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(box.closest("label")?.className).not.toContain("late");
    expect(screen.getByText("회사")).toBeTruthy();
  });
});

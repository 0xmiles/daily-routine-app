import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DateLeaf } from "./DateLeaf";

const counts = { events: 2, todos: 4, done: 1 };

describe("DateLeaf", () => {
  it("saturday numeral uses sat color", () => {
    render(<DateLeaf date="2026-11-14" counts={counts} />);
    const numeral = screen.getByText("14");
    expect(numeral.className).toContain("sat");
    expect(numeral.className).not.toContain("sun");
    expect(screen.getByText("토요일").className).toContain("sat");
    expect(screen.getByText("2026")).toBeTruthy();
    expect(screen.getByText(/11월/)).toBeTruthy();
  });

  it("sunday uses sun color", () => {
    render(<DateLeaf date="2026-11-15" counts={counts} />);
    expect(screen.getByText("15").className).toContain("sun");
    expect(screen.getByText("일요일").className).toContain("sun");
  });

  it("weekday uses ink color", () => {
    render(<DateLeaf date="2026-11-16" counts={counts} />);
    expect(screen.getByText("16").className).toContain("ink");
  });

  it("holiday weekday uses sun color", () => {
    // 2026-12-25 is a Friday.
    render(<DateLeaf date="2026-12-25" counts={counts} holiday="기독탄신일" />);
    expect(screen.getByText("25").className).toContain("sun");
    expect(screen.getByText("금요일").className).toContain("sun");
    expect(screen.getByText("기독탄신일")).toBeTruthy();
  });

  it("summary sentence", () => {
    render(<DateLeaf date="2026-11-14" counts={counts} />);
    expect(screen.getByTestId("leaf-summary").textContent).toBe("일정 2개, 할 일 4개 중 1개 끝냄");
  });

  it("summary without todos or events", () => {
    render(<DateLeaf date="2026-11-14" counts={{ events: 0, todos: 0, done: 0 }} />);
    expect(screen.getByTestId("leaf-summary").textContent).toBe("일정 없음, 할 일 없음");
  });

  it("shows late todos in a separate line", () => {
    render(<DateLeaf date="2026-11-14" counts={{ ...counts, late: 1 }} />);
    expect(screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "늦은 할 일 1개")).toBeTruthy();
  });
});

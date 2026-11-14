import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button";
import { Checkbox } from "./Checkbox";
import { Sheet } from "./Sheet";
import { Tag } from "./Tag";

describe("Tag", () => {
  it("work is filled, personal is outlined, with Korean labels", () => {
    render(
      <>
        <Tag scope="work" />
        <Tag scope="personal" />
      </>,
    );
    expect(screen.getByText("회사").className).toContain("work");
    expect(screen.getByText("개인").className).toContain("personal");
  });
});

describe("Checkbox", () => {
  it("calls onChange with the next checked value and marks late", async () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} late onChange={onChange} label="보고서 제출 완료" />);
    const box = screen.getByRole("checkbox", { name: "보고서 제출 완료" });
    expect((box as HTMLInputElement).checked).toBe(false);
    expect(box.closest("label")?.className).toContain("late");
    await userEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("is keyboard operable", async () => {
    const onChange = vi.fn();
    render(<Checkbox checked onChange={onChange} label="완료" />);
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole("checkbox"));
    await userEvent.keyboard(" ");
    expect(onChange).toHaveBeenCalledWith(false);
  });
});

describe("Button", () => {
  it("defaults to type=button and applies the variant", () => {
    render(<Button variant="outline">거래내역 엑셀 올리기</Button>);
    const button = screen.getByRole("button", { name: "거래내역 엑셀 올리기" });
    expect(button.getAttribute("type")).toBe("button");
    expect(button.className).toContain("outline");
  });

  it("defaults to the ink variant", () => {
    render(<Button>메모 쓰기</Button>);
    expect(screen.getByRole("button").className).toContain("ink");
  });
});

describe("Sheet", () => {
  function Harness({ onClose }: { onClose?: () => void }) {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          열기
        </button>
        <Sheet
          open={open}
          title="할 일 고치기"
          onClose={() => {
            onClose?.();
            setOpen(false);
          }}
        >
          <input aria-label="제목" />
        </Sheet>
      </>
    );
  }

  it("renders nothing when closed", () => {
    render(
      <Sheet open={false} onClose={() => {}} title="x">
        내용
      </Sheet>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is a labelled modal dialog", () => {
    render(<Harness />);
    const dialog = screen.getByRole("dialog", { name: "할 일 고치기" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on backdrop click but not on panel click", async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.click(screen.getByLabelText("제목"));
    expect(onClose).not.toHaveBeenCalled();
    const backdrop = document.querySelector("[data-sheet-backdrop]");
    expect(backdrop).not.toBeNull();
    await userEvent.click(backdrop as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("has a close button and moves focus into the dialog", async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps Tab focus inside the dialog", async () => {
    render(<Harness />);
    const dialog = screen.getByRole("dialog");
    for (let i = 0; i < 4; i++) {
      await userEvent.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await userEvent.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/today", push: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push, replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/features/todos/client", () => ({
  createTodo: vi.fn(async (input: { title: string }) => ({ id: "t1", ...input })),
  fetchTodos: vi.fn(async () => []),
}));
vi.mock("@/features/calendar/client", () => ({
  createEvent: vi.fn(async (input: object) => ({ id: "e1", ...input })),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
  fetchEvents: vi.fn(async () => ({ events: [], workStatus: "connected", personalConnected: true })),
}));
vi.mock("@/features/todos/TodoEditorSheet", () => ({
  TodoEditorSheet: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="할 일 자세히" /> : null),
}));

import { createEvent, fetchEvents } from "@/features/calendar/client";
import { createTodo } from "@/features/todos/client";
import { AppShell } from "./AppShell";
import { resetPersonalConnectedForTests } from "./personalConnection";

function setWide(wide: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("min-width: 900px") ? wide : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function renderShell() {
  return render(
    <AppShell>
      <p>본문</p>
    </AppShell>,
  );
}

beforeEach(() => {
  nav.pathname = "/today";
  localStorage.clear();
  delete document.body.dataset.editing;
  resetPersonalConnectedForTests();
  vi.mocked(createTodo).mockClear();
  vi.mocked(createEvent).mockClear();
  vi.mocked(fetchEvents).mockResolvedValue({ events: [], workStatus: "connected", personalConnected: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("AppShell narrow (<900px)", () => {
  it("narrow shows bottom tabs", () => {
    setWide(false);
    renderShell();
    const tabs = screen.getByRole("navigation", { name: "주 메뉴" });
    const links = within(tabs).getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual(["할 일", "메모", "자산"]);
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/today", "/memo", "/assets"]);
    // The active tab label is highlighted.
    const active = within(tabs).getByRole("link", { name: "할 일" });
    expect(active.getAttribute("aria-current")).toBe("page");
    expect(active.querySelector(".hl")?.textContent).toBe("할 일");
    expect(screen.getByRole("button", { name: "빠른 추가" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "메뉴 열기" })).toBeNull();
    expect(screen.getByText("본문")).toBeTruthy();
  });

  it("marks 메모 active on /memo", () => {
    setWide(false);
    nav.pathname = "/memo";
    renderShell();
    expect(screen.getByRole("link", { name: "메모" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "할 일" }).getAttribute("aria-current")).toBeNull();
  });

  it("hides the tab bar while the memo editor sets body[data-editing]", async () => {
    setWide(false);
    renderShell();
    expect(screen.queryByRole("navigation", { name: "주 메뉴" })).toBeTruthy();
    act(() => {
      document.body.dataset.editing = "true";
    });
    await waitFor(() => expect(screen.queryByRole("navigation", { name: "주 메뉴" })).toBeNull());
    act(() => {
      document.body.dataset.editing = "false";
    });
    await waitFor(() => expect(screen.queryByRole("navigation", { name: "주 메뉴" })).toBeTruthy());
  });
});

describe("AppShell wide (≥900px)", () => {
  it("wide shows drawer toggle and Cmd+Backslash toggles", async () => {
    setWide(true);
    renderShell();
    expect(screen.queryByRole("navigation", { name: "주 메뉴" })).toBeNull();
    const toggle = screen.getByRole("button", { name: "메뉴 열기" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("navigation", { name: "전체 메뉴" })).toBeNull();

    await userEvent.click(toggle);
    expect(screen.getByRole("navigation", { name: "전체 메뉴" })).toBeTruthy();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    fireEvent.keyDown(document, { key: "\\", code: "Backslash", metaKey: true });
    expect(screen.queryByRole("navigation", { name: "전체 메뉴" })).toBeNull();

    // Korean keyboard layouts produce ₩ on the backslash key.
    fireEvent.keyDown(document, { key: "₩", code: "Backslash", metaKey: true });
    expect(screen.getByRole("navigation", { name: "전체 메뉴" })).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("navigation", { name: "전체 메뉴" })).toBeNull();
  });

  it("drawer lists the menu and closes when an item is chosen", async () => {
    setWide(true);
    renderShell();
    await userEvent.click(screen.getByRole("button", { name: "메뉴 열기" }));
    const drawer = screen.getByRole("navigation", { name: "전체 메뉴" });
    const labels = within(drawer)
      .getAllByRole("link")
      .map((a) => a.textContent);
    expect(labels).toEqual(["할 일", "오늘", "달력", "목록", "메모", "자산", "거래내역 올리기", "설정"]);
    await userEvent.click(within(drawer).getByRole("link", { name: "메모" }));
    expect(screen.queryByRole("navigation", { name: "전체 메뉴" })).toBeNull();
  });

  it("pinning keeps the drawer as a sidebar and is remembered", async () => {
    setWide(true);
    const { unmount } = renderShell();
    await userEvent.click(screen.getByRole("button", { name: "메뉴 열기" }));
    const pin = screen.getByRole("button", { name: "고정" });
    expect(pin.getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(pin);
    expect(screen.getByRole("button", { name: "고정" }).getAttribute("aria-pressed")).toBe("true");
    // Choosing an item no longer closes a pinned drawer.
    await userEvent.click(within(screen.getByRole("navigation", { name: "전체 메뉴" })).getByRole("link", { name: "자산" }));
    expect(screen.getByRole("navigation", { name: "전체 메뉴" })).toBeTruthy();
    unmount();

    renderShell();
    await waitFor(() => expect(screen.getByRole("navigation", { name: "전체 메뉴" })).toBeTruthy());
    expect(screen.getByRole("button", { name: "고정" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("top bar shows the 오늘/달력/목록 segment on 할 일 pages", () => {
    setWide(true);
    nav.pathname = "/calendar";
    renderShell();
    const segment = screen.getByRole("navigation", { name: "할 일 보기" });
    expect(within(segment).getByRole("link", { name: "달력" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: /새로 만들기/ })).toBeTruthy();
  });

  it("does not show the segment on 메모", () => {
    setWide(true);
    nav.pathname = "/memo";
    renderShell();
    expect(screen.queryByRole("navigation", { name: "할 일 보기" })).toBeNull();
    expect(screen.getByRole("banner").textContent).toContain("메모");
  });
});

describe("QuickAdd", () => {
  it("quick add todo with title only calls createTodo", async () => {
    setWide(false);
    renderShell();
    await userEvent.click(screen.getByRole("button", { name: "빠른 추가" }));
    const dialog = screen.getByRole("dialog", { name: "빠른 추가" });
    expect(within(dialog).getByRole("radio", { name: "할 일" }).getAttribute("aria-checked")).toBe("true");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "제목" }), "보고서 제출{Enter}");
    expect(createTodo).toHaveBeenCalledTimes(1);
    expect(createTodo).toHaveBeenCalledWith({ title: "보고서 제출" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "빠른 추가" })).toBeNull());
    expect(screen.getByRole("status").textContent).toContain("할 일을 추가했어요.");
  });

  it("does not save an empty title", async () => {
    setWide(false);
    renderShell();
    await userEvent.click(screen.getByRole("button", { name: "빠른 추가" }));
    await userEvent.type(screen.getByRole("textbox", { name: "제목" }), "   {Enter}");
    expect(createTodo).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "빠른 추가" })).toBeTruthy();
  });

  it("quick add event starts at the next full hour for one hour", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-14T05:20:00Z")); // 14:20 KST
    setWide(true);
    renderShell();
    fireEvent.keyDown(document, { key: "n", metaKey: true });
    const dialog = screen.getByRole("dialog", { name: "빠른 추가" });
    await userEvent.click(within(dialog).getByRole("radio", { name: "일정" }));
    expect(await within(dialog).findByText(/15:00부터 1시간/)).toBeTruthy();
    await userEvent.type(within(dialog).getByRole("textbox", { name: "제목" }), "치과{Enter}");
    expect(createEvent).toHaveBeenCalledWith({
      title: "치과",
      start: "2026-11-14T15:00:00+09:00",
      end: "2026-11-14T16:00:00+09:00",
      allDay: false,
    });
  });

  it("event tab asks to connect the personal calendar when it isn't connected", async () => {
    vi.mocked(fetchEvents).mockResolvedValue({ events: [], workStatus: "connected", personalConnected: false });
    setWide(false);
    renderShell();
    await userEvent.click(screen.getByRole("button", { name: "빠른 추가" }));
    await userEvent.click(screen.getByRole("radio", { name: "일정" }));
    expect(await screen.findByText("개인 캘린더를 연결하면 새 일정을 추가할 수 있어요.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "설정에서 연결하기" }).getAttribute("href")).toBe("/settings");
    expect(screen.queryByRole("textbox", { name: "제목" })).toBeNull();
  });

  it("shows the server message when an event write is rejected", async () => {
    vi.mocked(createEvent).mockRejectedValueOnce(
      Object.assign(new Error("개인 캘린더가 연결되어 있지 않아요. 설정에서 연결해 주세요."), { status: 409 }),
    );
    setWide(false);
    renderShell();
    await userEvent.click(screen.getByRole("button", { name: "빠른 추가" }));
    await userEvent.click(screen.getByRole("radio", { name: "일정" }));
    await userEvent.type(await screen.findByRole("textbox", { name: "제목" }), "치과{Enter}");
    expect(await screen.findByText("개인 캘린더가 연결되어 있지 않아요. 설정에서 연결해 주세요.")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "빠른 추가" })).toBeTruthy();
  });

  it("자세히 opens the todo editor", async () => {
    setWide(false);
    renderShell();
    await userEvent.click(screen.getByRole("button", { name: "빠른 추가" }));
    await userEvent.click(screen.getByRole("button", { name: "자세히" }));
    expect(screen.queryByRole("dialog", { name: "빠른 추가" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "할 일 자세히" })).toBeTruthy();
  });
});

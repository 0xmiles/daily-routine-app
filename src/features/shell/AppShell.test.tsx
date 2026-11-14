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
import { takeNewMemoTitle } from "./events";
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
    // The current tab wears its menu's index colour, and the shell names the menu for the accent.
    expect(active.getAttribute("data-tab")).toBe("todo");
    expect(document.querySelector('[data-section="todo"]')).toBeTruthy();
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

  it("phone top bar has a settings button; on the memo tab + opens a new memo directly", async () => {
    setWide(false);
    nav.pathname = "/memo";
    const onNew = vi.fn();
    window.addEventListener("daily:new-memo", onNew);
    renderShell();
    expect(screen.getByRole("link", { name: "설정" }).getAttribute("href")).toBe("/settings");
    await userEvent.click(screen.getByRole("button", { name: "새 메모" }));
    expect(onNew).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "빠른 추가" })).toBeNull();
    window.removeEventListener("daily:new-memo", onNew);
  });

  it("hides the phone top bar while a page shows its own header (memo file)", async () => {
    setWide(false);
    nav.pathname = "/memo";
    renderShell();
    expect(screen.getByRole("banner").className).not.toMatch(/barHidden/);
    act(() => {
      document.body.dataset.ownHeader = "true";
    });
    await waitFor(() => expect(screen.getByRole("banner", { hidden: true }).className).toMatch(/barHidden/));
    act(() => {
      delete document.body.dataset.ownHeader;
    });
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
  it("메모 goes to the memo page with the typed first line", async () => {
    setWide(false);
    renderShell();
    await userEvent.click(screen.getByRole("button", { name: "빠른 추가" }));
    const dialog = screen.getByRole("dialog", { name: "빠른 추가" });
    await userEvent.click(within(dialog).getByRole("radio", { name: "메모" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "제목" }), "회의 준비{Enter}");
    // The title goes to the memo page in memory; the URL only says "new".
    expect(nav.push).toHaveBeenCalledWith("/memo?new");
    expect(takeNewMemoTitle()).toBe("회의 준비");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "빠른 추가" })).toBeNull());
  });

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

  it("quick add event asks for the day and time, prefilled with the next full hour for one hour", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-14T05:20:00Z")); // Sat 14:20 KST
    setWide(true);
    renderShell();
    fireEvent.keyDown(document, { key: "n", metaKey: true });
    const dialog = screen.getByRole("dialog", { name: "빠른 추가" });
    await userEvent.click(within(dialog).getByRole("radio", { name: "일정" }));
    expect((await within(dialog).findByLabelText<HTMLInputElement>("날짜")).value).toBe("2026-11-14");
    expect(within(dialog).getByLabelText<HTMLInputElement>("시작").value).toBe("15:00");
    expect(within(dialog).getByLabelText<HTMLInputElement>("끝").value).toBe("16:00");
    expect(within(dialog).getByText(/^11월 14일\(토\) 15:00부터 16:00까지 잡아요\./)).toBeTruthy();
    await userEvent.type(within(dialog).getByRole("textbox", { name: "제목" }), "치과{Enter}");
    expect(createEvent).toHaveBeenCalledWith({
      title: "치과",
      start: "2026-11-14T15:00:00+09:00",
      end: "2026-11-14T16:00:00+09:00",
      allDay: false,
    });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "빠른 추가" })).toBeNull());
    expect(screen.getByRole("status").textContent).toBe("일정을 11월 14일(토) 15:00에 추가했어요.");
  });

  it("quick add event saves the picked day and time; the end follows the start", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-14T05:20:00Z")); // Sat 14:20 KST
    setWide(false);
    renderShell();
    await userEvent.click(screen.getByRole("button", { name: "빠른 추가" }));
    const dialog = screen.getByRole("dialog", { name: "빠른 추가" });
    await userEvent.click(within(dialog).getByRole("radio", { name: "일정" }));
    fireEvent.change(await within(dialog).findByLabelText("날짜"), { target: { value: "2026-11-16" } });
    fireEvent.change(within(dialog).getByLabelText("시작"), { target: { value: "10:00" } });
    expect(within(dialog).getByLabelText<HTMLInputElement>("끝").value).toBe("11:00");
    fireEvent.change(within(dialog).getByLabelText("끝"), { target: { value: "11:30" } });
    expect(within(dialog).getByText(/^11월 16일\(월\) 10:00부터 11:30까지 잡아요\./)).toBeTruthy();
    await userEvent.type(within(dialog).getByRole("textbox", { name: "제목" }), "병원{Enter}");
    expect(createEvent).toHaveBeenCalledWith({
      title: "병원",
      start: "2026-11-16T10:00:00+09:00",
      end: "2026-11-16T11:30:00+09:00",
      allDay: false,
    });
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("일정을 11월 16일(월) 10:00에 추가했어요."));
  });

  it("quick add event says what to fix instead of saving a bad time", async () => {
    setWide(false);
    renderShell();
    await userEvent.click(screen.getByRole("button", { name: "빠른 추가" }));
    const dialog = screen.getByRole("dialog", { name: "빠른 추가" });
    await userEvent.click(within(dialog).getByRole("radio", { name: "일정" }));
    fireEvent.change(await within(dialog).findByLabelText("시작"), { target: { value: "15:00" } });
    fireEvent.change(within(dialog).getByLabelText("끝"), { target: { value: "14:00" } });
    await userEvent.type(within(dialog).getByRole("textbox", { name: "제목" }), "치과{Enter}");
    expect((await within(dialog).findByRole("alert")).textContent).toBe("끝나는 시간은 시작 시간보다 늦어야 해요.");

    fireEvent.change(within(dialog).getByLabelText("날짜"), { target: { value: "" } });
    expect(within(dialog).getByText("날짜와 시간을 골라 주세요.")).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "일정 추가하기" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("날짜를 골라 주세요.");
    expect(createEvent).not.toHaveBeenCalled();
  });

  it("자세히 on 일정 carries the title, day and time to the full editor", async () => {
    setWide(false);
    renderShell();
    await userEvent.click(screen.getByRole("button", { name: "빠른 추가" }));
    const quick = screen.getByRole("dialog", { name: "빠른 추가" });
    await userEvent.click(within(quick).getByRole("radio", { name: "일정" }));
    await userEvent.type(await within(quick).findByRole("textbox", { name: "제목" }), "치과");
    fireEvent.change(within(quick).getByLabelText("날짜"), { target: { value: "2026-11-20" } });
    fireEvent.change(within(quick).getByLabelText("시작"), { target: { value: "09:00" } });
    await userEvent.click(within(quick).getByRole("button", { name: "자세히" }));
    const editor = screen.getByRole("dialog", { name: "새 일정" });
    expect(within(editor).getByLabelText<HTMLInputElement>("제목").value).toBe("치과");
    expect(within(editor).getByLabelText<HTMLInputElement>("날짜").value).toBe("2026-11-20");
    expect(within(editor).getByLabelText<HTMLInputElement>("시작").value).toBe("09:00");
    expect(within(editor).getByLabelText<HTMLInputElement>("끝").value).toBe("10:00");
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

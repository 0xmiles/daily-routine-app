import { EditorView } from "@codemirror/view";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventRef, MemoBlock } from "@/shared/contracts";
import { readDrafts } from "./draft";
import { MemoPage } from "./MemoPage";

// ---- jsdom shims --------------------------------------------------------------

beforeAll(() => {
  // CodeMirror measures text through Range rects; jsdom has no layout.
  Range.prototype.getClientRects ??= () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
  Element.prototype.scrollIntoView ??= function scrollIntoView() {};
});

function mockMatchMedia(narrow: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes("max-width: 899.98px") ? narrow : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

// ---- a tiny fake /api/memo -----------------------------------------------------

interface Call {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
}

const NOW = "2026-11-14T00:12:00.000Z";

function block(overrides: Partial<MemoBlock> = {}): MemoBlock {
  return { id: "b1", content: "내 메모", createdAt: NOW, updatedAt: NOW, version: 1, eventRef: null, ...overrides };
}

const eventRef: EventRef = {
  eventKey: "work-cal:evt-1",
  calendarId: "work-cal",
  eventId: "evt-1",
  recurringEventId: null,
  source: "work",
  title: "주간 회의",
  start: "2026-11-16T10:00:00+09:00",
  end: "2026-11-16T11:00:00+09:00",
  allDay: false,
  deleted: false,
};

type Handler = (call: Call) => Response | Promise<Response>;

let calls: Call[];
let routes: Record<string, Handler>;

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

function serve(blocks: MemoBlock[], extra: Record<string, Handler> = {}) {
  let n = 100;
  routes = {
    "GET /api/memo/blocks": () => jsonResponse({ blocks }),
    "POST /api/memo/blocks": ({ body }) =>
      jsonResponse(block({ id: `b${n++}`, content: String(body?.content ?? ""), version: 1, createdAt: new Date().toISOString() }), 201),
    ...extra,
  };
}

beforeEach(() => {
  calls = [];
  localStorage.clear();
  mockMatchMedia(false);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      const call = { method, url, body };
      calls.push(call);
      const path = url.split("?")[0];
      const handler = routes[`${method} ${path}`];
      if (!handler) return jsonResponse({ message: `no route ${method} ${path}` }, 500);
      return handler(call);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete document.body.dataset.editing;
});

// ---- helpers --------------------------------------------------------------------

function editorShowing(text: string | RegExp): EditorView {
  const node = screen.getByText(text, { selector: ".cm-line" });
  const view = EditorView.findFromDOM(node.closest(".cm-editor") as HTMLElement);
  if (!view) throw new Error("no editor");
  return view;
}

function type(view: EditorView, insert: string) {
  act(() => {
    view.dispatch({ changes: { from: view.state.doc.length, insert }, userEvent: "input.type" });
  });
}

const puts = () => calls.filter((c) => c.method === "PUT");
const posts = () => calls.filter((c) => c.method === "POST");

// ---- tests ----------------------------------------------------------------------

describe("MemoPage", () => {
  it("shows the title and blocks newest first with a time header", async () => {
    serve([block({ id: "b2", content: "새 메모", createdAt: "2026-11-14T01:00:00.000Z" }), block()]);
    render(<MemoPage />);
    expect(screen.getByRole("heading", { level: 1, name: "메모" })).toBeTruthy();
    await screen.findByText("새 메모");
    const lines = [...document.querySelectorAll(".cm-line")].map((el) => el.textContent);
    expect(lines).toEqual(["새 메모", "내 메모"]);
    expect(screen.getByText("11월 14일 오전 9:12")).toBeTruthy();
    expect(screen.getByText("11월 14일 오전 10:00")).toBeTruthy();
  });

  it("debounces saves by 800ms and sends the base version", async () => {
    serve([block()], { "PUT /api/memo/blocks/b1": ({ body }) => jsonResponse(block({ content: String(body?.content), version: 2 })) });
    render(<MemoPage />);
    await screen.findByText("내 메모");
    const view = editorShowing("내 메모");
    type(view, " 하나");
    type(view, " 둘");
    await new Promise((r) => setTimeout(r, 400));
    expect(puts()).toHaveLength(0);
    await waitFor(() => expect(puts()).toHaveLength(1), { timeout: 2000 });
    expect(puts()[0].body).toEqual({ content: "내 메모 하나 둘", baseVersion: 1 });
    await waitFor(() => expect(readDrafts()).toHaveLength(0));
  });

  it("conflict creates copy block", async () => {
    serve([block()], {
      "PUT /api/memo/blocks/b1": () => jsonResponse({ current: block({ content: "다른 기기에서 쓴 내용", version: 2 }) }, 409),
    });
    render(<MemoPage />);
    await screen.findByText("내 메모");
    const view = editorShowing("내 메모");
    type(view, " 추가");

    // The local text is kept as a new block that starts with "충돌 사본 — <시각>".
    await waitFor(() => expect(posts()).toHaveLength(1), { timeout: 2500 });
    expect(String(posts()[0].body?.content)).toMatch(/^충돌 사본 — \d+월 \d+일 오[전후] \d+:\d{2}\n내 메모 추가$/);

    // The original block now shows what the other device saved.
    await waitFor(() => expect(view.state.doc.toString()).toBe("다른 기기에서 쓴 내용"));
    const copyLine = await screen.findByText(/^충돌 사본 — /, { selector: ".cm-line" });
    // New blocks go on top.
    expect(document.querySelector(".cm-line")).toBe(copyLine);
    expect(screen.getByText("내 메모 추가", { selector: ".cm-line" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("충돌 사본");
    // Nothing was silently overwritten: no PUT after the 409.
    expect(puts()).toHaveLength(1);
  });

  it("event block shows label with 일정 보기", async () => {
    serve([block({ id: "e1", content: "- ", eventRef })]);
    render(<MemoPage />);
    const title = await screen.findByText("주간 회의");
    const label = title.closest("div")!.parentElement!;
    expect(within(label).getByText("회사")).toBeTruthy();
    expect(within(label).getByText("11월 16일 월요일 10:00–11:00").className).toContain("num");
    const link = within(label).getByRole("link", { name: "일정 보기" });
    expect(link.getAttribute("href")).toBe("/calendar?date=2026-11-16");
  });

  it("deleted event keeps its memo and says 삭제된 일정", async () => {
    serve([block({ id: "e1", content: "- 회의록", eventRef: { ...eventRef, deleted: true } })]);
    render(<MemoPage />);
    expect(await screen.findByText("삭제된 일정")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "일정 보기" })).toBeNull();
    expect(document.querySelector(".cm-line")?.textContent).toBe("- 회의록");
  });

  it("offline save keeps draft", async () => {
    let online = false;
    serve([block()], {
      "PUT /api/memo/blocks/b1": ({ body }) => {
        if (!online) throw new TypeError("Failed to fetch");
        return jsonResponse(block({ content: String(body?.content), version: 2 }));
      },
    });
    const { unmount } = render(<MemoPage />);
    await screen.findByText("내 메모");
    type(editorShowing("내 메모"), " 지하철에서");

    await waitFor(() => expect(puts()).toHaveLength(1), { timeout: 2000 });
    await screen.findByText(/이 기기에 보관해 두었어요/);
    expect(readDrafts()).toMatchObject([{ id: "b1", content: "내 메모 지하철에서", baseVersion: 1 }]);

    // Reload while still offline: the draft is shown instead of the server's older text.
    unmount();
    render(<MemoPage />);
    await screen.findByText("내 메모 지하철에서", { selector: ".cm-line" });

    // Back online: the draft is sent with the version it was based on, then cleared.
    online = true;
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(puts().at(-1)?.body).toEqual({ content: "내 메모 지하철에서", baseVersion: 1 }));
    await waitFor(() => expect(readDrafts()).toHaveLength(0));
    await waitFor(() => expect(screen.queryByText(/이 기기에 보관해 두었어요/)).toBeNull());
  });

  it("empty memo pad has one empty block ready to type, saved as a new block", async () => {
    serve([]);
    render(<MemoPage />);
    await waitFor(() => expect(document.querySelectorAll(".cm-editor")).toHaveLength(1));
    const view = EditorView.findFromDOM(document.querySelector(".cm-editor") as HTMLElement)!;
    expect(view.state.doc.toString()).toBe("");
    type(view, "첫 메모");
    await waitFor(() => expect(posts()).toHaveLength(1), { timeout: 2000 });
    expect(posts()[0].body).toEqual({ content: "첫 메모" });
  });

  it("Mod-Enter makes a new block on top", async () => {
    serve([block()]);
    render(<MemoPage />);
    await screen.findByText("내 메모");
    const view = editorShowing("내 메모");
    act(() => {
      view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }));
    });
    await waitFor(() => expect(document.querySelectorAll(".cm-editor")).toHaveLength(2));
    const top = EditorView.findFromDOM(document.querySelector(".cm-editor") as HTMLElement)!;
    expect(top.state.doc.toString()).toBe("");
  });

  it("search filters blocks by content and event title; Enter jumps to the first match", async () => {
    serve([block({ id: "e1", content: "- 안건", eventRef, createdAt: "2026-11-14T02:00:00.000Z" }), block({ content: "장보기 목록" })]);
    render(<MemoPage />);
    await screen.findByText("장보기 목록");
    await userEvent.click(screen.getByRole("button", { name: "메모 검색" }));
    const input = screen.getByRole("searchbox", { name: "메모에서 찾기" });
    await userEvent.type(input, "주간");
    const sections = () => [...document.querySelectorAll("section")];
    expect(sections().map((s) => s.hidden)).toEqual([false, true]);
    expect(screen.getByText(/1개 블록에서 찾았어요/)).toBeTruthy();

    await userEvent.clear(input);
    await userEvent.type(input, "장보기");
    expect(sections().map((s) => s.hidden)).toEqual([true, false]);

    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    await userEvent.keyboard("{Enter}");
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(sections().map((s) => s.hidden)).toEqual([false, false]);
    expect(scroll.mock.contexts.at(-1)).toBe(sections()[1]);
  });

  it("Cmd/Ctrl+F opens the search", async () => {
    serve([block()]);
    render(<MemoPage />);
    await screen.findByText("내 메모");
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    expect(screen.getByRole("searchbox", { name: "메모에서 찾기" })).toBeTruthy();
  });

  it("?block=<id> scrolls to that block and activates it", async () => {
    serve([block({ id: "b2", content: "위 메모", createdAt: "2026-11-14T02:00:00.000Z" }), block({ id: "e1", content: "- ", eventRef })]);
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    render(<MemoPage focusBlockId="e1" />);
    await screen.findByText("주간 회의");
    const target = document.querySelector('section[data-block-id="e1"]')!;
    await waitFor(() => expect(scroll.mock.contexts).toContain(target));
    expect(target.hasAttribute("data-active")).toBe(true);
  });

  it("narrow screen: focusing a block shows the keyboard tool bar and marks body as editing", async () => {
    mockMatchMedia(true);
    serve([block()]);
    render(<MemoPage />);
    await screen.findByText("내 메모");
    const view = editorShowing("내 메모");
    act(() => {
      view.contentDOM.dispatchEvent(new FocusEvent("focus"));
    });
    const bar = await screen.findByRole("toolbar", { name: "메모 편집 도구" });
    for (const name of ["들여쓰기", "내어쓰기", "굵게", "새 블록", "완료"]) {
      expect(within(bar).getByRole("button", { name })).toBeTruthy();
    }
    expect(document.body.dataset.editing).toBe("true");

    act(() => {
      view.dispatch({ selection: { anchor: 0 } });
    });
    await userEvent.click(within(bar).getByRole("button", { name: "들여쓰기" }));
    expect(view.state.doc.toString()).toBe("  내 메모");

    await userEvent.click(within(bar).getByRole("button", { name: "완료" }));
    await waitFor(() => expect(screen.queryByRole("toolbar")).toBeNull());
    expect(document.body.dataset.editing).toBeUndefined();
  });

  it("shows a fix-it message when the memo pad can't load", async () => {
    serve([], { "GET /api/memo/blocks": () => Promise.reject(new TypeError("Failed to fetch")) });
    render(<MemoPage />);
    expect((await screen.findByRole("alert")).textContent).toContain("인터넷 연결을 확인한 뒤");
    expect(screen.getByRole("button", { name: "메모 다시 불러오기" })).toBeTruthy();
  });
});

import { EditorView } from "@codemirror/view";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventRef, MemoBlock, MemoFolder } from "@/shared/contracts";
import { stashNewMemoTitle } from "@/features/shell/events";
import { readDrafts } from "./draft";
import { MemoPage } from "./MemoPage";

// useSearchParams follows window.location (pushState/replaceState/popstate), like the App Router.
vi.mock("next/navigation", async () => {
  const React = await import("react");
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());
  for (const method of ["pushState", "replaceState"] as const) {
    const original = window.history[method].bind(window.history);
    window.history[method] = (...args: Parameters<History["pushState"]>) => {
      original(...args);
      notify();
    };
  }
  window.addEventListener("popstate", notify);
  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };
  return {
    useSearchParams: () => {
      const search = React.useSyncExternalStore(subscribe, () => window.location.search, () => "");
      return React.useMemo(() => new URLSearchParams(search), [search]);
    },
  };
});
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

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
      matches: query.includes("min-width: 900px") ? !narrow : false,
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
  return { id: "b1", content: "내 메모", createdAt: NOW, updatedAt: NOW, version: 1, eventRef: null, folderId: null, hue: null, ...overrides };
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

function folder(overrides: Partial<MemoFolder> = {}): MemoFolder {
  return { id: "f1", name: "회사", hue: "tangerine", createdAt: NOW, updatedAt: NOW, ...overrides };
}

function serve(blocks: MemoBlock[], extra: Record<string, Handler> = {}, folders: MemoFolder[] = []) {
  let n = 100;
  routes = {
    "GET /api/memo/blocks": () => jsonResponse({ blocks, folders }),
    "POST /api/memo/blocks": ({ body }) =>
      jsonResponse(
        block({
          id: `b${n++}`,
          content: String(body?.content ?? ""),
          version: 1,
          createdAt: new Date().toISOString(),
          folderId: (body?.folderId as string | undefined) ?? null,
          hue: (body?.hue as MemoBlock["hue"] | undefined) ?? null,
        }),
        201,
      ),
    "DELETE /api/memo/blocks/b1": () => new Response(null, { status: 204 }),
    ...extra,
  };
}

beforeEach(() => {
  calls = [];
  localStorage.clear();
  window.history.replaceState(null, "", "/memo");
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
  delete document.body.dataset.ownHeader;
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
const deletes = () => calls.filter((c) => c.method === "DELETE");

function visit(search: string) {
  window.history.replaceState(null, "", `/memo${search}`);
}

const fileList = () => screen.getByRole("region", { name: "메모 목록" });
const fileNames = () => within(fileList()).queryAllByRole("link").map((a) => a.querySelector("[class*=fileName]")?.textContent);
const openEditors = () => document.querySelectorAll(".cm-editor");

function onlyEditor(): EditorView {
  const editors = openEditors();
  expect(editors).toHaveLength(1);
  return EditorView.findFromDOM(editors[0] as HTMLElement)!;
}

// ---- tests ----------------------------------------------------------------------

describe("MemoPage (files)", () => {
  it("lists memo files by last edit with their first line as the name; wide screens open the newest", async () => {
    serve([
      block({ id: "b2", content: "장보기\n- 우유\n- **달걀**", updatedAt: "2026-11-14T01:00:00.000Z" }),
      block({ content: "내 메모" }),
    ]);
    render(<MemoPage />);
    expect(screen.getByRole("heading", { level: 1, name: "메모" })).toBeTruthy();
    await waitFor(() => expect(fileNames()).toEqual(["장보기", "내 메모"]));
    // Preview: the lines after the title, without list or bold markers.
    expect(within(fileList()).getByText("우유 달걀")).toBeTruthy();
    // The newest file opens on the right and the URL names it.
    await waitFor(() => expect(window.location.search).toBe("?id=b2"));
    expect(onlyEditor().state.doc.toString()).toBe("장보기\n- 우유\n- **달걀**");
    expect(within(fileList()).getByRole("link", { name: /장보기/ }).getAttribute("aria-current")).toBe("page");
  });

  it("clicking a file opens it; edits are debounced by 800ms and send the base version", async () => {
    serve([block({ id: "b2", content: "위", updatedAt: "2026-11-14T01:00:00.000Z" }), block()], {
      "PUT /api/memo/blocks/b1": ({ body }) => jsonResponse(block({ content: String(body?.content), version: 2 })),
    });
    render(<MemoPage />);
    await userEvent.click(await within(fileList()).findByRole("link", { name: /내 메모/ }));
    expect(window.location.search).toBe("?id=b1");
    const view = editorShowing("내 메모");
    type(view, " 하나");
    type(view, " 둘");
    await new Promise((r) => setTimeout(r, 400));
    expect(puts()).toHaveLength(0);
    await waitFor(() => expect(puts()).toHaveLength(1), { timeout: 2000 });
    expect(puts()[0].body).toEqual({ content: "내 메모 하나 둘", baseVersion: 1 });
    await waitFor(() => expect(readDrafts()).toHaveLength(0));
    // The edited file moves to the top of the list.
    expect(fileNames()[0]).toBe("내 메모 하나 둘");
  });

  it("conflict keeps both: the server text here, mine as a 충돌 사본 file", async () => {
    visit("?id=b1");
    serve([block()], {
      "PUT /api/memo/blocks/b1": () => jsonResponse({ current: block({ content: "다른 기기에서 쓴 내용", version: 2 }) }, 409),
    });
    render(<MemoPage />);
    await screen.findByText("내 메모", { selector: ".cm-line" });
    const view = editorShowing("내 메모");
    type(view, " 추가");

    await waitFor(() => expect(posts()).toHaveLength(1), { timeout: 2500 });
    expect(String(posts()[0].body?.content)).toMatch(/^충돌 사본 — \d+월 \d+일 오[전후] \d+:\d{2}\n내 메모 추가$/);
    await waitFor(() => expect(view.state.doc.toString()).toBe("다른 기기에서 쓴 내용"));
    expect(fileNames()[0]).toMatch(/^충돌 사본 — /);
    const notice = screen.getAllByRole("status").find((n) => n.textContent?.includes("충돌 사본"))!;
    await userEvent.click(within(notice).getByRole("button", { name: "사본 열기" }));
    await waitFor(() => expect(onlyEditor().state.doc.toString()).toMatch(/^충돌 사본 — .*\n내 메모 추가$/));
    expect(puts()).toHaveLength(1);
  });

  it("event memo is named after its event and shows the label with 일정 보기", async () => {
    visit("?id=e1");
    serve([block({ id: "e1", content: "- ", eventRef })]);
    render(<MemoPage />);
    await waitFor(() => expect(fileNames()).toEqual(["주간 회의"]));
    expect(within(fileList()).getByLabelText("일정 메모")).toBeTruthy();
    const label = screen.getByRole("link", { name: "일정 보기" }).closest("div")!.parentElement!;
    expect(within(label).getByText("회사")).toBeTruthy();
    expect(within(label).getByText("11월 16일 월요일 10:00–11:00").className).toContain("num");
    expect(screen.getByRole("link", { name: "일정 보기" }).getAttribute("href")).toBe("/calendar?date=2026-11-16");
  });

  it("deleted event keeps its memo and says 삭제된 일정", async () => {
    visit("?id=e1");
    serve([block({ id: "e1", content: "- 회의록", eventRef: { ...eventRef, deleted: true } })]);
    render(<MemoPage />);
    expect(await screen.findByText("삭제된 일정")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "일정 보기" })).toBeNull();
    expect(onlyEditor().state.doc.toString()).toBe("- 회의록");
  });

  it("offline save keeps draft", async () => {
    visit("?id=b1");
    let online = false;
    serve([block()], {
      "PUT /api/memo/blocks/b1": ({ body }) => {
        if (!online) throw new TypeError("Failed to fetch");
        return jsonResponse(block({ content: String(body?.content), version: 2 }));
      },
    });
    const { unmount } = render(<MemoPage />);
    await screen.findByText("내 메모", { selector: ".cm-line" });
    type(editorShowing("내 메모"), " 지하철에서");

    await waitFor(() => expect(puts()).toHaveLength(1), { timeout: 2000 });
    await screen.findByText(/이 기기에 보관해 두었어요/);
    expect(readDrafts()).toMatchObject([{ id: "b1", content: "내 메모 지하철에서", baseVersion: 1 }]);

    unmount();
    render(<MemoPage />);
    await screen.findByText("내 메모 지하철에서", { selector: ".cm-line" });

    online = true;
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(puts().at(-1)?.body).toEqual({ content: "내 메모 지하철에서", baseVersion: 1 }));
    await waitFor(() => expect(readDrafts()).toHaveLength(0));
    await waitFor(() => expect(screen.queryByText(/이 기기에 보관해 두었어요/)).toBeNull());
  });

  it("no memos yet: an empty state with 새 메모 쓰기; typing saves it as a new file", async () => {
    serve([]);
    render(<MemoPage />);
    expect(await screen.findByText("아직 메모가 없어요.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "새 메모 쓰기" }));
    const view = onlyEditor();
    expect(view.state.doc.toString()).toBe("");
    type(view, "첫 메모");
    await waitFor(() => expect(posts()).toHaveLength(1), { timeout: 2000 });
    expect(posts()[0].body).toEqual({ content: "첫 메모" });
    await waitFor(() => expect(window.location.search).toBe("?id=b100"));
  });

  it("+ in the list and Mod-Enter in the editor start a new memo; leaving it empty drops it", async () => {
    visit("?id=b1");
    serve([block()]);
    render(<MemoPage />);
    await screen.findByText("내 메모", { selector: ".cm-line" });
    await userEvent.click(screen.getByRole("button", { name: "새 메모" }));
    await waitFor(() => expect(onlyEditor().state.doc.toString()).toBe(""));
    expect(fileNames()).toEqual(["새 메모", "내 메모"]);

    // Back to the other file without typing: the empty one goes away, nothing is sent.
    await userEvent.click(within(fileList()).getByRole("link", { name: /내 메모/ }));
    await waitFor(() => expect(fileNames()).toEqual(["내 메모"]));
    expect(posts()).toHaveLength(0);

    act(() => {
      onlyEditor().contentDOM.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });
    await waitFor(() => expect(onlyEditor().state.doc.toString()).toBe(""));
    expect(fileNames()).toEqual(["새 메모", "내 메모"]);
  });

  it("?new from 빠른 추가 opens a new memo whose first line is the typed title", async () => {
    stashNewMemoTitle("회의 준비");
    visit("?new");
    serve([block()]);
    render(<MemoPage />);
    await waitFor(() => expect(onlyEditor().state.doc.toString()).toBe("회의 준비\n"));
    expect(fileNames()[0]).toBe("회의 준비");
    await waitFor(() => expect(posts()).toHaveLength(1), { timeout: 2000 });
    expect(posts()[0].body).toEqual({ content: "회의 준비\n" });
  });

  it("a link with ?new=<text> alone never writes a memo: it opens an empty one, saved only once typed in", async () => {
    visit("?new=" + encodeURIComponent("누가 보낸 글"));
    serve([block()]);
    render(<MemoPage />);
    await waitFor(() => expect(onlyEditor().state.doc.toString()).toBe(""));
    await new Promise((r) => setTimeout(r, 1000));
    expect(posts()).toHaveLength(0);
    expect(readDrafts()).toHaveLength(0);
  });

  it("search filters the list by content and event title; Enter opens the first match", async () => {
    serve([
      block({ id: "e1", content: "- 안건", eventRef, updatedAt: "2026-11-14T02:00:00.000Z" }),
      block({ content: "장보기 목록" }),
    ]);
    render(<MemoPage />);
    await waitFor(() => expect(fileNames()).toHaveLength(2));
    const input = screen.getByRole("searchbox", { name: "메모 찾기" });
    await userEvent.type(input, "주간");
    expect(fileNames()).toEqual(["주간 회의"]);
    expect(screen.getByText(/메모 1개를 찾았어요/)).toBeTruthy();

    await userEvent.clear(input);
    await userEvent.type(input, "장보기");
    expect(fileNames()).toEqual(["장보기 목록"]);
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(window.location.search).toBe("?id=b1"));
    await waitFor(() => expect(onlyEditor().state.doc.toString()).toBe("장보기 목록"));
  });

  it("Cmd/Ctrl+F focuses the search box", async () => {
    serve([block()]);
    render(<MemoPage />);
    await waitFor(() => expect(fileNames()).toHaveLength(1));
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    expect(document.activeElement).toBe(screen.getByRole("searchbox", { name: "메모 찾기" }));
  });

  it("old ?block=<id> links open that memo", async () => {
    visit("?block=e1");
    serve([block({ id: "b2", content: "위 메모", updatedAt: "2026-11-14T02:00:00.000Z" }), block({ id: "e1", content: "- ", eventRef })]);
    render(<MemoPage />);
    await screen.findByRole("link", { name: "일정 보기" });
    expect(within(fileList()).getByRole("link", { name: /주간 회의/ }).getAttribute("aria-current")).toBe("page");
  });

  it("deleting asks first, then deletes version-checked and opens the next memo", async () => {
    visit("?id=b1");
    serve([block(), block({ id: "b2", content: "남는 메모", updatedAt: "2026-11-13T00:00:00.000Z" })]);
    render(<MemoPage />);
    await screen.findByText("내 메모", { selector: ".cm-line" });
    await userEvent.click(screen.getByRole("button", { name: "이 메모 지우기" }));
    const dialog = screen.getByRole("dialog", { name: "이 메모를 지울까요?" });
    expect(dialog.textContent).toContain("‘내 메모’ 메모를 지워요.");
    await userEvent.click(within(dialog).getByRole("button", { name: "메모 지우기" }));
    await waitFor(() => expect(deletes()).toHaveLength(1));
    expect(deletes()[0].url).toBe("/api/memo/blocks/b1?baseVersion=1");
    expect(fileNames()).toEqual(["남는 메모"]);
    await waitFor(() => expect(window.location.search).toBe("?id=b2"));
  });

  it("phone: list first; a file opens full screen with a back button and the keyboard tool bar", async () => {
    mockMatchMedia(true);
    serve([block()]);
    render(<MemoPage />);
    await waitFor(() => expect(fileNames()).toEqual(["내 메모"]));
    // Phones don't jump into a file by themselves.
    expect(window.location.search).toBe("");
    expect(openEditors()).toHaveLength(0);

    await userEvent.click(within(fileList()).getByRole("link", { name: /내 메모/ }));
    const view = onlyEditor();
    expect(document.body.dataset.ownHeader).toBe("true");
    act(() => {
      view.contentDOM.dispatchEvent(new FocusEvent("focus"));
    });
    const bar = await screen.findByRole("toolbar", { name: "메모 편집 도구" });
    for (const name of ["들여쓰기", "내어쓰기", "굵게", "완료"]) {
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

    const back = screen.getByRole("button", { name: "메모" });
    const historyBack = vi.spyOn(window.history, "back").mockImplementation(() => {
      window.history.replaceState(null, "", "/memo");
    });
    await userEvent.click(back);
    expect(historyBack).toHaveBeenCalled();
    await waitFor(() => expect(openEditors()).toHaveLength(0));
    expect(document.body.dataset.ownHeader).toBeUndefined();
  });

  it("shows a fix-it message when the memos can't load", async () => {
    serve([], { "GET /api/memo/blocks": () => Promise.reject(new TypeError("Failed to fetch")) });
    render(<MemoPage />);
    expect((await screen.findByRole("alert")).textContent).toContain("인터넷 연결을 확인한 뒤");
    expect(screen.getByRole("button", { name: "메모 다시 불러오기" })).toBeTruthy();
  });
});

// ---- folders, colours and view settings ----------------------------------------------

const page = () => document.querySelector<HTMLElement>("[data-list]")!;
const LATER = "2026-11-14T01:00:00.000Z";

describe("MemoPage folders", () => {
  it("shows folders above the loose memos; a folder opens and closes and that is remembered", async () => {
    serve([block({ id: "b2", content: "주간 회의", folderId: "f1", updatedAt: LATER }), block({ content: "장보기" })], {}, [folder()]);
    render(<MemoPage />);
    await waitFor(() => expect(fileNames()).toEqual(["주간 회의", "장보기"]));
    const toggle = within(fileList()).getByRole("button", { name: "회사 폴더" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await userEvent.click(toggle);
    expect(fileNames()).toEqual(["장보기"]);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(JSON.parse(localStorage.getItem("daily:memo.closedFolders")!)).toEqual(["f1"]);
    await userEvent.click(toggle);
    expect(fileNames()).toEqual(["주간 회의", "장보기"]);
  });

  it("a memo in a folder takes the folder's colour unless it has its own", async () => {
    serve([block({ id: "b2", content: "주간 회의", folderId: "f1", updatedAt: LATER }), block({ content: "1:1", folderId: "f1", hue: "sky" })], {}, [folder()]);
    render(<MemoPage />);
    const row = await within(fileList()).findByRole("link", { name: /주간 회의/ });
    expect(row.style.getPropertyValue("--hue")).toBe("var(--tangerine)");
    expect(within(fileList()).getByRole("link", { name: /1:1/ }).style.getPropertyValue("--hue")).toBe("var(--sky)");
  });

  it("+ on a folder row starts a memo in that folder", async () => {
    serve([block()], {}, [folder()]);
    render(<MemoPage />);
    await userEvent.click(await within(fileList()).findByRole("button", { name: "‘회사’ 폴더에 새 메모" }));
    const view = onlyEditor();
    expect(view.state.doc.toString()).toBe("");
    type(view, "새 회의");
    await waitFor(() => expect(posts()).toHaveLength(1), { timeout: 2500 });
    expect(posts()[0].body).toEqual({ content: "새 회의", folderId: "f1" });
    await waitFor(() => expect(fileNames()).toEqual(["새 회의", "내 메모"]));
  });

  it("makes a new folder", async () => {
    serve([block()], {
      "POST /api/memo/folders": ({ body }) => jsonResponse(folder({ id: "f9", name: String(body?.name), hue: "pink" }), 201),
    });
    render(<MemoPage />);
    await userEvent.click(await screen.findByRole("button", { name: "새 폴더" }));
    const dialog = screen.getByRole("dialog", { name: "새 폴더" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: "폴더 이름" }), "  개인 ");
    await userEvent.click(within(dialog).getByRole("button", { name: "만들기" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls.find((c) => c.method === "POST" && c.url.endsWith("/folders"))?.body).toEqual({ name: "개인" });
    expect(within(fileList()).getByRole("button", { name: "개인 폴더" })).toBeTruthy();
  });

  it("deleting a folder asks first and keeps its memos, moved out", async () => {
    serve([block({ folderId: "f1" })], { "DELETE /api/memo/folders/f1": () => new Response(null, { status: 204 }) }, [folder()]);
    render(<MemoPage />);
    await userEvent.click(await within(fileList()).findByRole("button", { name: "‘회사’ 폴더 메뉴" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "‘회사’ 폴더" })).getByRole("button", { name: "폴더 지우기" }));
    const confirm = screen.getByRole("dialog", { name: "‘회사’ 폴더를 지울까요?" });
    expect(confirm.textContent).toContain("안에 든 메모 1개는 지우지 않고 폴더 밖으로 꺼내요.");
    expect(deletes()).toHaveLength(0);
    await userEvent.click(within(confirm).getByRole("button", { name: "폴더 지우기" }));
    await waitFor(() => expect(deletes().map((c) => c.url)).toEqual(["/api/memo/folders/f1"]));
    expect(within(fileList()).queryByRole("button", { name: "회사 폴더" })).toBeNull();
    expect(fileNames()).toEqual(["내 메모"]);
  });

  it("a search opens a closed folder that has a match; Enter opens it", async () => {
    localStorage.setItem("daily:memo.closedFolders", JSON.stringify(["f1"]));
    mockMatchMedia(true);
    serve([block({ id: "b2", content: "주간 회의", folderId: "f1" }), block({ content: "장보기" })], {}, [folder(), folder({ id: "f2", name: "빈 폴더" })]);
    render(<MemoPage />);
    await waitFor(() => expect(fileNames()).toEqual(["장보기"]));
    await userEvent.type(screen.getByRole("searchbox", { name: "메모 찾기" }), "회의");
    expect(fileNames()).toEqual(["주간 회의"]);
    expect(within(fileList()).queryByRole("button", { name: "빈 폴더 폴더" })).toBeNull();
    await userEvent.keyboard("{Enter}");
    expect(window.location.search).toBe("?id=b2");
  });

  it("the 폴더와 색 chip moves the open memo and sets or clears its colour", async () => {
    visit("?id=b1");
    let current = block();
    serve(
      [block()],
      {
        "PATCH /api/memo/blocks/b1": ({ body }) => {
          current = { ...current, ...(body as Partial<MemoBlock>) };
          return jsonResponse(current);
        },
      },
      [folder(), folder({ id: "f2", name: "개인", hue: "green" })],
    );
    render(<MemoPage />);
    await userEvent.click(await screen.findByRole("button", { name: "폴더와 색: 폴더 없음" }));
    const dialog = screen.getByRole("dialog", { name: "폴더와 색" });
    const folders = within(dialog).getByRole("radiogroup", { name: "폴더" });
    expect(within(folders).getAllByRole("radio").map((r) => r.textContent)).toEqual(["폴더 없음", "개인", "회사"]);
    await userEvent.click(within(folders).getByRole("radio", { name: "개인" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "PATCH").map((c) => c.body)).toEqual([{ folderId: "f2" }]));
    expect(screen.getByRole("button", { name: "폴더와 색: 개인" })).toBeTruthy();
    expect(within(fileList()).getByRole("button", { name: "개인 폴더" })).toBeTruthy();

    const colours = within(dialog).getByRole("radiogroup", { name: "메모 색" });
    await userEvent.click(within(colours).getByRole("radio", { name: "하늘" }));
    await userEvent.click(within(colours).getByRole("radio", { name: "폴더 색 따르기" }));
    await waitFor(() =>
      expect(calls.filter((c) => c.method === "PATCH").map((c) => c.body)).toEqual([{ folderId: "f2" }, { hue: "sky" }, { hue: null }]),
    );
    expect(puts()).toHaveLength(0);
  });

  it("a move that can't reach the server is undone with a notice", async () => {
    visit("?id=b1");
    serve([block()], { "PATCH /api/memo/blocks/b1": () => Promise.reject(new TypeError("Failed to fetch")) }, [folder()]);
    render(<MemoPage />);
    await userEvent.click(await screen.findByRole("button", { name: "폴더와 색: 폴더 없음" }));
    await userEvent.click(screen.getByRole("radio", { name: "회사" }));
    expect((await screen.findByRole("alert")).textContent).toBe("인터넷에 연결되지 않아 메모를 옮기지 못했어요. 연결되면 다시 해 주세요.");
    expect(screen.getByRole("button", { name: "폴더와 색: 폴더 없음" })).toBeTruthy();
  });
});

describe("MemoPage view settings", () => {
  it("⌥⌘S folds the list on wide screens and it stays folded; the button unfolds it", async () => {
    serve([block()]);
    const { unmount } = render(<MemoPage />);
    await screen.findByText("내 메모", { selector: ".cm-line" });
    expect(page().dataset.list).toBe("open");
    fireEvent.keyDown(window, { key: "ß", code: "KeyS", metaKey: true, altKey: true });
    expect(page().dataset.list).toBe("closed");
    expect(localStorage.getItem("daily:memo.listOpen")).toBe("false");
    unmount();

    render(<MemoPage />);
    await screen.findByText("내 메모", { selector: ".cm-line" });
    expect(page().dataset.list).toBe("closed");
    const toggle = screen.getByRole("button", { name: "메모 목록 펼치기" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(toggle);
    expect(page().dataset.list).toBe("open");
  });

  it("⌘F while the list is folded unfolds it and goes to the search box", async () => {
    localStorage.setItem("daily:memo.listOpen", "false");
    serve([block()]);
    render(<MemoPage />);
    await screen.findByText("내 메모", { selector: ".cm-line" });
    expect(page().dataset.list).toBe("closed");
    fireEvent.keyDown(window, { key: "f", code: "KeyF", metaKey: true });
    expect(page().dataset.list).toBe("open");
    expect(document.activeElement).toBe(screen.getByRole("searchbox", { name: "메모 찾기" }));
  });

  it("phones ignore ⌥⌘S and a folded setting", async () => {
    localStorage.setItem("daily:memo.listOpen", "false");
    mockMatchMedia(true);
    serve([block()]);
    render(<MemoPage />);
    await waitFor(() => expect(fileNames()).toEqual(["내 메모"]));
    fireEvent.keyDown(window, { key: "s", code: "KeyS", metaKey: true, altKey: true });
    expect(localStorage.getItem("daily:memo.listOpen")).toBe("false");
  });

  it("글씨 크기 sets the memo text scale on this device", async () => {
    serve([block()]);
    render(<MemoPage />);
    await userEvent.click(await screen.findByRole("button", { name: "글씨 크기" }));
    const sizes = within(screen.getByRole("dialog", { name: "글씨 크기" })).getByRole("radiogroup", { name: "글씨 크기" });
    expect(within(sizes).getAllByRole("radio").map((r) => r.getAttribute("aria-label"))).toEqual(["작게", "보통", "조금 크게", "크게", "아주 크게"]);
    expect(within(sizes).getByRole("radio", { name: "보통" }).getAttribute("aria-checked")).toBe("true");
    await userEvent.click(within(sizes).getByRole("radio", { name: "크게" }));
    expect(page().style.getPropertyValue("--memo-scale")).toBe("1.25");
    expect(localStorage.getItem("daily:memo.fontScale")).toBe("1.25");
  });

  it("phones never go below 보통 (iOS would zoom in while typing)", async () => {
    localStorage.setItem("daily:memo.fontScale", "0.875");
    mockMatchMedia(true);
    visit("?id=b1");
    serve([block()]);
    render(<MemoPage />);
    await userEvent.click(await screen.findByRole("button", { name: "글씨 크기" }));
    const sizes = screen.getByRole("radiogroup", { name: "글씨 크기" });
    expect(within(sizes).queryByRole("radio", { name: "작게" })).toBeNull();
    expect(within(sizes).getByRole("radio", { name: "보통" }).getAttribute("aria-checked")).toBe("true");
    expect(page().style.getPropertyValue("--memo-scale")).toBe("1");
  });

  it("clicking the empty space under the text puts the cursor at the end", async () => {
    mockMatchMedia(true);
    visit("?id=b1");
    serve([block({ content: "첫 줄\n둘째 줄" })]);
    render(<MemoPage />);
    await screen.findByText("첫 줄", { selector: ".cm-line" });
    const view = onlyEditor();
    expect(view.state.doc.toString()).toBe("첫 줄\n둘째 줄");
    expect(view.state.selection.main.head).toBe(0);
    fireEvent.mouseDown(view.dom.closest("article")!, { button: 0, clientY: 500 });
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
  });

  it("the keyboard tool bar's 제목 cycles the line's heading", async () => {
    mockMatchMedia(true);
    visit("?id=b1");
    serve([block()]);
    render(<MemoPage />);
    await screen.findByText("내 메모", { selector: ".cm-line" });
    const view = onlyEditor();
    act(() => {
      view.contentDOM.dispatchEvent(new FocusEvent("focus"));
    });
    const bar = await screen.findByRole("toolbar", { name: "메모 편집 도구" });
    await userEvent.click(within(bar).getByRole("button", { name: "제목" }));
    expect(view.state.doc.toString()).toBe("# 내 메모");
    await userEvent.click(within(bar).getByRole("button", { name: "제목" }));
    expect(view.state.doc.toString()).toBe("## 내 메모");
  });
});


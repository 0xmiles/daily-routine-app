// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MemoBlock, MemoFolder } from "@/shared/contracts";
import type { Hue } from "@/ui/hues";
import { MemoApiError } from "./client";
import { readDrafts, writeDraft } from "./draft";
import { MemoPad, conflictCopyContent, type MemoApi } from "./store";

const T0 = "2026-11-14T00:12:00.000Z";

function block(overrides: Partial<MemoBlock> = {}): MemoBlock {
  return { id: "b1", content: "처음", createdAt: T0, updatedAt: T0, version: 1, eventRef: null, folderId: null, hue: null, ...overrides };
}

function folder(overrides: Partial<MemoFolder> = {}): MemoFolder {
  return { id: "f1", name: "회사", hue: "tangerine", createdAt: T0, updatedAt: T0, ...overrides };
}

function fakeApi(server: MemoBlock[] = [block()], folders: MemoFolder[] = []) {
  let n = 0;
  const api = {
    fetchMemos: vi.fn(async () => ({ blocks: server, folders })),
    createBlock: vi.fn(async (input: { content?: string; folderId?: string | null; hue?: Hue | null }) =>
      block({
        id: `new${n++}`,
        content: input.content ?? "",
        createdAt: new Date().toISOString(),
        folderId: input.folderId && folders.some((f) => f.id === input.folderId) ? input.folderId : null,
        hue: input.hue ?? null,
      }),
    ),
    placeBlock: vi.fn(async (id: string, patch: { folderId?: string | null; hue?: Hue | null }) => {
      const current = server.find((b) => b.id === id) ?? block({ id });
      return { ...current, ...patch };
    }),
    createFolder: vi.fn(async (name: string) => folder({ id: `f-new${n++}`, name, hue: "pink" })),
    updateFolder: vi.fn(async (id: string, patch: { name?: string; hue?: Hue }) => {
      const i = folders.findIndex((f) => f.id === id);
      const next = { ...(folders[i] ?? folder({ id })), ...patch };
      if (i >= 0) folders[i] = next;
      return next;
    }),
    deleteFolder: vi.fn(async () => undefined),
    saveBlock: vi.fn(async (id: string, content: string, baseVersion: number) => ({
      ok: true as const,
      block: block({ id, content, version: baseVersion + 1 }),
    })),
    deleteBlock: vi.fn(async () => ({ ok: true as const })),
  };
  return api as typeof api & MemoApi;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => localStorage.clear());

describe("MemoPad", () => {
  it("conflict copy text starts with 충돌 사본 and the Seoul time", () => {
    expect(conflictCopyContent("내 글", new Date(T0))).toBe("충돌 사본 — 11월 14일 오전 9:12\n내 글");
  });

  it("keeps saving from the new version when typing continues during a save", async () => {
    const api = fakeApi();
    let release!: () => void;
    api.saveBlock.mockImplementationOnce(
      (id, content, baseVersion) =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, block: block({ id, content, version: baseVersion + 1 }) });
        }),
    );
    const pad = new MemoPad({ api, saveDelayMs: 0 });
    await pad.load();
    pad.edit("b1", "처음 a");
    await tick();
    pad.edit("b1", "처음 ab");
    release();
    await vi.waitFor(() => expect(api.saveBlock).toHaveBeenCalledTimes(2));
    expect(api.saveBlock.mock.calls[1]).toEqual(["b1", "처음 ab", 2]);
    await vi.waitFor(() => expect(pad.find("b1")).toMatchObject({ status: "saved", version: 3 }));
    expect(readDrafts()).toHaveLength(0);
  });

  it("a block deleted on another device keeps the local text as a new block", async () => {
    const api = fakeApi();
    api.saveBlock.mockRejectedValueOnce(new MemoApiError(404, "없음"));
    const pad = new MemoPad({ api, saveDelayMs: 0 });
    await pad.load();
    pad.edit("b1", "지워진 블록에 쓴 글");
    await vi.waitFor(() => expect(api.createBlock).toHaveBeenCalledWith({ content: "지워진 블록에 쓴 글" }));
    await vi.waitFor(() => expect(pad.find("b1")).toMatchObject({ id: "new0", status: "saved" }));
  });

  it("restores a draft of a block that never reached the server", async () => {
    writeDraft("local-x", { key: "local-x", id: null, content: "오프라인 새 메모", baseVersion: 0, createdAt: T0, savedAt: T0 });
    const api = fakeApi([]);
    const pad = new MemoPad({ api, saveDelayMs: 0 });
    await pad.load();
    expect(pad.getSnapshot().blocks.map((b) => b.content)).toEqual(["오프라인 새 메모"]);
    await vi.waitFor(() => expect(api.createBlock).toHaveBeenCalledWith({ content: "오프라인 새 메모" }));
  });

  it("refresh picks up the other device's text for saved blocks but never replaces unsaved text", async () => {
    const server = [block(), block({ id: "b2", content: "둘째", createdAt: "2026-11-13T00:00:00.000Z" })];
    const api = fakeApi(server);
    const pad = new MemoPad({ api, saveDelayMs: 10_000 });
    await pad.load();
    pad.edit("b2", "둘째 수정 중");
    server[0] = block({ content: "맥에서 고침", version: 2 });
    server[1] = block({ id: "b2", content: "맥에서 고친 둘째", version: 2, createdAt: "2026-11-13T00:00:00.000Z" });
    await pad.load();
    expect(pad.find("b1")).toMatchObject({ content: "맥에서 고침", version: 2, remoteRev: 1 });
    expect(pad.find("b2")).toMatchObject({ content: "둘째 수정 중", version: 1, status: "pending" });
  });

  it("removing an empty block is version-checked and brings it back if someone wrote there", async () => {
    const api = fakeApi([block({ content: "" }), block({ id: "b2", content: "남는 블록", createdAt: "2026-11-13T00:00:00.000Z" })]);
    api.deleteBlock.mockResolvedValueOnce({ ok: false, current: block({ content: "다른 기기 글", version: 2 }) } as never);
    const pad = new MemoPad({ api });
    await pad.load();
    expect(pad.removeBlock("b2")).toBe(false); // has text
    expect(pad.removeBlock("b1")).toBe(true);
    expect(api.deleteBlock).toHaveBeenCalledWith("b1", 1);
    await vi.waitFor(() => expect(pad.find("b1")?.content).toBe("다른 기기 글"));
  });
});

describe("MemoPad folders and placement", () => {
  it("loads the folders with the blocks", async () => {
    const pad = new MemoPad({ api: fakeApi([block({ folderId: "f1" })], [folder()]) });
    await pad.load();
    expect(pad.getSnapshot().folders).toEqual([folder()]);
    expect(pad.find("b1")).toMatchObject({ folderId: "f1", hue: null });
  });

  it("takes the server's folder and colour on reload, even while the text is still unsaved", async () => {
    const server = [block()];
    const pad = new MemoPad({ api: fakeApi(server, [folder()]), saveDelayMs: 10_000 });
    await pad.load();
    pad.edit("b1", "처음 고치는 중");
    server[0] = block({ folderId: "f1", hue: "sky" });
    await pad.load();
    expect(pad.find("b1")).toMatchObject({ content: "처음 고치는 중", status: "pending", folderId: "f1", hue: "sky" });
  });

  it("makes a new memo in a folder and sends the folder with its first save", async () => {
    const api = fakeApi([], [folder()]);
    const pad = new MemoPad({ api, saveDelayMs: 0 });
    await pad.load();
    const key = pad.addBlock("", "f1");
    expect(pad.find(key)).toMatchObject({ folderId: "f1", id: null });
    expect(pad.addBlock("", null)).not.toBe(key);
    pad.edit(key, "주간 회의");
    await vi.waitFor(() => expect(api.createBlock).toHaveBeenCalledWith({ content: "주간 회의", folderId: "f1" }));
    await vi.waitFor(() => expect(pad.find(key)).toMatchObject({ status: "saved", folderId: "f1" }));
  });

  it("moving a memo that is not on the server yet only changes it here, and goes with its create", async () => {
    const api = fakeApi([], [folder()]);
    const pad = new MemoPad({ api, saveDelayMs: 10_000 });
    await pad.load();
    const key = pad.addBlock("장보기\n");
    await pad.place(key, { folderId: "f1", hue: "lemon" });
    expect(api.placeBlock).not.toHaveBeenCalled();
    expect(readDrafts()[0]).toMatchObject({ folderId: "f1", hue: "lemon" });
    await pad.flush(key);
    expect(api.createBlock).toHaveBeenCalledWith({ content: "장보기\n", folderId: "f1", hue: "lemon" });
  });

  it("a memo moved while its create was on its way sends the move once it has an id", async () => {
    const api = fakeApi([], [folder()]);
    let release!: () => void;
    api.createBlock.mockImplementationOnce(
      (input) =>
        new Promise((resolve) => {
          release = () => resolve(block({ id: "new-x", content: input.content ?? "" }));
        }),
    );
    const pad = new MemoPad({ api, saveDelayMs: 10_000 });
    await pad.load();
    const key = pad.addBlock("장보기");
    const saving = pad.flush(key);
    await pad.place(key, { folderId: "f1" });
    release();
    await saving;
    await vi.waitFor(() => expect(api.placeBlock).toHaveBeenCalledWith("new-x", { folderId: "f1" }));
    expect(pad.find(key)).toMatchObject({ id: "new-x", folderId: "f1" });
  });

  it("moves a memo on screen at once and keeps what the server answers", async () => {
    const api = fakeApi([block()], [folder()]);
    const pad = new MemoPad({ api });
    await pad.load();
    const moving = pad.place("b1", { folderId: "f1" });
    expect(pad.find("b1")?.folderId).toBe("f1");
    await moving;
    expect(api.placeBlock).toHaveBeenCalledWith("b1", { folderId: "f1" });
    expect(pad.find("b1")).toMatchObject({ folderId: "f1", version: 1 });
  });

  it("undoes a move that couldn't reach the server, with a notice, and keeps the text untouched", async () => {
    const api = fakeApi([block()], [folder()]);
    api.placeBlock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const pad = new MemoPad({ api });
    await pad.load();
    await pad.place("b1", { folderId: "f1" });
    expect(pad.find("b1")).toMatchObject({ folderId: null, content: "처음" });
    expect(pad.getSnapshot().notice).toEqual({
      kind: "placementFailed",
      message: "인터넷에 연결되지 않아 메모를 옮기지 못했어요. 연결되면 다시 해 주세요.",
    });
    expect(pad.getSnapshot().offline).toBe(false);
  });

  it("shows the server's message when a colour change is refused", async () => {
    const api = fakeApi([block()]);
    api.placeBlock.mockRejectedValueOnce(new MemoApiError(400, "폴더를 찾지 못했어요."));
    const pad = new MemoPad({ api });
    await pad.load();
    await pad.place("b1", { hue: "sky" });
    expect(pad.find("b1")?.hue).toBeNull();
    expect(pad.getSnapshot().notice).toEqual({ kind: "placementFailed", message: "폴더를 찾지 못했어요." });
  });

  it("a conflict copy stays in the memo's folder with its colour", async () => {
    const api = fakeApi([block({ folderId: "f1", hue: "sky" })], [folder()]);
    api.saveBlock.mockResolvedValueOnce({ ok: false, current: block({ content: "다른 기기", version: 2, folderId: "f1", hue: "sky" }) } as never);
    const pad = new MemoPad({ api, saveDelayMs: 0 });
    await pad.load();
    pad.edit("b1", "내가 쓴 글");
    await vi.waitFor(() => expect(pad.getSnapshot().notice?.kind).toBe("conflict"));
    const notice = pad.getSnapshot().notice as { copyKey: string };
    expect(pad.find(notice.copyKey)).toMatchObject({ folderId: "f1", hue: "sky" });
  });

  it("a draft of a never-saved memo comes back in its folder, or outside if the folder is gone", async () => {
    const draft = { id: null, baseVersion: 0, createdAt: T0, savedAt: T0 };
    writeDraft("local-a", { ...draft, key: "local-a", content: "폴더 안 글", folderId: "f1", hue: "lemon" });
    writeDraft("local-b", { ...draft, key: "local-b", content: "지워진 폴더의 글", folderId: "gone" });
    const api = fakeApi([], [folder()]);
    const pad = new MemoPad({ api, saveDelayMs: 0 });
    await pad.load();
    expect(pad.find("local-a")).toMatchObject({ folderId: "f1", hue: "lemon" });
    expect(pad.find("local-b")).toMatchObject({ folderId: null });
    await vi.waitFor(() => expect(api.createBlock).toHaveBeenCalledWith({ content: "폴더 안 글", folderId: "f1", hue: "lemon" }));
    expect(api.createBlock).toHaveBeenCalledWith({ content: "지워진 폴더의 글" });
  });

  it("deleting a folder moves its memos out and they keep the colour they showed", async () => {
    const api = fakeApi([block({ folderId: "f1" }), block({ id: "b2", folderId: "f1", hue: "sky" })], [folder()]);
    const pad = new MemoPad({ api });
    await pad.load();
    await pad.deleteFolder("f1");
    expect(api.deleteFolder).toHaveBeenCalledWith("f1");
    expect(pad.getSnapshot().folders).toEqual([]);
    expect(pad.find("b1")).toMatchObject({ folderId: null, hue: "tangerine" });
    expect(pad.find("b2")).toMatchObject({ folderId: null, hue: "sky" });
  });

  it("a folder delete that fails puts the folder and its memos back", async () => {
    const api = fakeApi([block({ folderId: "f1" })], [folder()]);
    api.deleteFolder.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const pad = new MemoPad({ api });
    await pad.load();
    await pad.deleteFolder("f1");
    expect(pad.getSnapshot().folders).toEqual([folder()]);
    expect(pad.find("b1")).toMatchObject({ folderId: "f1", hue: null });
    expect(pad.getSnapshot().notice).toMatchObject({ kind: "placementFailed" });
  });

  it("creates, renames and recolours folders", async () => {
    const api = fakeApi([], [folder()]);
    const pad = new MemoPad({ api });
    await pad.load();
    const made = await pad.createFolder("개인");
    expect(made).toMatchObject({ name: "개인" });
    expect(pad.getSnapshot().folders.map((f) => f.name)).toEqual(["회사", "개인"]);
    await pad.renameFolder("f1", "일");
    await pad.recolorFolder("f1", "green");
    expect(pad.getSnapshot().folders[0]).toMatchObject({ name: "일", hue: "green" });
    api.updateFolder.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await pad.renameFolder("f1", "실패");
    expect(pad.getSnapshot().folders[0].name).toBe("일");
  });
});

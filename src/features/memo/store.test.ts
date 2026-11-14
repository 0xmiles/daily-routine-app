// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MemoBlock } from "@/shared/contracts";
import { MemoApiError } from "./client";
import { readDrafts, writeDraft } from "./draft";
import { MemoPad, conflictCopyContent, type MemoApi } from "./store";

const T0 = "2026-11-14T00:12:00.000Z";

function block(overrides: Partial<MemoBlock> = {}): MemoBlock {
  return { id: "b1", content: "처음", createdAt: T0, updatedAt: T0, version: 1, eventRef: null, ...overrides };
}

function fakeApi(server: MemoBlock[] = [block()]) {
  let n = 0;
  const api = {
    fetchBlocks: vi.fn(async () => server),
    createBlock: vi.fn(async (input: { content?: string }) =>
      block({ id: `new${n++}`, content: input.content ?? "", createdAt: new Date().toISOString() }),
    ),
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

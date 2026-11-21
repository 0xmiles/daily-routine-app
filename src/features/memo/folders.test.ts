import { describe, expect, it } from "vitest";
import type { MemoFolder } from "@/shared/contracts";
import { hueFor } from "@/ui/hues";
import { groupMemos, memoHue, shownMemos } from "./folders";
import type { PadBlock } from "./store";
import { clampFontScale } from "./viewPrefs";

const T = "2026-11-21T00:00:00.000Z";

function memo(key: string, content: string, folderId: string | null = null, hue: PadBlock["hue"] = null): PadBlock {
  return {
    key,
    id: key,
    content,
    version: 1,
    createdAt: T,
    updatedAt: T,
    eventRef: null,
    status: "saved",
    remoteRev: 0,
    folderId,
    hue,
  };
}

function folder(id: string, name: string, hue: MemoFolder["hue"] = "tangerine"): MemoFolder {
  return { id, name, hue, createdAt: T, updatedAt: T };
}

const folders = [folder("w", "회사"), folder("p", "개인", "green"), folder("e", "빈 폴더", "sky")];
const blocks = [memo("a", "주간 회의", "w"), memo("b", "장보기"), memo("c", "운동", "p"), memo("d", "1:1 메모", "w"), memo("x", "모르는 폴더", "gone")];

describe("memo list grouping", () => {
  it("puts folders in 가나다 order above the loose memos, keeping each list's order", () => {
    const g = groupMemos(blocks, folders, { query: "", closed: new Set() });
    expect(g.folders.map((f) => f.folder.name)).toEqual(["개인", "빈 폴더", "회사"]);
    expect(g.folders[2].memos.map((m) => m.key)).toEqual(["a", "d"]);
    expect(g.folders[1]).toMatchObject({ open: true, memos: [] });
    expect(g.loose.map((m) => m.key)).toEqual(["b", "x"]);
  });

  it("closed folders hide their memos from the shown order", () => {
    const g = groupMemos(blocks, folders, { query: "", closed: new Set(["w"]) });
    expect(g.folders.find((f) => f.folder.id === "w")?.open).toBe(false);
    expect(shownMemos(g).map((m) => m.key)).toEqual(["c", "b", "x"]);
  });

  it("a search lists only folders with a match, opened even if closed", () => {
    const g = groupMemos(blocks, folders, { query: "회의", closed: new Set(["w"]) });
    expect(g.folders.map((f) => [f.folder.name, f.open, f.memos.map((m) => m.key)])).toEqual([["회사", true, ["a"]]]);
    expect(g.loose).toEqual([]);
    expect(shownMemos(g).map((m) => m.key)).toEqual(["a"]);
  });
});

describe("memo colour", () => {
  it("is the memo's own, else its folder's, else its own pencil from its id", () => {
    expect(memoHue(memo("a", "", "w", "lemon"), folders)).toBe("lemon");
    expect(memoHue(memo("a", "", "p"), folders)).toBe("green");
    expect(memoHue(memo("b", ""), folders)).toBe(hueFor("b"));
    expect(memoHue({ ...memo("local-1", ""), id: null }, folders)).toBe(hueFor("local-1"));
    expect(memoHue(memo("x", "", "gone"), folders)).toBe(hueFor("x"));
  });
});

describe("font scale", () => {
  it("never goes under 1 on phones and touch devices, and falls back to 1 for unknown values", () => {
    expect(clampFontScale(0.875, false)).toBe(0.875);
    expect(clampFontScale(0.875, true)).toBe(1);
    expect(clampFontScale(1.375, true)).toBe(1.375);
    expect(clampFontScale(3, false)).toBe(1);
  });
});

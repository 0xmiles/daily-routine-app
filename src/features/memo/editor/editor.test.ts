// @vitest-environment jsdom
import { EditorSelection, EditorState, type Transaction } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { boldSpans, toggleBold } from "./bold";
import { currentLineDecorations } from "./currentLine";
import { continueList, indentLines, outdentLines } from "./indent";
import { memoExtensions } from "./index";

// jsdom has no layout; CodeMirror measures through Range rects.
beforeAll(() => {
  const emptyRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
  Range.prototype.getClientRects ??= emptyRects;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
});

/** Doc with `|` marking the cursor, or `[`…`]` marking a selection. */
function stateOf(marked: string): EditorState {
  const anchor = marked.includes("[") ? marked.indexOf("[") : marked.indexOf("|");
  const doc = marked.replace(/[|[\]]/g, "");
  const head = marked.includes("]") ? marked.indexOf("]") - 1 : anchor;
  return EditorState.create({ doc, selection: EditorSelection.single(anchor, head) });
}

/** Renders a state back with `|` / `[`…`]`. */
function marked(state: EditorState): string {
  const { from, to, empty } = state.selection.main;
  const doc = state.doc.toString();
  if (empty) return doc.slice(0, from) + "|" + doc.slice(from);
  return doc.slice(0, from) + "[" + doc.slice(from, to) + "]" + doc.slice(to);
}

type StateCmd = (target: { state: EditorState; dispatch: (tr: Transaction) => void }) => boolean;
function run(cmd: StateCmd, state: EditorState): { handled: boolean; state: EditorState } {
  let next = state;
  const handled = cmd({ state, dispatch: (tr) => (next = tr.state) });
  return { handled, state: next };
}

const views: EditorView[] = [];
function makeView(doc: string, opts: Partial<Parameters<typeof memoExtensions>[0]> = {}, cursor = 0) {
  const onNewBlock = vi.fn();
  const onBoundary = vi.fn();
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: { anchor: cursor },
      extensions: memoExtensions({ onNewBlock, onBoundary, ...opts }),
    }),
  });
  views.push(view);
  return { view, onNewBlock, onBoundary };
}

function press(view: EditorView, key: string, mods: { meta?: boolean; ctrl?: boolean; shift?: boolean } = {}) {
  const event = new KeyboardEvent("keydown", {
    key,
    metaKey: mods.meta ?? false,
    ctrlKey: mods.ctrl ?? false,
    shiftKey: mods.shift ?? false,
    bubbles: true,
    cancelable: true,
  });
  return runScopeHandlers(view, event, "editor");
}

/** Mod = Cmd on Mac, Ctrl elsewhere (jsdom reports a non-Mac platform). */
function pressMod(view: EditorView, key: string) {
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  return press(view, key, isMac ? { meta: true } : { ctrl: true });
}

afterEach(() => {
  while (views.length) views.pop()!.destroy();
  document.body.replaceChildren();
});

describe("indent", () => {
  it("Tab indents line by 2 spaces; Shift-Tab outdents", () => {
    let s = run(indentLines, stateOf("- 할 일|")).state;
    expect(marked(s)).toBe("  - 할 일|");
    s = run(indentLines, s).state;
    expect(marked(s)).toBe("    - 할 일|");
    s = run(outdentLines, s).state;
    expect(marked(s)).toBe("  - 할 일|");
    s = run(outdentLines, s).state;
    expect(marked(s)).toBe("- 할 일|");
    // Nothing left to outdent: no change.
    expect(marked(run(outdentLines, s).state)).toBe("- 할 일|");
  });

  it("indents every line touched by the selection and keeps a line-start cursor after the indent", () => {
    expect(marked(run(indentLines, stateOf("[a\nb]\nc")).state)).toBe("  [a\n  b]\nc");
    expect(marked(run(indentLines, stateOf("|a")).state)).toBe("  |a");
    // A selection ending at the start of a line does not touch that line.
    expect(run(indentLines, stateOf("[a\n]b")).state.doc.toString()).toBe("  a\nb");
    // Outdent removes at most 2 spaces per line.
    expect(run(outdentLines, stateOf("[   a\n b]")).state.doc.toString()).toBe(" a\nb");
  });

  it("Tab and Shift-Tab are bound in the editor keymap", () => {
    const { view } = makeView("- a", {}, 3);
    expect(press(view, "Tab")).toBe(true);
    expect(view.state.doc.toString()).toBe("  - a");
    expect(press(view, "Tab", { shift: true })).toBe(true);
    expect(view.state.doc.toString()).toBe("- a");
  });
});

describe("Enter continues lists", () => {
  it('Enter continues "- " with same indent', () => {
    expect(marked(run(continueList, stateOf("  - 결정한 것|")).state)).toBe("  - 결정한 것\n  - |");
    expect(marked(run(continueList, stateOf("* 별표|")).state)).toBe("* 별표\n* |");
  });

  it('Enter continues "1. " as "2. "', () => {
    expect(marked(run(continueList, stateOf("1. 첫째|")).state)).toBe("1. 첫째\n2. |");
    expect(marked(run(continueList, stateOf("  9. 아홉|")).state)).toBe("  9. 아홉\n  10. |");
  });

  it("Enter on empty bullet removes bullet", () => {
    expect(marked(run(continueList, stateOf("- 하나\n- |")).state)).toBe("- 하나\n|");
    expect(marked(run(continueList, stateOf("- 하나\n  - |")).state)).toBe("- 하나\n  |");
    expect(marked(run(continueList, stateOf("3. |")).state)).toBe("|");
  });

  it("splits a bullet in the middle and keeps plain-line indentation", () => {
    expect(marked(run(continueList, stateOf("- 앞|뒤")).state)).toBe("- 앞\n- |뒤");
    expect(marked(run(continueList, stateOf("    들여쓴 줄|")).state)).toBe("    들여쓴 줄\n    |");
    expect(marked(run(continueList, stateOf("평범한 줄|")).state)).toBe("평범한 줄\n|");
    // Cursor inside the indentation/marker: plain newline, no new bullet.
    expect(marked(run(continueList, stateOf("|- a")).state)).toBe("\n|- a");
    // "**bold**" at line start is not a "*" bullet.
    expect(marked(run(continueList, stateOf("**굵게**|")).state)).toBe("**굵게**\n|");
  });

  it("Enter is bound in the editor keymap", () => {
    const { view } = makeView("- a", {}, 3);
    expect(press(view, "Enter")).toBe(true);
    expect(view.state.doc.toString()).toBe("- a\n- ");
  });
});

describe("bold", () => {
  it("Mod-b wraps selection in ** and toggles off", () => {
    let s = run(toggleBold, stateOf("[굵게] 할 말")).state;
    expect(marked(s)).toBe("**[굵게]** 할 말");
    s = run(toggleBold, s).state;
    expect(marked(s)).toBe("[굵게] 할 말");
    // Selecting the whole "**x**" also toggles off.
    expect(marked(run(toggleBold, stateOf("[**x**] y")).state)).toBe("[x] y");
  });

  it("Mod-b with a cursor wraps the word at the cursor, or unwraps the bold span around it", () => {
    expect(marked(run(toggleBold, stateOf("배포 일|정 확인")).state)).toBe("배포 **일|정** 확인");
    expect(marked(run(toggleBold, stateOf("배포 **일|정** 확인")).state)).toBe("배포 일|정 확인");
    expect(marked(run(toggleBold, stateOf("끝 |")).state)).toBe("끝 **|**");
  });

  it("Mod-b is bound in the editor keymap", () => {
    const { view } = makeView("foo bar", {}, 1);
    expect(pressMod(view, "b")).toBe(true);
    expect(view.state.doc.toString()).toBe("**foo** bar");
  });

  it("bold markers hidden via decoration but text kept as **x**", () => {
    const { view } = makeView("- **결정한 것** 정리");
    expect(view.state.doc.toString()).toBe("- **결정한 것** 정리");
    const bold = view.contentDOM.querySelector(".cm-memo-bold");
    expect(bold?.textContent).toBe("결정한 것");
    expect(view.contentDOM.textContent).not.toContain("**");
    expect(view.contentDOM.textContent).toContain("결정한 것");
  });

  it("finds bold spans per line and ignores unmatched or empty markers", () => {
    expect(boldSpans("a **b** c **d e**")).toEqual([
      { from: 2, to: 7 },
      { from: 10, to: 17 },
    ]);
    expect(boldSpans("** 공백 ** 와 ****, **열림")).toEqual([]);
  });

  it("Backspace at the end of a bold word deletes the last letter, not the hidden marker", () => {
    const { view } = makeView("**ab** c", {}, 6);
    expect(press(view, "Backspace")).toBe(true);
    expect(view.state.doc.toString()).toBe("**a** c");
    expect(press(view, "Backspace")).toBe(true);
    expect(view.state.doc.toString()).toBe(" c");
  });
});

describe("indent guides", () => {
  it("draws one guide per 2-space indent level and keeps the spaces in the doc", () => {
    const { view } = makeView("- a\n  - b\n    - c");
    const lines = view.contentDOM.querySelectorAll(".cm-line");
    expect(lines[0].querySelectorAll(".cm-memo-guide")).toHaveLength(0);
    expect(lines[1].querySelectorAll(".cm-memo-guide")).toHaveLength(1);
    expect(lines[2].querySelectorAll(".cm-memo-guide")).toHaveLength(2);
    expect(view.state.doc.line(3).text).toBe("    - c");
  });
});

describe("current line", () => {
  it("marks only the cursor line, and only while focused", () => {
    const state = stateOf("a\nb|\nc");
    expect(currentLineDecorations(state, false).size).toBe(0);
    const deco = currentLineDecorations(state, true);
    const starts: number[] = [];
    deco.between(0, state.doc.length, (from) => void starts.push(from));
    expect(starts).toEqual([state.doc.line(2).from]);
  });
});

describe("block navigation", () => {
  it("Mod-Enter calls onNewBlock", () => {
    const { view, onNewBlock } = makeView("- a", {}, 3);
    expect(pressMod(view, "Enter")).toBe(true);
    expect(onNewBlock).toHaveBeenCalledTimes(1);
    expect(view.state.doc.toString()).toBe("- a");
  });

  it("ArrowUp on first line calls onBoundary('up')", () => {
    const { view, onBoundary } = makeView("첫 줄\n둘째 줄", {}, 2);
    expect(press(view, "ArrowUp")).toBe(true);
    expect(onBoundary).toHaveBeenCalledWith("up");
  });

  it("ArrowUp below the first line moves normally", () => {
    const { view, onBoundary } = makeView("첫 줄\n둘째 줄", {}, 6);
    press(view, "ArrowUp");
    expect(onBoundary).not.toHaveBeenCalled();
  });

  it("ArrowDown on last line calls onBoundary('down')", () => {
    const { view, onBoundary } = makeView("첫 줄\n둘째 줄", {}, 6);
    expect(press(view, "ArrowDown")).toBe(true);
    expect(onBoundary).toHaveBeenCalledWith("down");
  });

  it("falls through to the default motion when onBoundary returns false (no block there)", () => {
    const onBoundary = vi.fn(() => false);
    const { view } = makeView("첫 줄", { onBoundary }, 2);
    press(view, "ArrowUp");
    expect(onBoundary).toHaveBeenCalledWith("up");
    expect(view.state.doc.toString()).toBe("첫 줄");
  });

  it("does not leave the block while text is selected", () => {
    const { view, onBoundary } = makeView("첫 줄", {}, 0);
    view.dispatch({ selection: { anchor: 0, head: 2 } });
    press(view, "ArrowUp");
    expect(onBoundary).not.toHaveBeenCalled();
  });
});

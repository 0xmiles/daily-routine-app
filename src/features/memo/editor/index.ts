import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { EditorState, Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { boldDecorations, deleteBackwardAroundBold, toggleBold } from "./bold";
import { currentLineHighlight } from "./currentLine";
import { indentGuides } from "./guides";
import { headings } from "./heading";
import { INDENT, continueList, indentLines, outdentLines } from "./indent";
import { dividers } from "./rule";
import { firstLineTitle } from "./title";

export { boldSpans, toggleBold } from "./bold";
export { cycleHeading } from "./heading";
export { continueList, indentLines, outdentLines } from "./indent";

export interface MemoEditorOptions {
  /** Mod-Enter: start a new memo file. */
  onNewBlock(): void;
  /** Set the first line as the memo's title (larger, bold). */
  titled?: boolean;
  /**
   * ArrowUp on the first (visual) line / ArrowDown on the last: move to the
   * neighbouring block. Return `false` when there is no block that way, and the
   * key falls through to normal cursor motion.
   */
  onBoundary(dir: "up" | "down"): void | boolean;
}

/** True if `pos` sits on the first (up) / last (down) visual row of the document. */
function onEdgeRow(view: EditorView, pos: number, dir: "up" | "down"): boolean {
  const line = view.state.doc.lineAt(pos);
  if (dir === "up" ? line.number !== 1 : line.number !== view.state.doc.lines) return false;
  try {
    const here = view.coordsAtPos(pos, dir === "up" ? 1 : -1);
    const edge = view.coordsAtPos(dir === "up" ? line.from : line.to, dir === "up" ? 1 : -1);
    // A wrapped first/last line spans several rows; only the outermost row is the edge.
    if (here && edge) return Math.abs(here.top - edge.top) < 2;
  } catch {
    // No layout (tests, hidden editor): treat the document line as the row.
  }
  return true;
}

function boundary(opts: MemoEditorOptions, dir: "up" | "down") {
  return (view: EditorView): boolean => {
    const { selection } = view.state;
    if (selection.ranges.length > 1 || !selection.main.empty) return false;
    if (!onEdgeRow(view, selection.main.head, dir)) return false;
    return opts.onBoundary(dir) !== false;
  };
}

const memoTheme = EditorView.theme({
  "&": { color: "inherit", backgroundColor: "transparent", fontSize: "inherit" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "1.75", overflowX: "hidden" },
  ".cm-content": { padding: "0", caretColor: "var(--ink)", minHeight: "1.75em" },
  ".cm-line": { padding: "0 var(--memo-gutter, 0px)" },
  ".cm-memo-current": {
    backgroundImage:
      "linear-gradient(90deg, color-mix(in srgb, var(--hue) var(--line-mix), var(--tint-base)), color-mix(in srgb, var(--hue) 6%, transparent))",
  },
  ".cm-memo-bold": { fontWeight: "700" },
  ".cm-memo-title": {
    fontFamily: "var(--font-stack-head)",
    fontSize: "1.6em",
    fontWeight: "700",
    lineHeight: "1.4",
    letterSpacing: "-0.02em",
    paddingBottom: "0.35em",
  },
  // Headings, smaller than the memo's name (1.6em) and larger than the text.
  ".cm-memo-h1, .cm-memo-h2, .cm-memo-h3": {
    fontFamily: "var(--font-stack-head)",
    fontWeight: "700",
    lineHeight: "1.45",
    letterSpacing: "-0.015em",
    paddingTop: "0.3em",
  },
  ".cm-memo-h1": { fontSize: "1.4em" },
  ".cm-memo-h2": { fontSize: "1.2em" },
  ".cm-memo-h3": { fontSize: "1.08em" },
  // `#` / `---` shown as text on the line being edited.
  ".cm-memo-mark": { color: "var(--pencil)" },
  ".cm-memo-hr": {
    display: "inline-block",
    width: "100%",
    height: "1px",
    verticalAlign: "middle",
    backgroundColor: "var(--rule)",
  },
  ".cm-memo-bullet": { color: "var(--pencil)" },
  ".cm-memo-guide": {
    display: "inline-block",
    width: "1.15em",
    height: "1.75em",
    verticalAlign: "top",
    background: "linear-gradient(var(--rule), var(--rule)) no-repeat 0.2em 0 / 1px 100%",
  },
  ".cm-placeholder": { color: "var(--pencil)" },
});

/**
 * Everything the memo editor needs on top of a bare EditorView: history, the
 * default keymap, 2-space Tab indent, list-continuing Enter, Mod-b bold with
 * hidden markers, `#` headings and `---` dividers, indent guides, current-line
 * highlight and block navigation.
 */
export function memoExtensions(opts: MemoEditorOptions): Extension[] {
  return [
    history(),
    indentUnit.of(INDENT),
    EditorState.tabSize.of(INDENT.length),
    EditorView.lineWrapping,
    Prec.high(
      keymap.of([
        { key: "Tab", run: indentLines, shift: outdentLines },
        { key: "Enter", run: continueList },
        { key: "Mod-b", run: toggleBold },
        { key: "Backspace", run: deleteBackwardAroundBold },
        {
          key: "Mod-Enter",
          run: () => {
            opts.onNewBlock();
            return true;
          },
        },
        { key: "ArrowUp", run: boundary(opts, "up") },
        { key: "ArrowDown", run: boundary(opts, "down") },
      ]),
    ),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    boldDecorations,
    indentGuides,
    currentLineHighlight,
    headings(opts.titled ?? false),
    dividers,
    opts.titled ? firstLineTitle : [],
    memoTheme,
  ];
}

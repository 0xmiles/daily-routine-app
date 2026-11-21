import { EditorSelection, type Range, type StateCommand } from "@codemirror/state";
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";
import { headingLevel, headingPrefixLength } from "../syntax";
import { listMarker, selectedLines } from "./indent";
import { revealedLines, visibleLines } from "./marks";

// Headings: a line starting with `# `, `## ` or `### ` is drawn as a heading
// (`cm-memo-h1..3`). Its `# ` is shown in pencil on the line being edited and
// hidden elsewhere; the text is stored as typed. On a titled memo the first
// line is the memo's name and keeps the name's size — only its `# ` is hidden.

const LEVEL_CLASS = ["", "cm-memo-h1", "cm-memo-h2", "cm-memo-h3"] as const;
const mark = Decoration.mark({ class: "cm-memo-mark" });
const hidden = Decoration.replace({});

function build(view: EditorView, titled: boolean): DecorationSet {
  const shown = revealedLines(view.state, view.hasFocus);
  const out: Range<Decoration>[] = [];
  for (const line of visibleLines(view)) {
    const level = headingLevel(line.text);
    if (level === 0) continue;
    if (!(titled && line.number === 1)) out.push(Decoration.line({ class: LEVEL_CLASS[level] }).range(line.from));
    const end = line.from + headingPrefixLength(line.text);
    out.push((shown.has(line.number) ? mark : hidden).range(line.from, end));
  }
  return Decoration.set(out, true);
}

export function headings(titled: boolean) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = build(view, titled);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || update.selectionSet || update.focusChanged) {
          this.decorations = build(update.view, titled);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
}

/**
 * The 제목 tool: each selected line goes plain → `#` → `##` → `###` → plain.
 * An indented or bulleted line loses its indent and bullet and becomes a heading.
 */
export const cycleHeading: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  const changes = state.changes(
    selectedLines(state).map((line) => {
      const level = headingLevel(line.text);
      const strip = level
        ? headingPrefixLength(line.text)
        : (listMarker(line.text)?.length ?? /^[ \t]*/.exec(line.text)![0].length);
      const next = (level + 1) % 4;
      return { from: line.from, to: line.from + strip, insert: next ? `${"#".repeat(next)} ` : "" };
    }),
  );
  dispatch(
    state.update({
      changes,
      selection: EditorSelection.create(
        state.selection.ranges.map((r) => EditorSelection.range(changes.mapPos(r.anchor, 1), changes.mapPos(r.head, 1))),
        state.selection.mainIndex,
      ),
      scrollIntoView: true,
      userEvent: "input.heading",
    }),
  );
  return true;
};

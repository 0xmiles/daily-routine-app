import type { EditorState } from "@codemirror/state";
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";

// "지금 쓰는 줄만 형광펜" (spec §5.7): the cursor line of the focused editor gets
// a `--marker` gradient underlay. Unfocused blocks show no highlight, so only
// one line on the whole memo pad is ever highlighted.

const currentLine = Decoration.line({ class: "cm-memo-current" });

export function currentLineDecorations(state: EditorState, focused: boolean): DecorationSet {
  if (!focused) return Decoration.none;
  const line = state.doc.lineAt(state.selection.main.head);
  return Decoration.set([currentLine.range(line.from)]);
}

export const currentLineHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = currentLineDecorations(view.state, view.hasFocus);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.focusChanged) {
        this.decorations = currentLineDecorations(update.state, update.view.hasFocus);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

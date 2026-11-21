import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/**
 * Line numbers whose `#` / `---` marks are shown as text: the lines the
 * selection touches while the editor has focus. Elsewhere the marks are hidden
 * (headings) or drawn (dividers). Unfocused, every mark is hidden.
 */
export function revealedLines(state: EditorState, focused: boolean): Set<number> {
  const lines = new Set<number>();
  if (!focused) return lines;
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let n = first; n <= last; n++) lines.add(n);
  }
  return lines;
}

/** Each visible document line once, in order. */
export function* visibleLines(view: EditorView) {
  let last = 0;
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos);
      if (line.number > last) {
        last = line.number;
        yield line;
      }
      pos = line.to + 1;
    }
  }
}

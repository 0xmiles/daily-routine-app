import { EditorSelection, type ChangeSpec, type EditorState, type Line, type StateCommand } from "@codemirror/state";

// Indentation and list continuation (spec §5.3):
// - Tab / Shift-Tab indent / outdent whole lines by 2 spaces.
// - Enter carries the line's indentation and bullet ("- ", "* ", "1. ") to the
//   next line; numbers count up. Enter on a bullet with no text removes the bullet.

export const INDENT = "  ";

/** indent, marker ("-", "*", "12."), spacing after the marker. "**bold**" is not a bullet. */
const LIST_RE = /^([ \t]*)([-*]|\d+\.)([ \t]+)/;

export interface ListMarker {
  indent: string;
  marker: string;
  spacing: string;
  /** Length of indent + marker + spacing. */
  length: number;
}

export function listMarker(lineText: string): ListMarker | null {
  const m = LIST_RE.exec(lineText);
  if (!m) return null;
  return { indent: m[1], marker: m[2], spacing: m[3], length: m[0].length };
}

function nextMarker(marker: string): string {
  const n = /^(\d+)\.$/.exec(marker);
  return n ? `${Number(n[1]) + 1}.` : marker;
}

/** Lines touched by the selection (a range ending at a line start does not touch that line). */
export function selectedLines(state: EditorState): Line[] {
  const lines: Line[] = [];
  let last = -1;
  for (const range of state.selection.ranges) {
    const endLine = state.doc.lineAt(range.to);
    const to = !range.empty && range.to === endLine.from && endLine.number > 1 ? range.to - 1 : range.to;
    for (let pos = range.from; pos <= to; ) {
      const line = state.doc.lineAt(pos);
      if (line.number > last) {
        lines.push(line);
        last = line.number;
      }
      pos = line.to + 1;
    }
  }
  return lines;
}

/** Tab: add 2 spaces at the start of every selected line. */
export const indentLines: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  const changes = state.changes(selectedLines(state).map((line) => ({ from: line.from, insert: INDENT })));
  dispatch(
    state.update({
      changes,
      // assoc 1: a cursor at the line start ends up after the new indent.
      selection: state.selection.map(changes, 1),
      scrollIntoView: true,
      userEvent: "input.indent",
    }),
  );
  return true;
};

/** Shift-Tab: remove up to 2 leading spaces (or one tab) from every selected line. */
export const outdentLines: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  const specs: ChangeSpec[] = [];
  for (const line of selectedLines(state)) {
    const lead = /^( {1,2}|\t)/.exec(line.text);
    if (lead) specs.push({ from: line.from, to: line.from + lead[0].length });
  }
  if (specs.length === 0) return true; // nothing to outdent; still swallow Shift-Tab
  const changes = state.changes(specs);
  dispatch(
    state.update({ changes, selection: state.selection.map(changes, 1), scrollIntoView: true, userEvent: "delete.dedent" }),
  );
  return true;
};

/** Enter: newline that keeps indentation and continues bullets / numbering. */
export const continueList: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  const tr = state.changeByRange((range) => {
    const line = state.doc.lineAt(range.from);
    const offset = range.from - line.from;
    const list = listMarker(line.text);

    if (list && offset >= list.length) {
      const textAfterMarker = line.text.slice(list.length);
      if (textAfterMarker.trim() === "" && range.to <= line.to) {
        // Empty bullet: the bullet goes away, the indentation stays.
        const from = line.from + list.indent.length;
        return { changes: { from, to: line.to }, range: EditorSelection.cursor(from) };
      }
      const insert = `\n${list.indent}${nextMarker(list.marker)}${list.spacing}`;
      return {
        changes: { from: range.from, to: range.to, insert },
        range: EditorSelection.cursor(range.from + insert.length),
      };
    }

    const indent = /^[ \t]*/.exec(line.text)![0];
    const keep = offset >= indent.length ? indent : line.text.slice(0, offset);
    const insert = `\n${keep}`;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.cursor(range.from + insert.length),
    };
  });
  dispatch(state.update(tr, { scrollIntoView: true, userEvent: "input" }));
  return true;
};

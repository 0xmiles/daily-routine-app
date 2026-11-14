import {
  EditorSelection,
  RangeSetBuilder,
  findClusterBreak,
  type ChangeSpec,
  type EditorState,
  type SelectionRange,
  type StateCommand,
} from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { listMarker } from "./indent";

// Bold (spec §5.3): stored as `**text**`, shown bold with the `**` hidden.
// Mod-b toggles it. The hidden markers are atomic, so the cursor never lands
// inside them, and Backspace next to a hidden marker deletes a visible letter.

const MARK = "**";

/** Bold content: no `*` inside, no whitespace at either end, not empty. */
const BOLD_RE = /\*\*([^\s*](?:[^*]*?[^\s*])?)\*\*/g;

export interface Span {
  /** Start of the opening `**`, relative to the text. */
  from: number;
  /** End of the closing `**`, relative to the text. */
  to: number;
}

/** `**bold**` spans in one line of text. */
export function boldSpans(lineText: string): Span[] {
  const spans: Span[] = [];
  for (const m of lineText.matchAll(BOLD_RE)) spans.push({ from: m.index, to: m.index + m[0].length });
  return spans;
}

function isWholeBold(text: string): boolean {
  return boldSpans(text).some((s) => s.from === 0 && s.to === text.length);
}

function toggleAtCursor(state: EditorState, pos: number) {
  const line = state.doc.lineAt(pos);
  const off = pos - line.from;

  const span = boldSpans(line.text).find((s) => s.from <= off && off <= s.to);
  if (span) {
    const changes = state.changes([
      { from: line.from + span.from, to: line.from + span.from + 2 },
      { from: line.from + span.to - 2, to: line.from + span.to },
    ]);
    return { changes, range: EditorSelection.cursor(changes.mapPos(pos)) };
  }

  if (line.text.slice(off - 2, off + 2) === MARK + MARK) {
    // An empty "**|**" pair: toggle it off again.
    return { changes: { from: pos - 2, to: pos + 2 }, range: EditorSelection.cursor(pos - 2) };
  }

  const word = state.wordAt(pos);
  if (word) {
    return {
      changes: [
        { from: word.from, insert: MARK },
        { from: word.to, insert: MARK },
      ],
      range: EditorSelection.cursor(pos + 2),
    };
  }
  return { changes: { from: pos, insert: MARK + MARK }, range: EditorSelection.cursor(pos + 2) };
}

function toggleInLine(state: EditorState, range: SelectionRange) {
  const { from, to } = range;
  const line = state.doc.lineAt(from);
  const text = state.sliceDoc(from, to);

  if (isWholeBold(text)) {
    return {
      changes: [
        { from, to: from + 2 },
        { from: to - 2, to },
      ],
      range: EditorSelection.range(from, to - 4),
    };
  }

  const before = state.sliceDoc(from - 2, from);
  const after = state.sliceDoc(to, to + 2);
  if (
    before === MARK &&
    after === MARK &&
    boldSpans(line.text).some((s) => s.from === from - 2 - line.from && s.to === to + 2 - line.from)
  ) {
    return {
      changes: [
        { from: from - 2, to: from },
        { from: to, to: to + 2 },
      ],
      range: EditorSelection.range(from - 2, to - 2),
    };
  }

  const lead = text.length - text.trimStart().length;
  const trail = text.length - text.trimEnd().length;
  if (lead === text.length) return { range };
  const a = from + lead;
  const b = to - trail;
  return {
    changes: [
      { from: a, insert: MARK },
      { from: b, insert: MARK },
    ],
    range: EditorSelection.range(a + 2, b + 2),
  };
}

function toggleAcrossLines(state: EditorState, range: SelectionRange) {
  const segments: Array<[number, number]> = [];
  const last = state.doc.lineAt(range.to).number;
  for (let n = state.doc.lineAt(range.from).number; n <= last; n++) {
    const line = state.doc.line(n);
    const list = listMarker(line.text);
    const contentStart = line.from + (list ? list.length : /^[ \t]*/.exec(line.text)![0].length);
    let a = Math.max(range.from, line.from, contentStart);
    let b = Math.min(range.to, line.to);
    while (a < b && /\s/.test(state.sliceDoc(a, a + 1))) a++;
    while (b > a && /\s/.test(state.sliceDoc(b - 1, b))) b--;
    if (a < b) segments.push([a, b]);
  }
  if (segments.length === 0) return { range };

  const allBold = segments.every(([a, b]) => isWholeBold(state.sliceDoc(a, b)));
  const specs: ChangeSpec[] = [];
  for (const [a, b] of segments) {
    if (allBold) specs.push({ from: a, to: a + 2 }, { from: b - 2, to: b });
    else if (!isWholeBold(state.sliceDoc(a, b))) specs.push({ from: a, insert: MARK }, { from: b, insert: MARK });
  }
  const changes = state.changes(specs);
  return { changes, range: EditorSelection.range(changes.mapPos(range.from, -1), changes.mapPos(range.to, 1)) };
}

/** Mod-b: bold the selection (or the word at the cursor), or un-bold it if it already is. */
export const toggleBold: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  const tr = state.changeByRange((range) => {
    if (range.empty) return toggleAtCursor(state, range.head);
    if (state.doc.lineAt(range.from).number === state.doc.lineAt(range.to).number) return toggleInLine(state, range);
    return toggleAcrossLines(state, range);
  });
  dispatch(state.update(tr, { scrollIntoView: true, userEvent: "input.format" }));
  return true;
};

/**
 * Backspace right after a hidden closing `**` deletes the last bold letter (the
 * whole span when it was the only one); right after a hidden opening `**` it
 * deletes the character before the bold word. Elsewhere: default Backspace.
 */
export const deleteBackwardAroundBold: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly || state.selection.ranges.length > 1 || !state.selection.main.empty) return false;
  const pos = state.selection.main.head;
  const line = state.doc.lineAt(pos);
  const off = pos - line.from;

  for (const span of boldSpans(line.text)) {
    if (off === span.to) {
      const contentStart = span.from + 2;
      const contentEnd = span.to - 2;
      const prev = findClusterBreak(line.text, contentEnd, false);
      const change =
        prev <= contentStart
          ? { from: line.from + span.from, to: line.from + span.to }
          : { from: line.from + prev, to: line.from + contentEnd };
      const changes = state.changes(change);
      dispatch(state.update({ changes, selection: { anchor: changes.mapPos(pos, -1) }, userEvent: "delete.backward" }));
      return true;
    }
    if (off === span.from + 2) {
      let change: { from: number; to: number } | null = null;
      if (span.from > 0) change = { from: line.from + findClusterBreak(line.text, span.from, false), to: line.from + span.from };
      else if (line.number > 1) change = { from: line.from - 1, to: line.from };
      if (!change) return true;
      const changes = state.changes(change);
      dispatch(state.update({ changes, selection: { anchor: changes.mapPos(pos, 1) }, userEvent: "delete.backward" }));
      return true;
    }
  }
  return false;
};

const hiddenMarker = Decoration.replace({});
const boldMark = Decoration.mark({ class: "cm-memo-bold" });

class BoldView {
  decorations: DecorationSet;
  hidden: DecorationSet;

  constructor(view: EditorView) {
    ({ decorations: this.decorations, hidden: this.hidden } = build(view));
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged) {
      ({ decorations: this.decorations, hidden: this.hidden } = build(update.view));
    }
  }
}

function build(view: EditorView): { decorations: DecorationSet; hidden: DecorationSet } {
  const all = new RangeSetBuilder<Decoration>();
  const hidden = new RangeSetBuilder<Decoration>();
  let lastLine = 0;
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos);
      if (line.number > lastLine) {
        lastLine = line.number;
        for (const span of boldSpans(line.text)) {
          const a = line.from + span.from;
          const b = line.from + span.to;
          all.add(a, a + 2, hiddenMarker);
          all.add(a + 2, b - 2, boldMark);
          all.add(b - 2, b, hiddenMarker);
          hidden.add(a, a + 2, hiddenMarker);
          hidden.add(b - 2, b, hiddenMarker);
        }
      }
      pos = line.to + 1;
    }
  }
  return { decorations: all.finish(), hidden: hidden.finish() };
}

const boldPlugin = ViewPlugin.fromClass(BoldView, { decorations: (v) => v.decorations });

/** Shows `**x**` as bold x with the markers hidden (and atomic for the cursor). */
export const boldDecorations = [
  boldPlugin,
  EditorView.atomicRanges.of((view) => view.plugin(boldPlugin)?.hidden ?? Decoration.none),
];

import type { Range } from "@codemirror/state";
import { Decoration, ViewPlugin, WidgetType, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";
import { isRuleLine } from "../syntax";
import { revealedLines, visibleLines } from "./marks";

// Dividers: a line of only `---` (three or more) is drawn as a thin rule. On
// the line being edited the dashes come back as text (in pencil) so they can be
// changed; the document always keeps the dashes.

class RuleWidget extends WidgetType {
  eq(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-memo-hr";
    span.setAttribute("aria-hidden", "true");
    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

const ruleLine = Decoration.line({ class: "cm-memo-rule" });
const drawn = Decoration.replace({ widget: new RuleWidget() });
const mark = Decoration.mark({ class: "cm-memo-mark" });

function build(view: EditorView): DecorationSet {
  const shown = revealedLines(view.state, view.hasFocus);
  const out: Range<Decoration>[] = [];
  for (const line of visibleLines(view)) {
    if (!isRuleLine(line.text)) continue;
    out.push(ruleLine.range(line.from));
    out.push((shown.has(line.number) ? mark : drawn).range(line.from, line.to));
  }
  return Decoration.set(out, true);
}

export const dividers = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = build(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.selectionSet || update.focusChanged) {
        this.decorations = build(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

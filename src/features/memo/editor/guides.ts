import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { INDENT, listMarker } from "./indent";

// Indent guides: every 2-space indent unit is drawn as a fixed-width box with a
// 1px `--rule` line (one line per level), like the mockup. The spaces stay in
// the document; the boxes are atomic, so Backspace after an indent removes one
// level. Bullet markers ("-", "*", "1.") are drawn in `--pencil`.

class GuideWidget extends WidgetType {
  eq(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-memo-guide";
    span.setAttribute("aria-hidden", "true");
    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

const guide = Decoration.replace({ widget: new GuideWidget() });
const bullet = Decoration.mark({ class: "cm-memo-bullet" });

class GuidesView {
  decorations: DecorationSet;
  guides: DecorationSet;

  constructor(view: EditorView) {
    ({ decorations: this.decorations, guides: this.guides } = build(view));
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged) {
      ({ decorations: this.decorations, guides: this.guides } = build(update.view));
    }
  }
}

function build(view: EditorView): { decorations: DecorationSet; guides: DecorationSet } {
  const all = new RangeSetBuilder<Decoration>();
  const guides = new RangeSetBuilder<Decoration>();
  let lastLine = 0;
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos);
      if (line.number > lastLine) {
        lastLine = line.number;
        const spaces = /^ */.exec(line.text)![0].length;
        const levels = Math.floor(spaces / INDENT.length);
        for (let i = 0; i < levels; i++) {
          const a = line.from + i * INDENT.length;
          all.add(a, a + INDENT.length, guide);
          guides.add(a, a + INDENT.length, guide);
        }
        const list = listMarker(line.text);
        if (list) {
          const markerFrom = line.from + list.indent.length;
          all.add(markerFrom, markerFrom + list.marker.length, bullet);
        }
      }
      pos = line.to + 1;
    }
  }
  return { decorations: all.finish(), guides: guides.finish() };
}

const guidesPlugin = ViewPlugin.fromClass(GuidesView, { decorations: (v) => v.decorations });

export const indentGuides = [
  guidesPlugin,
  EditorView.atomicRanges.of((view) => view.plugin(guidesPlugin)?.guides ?? Decoration.none),
];

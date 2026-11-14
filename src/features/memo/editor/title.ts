import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";

// A memo file's first line is its title (shown in the memo list), so the
// editor sets it larger and bold. Event memos are named by their event and
// don't use this.

const titleLine = Decoration.line({ class: "cm-memo-title" });

function build(): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  builder.add(0, 0, titleLine);
  return builder.finish();
}

export const firstLineTitle = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor() {
      this.decorations = build();
    }

    update(update: ViewUpdate) {
      if (update.docChanged) this.decorations = build();
    }
  },
  { decorations: (v) => v.decorations },
);

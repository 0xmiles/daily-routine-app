"use client";

import { Annotation, EditorState, Prec, Transaction, type ChangeSpec } from "@codemirror/state";
import { EditorView, keymap, placeholder as placeholderExtension } from "@codemirror/view";
import { memo, useEffect, useLayoutEffect, useRef } from "react";
import { memoExtensions } from "./editor";

/** Marks transactions that load server text into the editor (not user edits). */
const External = Annotation.define<boolean>();

export interface BlockEditorHandle {
  readonly view: EditorView;
  /** Focus with the cursor at the start or end of the block. */
  focus(at: "start" | "end"): void;
}

export interface BlockEditorProps {
  blockKey: string;
  /** Text to start with; afterwards only read again when `remoteRev` changes. */
  content: string;
  /** Bump to replace the editor's text with `content` (server text after a conflict or refresh). */
  remoteRev: number;
  /** Accessible name of the text area. */
  label: string;
  placeholder?: string;
  /** First line is the memo's title (read once, on mount). */
  titled?: boolean;
  className?: string;
  onChange(key: string, content: string): void;
  onNewBlock(): void;
  /** Return false when there is no block in that direction. */
  onBoundary(key: string, dir: "up" | "down"): boolean;
  /** Backspace in an empty block. Return true if the block was removed. */
  onRemoveEmpty(key: string): boolean;
  onFocusChange(key: string, focused: boolean): void;
  register(key: string, handle: BlockEditorHandle | null): void;
}

/** Smallest single replacement turning `from` into `to`, so the cursor survives when possible. */
function minimalChange(from: string, to: string): ChangeSpec {
  let start = 0;
  const max = Math.min(from.length, to.length);
  while (start < max && from.charCodeAt(start) === to.charCodeAt(start)) start++;
  let end = 0;
  while (end < max - start && from.charCodeAt(from.length - 1 - end) === to.charCodeAt(to.length - 1 - end)) end++;
  return { from: start, to: from.length - end, insert: to.slice(start, to.length - end) };
}

/** One CodeMirror 6 editor for one memo file. */
export const BlockEditor = memo(function BlockEditor(props: BlockEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const latest = useRef(props);
  const initialContent = useRef(props.content);
  const initialPlaceholder = useRef(props.placeholder);
  const initialTitled = useRef(props.titled ?? false);
  const appliedRev = useRef(props.remoteRev);

  useLayoutEffect(() => {
    latest.current = props;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const p = () => latest.current;
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: initialContent.current,
        extensions: [
          Prec.highest(
            keymap.of([
              { key: "Backspace", run: (v) => v.state.doc.length === 0 && p().onRemoveEmpty(p().blockKey) },
            ]),
          ),
          memoExtensions({
            titled: initialTitled.current,
            onNewBlock: () => p().onNewBlock(),
            onBoundary: (dir) => p().onBoundary(p().blockKey, dir),
          }),
          initialPlaceholder.current ? placeholderExtension(initialPlaceholder.current) : [],
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            if (update.transactions.some((tr) => tr.annotation(External))) return;
            p().onChange(p().blockKey, update.state.doc.toString());
          }),
          // Keep the cursor clear of the sticky header and the mobile tool bar.
          EditorView.scrollMargins.of(() => ({ top: 72, bottom: 96 })),
        ],
      }),
    });
    viewRef.current = view;

    const onFocus = () => p().onFocusChange(p().blockKey, true);
    const onBlur = () => p().onFocusChange(p().blockKey, false);
    view.contentDOM.addEventListener("focus", onFocus);
    view.contentDOM.addEventListener("blur", onBlur);

    const handle: BlockEditorHandle = {
      view,
      focus(at) {
        view.dispatch({ selection: { anchor: at === "end" ? view.state.doc.length : 0 } });
        view.focus();
      },
    };
    const key = p().blockKey;
    p().register(key, handle);

    return () => {
      p().register(key, null);
      view.contentDOM.removeEventListener("focus", onFocus);
      view.contentDOM.removeEventListener("blur", onBlur);
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // Accessible name (kept outside CodeMirror's managed attributes so it can change).
  useEffect(() => {
    viewRef.current?.contentDOM.setAttribute("aria-label", props.label);
  }, [props.label]);

  // Server text replaced this block's text.
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view || props.remoteRev === appliedRev.current) return;
    appliedRev.current = props.remoteRev;
    const current = view.state.doc.toString();
    if (current === props.content) return;
    view.dispatch({
      changes: minimalChange(current, props.content),
      annotations: [External.of(true), Transaction.addToHistory.of(false)],
    });
  }, [props.remoteRev, props.content]);

  return <div ref={hostRef} className={props.className} data-memo-editor="" />;
});

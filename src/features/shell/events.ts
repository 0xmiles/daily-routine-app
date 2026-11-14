// A tiny in-page signal so screens refetch after something is created or
// changed elsewhere (quick add, event sheet). Any track may listen:
//
//   useEffect(() => onDataChanged((kind) => { if (kind === "todo") reload(); }), []);

export const DATA_CHANGED_EVENT = "daily:data-changed";

export type DataKind = "todo" | "event" | "memo";

export function emitDataChanged(kind: DataKind): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<{ kind: DataKind }>(DATA_CHANGED_EVENT, { detail: { kind } }));
}

/** Subscribes to data changes; returns the unsubscribe function. */
export function onDataChanged(listener: (kind: DataKind) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<{ kind: DataKind }>).detail.kind);
  window.addEventListener(DATA_CHANGED_EVENT, handler);
  return () => window.removeEventListener(DATA_CHANGED_EVENT, handler);
}

// "새 메모" from the shell (+ button / ⌘N on the memo tab). The memo page
// listens and opens a new memo file.

export const NEW_MEMO_EVENT = "daily:new-memo";

export function requestNewMemo(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(NEW_MEMO_EVENT));
}

export function onNewMemoRequest(listener: () => void): () => void {
  window.addEventListener(NEW_MEMO_EVENT, listener);
  return () => window.removeEventListener(NEW_MEMO_EVENT, listener);
}

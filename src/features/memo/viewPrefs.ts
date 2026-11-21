"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { readPrefRaw, writePref } from "@/features/shell/prefs";

// 메모 화면의 기기별 보기 설정 (localStorage, "daily:" keys). Server render and
// hydration see the defaults; the stored values follow right after.

/** 글씨 크기 단계 (배율). 1 = 기본: 넓은 화면 16px, 휴대폰 16.5px. */
export const FONT_SCALES = [0.875, 1, 1.125, 1.25, 1.375] as const;
export type FontScale = (typeof FONT_SCALES)[number];

/**
 * The scale to use. On phones and touch devices (`compact`) nothing below 1:
 * iOS zooms into a text field whose text is under 16px.
 */
export function clampFontScale(scale: number, compact: boolean): FontScale {
  const known = (FONT_SCALES as readonly number[]).includes(scale) ? (scale as FontScale) : 1;
  return compact && known < 1 ? 1 : known;
}

const KEYS = {
  listOpen: "memo.listOpen",
  fontScale: "memo.fontScale",
  closedFolders: "memo.closedFolders",
} as const;

const listeners = new Set<() => void>();
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Parsed values by key, reused while the stored text is the same (a stable snapshot).
const cache = new Map<string, { raw: string | null; value: unknown }>();

function usePref<T>(key: string, fallback: T, parse: (stored: unknown) => T): [T, (value: T) => void] {
  const getSnapshot = useCallback((): T => {
    const raw = readPrefRaw(key);
    const hit = cache.get(key);
    if (hit && hit.raw === raw) return hit.value as T;
    let value = fallback;
    if (raw !== null) {
      try {
        value = parse(JSON.parse(raw));
      } catch {
        value = fallback;
      }
    }
    cache.set(key, { raw, value });
    return value;
  }, [key, fallback, parse]);
  const value = useSyncExternalStore(subscribe, getSnapshot, () => fallback);
  const set = useCallback(
    (next: T) => {
      writePref(key, next);
      for (const listener of listeners) listener();
    },
    [key],
  );
  return [value, set];
}

const EMPTY: readonly string[] = [];
const parseBool = (v: unknown) => (typeof v === "boolean" ? v : true);
const parseScale = (v: unknown) => (typeof v === "number" ? clampFontScale(v, false) : 1);
const parseIds = (v: unknown): readonly string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : EMPTY;

export interface MemoPrefs {
  /** 넓은 화면에서 메모 목록을 펼쳐 두었는지 (기본 펼침). */
  listOpen: boolean;
  setListOpen(open: boolean): void;
  /** 고른 글씨 배율 (아직 기기에 맞게 줄이기 전의 값). */
  fontScale: FontScale;
  setFontScale(scale: FontScale): void;
  /** 닫아 둔 폴더 id. 처음에는 모두 펼쳐져 있다. */
  closedFolders: ReadonlySet<string>;
  toggleFolder(id: string): void;
}

export function useMemoPrefs(): MemoPrefs {
  const [listOpen, setListOpen] = usePref<boolean>(KEYS.listOpen, true, parseBool);
  const [fontScale, setFontScale] = usePref<FontScale>(KEYS.fontScale, 1, parseScale);
  const [closedIds, setClosedIds] = usePref<readonly string[]>(KEYS.closedFolders, EMPTY, parseIds);
  const closedFolders = useMemo(() => new Set(closedIds), [closedIds]);
  const toggleFolder = useCallback(
    (id: string) => setClosedIds(closedIds.includes(id) ? closedIds.filter((x) => x !== id) : [...closedIds, id]),
    [closedIds, setClosedIds],
  );
  return { listOpen, setListOpen, fontScale, setFontScale, closedFolders, toggleFolder };
}

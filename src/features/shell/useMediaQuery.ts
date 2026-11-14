"use client";

import { useSyncExternalStore } from "react";

/** The app's single responsive breakpoint (spec §5.0): tabs below, drawer at and above. */
export const WIDE_QUERY = "(min-width: 900px)";

function matchMediaSafe(query: string): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(query);
}

/**
 * Whether `query` matches. Returns `null` until it is known on the client
 * (server render and hydration), so callers can render both variants and let
 * CSS media queries pick one — no layout flash on first paint.
 */
export function useMediaQuery(query: string): boolean | null {
  return useSyncExternalStore(
    (onChange) => {
      const list = matchMediaSafe(query);
      if (!list) return () => {};
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => matchMediaSafe(query)?.matches ?? false,
    () => null,
  );
}

/** `true` at ≥900px, `false` below, `null` while unknown (SSR / hydration). */
export function useIsWide(): boolean | null {
  return useMediaQuery(WIDE_QUERY);
}

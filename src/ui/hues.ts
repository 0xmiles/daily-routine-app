import type { CSSProperties } from "react";

/**
 * The seven colour pencils in tokens.css, in weekday order (일 → 토), each named
 * after what its weekday means: 해, 달, 불, 물, 나무, 금, and Saturday's blue.
 */
export const HUES = ["pink", "lilac", "tangerine", "aqua", "green", "lemon", "sky"] as const;
export type Hue = (typeof HUES)[number];

/** The pencil of a weekday (0 = 일요일). */
export function dayHue(weekday: number): Hue {
  return HUES[((weekday % 7) + 7) % 7];
}

/** Accounts take pencils in this order, starting with the 자산 tab's green, so up to seven never share one. */
const ACCOUNT_ORDER: readonly Hue[] = ["green", "sky", "tangerine", "lilac", "pink", "aqua", "lemon"];

export function accountHue(index: number): Hue {
  return ACCOUNT_ORDER[((index % ACCOUNT_ORDER.length) + ACCOUNT_ORDER.length) % ACCOUNT_ORDER.length];
}

/** A pencil that stays with one thing (a memo): the same key always gets the same colour. */
export function hueFor(key: string): Hue {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return HUES[Math.abs(h) % HUES.length];
}

/** Sets --hue for the element's CSS, which mixes it, e.g. color-mix(in srgb, var(--hue) 30%, var(--sheet)). */
export function hueStyle(hue: Hue): CSSProperties {
  return { "--hue": `var(--${hue})` } as CSSProperties;
}

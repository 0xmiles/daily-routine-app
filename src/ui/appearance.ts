// 설정 › 화면: colour theme and light/dark mode, kept per device in localStorage
// (the same "daily:" keys as src/features/shell/prefs.ts, JSON-encoded).
//
// <html> carries the result as attributes that src/ui/themes.css reads:
//   data-theme  = one of THEME_IDS
//   data-mode   = what the person picked: system | light | dark
//   data-scheme = what is shown: light | dark (system resolved against the OS)
// THEME_BOOT_SCRIPT sets them in <head> before the first paint and keeps a
// 시스템 page following the OS; applyAppearance() changes them later.

export type ThemeGroup = "basic" | "dev";

export const THEME_GROUPS: ReadonlyArray<{ id: ThemeGroup; name: string; note: string }> = [
  { id: "basic", name: "기본", note: "색연필 일곱 색을 종이마다 다르게" },
  { id: "dev", name: "개발자", note: "에디터와 터미널에서 쓰던 색 구성표 그대로" },
];

const THEME_LIST = [
  { id: "crayon", name: "색연필", group: "basic", note: "또렷한 일곱 색, 기본" },
  { id: "neon", name: "네온", group: "basic", note: "형광처럼 쨍한 색" },
  { id: "candy", name: "캔디", group: "basic", note: "분홍빛 종이에 달콤한 색" },
  { id: "tropical", name: "트로피컬", group: "basic", note: "초록빛 종이에 열대 과일 색" },
  { id: "sunset", name: "노을", group: "basic", note: "살구빛 종이에 따뜻한 색" },
  { id: "pastel", name: "파스텔", group: "basic", note: "흐린 색연필, 차분하게" },
  // 개발자: colours from iTerm2-Color-Schemes and each editor's accents (src/ui/themes.css).
  { id: "onedark", name: "One Dark", group: "dev" },
  { id: "dracula", name: "Dracula", group: "dev" },
  { id: "monokai", name: "Monokai Pro", group: "dev" },
  { id: "gruvbox", name: "Gruvbox", group: "dev" },
  { id: "catppuccin", name: "Catppuccin", group: "dev" },
  { id: "solarized", name: "Solarized", group: "dev" },
  { id: "nord", name: "Nord", group: "dev" },
  { id: "github", name: "GitHub", group: "dev" },
  { id: "tokyonight", name: "Tokyo Night", group: "dev" },
  { id: "ayu", name: "Ayu", group: "dev" },
  { id: "everforest", name: "Everforest", group: "dev" },
  { id: "kanagawa", name: "Kanagawa", group: "dev" },
  { id: "synthwave", name: "Synthwave", group: "dev" },
  { id: "material", name: "Material", group: "dev" },
  { id: "rosepine", name: "Rosé Pine", group: "dev" },
  { id: "darcula", name: "Darcula", group: "dev" },
  { id: "xcode", name: "Xcode", group: "dev" },
  { id: "tomorrow", name: "Tomorrow", group: "dev" },
] as const satisfies ReadonlyArray<{ id: string; name: string; group: ThemeGroup; note?: string }>;

export type ThemeId = (typeof THEME_LIST)[number]["id"];
export type Theme = { id: ThemeId; name: string; group: ThemeGroup; note?: string };
export type Mode = "system" | "light" | "dark";
export type Scheme = "light" | "dark";

export const THEMES: readonly Theme[] = THEME_LIST;
export const THEME_IDS: readonly ThemeId[] = THEMES.map((t) => t.id);
export const DEFAULT_THEME: ThemeId = "crayon";

export const MODES: ReadonlyArray<{ id: Mode; name: string }> = [
  { id: "system", name: "시스템" },
  { id: "light", name: "라이트" },
  { id: "dark", name: "다크" },
];

const THEME_KEY = "daily:theme";
const MODE_KEY = "daily:mode";
const DARK_QUERY = "(prefers-color-scheme: dark)";

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && (THEME_IDS as readonly string[]).includes(value);
}

export function isMode(value: unknown): value is Mode {
  return value === "system" || value === "light" || value === "dark";
}

export function resolveScheme(mode: Mode, osDark: boolean): Scheme {
  return mode === "system" ? (osDark ? "dark" : "light") : mode;
}

/**
 * Runs inline in <head> (src/app/layout.tsx) before anything paints. Kept in
 * plain ES5 with no imports; it mirrors isThemeId / isMode / resolveScheme.
 */
export const THEME_BOOT_SCRIPT = `(function(){var d=document.documentElement;function g(k){try{var v=localStorage.getItem(k);return v===null?null:JSON.parse(v)}catch(e){return null}}var T=${JSON.stringify(
  THEME_IDS,
)};var t=g(${JSON.stringify(THEME_KEY)});if(T.indexOf(t)<0)t=${JSON.stringify(DEFAULT_THEME)};var m=g(${JSON.stringify(
  MODE_KEY,
)});if(m!=="light"&&m!=="dark")m="system";var q=window.matchMedia?window.matchMedia(${JSON.stringify(
  DARK_QUERY,
)}):null;function s(){var mode=d.getAttribute("data-mode");d.setAttribute("data-scheme",mode==="light"||mode==="dark"?mode:q&&q.matches?"dark":"light")}d.setAttribute("data-theme",t);d.setAttribute("data-mode",m);s();if(q){if(q.addEventListener)q.addEventListener("change",s);else if(q.addListener)q.addListener(s)}})();`;

/** What <html> shows now (falls back to the defaults outside a browser or before the boot script). */
export function currentAppearance(): { theme: ThemeId; mode: Mode } {
  if (typeof document === "undefined") return { theme: DEFAULT_THEME, mode: "system" };
  const el = document.documentElement;
  const theme = el.getAttribute("data-theme");
  const mode = el.getAttribute("data-mode");
  return { theme: isThemeId(theme) ? theme : DEFAULT_THEME, mode: isMode(mode) ? mode : "system" };
}

export const APPEARANCE_EVENT = "daily:appearance";

/** Saves and shows a theme and mode on this device. */
export function applyAppearance(theme: ThemeId, mode: Mode): void {
  try {
    window.localStorage.setItem(THEME_KEY, JSON.stringify(theme));
    window.localStorage.setItem(MODE_KEY, JSON.stringify(mode));
  } catch {
    // Storage unavailable: the choice still applies until the page is reloaded.
  }
  const el = document.documentElement;
  const osDark = typeof window.matchMedia === "function" && window.matchMedia(DARK_QUERY).matches;
  el.setAttribute("data-theme", theme);
  el.setAttribute("data-mode", mode);
  el.setAttribute("data-scheme", resolveScheme(mode, osDark));
  syncThemeColor();
  window.dispatchEvent(new CustomEvent(APPEARANCE_EVENT));
}

/** Points <meta name="theme-color"> (browser bar, iOS status area) at the current --paper. */
export function syncThemeColor(): void {
  if (typeof document === "undefined") return;
  const paper = getComputedStyle(document.documentElement).getPropertyValue("--paper").trim();
  if (!paper) return;
  for (const meta of Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'))) {
    meta.removeAttribute("media");
    meta.setAttribute("content", paper);
  }
}

/** Keeps theme-color in step when the OS switches light/dark while 시스템 is picked. */
export function watchSystemScheme(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(DARK_QUERY);
  // The boot script updates data-scheme on the same event; read it after that ran.
  const handler = () => window.setTimeout(onChange, 0);
  query.addEventListener?.("change", handler);
  return () => query.removeEventListener?.("change", handler);
}

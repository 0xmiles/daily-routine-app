// Mirrors --paper / --ink in src/ui/tokens.css for places that cannot read CSS
// variables: <meta name="theme-color"> (viewport.themeColor) and the web manifest.
// Keep in sync with tokens.css.
export const THEME_COLORS = {
  light: { paper: "#F7F7F4", ink: "#1F2533" },
  dark: { paper: "#1F2533", ink: "#F7F7F4" },
} as const;

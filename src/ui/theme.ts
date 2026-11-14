// Mirrors --paper / --ink in src/ui/tokens.css for places that cannot read CSS
// variables: <meta name="theme-color"> (viewport.themeColor) and the web manifest.
// Keep in sync with tokens.css.
export const THEME_COLORS = {
  light: { paper: "#F7F6F2", ink: "#26231F" },
  dark: { paper: "#1C1B19", ink: "#F5F3EE" },
} as const;

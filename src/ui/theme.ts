// Mirrors the default theme's --paper / --ink (src/ui/themes.css, 색연필) for places
// that cannot read CSS variables: <meta name="theme-color"> before the boot script
// runs (viewport.themeColor) and the web manifest. Keep in sync with themes.css.
export const THEME_COLORS = {
  light: { paper: "#FBFAF7", ink: "#1F1C19" },
  dark: { paper: "#0E0E0D", ink: "#F5F4F0" },
} as const;

"use client";

import { useEffect } from "react";
import { syncThemeColor, watchSystemScheme } from "./appearance";

/** Keeps <meta name="theme-color"> on the chosen theme's paper (the boot script sets the theme itself). */
export function AppearanceSync() {
  useEffect(() => {
    syncThemeColor();
    return watchSystemScheme(syncThemeColor);
  }, []);
  return null;
}

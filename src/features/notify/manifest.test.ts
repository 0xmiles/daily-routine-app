import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import { THEME_COLORS } from "@/ui/theme";

const PUBLIC = fileURLToPath(new URL("../../../public", import.meta.url));

describe("web manifest", () => {
  it("is an installable standalone app that opens on /today", () => {
    const m = manifest();
    expect(m).toMatchObject({
      name: "데일리",
      short_name: "데일리",
      display: "standalone",
      start_url: "/today",
      background_color: THEME_COLORS.light.paper,
      theme_color: THEME_COLORS.light.paper,
    });
  });

  it("has 192 and 512 icons, plain and maskable, that exist in public/", () => {
    const icons = manifest().icons ?? [];
    for (const purpose of ["any", "maskable"]) {
      expect(icons.filter((i) => i.purpose === purpose).map((i) => i.sizes)).toEqual(["192x192", "512x512"]);
    }
    for (const icon of icons) expect(existsSync(`${PUBLIC}${icon.src}`)).toBe(true);
    expect(existsSync(`${PUBLIC}/icons/apple-touch-icon.png`)).toBe(true);
    expect(existsSync(`${PUBLIC}/sw.js`)).toBe(true);
  });
});

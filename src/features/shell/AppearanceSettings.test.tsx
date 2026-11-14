import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEMES, THEME_BOOT_SCRIPT, THEME_IDS, resolveScheme } from "@/ui/appearance";
import { AppearanceSettings } from "./AppearanceSettings";

const html = document.documentElement;
let osDark = false;

function runBootScript() {
  // The same string the root layout puts in <head>.
  new Function(THEME_BOOT_SCRIPT)();
}

beforeEach(() => {
  osDark = false;
  localStorage.clear();
  for (const name of ["data-theme", "data-mode", "data-scheme"]) html.removeAttribute(name);
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes("dark") ? osDark : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("appearance boot script", () => {
  it("defaults to 색연필 following the OS", () => {
    osDark = true;
    runBootScript();
    expect(html.getAttribute("data-theme")).toBe("crayon");
    expect(html.getAttribute("data-mode")).toBe("system");
    expect(html.getAttribute("data-scheme")).toBe("dark");
  });

  it("applies the saved theme and mode, ignoring unknown values", () => {
    localStorage.setItem("daily:theme", JSON.stringify("neon"));
    localStorage.setItem("daily:mode", JSON.stringify("dark"));
    runBootScript();
    expect(html.getAttribute("data-theme")).toBe("neon");
    expect(html.getAttribute("data-scheme")).toBe("dark");

    localStorage.setItem("daily:theme", JSON.stringify("navy"));
    localStorage.setItem("daily:mode", "not json");
    runBootScript();
    expect(html.getAttribute("data-theme")).toBe("crayon");
    expect(html.getAttribute("data-mode")).toBe("system");
    expect(html.getAttribute("data-scheme")).toBe("light");
  });

  it("resolves 시스템 against the OS and keeps explicit modes", () => {
    expect(resolveScheme("system", true)).toBe("dark");
    expect(resolveScheme("system", false)).toBe("light");
    expect(resolveScheme("light", true)).toBe("light");
    expect(resolveScheme("dark", false)).toBe("dark");
  });
});

describe("AppearanceSettings", () => {
  it("offers at least five themes and three modes", () => {
    runBootScript();
    render(<AppearanceSettings />);
    expect(THEME_IDS.length).toBeGreaterThanOrEqual(5);
    const themes = screen.getAllByRole("radio").filter((r) => THEME_IDS.includes((r as HTMLInputElement).value as never));
    expect(themes).toHaveLength(THEME_IDS.length);
    expect(screen.getByRole("radio", { name: "시스템" })).toHaveProperty("checked", true);
    expect(screen.getByRole("radio", { name: "라이트" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "다크" })).toBeTruthy();
  });

  it("switches theme and mode at once and remembers them on this device", async () => {
    runBootScript();
    render(<AppearanceSettings />);

    await userEvent.click(screen.getByRole("radio", { name: /트로피컬/ }));
    expect(html.getAttribute("data-theme")).toBe("tropical");
    expect(JSON.parse(localStorage.getItem("daily:theme") ?? "null")).toBe("tropical");
    expect(screen.getByRole("radio", { name: /트로피컬/ })).toHaveProperty("checked", true);

    await userEvent.click(screen.getByRole("radio", { name: "다크" }));
    expect(html.getAttribute("data-mode")).toBe("dark");
    expect(html.getAttribute("data-scheme")).toBe("dark");
    expect(JSON.parse(localStorage.getItem("daily:mode") ?? "null")).toBe("dark");
    // The theme stays when only the mode changes.
    expect(html.getAttribute("data-theme")).toBe("tropical");
  });

  it("groups the themes into 기본 and 개발자, every one with a light and a dark palette", () => {
    expect(THEMES.filter((t) => t.group === "basic")).toHaveLength(6);
    expect(THEMES.filter((t) => t.group === "dev").length).toBeGreaterThanOrEqual(18);
    expect(new Set(THEME_IDS).size).toBe(THEME_IDS.length);

    const css = readFileSync(resolve(__dirname, "../../ui/themes.css"), "utf8");
    for (const id of THEME_IDS) {
      expect(css, id).toMatch(new RegExp(`\\[data-theme="${id}"\\] \\{[^}]*--paper:`));
      expect(css, id).toMatch(new RegExp(`\\[data-theme="${id}"\\]\\[data-scheme="dark"\\] \\{[^}]*--paper:`));
    }

    runBootScript();
    render(<AppearanceSettings />);
    const dev = screen.getByRole("group", { name: "개발자" });
    expect(within(dev).getAllByRole("radio")).toHaveLength(THEMES.filter((t) => t.group === "dev").length);
    expect(within(screen.getByRole("group", { name: "기본" })).getAllByRole("radio")).toHaveLength(6);
  });

  it("picks a developer theme like any other", async () => {
    runBootScript();
    render(<AppearanceSettings />);
    await userEvent.click(screen.getByRole("radio", { name: /One Dark/ }));
    expect(html.getAttribute("data-theme")).toBe("onedark");
    expect(JSON.parse(localStorage.getItem("daily:theme") ?? "null")).toBe("onedark");
  });

  it("paints each theme card in its own theme and the current scheme", async () => {
    runBootScript();
    render(<AppearanceSettings />);
    await userEvent.click(screen.getByRole("radio", { name: "다크" }));
    const card = screen.getByRole("radio", { name: /캔디/ }).closest("label");
    expect(card?.getAttribute("data-theme")).toBe("candy");
    expect(card?.getAttribute("data-scheme")).toBe("dark");
  });
});

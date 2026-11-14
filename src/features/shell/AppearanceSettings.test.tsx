import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_BOOT_SCRIPT, THEME_IDS, resolveScheme } from "@/ui/appearance";
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

  it("paints each theme card in its own theme and the current scheme", async () => {
    runBootScript();
    render(<AppearanceSettings />);
    await userEvent.click(screen.getByRole("radio", { name: "다크" }));
    const card = screen.getByRole("radio", { name: /캔디/ }).closest("label");
    expect(card?.getAttribute("data-theme")).toBe("candy");
    expect(card?.getAttribute("data-scheme")).toBe("dark");
  });
});

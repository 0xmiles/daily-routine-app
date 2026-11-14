import { describe, expect, it } from "vitest";
import { HUES, accountHue, dayHue, hueFor, hueStyle } from "./hues";

describe("colour pencils", () => {
  it("gives every weekday its own pencil, Sunday pink and Saturday sky", () => {
    const week = [0, 1, 2, 3, 4, 5, 6].map(dayHue);
    expect(new Set(week).size).toBe(7);
    expect(week[0]).toBe("pink");
    expect(week[6]).toBe("sky");
  });

  it("starts accounts at the 자산 green and keeps the first seven apart", () => {
    expect(accountHue(0)).toBe("green");
    expect(new Set([0, 1, 2, 3, 4, 5, 6].map(accountHue)).size).toBe(7);
    expect(accountHue(7)).toBe(accountHue(0));
  });

  it("keeps a memo's pencil the same for the same key", () => {
    expect(hueFor("memo-1")).toBe(hueFor("memo-1"));
    expect(HUES).toContain(hueFor("memo-1"));
    expect(HUES).toContain(hueFor(""));
  });

  it("sets --hue to the pencil's token", () => {
    expect(hueStyle("aqua")).toEqual({ "--hue": "var(--aqua)" });
  });
});

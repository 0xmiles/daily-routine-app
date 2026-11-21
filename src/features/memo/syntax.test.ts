import { describe, expect, it } from "vitest";
import { headingLevel, headingPrefixLength, isRuleLine } from "./syntax";

describe("memo line syntax", () => {
  it("knows # ## ### headings at the start of a line only", () => {
    expect(headingLevel("# a")).toBe(1);
    expect(headingLevel("## a")).toBe(2);
    expect(headingLevel("### a")).toBe(3);
    expect(headingLevel("# ")).toBe(1);
    expect(headingLevel("#\ta")).toBe(1);
    expect(headingLevel("#### a")).toBe(0);
    expect(headingLevel("###a")).toBe(0);
    expect(headingLevel("  # a")).toBe(0);
    expect(headingLevel("- # a")).toBe(0);
    expect(headingPrefixLength("##   제목")).toBe(5);
    expect(headingPrefixLength("제목")).toBe(0);
  });

  it("knows a --- divider and keeps bullets and short dashes apart", () => {
    expect(isRuleLine("---")).toBe(true);
    expect(isRuleLine("-----  ")).toBe(true);
    expect(isRuleLine("--")).toBe(false);
    expect(isRuleLine("- --")).toBe(false);
    expect(isRuleLine("- ")).toBe(false);
    expect(isRuleLine("  ---")).toBe(false);
    expect(isRuleLine("--- a")).toBe(false);
  });
});

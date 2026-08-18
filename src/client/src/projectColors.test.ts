import { describe, expect, it } from "vitest";
import { PROJECT_COLORS, normalizeProjectColor, projectColorName, projectTintStyle } from "./projectColors";

describe("normalizeProjectColor", () => {
  it("lowercases six-digit hex so palette comparisons and server validation agree", () => {
    expect(normalizeProjectColor("#30A46C")).toBe("#30a46c");
  });

  it("expands three-digit shorthand", () => {
    expect(normalizeProjectColor("#0AF")).toBe("#00aaff");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeProjectColor("  #30a46c ")).toBe("#30a46c");
  });

  it("rejects anything that is not a hex colour", () => {
    for (const value of ["red", "#12345", "#1234567", "rgb(1,2,3)", ""]) expect(normalizeProjectColor(value)).toBeUndefined();
  });
});

describe("projectColorName", () => {
  it("names a palette colour regardless of case", () => {
    expect(projectColorName("#30A46C")).toBe("Green");
  });

  it("returns undefined for a custom colour or no colour", () => {
    expect(projectColorName("#123456")).toBeUndefined();
    expect(projectColorName(undefined)).toBeUndefined();
  });
});

describe("projectTintStyle", () => {
  it("emits the colour plus a translucent tint per row state", () => {
    expect(projectTintStyle("#30a46c")).toBe(
      "--pi-project-color: #30a46c; --pi-project-tint: rgba(48, 164, 108, 0.22); --pi-project-tint-hover: rgba(48, 164, 108, 0.34); --pi-project-tint-selected: rgba(48, 164, 108, 0.45);",
    );
  });

  it("parses the channels of a colour with a zero component", () => {
    expect(projectTintStyle("#000000")).toContain("rgba(0, 0, 0, 0.22)");
    expect(projectTintStyle("#ffffff")).toContain("rgba(255, 255, 255, 0.22)");
  });

  it("yields no style rather than a broken one for absent or invalid colours", () => {
    expect(projectTintStyle(undefined)).toBe("");
    expect(projectTintStyle("red")).toBe("");
  });

  it("produces a usable tint for every palette entry", () => {
    for (const option of PROJECT_COLORS) {
      expect(projectTintStyle(option.value)).toMatch(/^--pi-project-color: #[0-9a-f]{6}; --pi-project-tint: rgba\(\d{1,3}, \d{1,3}, \d{1,3}, 0\.22\);/);
    }
  });
});

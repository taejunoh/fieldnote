import { describe, expect, it } from "vitest";
import { isSportSlug, sportSlugs } from "./sports";
import { SPORT_SLUGS, validImportInput } from "./import/validation";

describe("supported sports", () => {
  it("registers NBA independently from WNBA", () => {
    expect(sportSlugs).toContain("nba");
    expect(sportSlugs).toContain("wnba");
    expect(SPORT_SLUGS).toEqual(sportSlugs);
    expect(isSportSlug("nba")).toBe(true);
    expect(isSportSlug("wnba")).toBe(true);
    expect(validImportInput({ sportSlug: "nba", filename: "nba.md", content: "review" })).toBe(true);
    expect(validImportInput({ sportSlug: "wnba", filename: "wnba.md", content: "review" })).toBe(true);
  });

  it("rejects unknown sport slugs", () => {
    expect(isSportSlug("basketball")).toBe(false);
  });
});

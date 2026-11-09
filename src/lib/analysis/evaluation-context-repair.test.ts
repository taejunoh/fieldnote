import { describe, expect, it } from "vitest";
import { instructionsForContext } from "./context";

describe("analysis evaluation repair prompt", () => {
  it("requires exactly one evaluation report with an explicit empty-scope case", () => {
    const instructions = instructionsForContext(true, false);
    expect(instructions).toContain("analysis-evaluation 보고서를 정확히 하나 작성한다");
    expect(instructions).toContain("markets:[]");
    expect(instructions).toContain("scope_note");
    expect(instructions).toContain('"-3.5"');
    expect(instructions).toContain('"235.5"');
  });
});

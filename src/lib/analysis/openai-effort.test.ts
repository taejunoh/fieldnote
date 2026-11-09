import { afterEach, describe, expect, it, vi } from "vitest";
import { analysisSettings } from "./openai";

afterEach(() => vi.unstubAllEnvs());

describe("Astra effort defaults", () => {
  it("defaults analysis, recheck, review, and conversation jobs to high while status stays medium", () => {
    for (const name of ["OPENLLMS_MODEL", "OPENLLMS_EFFORT_ANALYSIS", "OPENLLMS_EFFORT_RECHECK", "OPENLLMS_EFFORT_STATUS"])
      vi.stubEnv(name, "");
    for (const kind of ["analyze_today", "recheck_lineup", "review_results", "message"] as const)
      expect(analysisSettings(kind)).toEqual({ model: "gpt-6-astra", effort: "high" });
    expect(analysisSettings("check_status")).toEqual({ model: "gpt-6-astra", effort: "medium" });
  });

  it("preserves explicit xhigh analysis and recheck overrides", () => {
    vi.stubEnv("OPENLLMS_EFFORT_ANALYSIS", "xhigh");
    vi.stubEnv("OPENLLMS_EFFORT_RECHECK", "xhigh");
    expect(analysisSettings("analyze_today").effort).toBe("xhigh");
    expect(analysisSettings("review_results").effort).toBe("xhigh");
    expect(analysisSettings("message").effort).toBe("xhigh");
    expect(analysisSettings("recheck_lineup").effort).toBe("xhigh");
  });

  it.each(["low", "medium", "ultra"]) ("rejects unsupported analysis effort %s", effort => {
    vi.stubEnv("OPENLLMS_EFFORT_ANALYSIS", effort);
    expect(() => analysisSettings("analyze_today")).toThrow("Unsupported OPENLLMS effort");
  });

  it("rejects non-medium status settings and keeps the Astra model fixed", () => {
    vi.stubEnv("OPENLLMS_EFFORT_STATUS", "high");
    expect(() => analysisSettings("check_status")).toThrow("Unsupported OPENLLMS effort");
    vi.stubEnv("OPENLLMS_EFFORT_STATUS", "medium");
    vi.stubEnv("OPENLLMS_MODEL", "gpt-6-luna");
    expect(() => analysisSettings("analyze_today")).toThrow("Unsupported OPENLLMS model");
  });
});

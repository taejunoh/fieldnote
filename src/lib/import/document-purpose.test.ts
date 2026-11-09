import { describe, expect, it } from "vitest";
import { extractDocumentPurpose } from "./document-purpose";
describe("historical document purpose reference", () => {
  it("extracts numbered heading with nested workflow and exact line provenance", () => {
    expect(extractDocumentPurpose("# Title\n## 1. Purpose\nDaily workflow\n### Details\nCheck all games\n## Picks\nSecret old pick")).toEqual({ purpose: "Daily workflow\n### Details\nCheck all games", sourceRef: "L2-L5" });
  });
  it("accepts heading levels and purpose in Korean", () => {
    expect(extractDocumentPurpose("# Purpose\npurpose\n# Other\nold")).toEqual({ purpose: "purpose", sourceRef: "L1-L2" });
    expect(extractDocumentPurpose("###### 2) 목적\nworkflow")).toEqual({ purpose: "workflow", sourceRef: "L1-L2" });
  });
  it("does not infer purpose from ordinary prose and bounds historical fragment", () => {
    expect(extractDocumentPurpose("No purpose section\nActual facts")).toBeNull();
    expect(extractDocumentPurpose(`## Purpose\n${"x".repeat(12000)}`)?.purpose.length).toBeLessThanOrEqual(6000);
  });
});

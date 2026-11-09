import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifiedEvaluationPresentation } from "./evaluation-recovery-server";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
describe("reviewed presentation proofs", () => {
  it("verifies original UTF-8 bytes and refuses tampered or split spans", () => {
    const raw = "한글\n| 시장 | 판단 |\n| --- | --- |\n| Total | GO |";
    const start = Buffer.byteLength("한글\n");
    const excerpt = raw.slice(3);
    const metadata = { original_model_response: raw, evaluation_presentation: { version: 1, context: "historical", reason: "No current recommendation", raw_sha256: hash(raw), reviewedTables: [{ start, end: Buffer.byteLength(raw), excerpt_sha256: hash(excerpt) }] } };
    expect(verifiedEvaluationPresentation(metadata)?.excerpts).toEqual([excerpt]);
    expect(verifiedEvaluationPresentation({ ...metadata, original_model_response: raw + "!" })).toBeNull();
    expect(verifiedEvaluationPresentation({ ...metadata, evaluation_presentation: { ...metadata.evaluation_presentation, reviewedTables: [{ start: 1, end: 3, excerpt_sha256: hash("한") }] } })).toBeNull();
  });
  it("rejects unknown keys and unbounded reasons", () => {
    expect(verifiedEvaluationPresentation({ original_model_response: "raw", evaluation_presentation: { version: 1, context: "historical", reason: "x".repeat(501), raw_sha256: hash("raw"), reviewedTables: [] } })).toBeNull();
  });
});

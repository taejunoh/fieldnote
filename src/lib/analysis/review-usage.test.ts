import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildReviewUsageAudit } from "./review-usage";

describe("buildReviewUsageAudit", () => {
  it("records exact text sizes and hashes with provider-reported successful usage", () => {
    const context = "A🎾";
    const instructions = "review";
    expect(buildReviewUsageAudit({
      context,
      instructions,
      result: {
        text: "ok",
        sources: [],
        searched: true,
        verified: true,
        upstreamResponseId: "response",
        usage: { inputTokens: 17, outputTokens: 4 },
        usageAvailable: true,
      },
    })).toEqual({
      request: {
        context: { characters: 2, utf8_bytes: 5, sha256: createHash("sha256").update(context).digest("hex") },
        instructions: { characters: 6, utf8_bytes: 6, sha256: createHash("sha256").update(instructions).digest("hex") },
      },
      provider: { input_tokens: 17, output_tokens: 4 },
      failed_unknown_attempts: null,
      recovered: null,
    });
  });

  it("keeps missing provider usage unknown and counts failed attempts without estimating tokens", () => {
    expect(buildReviewUsageAudit({
      context: "ctx",
      instructions: "inst",
      attempts: [{ status: "interrupted" }, { status: "completed" }, { status: "failed" }],
      recovered: true,
    })).toMatchObject({
      provider: null,
      failed_unknown_attempts: 2,
      recovered: true,
    });
  });

  it("does not treat default zero counters as reported provider usage", () => {
    expect(buildReviewUsageAudit({
      context: "ctx",
      instructions: "inst",
      result: {
        text: "ok",
        sources: [],
        searched: true,
        verified: true,
        upstreamResponseId: null,
        usage: { inputTokens: 0, outputTokens: 0 },
      },
    }).provider).toEqual({ input_tokens: null, output_tokens: null });
  });

  it("preserves zero token counts when the provider explicitly reported them", () => {
    expect(buildReviewUsageAudit({
      context: "ctx",
      instructions: "inst",
      result: {
        text: "ok",
        sources: [],
        searched: true,
        verified: true,
        upstreamResponseId: null,
        usage: { inputTokens: 0, outputTokens: 0 },
        usageAvailable: true,
      },
    }).provider).toEqual({ input_tokens: 0, output_tokens: 0 });
  });
});

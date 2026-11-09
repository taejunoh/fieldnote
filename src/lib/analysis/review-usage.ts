import { createHash } from "node:crypto";
import type { GatewayResult } from "./gateway";

export type ReviewUsageAttempt = { status: string };

type ReviewResult = GatewayResult & { usageAvailable?: boolean };

function textAudit(value: string) {
  return {
    characters: Array.from(value).length,
    utf8_bytes: Buffer.byteLength(value, "utf8"),
    sha256: createHash("sha256").update(value, "utf8").digest("hex"),
  };
}

export function buildReviewUsageAudit(args: {
  context: string;
  instructions: string;
  result?: ReviewResult;
  attempts?: readonly ReviewUsageAttempt[];
  recovered?: boolean;
}) {
  return {
    request: {
      context: textAudit(args.context),
      instructions: textAudit(args.instructions),
    },
    provider: args.result
      ? {
          input_tokens: args.result.usageAvailable
            ? args.result.usage.inputTokens
            : null,
          output_tokens: args.result.usageAvailable
            ? args.result.usage.outputTokens
            : null,
        }
      : null,
    failed_unknown_attempts: args.attempts
      ? args.attempts.filter((attempt) => attempt.status !== "completed").length
      : null,
    recovered: args.recovered ?? null,
  };
}

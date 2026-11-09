import { createHash } from "node:crypto";
import type { EvaluationPresentation, VerifiedEvaluationPresentation } from "./evaluation-recovery";
import { validReviewedSpan } from "./evaluation-recovery";
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const sha = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
/** Private raw never leaves this server-side verification boundary. Fail closed on any proof. */
export function verifiedEvaluationPresentation(metadata: unknown): VerifiedEvaluationPresentation | null {
  if (!object(metadata) || typeof metadata.original_model_response !== "string" || !object(metadata.evaluation_presentation)) return null;
  const p = metadata.evaluation_presentation;
  if (Object.keys(p).some(key => !["version", "context", "reason", "raw_sha256", "reviewedTables"].includes(key)) || p.version !== 1 || !["current", "historical", "unavailable"].includes(String(p.context)) || typeof p.reason !== "string" || !p.reason.trim() || p.reason.length > 500 || !sha(p.raw_sha256) || !Array.isArray(p.reviewedTables) || p.reviewedTables.length > 20) return null;
  const raw = new TextEncoder().encode(metadata.original_model_response);
  if (hash(raw) !== p.raw_sha256) return null;
  const excerpts: string[] = [];
  let previousEnd = 0;
  for (const span of p.reviewedTables) {
    if (!object(span) || Object.keys(span).some(key => !["start", "end", "excerpt_sha256"].includes(key)) || typeof span.start !== "number" || typeof span.end !== "number" || !validReviewedSpan(span.start, span.end, raw.length) || span.start < previousEnd || !sha(span.excerpt_sha256)) return null;
    const bytes = raw.slice(span.start, span.end);
    if (hash(bytes) !== span.excerpt_sha256) return null;
    try { excerpts.push(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { return null; }
    previousEnd = span.end;
  }
  if (excerpts.join("\n\n").length > 24_000) return null;
  return { context: p.context as EvaluationPresentation["context"], reason: p.reason, excerpts };
}
export function evaluationPresentationDisplayFromMetadata(metadata: unknown) {
  const verified = verifiedEvaluationPresentation(metadata);
  return verified ? { context: verified.context, reason: verified.reason } : null;
}

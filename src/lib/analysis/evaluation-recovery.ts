/** Browser-safe persisted provenance. Byte ranges refer to original_model_response UTF-8. */
export type EvaluationPresentation = {
  version: 1;
  context: "current" | "historical" | "unavailable";
  reason: string;
  raw_sha256: string;
  reviewedTables: { start: number; end: number; excerpt_sha256: string }[];
};
export type EvaluationPresentationDisplay = Pick<EvaluationPresentation, "context" | "reason">;
/** Construct only after server-side hash verification; never accept this from a request. */
export type VerifiedEvaluationPresentation = EvaluationPresentationDisplay & { excerpts: string[] };

export function validReviewedSpan(start: number, end: number, byteLength: number): boolean {
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end > start && end <= byteLength && end - start <= 24_000;
}

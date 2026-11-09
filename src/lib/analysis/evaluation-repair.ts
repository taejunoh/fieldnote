/** Offline derivation only: immutable saved evidence in, metadata-only RPC request out. */
import { createHash } from "node:crypto";
import { sourcedEventKey } from "./record";
import { extractEvaluationReport } from "./evaluation";
import type { CoverageReport } from "./coverage";
import { validReviewedSpan, type EvaluationPresentation } from "./evaluation-recovery";
export const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export function canonicalJson(value: unknown): string {
 if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
 if (value && typeof value === "object") return `{${Object.entries(value).sort(([a],[b]) => a<b?-1:a>b?1:0).map(([key,item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
 return JSON.stringify(value);
}
export type SavedEvaluationInput = {
 jobId: string; attemptId: string; originalAttemptId: string; messageId: string; ownerId: string; repairKey: string;
 sport: string; dateEt: string; raw: string; sources: {url:string;[key:string]:unknown}[]; rawSha256: string; sourcesSha256: string;
 content: string; expectedMetadata: Record<string,unknown>; reviewedTables?: EvaluationPresentation["reviewedTables"];
};
export function deriveSavedEvaluationRepair(input: SavedEvaluationInput) {
 const { raw, expectedMetadata: metadata } = input;
 if (!/^[a-f0-9]{64}$/.test(input.sourcesSha256) || sha256(raw)!==input.rawSha256 || metadata.original_model_response!==raw || canonicalJson(metadata.sources)!==canonicalJson(input.sources)) throw new Error("Immutable evidence mismatch");
 if (!input.repairKey || input.repairKey.length>160) throw new Error("Invalid repair key");
 const bytes = Buffer.from(raw), reviewedTables = input.reviewedTables ?? [];
 if (reviewedTables.length>12) throw new Error("Too many reviewed tables");
 let previousEnd=0, totalBytes=0;
 for (const span of reviewedTables) {
  totalBytes+=span.end-span.start;
  if(span.start<previousEnd || totalBytes>24_000) throw new Error("Overlapping or excessive reviewed excerpts");
  previousEnd=span.end;
  if (!validReviewedSpan(span.start,span.end,bytes.length) || sha256(bytes.subarray(span.start,span.end))!==span.excerpt_sha256) throw new Error("Invalid reviewed excerpt");
  const excerpt=bytes.subarray(span.start,span.end);
  if (!Buffer.from(new TextDecoder("utf-8",{fatal:true}).decode(excerpt)).equals(excerpt)) throw new Error("Invalid UTF-8 excerpt boundary");
 }
 const coverage=(metadata.coverage_report??null) as CoverageReport|null;
 const record=metadata.analysis_record as Parameters<typeof extractEvaluationReport>[1]["record"];
 const canonicalEventKeys=Object.fromEntries((coverage?.inventory??[]).flatMap(event=>{
  const matching=record?.events.filter(native=>native.event_key===event.event_key||(event.event_key.endsWith(":src")&&native.event_key===sourcedEventKey(event.event_key,native.source_url)));
  return matching?.length===1?[[event.event_key,matching[0].event_key]]:[];
 }));
 const display=extractEvaluationReport(raw,{sport:input.sport,dateEt:input.dateEt,sources:input.sources,canonicalEventKeys,coverageReport:coverage,record});
 if (display.report && reviewedTables.length) throw new Error("Historical excerpts cannot relabel accepted current report");
 const presentation:EvaluationPresentation={version:1,context:display.report ? "current" : reviewedTables.length ? "historical" : "unavailable",reason:display.report ? display.validation.status : reviewedTables.length ? "saved_historical_analysis_no_current_recommendation" : display.validation.reasons[0]??"evaluation_unavailable",raw_sha256:input.rawSha256,reviewedTables};
 const patch={evaluation_quarantined_markets:display.quarantinedMarkets,evaluation_report:display.report,evaluation_validation:display.validation,evaluation_presentation:presentation};
 const request={p_job_id:input.jobId,p_attempt_id:input.attemptId,p_original_attempt_id:input.originalAttemptId,p_message_id:input.messageId,p_owner_id:input.ownerId,p_repair_key:input.repairKey,p_expected_raw_sha256:input.rawSha256,p_expected_source_map_sha256:input.sourcesSha256,p_expected_content_sha256:sha256(input.content),p_expected_metadata:metadata,p_patch:patch};
 return {patch,request:{...request,p_fingerprint:sha256(canonicalJson(request))}};
}

export type SavedEvaluationRepairRequest=ReturnType<typeof deriveSavedEvaluationRepair>["request"];
/** Apply preflight: deterministic derivation from a fresh saved read, including repeat handling. */
export function verifyReviewedSavedEvaluationRepair(fresh:SavedEvaluationInput, reviewed:SavedEvaluationRepairRequest):SavedEvaluationRepairRequest {
 const current=deriveSavedEvaluationRepair(fresh);
 if(canonicalJson(current.patch)!==canonicalJson(reviewed.p_patch))throw new Error("Reviewed patch differs from fresh saved derivation");
 const before=canonicalJson(reviewed.p_expected_metadata), applied=canonicalJson({...reviewed.p_expected_metadata,...current.patch});
 if(![before,applied].includes(canonicalJson(fresh.expectedMetadata)))throw new Error("Reviewed metadata differs from saved state");
 // The expected OLD metadata is retained for exact audit idempotency after a successful repair.
 // Its immutable context is proven equal to fresh state above; patch is freshly derived.
 const {p_fingerprint: _fingerprint,...request}=current.request;
 void _fingerprint;
 const exactRequest={...request,p_expected_metadata:reviewed.p_expected_metadata};
 const recomputed={...exactRequest,p_fingerprint:sha256(canonicalJson(exactRequest))};
 if(canonicalJson(recomputed)!==canonicalJson(reviewed))throw new Error("Reviewed request or fingerprint mismatch");
 return recomputed;
}

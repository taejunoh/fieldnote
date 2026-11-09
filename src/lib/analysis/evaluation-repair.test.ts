import { describe, expect, it } from "vitest";
import { deriveSavedEvaluationRepair, verifyReviewedSavedEvaluationRepair, canonicalJson, sha256 } from "./evaluation-repair";
const raw = "saved 역사\n| market | decision |\n|---|---|\n| A | PASS |";
function fixture() {
 const metadata = { original_model_response: raw, sources: [], checked_at: "2026-10-29T00:00:00Z", analysis_record: null };
 return { jobId: "job", attemptId: "attempt", originalAttemptId: "attempt", messageId: "message", ownerId: "owner", repairKey: "saved-v1:job", sport: "cfb", dateEt: "2026-10-29", raw, sources: [], rawSha256: sha256(raw), sourcesSha256: "a".repeat(64), content: "original display", expectedMetadata: metadata };
}
describe("saved evaluation derivation", () => {
 it("preserves missing evaluation as historical quoted bytes without fabricated markets", () => {
  const input = fixture(), start = Buffer.byteLength(raw.slice(0, raw.indexOf("|")));
  const result = deriveSavedEvaluationRepair({ ...input, reviewedTables: [{ start, end: Buffer.byteLength(raw), excerpt_sha256: sha256(Buffer.from(raw).subarray(start)) }] });
  expect(result.patch.evaluation_report).toBeNull();
  expect(result.patch.evaluation_presentation.context).toBe("historical");
  expect(Object.keys(result.patch).sort()).toEqual(["evaluation_presentation", "evaluation_quarantined_markets", "evaluation_report", "evaluation_validation"]);
  expect(input.expectedMetadata.checked_at).toBe("2026-10-29T00:00:00Z");
  expect(result).toEqual(deriveSavedEvaluationRepair({ ...input, reviewedTables: result.patch.evaluation_presentation.reviewedTables }));
 });
 it("rejects changed immutable raw, source membership and invalid quoted byte bounds", () => {
  expect(() => deriveSavedEvaluationRepair({ ...fixture(), rawSha256: "b".repeat(64) })).toThrow();
  expect(() => deriveSavedEvaluationRepair({ ...fixture(), expectedMetadata: { ...fixture().expectedMetadata, sources: [{url:"https://example.invalid"}] } })).toThrow();
  expect(() => deriveSavedEvaluationRepair({ ...fixture(), reviewedTables: [{start:0,end:9999,excerpt_sha256:sha256(raw)}] })).toThrow();
  expect(() => deriveSavedEvaluationRepair({ ...fixture(), reviewedTables: [{start:0,end:4,excerpt_sha256:sha256(raw)}] })).toThrow();
 });
 it("keeps absent unreviewed results unavailable", () => {
  expect(deriveSavedEvaluationRepair(fixture()).patch.evaluation_presentation.context).toBe("unavailable");
 });
});

describe("reviewed saved manifest verification", () => {
 it("rejects a modified manifest even if its fingerprint was recomputed", () => {
  const input=fixture(), reviewed=deriveSavedEvaluationRepair(input).request;
  const forged=structuredClone(reviewed);
  forged.p_patch.evaluation_presentation.reason="operator changed reason";
  const fingerprintInput={...forged};delete (fingerprintInput as Partial<typeof forged>).p_fingerprint;
  forged.p_fingerprint=sha256(canonicalJson(fingerprintInput));
  // The verifier must derive from saved evidence rather than trust any supplied digest.
  expect(()=>verifyReviewedSavedEvaluationRepair(input,forged)).toThrow();
 });
 it("accepts only exact deterministic requests and an unchanged already-applied state", () => {
  const input=fixture(), reviewed=deriveSavedEvaluationRepair(input).request;
  expect(verifyReviewedSavedEvaluationRepair(input,reviewed)).toEqual(reviewed);
  expect(verifyReviewedSavedEvaluationRepair({...input,expectedMetadata:{...input.expectedMetadata,...reviewed.p_patch}},reviewed)).toEqual(reviewed);
  expect(()=>verifyReviewedSavedEvaluationRepair({...input,expectedMetadata:{...input.expectedMetadata,newer:true}},reviewed)).toThrow();
 });
});

function currentFixture() {
 const url="https://example.invalid/retained",key="nba:2026-10-29:away@home:src";
 const market={event_key:key,label:"Away at Home",market:"spread",selection:"Home",line:-3.5,original_decision:"PASS",state:"valuation_complete",observed_price:{value:"-110",source_url:url,checked_at:"2026-10-29T00:00:00Z"},price_condition:"-105 or better",suggested_units:null,thesis:"Saved thesis",countercase:"Saved countercase",critical_checks:["participants","matchup","workload","dependencies"].map(category=>({category,status:"confirmed",evidence:"Saved retained evidence",source_urls:[url],checked_at:"2026-10-29T00:00:00Z"})),uncertainty:{impact:"Saved impact",scenario:"Saved scenario",reopen_trigger:"Saved trigger"}};
 const report={version:1,sport:"nba",date_et:"2026-10-29",scope:"selected_markets",scope_note:"Saved selected market",truncated:false,markets:[market]};
 const raw=`Saved prose\n\`\`\`analysis-evaluation\n${JSON.stringify(report)}\n\`\`\``;
 return {...fixture(),sport:"nba",raw,rawSha256:sha256(raw),sources:[{url}],expectedMetadata:{original_model_response:raw,sources:[{url}],checked_at:"2026-10-29T00:00:00Z",coverage_report:{inventory:[{event_key:key,label:market.label}]},analysis_record:null}};
}
describe("fresh financial-value manifest guards",()=>{
 it.each(["original_decision","observed_price","suggested_units"])("rejects changed %s despite a recomputed manifest fingerprint",field=>{
  const input=currentFixture(),reviewed=deriveSavedEvaluationRepair(input).request;
  expect(reviewed.p_patch.evaluation_validation.status).toBe("valid");
  expect(reviewed.p_patch.evaluation_report?.markets[0].line).toBe("-3.5");
  const forged=structuredClone(reviewed), row=forged.p_patch.evaluation_report!.markets[0];
  if(field==="original_decision")row.original_decision="BET";
  if(field==="observed_price")row.observed_price!.value="+999";
  if(field==="suggested_units")row.suggested_units=100;
  const {p_fingerprint,...request}=forged;void p_fingerprint;
  forged.p_fingerprint=sha256(canonicalJson(request));
  expect(()=>verifyReviewedSavedEvaluationRepair(input,forged)).toThrow("Reviewed patch differs");
 });
});

import { evaluationDisplayFromMetadata } from "./evaluation";
import { projectReviewedExactBets, exactBetIdentity, type ReviewedExactOverlay } from "./reviewed-exact-bets";
import { projectConditionalBets, verifyConditionalCandidates, stripAnalysisCandidateBlocks, type CandidateOverlay } from "./display-candidates";
import { canonicalRecordSchema, sourcedEventKey, stableEventKey, type AnalysisRecord } from "./record";
import { extractResponsePurpose } from "./response-purpose";
import type { BettingOverviewProjection } from "../latest-analysis-table";

type Row = Record<string, unknown>;
export type ActionableBetInput = {
  sport: string;
  ownerId?: string;
  candidateOverlays?: CandidateOverlay[];
  reviewedExactOverlays?: ReviewedExactOverlay[];
  sourceAttested?: boolean;
  jobId: string;
  kind: string;
  now: Date;
  message: { id?: unknown; created_at?: unknown; metadata?: unknown } | null;
};
const object = (value: unknown): value is Row => !!value && typeof value === "object" && !Array.isArray(value);
const time = (value: unknown) => typeof value === "string" && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
const result = (actionState: BettingOverviewProjection["actionState"], actionReason?: string): BettingOverviewProjection => ({
  actionableBets: [], conditionalBets: [], actionState, ...(actionReason ? { actionReason } : {}), needsReview: { count: 0, reasons: [] },
});

/** A quarantine removes automatic eligibility only for its original market identity.
 * Resolve original :src keys with original inventory/event URLs; labels never identify a market.
 * This does not authorize or modify independently confirmed actual bet records.
 */
function marketEligibilityGuard(metadata: Row, sport: string) {
  const quarantined = evaluationDisplayFromMetadata(metadata)?.quarantinedMarkets ?? [];
  const aliases = new Map<string, Set<string>>();
  const raw = typeof metadata.original_model_response === "string" ? metadata.original_model_response : "";
  for (const block of raw.matchAll(/^```analysis-(coverage|record)[^\S\r\n]*\r?\n([\s\S]*?)^```[^\S\r\n]*(?:\r?\n|$)/gm)) {
    try {
      const value: unknown = JSON.parse(block[2]);
      if (!object(value)) continue;
      const events = block[1] === "coverage" ? value.inventory : value.events;
      if (!Array.isArray(events)) continue;
      for (const event of events.slice(0, 2000)) {
        if (!object(event) || typeof event.event_key !== "string" || typeof event.source_url !== "string" || !stableEventKey(event.event_key, sport)) continue;
        try {
          const source = new URL(event.source_url).href;
          const key = event.event_key.endsWith(":src") ? sourcedEventKey(event.event_key, source) : event.event_key;
          const keys = aliases.get(event.event_key) ?? new Set<string>();
          keys.add(key); aliases.set(event.event_key, keys);
        } catch { /* An invalid URL cannot establish an original-to-canonical identity. */ }
      }
    } catch { /* Other admission paths already handle malformed machine blocks. */ }
  }
  const text = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
  const market = (value: string) => text(value) === "ml" ? "moneyline" : text(value);
  return (row: { eventKey: string; market: string; selection: string; line?: string | null }) => !quarantined.some(rejected => {
    if (!rejected.eventKey || (rejected.eventKey !== row.eventKey && !aliases.get(rejected.eventKey)?.has(row.eventKey))) return false;
    if (market(rejected.market) !== market(row.market) || text(rejected.selection) !== text(row.selection)) return false;
    // Existing recommendation/candidate DTOs omit line. Missing line cannot certify an
    // otherwise exact quarantined identity; explicit distinct lines remain independent.
    return row.line === undefined || (rejected.line == null ? row.line == null : row.line != null && text(rejected.line) === text(row.line));
  });
}

/** Display projection only: canonical judgment precedes storage-source admission and actual execution. */
function projectCanonicalBets(input: ActionableBetInput): BettingOverviewProjection {
  const metadata = object(input.message?.metadata) ? input.message.metadata : {};
  const purpose = object(metadata.response_purpose) ? metadata.response_purpose : {};
  if (metadata.response_purpose_status === "invalid") return result("unavailable", "saved_response_purpose_invalid");
  if (input.kind === "review_results" || metadata.hypothetical === true ||
      ["hypothetical", "retrospective_hypothetical"].includes(String(metadata.analysis_purpose || metadata.purpose)) ||
      purpose.intent === "hypothetical") {
    return result("not_applicable", "not_current_recommendation_analysis");
  }
  if (typeof metadata.original_model_response !== "string") return result("unavailable", "original_record_missing");
  let raw = metadata.original_model_response;
  const hasPurpose = /^```response-purpose\s*$/m.test(raw);
  if (input.kind === "message" && (metadata.response_purpose_status !== "valid" || !object(metadata.response_purpose) || !hasPurpose)) return result("unavailable", "saved_response_purpose_unavailable");
  if (hasPurpose) {
    const ids = Array.isArray(purpose.referenced_message_ids) ? purpose.referenced_message_ids.filter((id): id is string => typeof id === "string") : [];
    const extracted = extractResponsePurpose(raw, new Set(ids));
    if (!extracted.purpose) return result("unavailable", "original_purpose_invalid");
    if (input.kind === "message" && (["version", "intent", "basis", "requires_fresh_data"].some(key => purpose[key] !== extracted.purpose![key as keyof typeof extracted.purpose]) || JSON.stringify(purpose.referenced_message_ids) !== JSON.stringify(extracted.purpose.referenced_message_ids))) return result("unavailable", "saved_and_original_purpose_mismatch");
    if (["conversation", "clarification"].includes(extracted.purpose.intent)) return result("not_applicable", "not_current_recommendation_analysis");
    raw = extracted.answer;
  }
  if (["conversation", "clarification"].includes(String(purpose.intent))) return result("not_applicable", "not_current_recommendation_analysis");
  // Same closed-block removal used by extractCoverageReport, before the strict record-tail parser.
  raw = stripAnalysisCandidateBlocks(raw).replace(/^```analysis-coverage[^\S\r\n]*\r?\n[\s\S]*?^```[^\S\r\n]*(?:\r?\n|$)/gm, "").trim();
  if ((raw.match(/^```analysis-record\s*$/gm) || []).length !== 1) return result("unavailable", "original_record_missing_or_ambiguous");
  const opening = raw.lastIndexOf("```analysis-record");
  const block = /^```analysis-record\s*\n([\s\S]*?)\n```\s*$/.exec(raw.slice(opening));
  if (!block || !raw.slice(0, opening).trim()) return result("unavailable", "original_record_malformed");
  let value: unknown;
  try { value = JSON.parse(block[1]); } catch { return result("unavailable", "original_record_invalid_json"); }
  if (!object(value) || !Array.isArray(value.events) || !Array.isArray(value.recommendations) || value.events.length > 20 || value.recommendations.length > 20) return result("unavailable", "original_record_invalid_schema");
  const policy = !!metadata.common_policy;
  const schema = canonicalRecordSchema(policy);
  const envelope = schema.safeParse({ ...value, events: [], recommendations: [] });
  if (!envelope.success || envelope.data.sport !== input.sport) return result("unavailable", "original_record_wrong_sport_or_schema");
  const eventSchema = schema.shape.events.element;
  const recommendationSchema = schema.shape.recommendations.element;
  const events = new Map<string, { event: AnalysisRecord["events"][number]; reasons: string[] }>();
  const normalizedKeys = new Map<string, string>();
  for (const row of value.events) {
    if (!object(row)) return result("unavailable", "original_event_invalid");
    let parsed = eventSchema.safeParse(row);
    const reasons: string[] = [];
    if (!parsed.success) {
      if (!parsed.error.issues.every(issue => ["label", "starts_at"].includes(String(issue.path[0])))) return result("unavailable", "original_event_invalid");
      if (parsed.error.issues.some(issue => issue.path[0] === "label")) reasons.push("match_missing");
      if (parsed.error.issues.some(issue => issue.path[0] === "starts_at")) reasons.push("start_time_missing_or_invalid");
      // Placeholders validate the remaining original fields only; these rows never become actionable.
      parsed = eventSchema.safeParse({ ...row, label: reasons.includes("match_missing") ? "Unconfirmed matchup" : row.label, starts_at: reasons.includes("start_time_missing_or_invalid") ? null : row.starts_at });
      if (!parsed.success) return result("unavailable", "original_event_invalid");
    }
    const event = parsed.data;
    if (!stableEventKey(event.event_key, input.sport)) return result("unavailable", "original_event_identity_invalid");
    const originalKey = event.event_key;
    const url = new URL(event.source_url).href;
    if (originalKey.endsWith(":src") || /:src-[a-f0-9]{32}$/.test(originalKey)) {
      const canonical = sourcedEventKey(originalKey, url);
      if (!originalKey.endsWith(":src") && originalKey !== canonical) return result("unavailable", "original_source_key_mismatch");
      event.event_key = canonical;
    }
    if (events.has(event.event_key)) return result("unavailable", "original_event_identity_duplicate");
    normalizedKeys.set(originalKey, event.event_key);
    events.set(event.event_key, { event, reasons });
  }
  const projection = result("ready");
  const itemKeys = new Set<string>();
  let betCount = 0;
  const checked = time(metadata.checked_at);
  const created = time(input.message?.created_at);
  const reportedDelivery = object(metadata.delivery) ? time(metadata.delivery.delivered_at) : created;
  // SQL publication timestamps have microseconds; Date.parse compares their shared millisecond resolution.
  const delivery = Math.max(created, reportedDelivery);
  const now = input.now.valueOf();
  const knownTimes = Number.isFinite(now) && Number.isFinite(checked) && Number.isFinite(created) && Number.isFinite(reportedDelivery) && Number.isFinite(delivery) && checked <= delivery && delivery <= now;
  const review = (reasons: string[]) => {
    projection.needsReview.count++;
    for (const reason of reasons) if (!projection.needsReview.reasons.includes(reason)) projection.needsReview.reasons.push(reason);
  };
  for (const row of value.recommendations) {
    if (!object(row)) return result("unavailable", "original_recommendation_invalid");
    let parsed = recommendationSchema.safeParse(row);
    const reasons: string[] = [];
    if (!parsed.success) {
      const recoverable = new Set(["market", "selection", "suggested_units", "price_gate"]);
      if (!parsed.error.issues.every(issue => recoverable.has(String(issue.path[0])))) return result("unavailable", "original_recommendation_invalid");
      const failed = new Set(parsed.error.issues.map(issue => String(issue.path[0])));
      reasons.push(...[...failed].map(field => `${field}_missing_or_invalid`));
      parsed = recommendationSchema.safeParse({ ...row, market: failed.has("market") ? "Unconfirmed market" : row.market, selection: failed.has("selection") ? "Unconfirmed selection" : row.selection, suggested_units: failed.has("suggested_units") ? null : row.suggested_units, price_gate: failed.has("price_gate") ? null : row.price_gate });
      if (!parsed.success) return result("unavailable", "original_recommendation_invalid");
    }
    const recommendation = parsed.data;
    if (itemKeys.has(recommendation.item_key)) return result("unavailable", "original_recommendation_identity_duplicate");
    itemKeys.add(recommendation.item_key);
    const linked = events.get(normalizedKeys.get(recommendation.event_key) || recommendation.event_key);
    if (!linked) return result("unavailable", "original_recommendation_unlinked");
    if (policy && recommendation.decision !== "BET" && recommendation.suggested_units !== null && recommendation.suggested_units !== 0) return result("unavailable", "original_non_entry_units_invalid");
    if (policy && "timing" in recommendation && recommendation.timing && recommendation.decision !== "BET") return result("unavailable", "original_early_timing_invalid");
    if (!policy && recommendation.decision === "EVALUATION INCOMPLETE" && (!linked.event.starts_at || !Number.isFinite(checked) || Date.parse(linked.event.starts_at) > checked)) return result("unavailable", "original_evaluation_timing_invalid");
    if (recommendation.decision !== "BET") continue;
    betCount++;
    reasons.push(...linked.reasons);
    const starts = time(linked.event.starts_at);
    if (!Number.isFinite(starts)) reasons.push("start_time_missing_or_invalid");
    if (!recommendation.price_gate?.trim()) reasons.push("price_gate_missing_or_invalid");
    if (recommendation.suggested_units === null || recommendation.suggested_units <= 0 || (policy && ![0.25, 0.5, 1, 2].includes(recommendation.suggested_units))) reasons.push("suggested_units_missing_or_invalid");
    if (!knownTimes || typeof input.message?.id !== "string") reasons.push("assessment_or_delivery_time_unavailable");
    if (Number.isFinite(starts) && Number.isFinite(checked) && checked >= starts) reasons.push("assessment_not_pregame");
    if (Number.isFinite(starts) && Number.isFinite(delivery) && delivery >= starts) reasons.push("delivery_not_pregame");
    if (reasons.length) { review(reasons); continue; }
    if (starts <= now) continue;
    projection.actionableBets.push({ eventKey: linked.event.event_key, match: linked.event.label, startsAt: linked.event.starts_at!, market: recommendation.market, selection: recommendation.selection, suggestedUnits: recommendation.suggested_units!, priceGate: recommendation.price_gate!, checkedAt: String(metadata.checked_at), messageId: String(input.message!.id), jobId: input.jobId });
  }
  if (betCount && !knownTimes) { projection.actionState = "unavailable"; projection.actionReason = "assessment_or_delivery_time_unavailable"; }
  return projection;
}

/** Add independently validated nonexact candidates without changing canonical execution eligibility. */
export function projectActionableBets(input: ActionableBetInput): BettingOverviewProjection {
  const projection=projectCanonicalBets(input);
  if (projection.actionState==="not_applicable" || (projection.actionState==="unavailable" && !["original_record_missing_or_ambiguous"].includes(projection.actionReason||""))) return projection;
  const metadata=object(input.message?.metadata)?input.message.metadata:{};
  if (typeof metadata.original_model_response!=="string" || typeof input.message?.id!=="string") return projection;
  const raw=metadata.original_model_response;
  const blocks=[...raw.matchAll(/^```analysis-record[^\S\r\n]*\r?\n([\s\S]*?)^```[^\S\r\n]*(?:\r?\n|$)/gm)];
  if (blocks.length > 1) return projection;
  let rows:unknown[]=[], events:unknown[]=[];
  try { const value=blocks.length===1?JSON.parse(blocks[0][1]):null; if (object(value)&&Array.isArray(value.recommendations)) rows=value.recommendations; if(object(value)&&Array.isArray(value.events)) events=value.events; } catch { /* Candidate display retains its own provenance validation. */ }
  const candidate=projectConditionalBets({sport:input.sport,ownerId:input.ownerId,jobId:input.jobId,messageId:input.message.id,raw,checkedAt:String(metadata.checked_at),createdAt:String(input.message.created_at),deliveredAt:object(metadata.delivery)?String(metadata.delivery.delivered_at):String(input.message.created_at),now:input.now,commonPolicy:!!metadata.common_policy},rows,input.candidateOverlays,events);
  const exact=projectReviewedExactBets({sport:input.sport,ownerId:input.ownerId,jobId:input.jobId,messageId:input.message.id,raw,checkedAt:String(metadata.checked_at),createdAt:String(input.message.created_at),deliveredAt:object(metadata.delivery)?String(metadata.delivery.delivered_at):String(input.message.created_at),now:input.now,commonPolicy:!!metadata.common_policy,sourceAttested:input.sourceAttested===true,sources:metadata.sources},input.reviewedExactOverlays||[],rows,events);
  projection.actionableBets=projection.actionableBets.filter(row=>!exact.conflicts.includes(exactBetIdentity(row)));
  for(const row of exact.bets)if(!projection.actionableBets.some(native=>exactBetIdentity(native)===exactBetIdentity(row)))projection.actionableBets.push(row);
  if(exact.reasons.length){projection.actionState="unavailable";projection.actionReason=exact.reasons[0];projection.needsReview.count++;projection.needsReview.reasons=[...new Set([...projection.needsReview.reasons,...exact.reasons])];}
  projection.conditionalBets=candidate.bets;
  if (candidate.reasons.length) {projection.needsReview.count++;projection.needsReview.reasons=[...new Set([...projection.needsReview.reasons,...candidate.reasons])];}
  const eligible = marketEligibilityGuard(metadata, input.sport);
  const blocked = [...projection.actionableBets, ...projection.conditionalBets].filter(row => !eligible(row)).length;
  projection.actionableBets = projection.actionableBets.filter(eligible);
  projection.conditionalBets = projection.conditionalBets.filter(eligible);
  if (blocked) {
    if (projection.actionState === "ready" && !projection.actionableBets.length && !projection.conditionalBets.length) {
      projection.actionState = "unavailable";
      projection.actionReason = "evaluation_market_quarantined";
    }
    projection.needsReview.count += blocked;
    projection.needsReview.reasons = [...new Set([...projection.needsReview.reasons, "evaluation_market_quarantined"])];
  }
  return projection;
}

/** Preserve purpose/canonical validation while resolving historical references with the actual clock. */
export function verifiedEntryCandidates(input: ActionableBetInput) {
 const projection=projectCanonicalBets(input);
 if(projection.actionState==="not_applicable" || (projection.actionState==="unavailable" && projection.actionReason!=="original_record_missing_or_ambiguous")) return [];
 const metadata=object(input.message?.metadata)?input.message.metadata:{};
 if(typeof metadata.original_model_response!=="string" || typeof input.message?.id!=="string") return [];
 const raw=metadata.original_model_response;
 const blocks=[...raw.matchAll(/^```analysis-record[^\S\r\n]*\r?\n([\s\S]*?)^```[^\S\r\n]*(?:\r?\n|$)/gm)];
 if(blocks.length>1) return [];
 let rows:unknown[]=[],events:unknown[]=[];
 try {const record=blocks.length?JSON.parse(blocks[0][1]):null;if(object(record)&&Array.isArray(record.recommendations))rows=record.recommendations;if(object(record)&&Array.isArray(record.events))events=record.events;}catch{return [];}
 return verifyConditionalCandidates({sport:input.sport,ownerId:input.ownerId,jobId:input.jobId,messageId:input.message.id,raw,checkedAt:String(metadata.checked_at),createdAt:String(input.message.created_at),deliveredAt:object(metadata.delivery)?String(metadata.delivery.delivered_at):String(input.message.created_at),now:input.now,commonPolicy:!!metadata.common_policy},rows,input.candidateOverlays,events).bets.map(row=>row.snapshot).filter(marketEligibilityGuard(metadata, input.sport));
}

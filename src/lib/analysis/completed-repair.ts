import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { parseApprovedIndependentSourceVerification, type IndependentSourceVerification } from "./source-verification";
import { extractAnalysisRecord } from "./record";
import { extractCoverageReport, hasVisibleCoverageEventIdentity, type AnalysisScope, type CoverageReport } from "./coverage";
import { extractResponsePurpose } from "./response-purpose";
import type { GatewaySource } from "./gateway";

type Row = Record<string, unknown>;
export type CompletedRepairSnapshot = { sport: string; job: Row; attempt: Row; message: Row };
export type RepairCitationSupplement = { event_key: string; label: string; source_url: string; reason: "original_inventory_citation" };
export function renderRepairCitationSupplements(supplements: RepairCitationSupplement[]): string {
  if (!supplements.length) return "";
  const escape = (text: string) => text.replace(/[\\[\]]/g, "\\$&");
  return `### 기록 복구 출처 보완\n\n${supplements.map(row => `- [${escape(row.label)}](${row.source_url})`).join("\n")}`;
}
const normalizeLabel = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();
export type CoverageKeyCorrection = { from: string; to: string; raw_sha256: string };
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const lineProof = z.object({line_index:z.number().int().min(0),text:z.string().min(1).max(4000),sha256:sha}).strict();
const headingCorrectionSchema = z.object({
  reason:z.literal("approved_historical_tournament_heading"),raw_sha256:sha,sport:z.literal("tennis"),date_et:z.string(),competition:z.string().min(1),
  original_heading:lineProof,canonical_heading:z.string().min(1).max(4000),
  events:z.array(z.object({event_key:z.string(),label:z.string(),competition:z.string(),source_url:z.string().url(),short_id:z.string().regex(/^[a-z0-9-]+$/),pair:z.string(),row:lineProof}).strict()).min(1).max(500),
  authority:z.object({url:z.string().url(),observed_at:z.string().datetime({offset:true}),evidence_kind:z.literal("official_page_via_search_index"),direct_fetch_verified:z.literal(false),evidence_sha256:sha}).strict(),
  approved_plan_sha256:sha,
}).strict();
export type RepairHeadingCorrection = z.infer<typeof headingCorrectionSchema>;
function applyApprovedHeadingCorrection(body: string,report: CoverageReport,scope: AnalysisScope,rawSha: string,input: RepairHeadingCorrection): string {
  const parsed=headingCorrectionSchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid approved heading plan");
  const plan=parsed.data, lines=body.split(/\r?\n/), url=new URL(plan.authority.url);
  const from=plan.original_heading.text.match(/^(\s{0,3}#{1,6}\s+[^—]+ — )(.+?)( (\d+)(?:항목|경기)\s*#*\s*)$/);
  const to=plan.canonical_heading.match(/^(\s{0,3}#{1,6}\s+[^—]+ — )(.+?)( (\d+)(?:항목|경기)\s*#*\s*)$/);
  if (plan.raw_sha256!==rawSha || scope.sport!==plan.sport || scope.date_et!==plan.date_et || !scope.competitions.includes(plan.competition) ||
      url.protocol!=="https:" || url.username || url.password || url.port || !["atptour.com","www.atptour.com"].includes(url.hostname) ||
      lines[plan.original_heading.line_index]!==plan.original_heading.text || lines.filter(line=>line===plan.original_heading.text).length!==1 || lines.includes(plan.canonical_heading) ||
      createHash("sha256").update(plan.original_heading.text).digest("hex")!==plan.original_heading.sha256 || !from || !to || from[1]!==to[1] || from[3]!==to[3] || from[2]===to[2] ||
      Number(to[4])!==plan.events.length) throw new Error("Invalid approved heading scope or proof");
  const tournament=to[2].replace(/[*`]/g,"").normalize("NFKC").replace(/\s+/g," ").trim();
  const group=report.inventory.filter(row=>row.competition===plan.competition && row.label.startsWith(`${tournament} `));
  if (group.length!==plan.events.length || new Set(plan.events.map(row=>row.event_key)).size!==group.length || new Set(plan.events.map(row=>row.row.line_index)).size!==group.length) throw new Error("Invalid approved heading group");
  const derived=lines.map((line,index)=>index===plan.original_heading.line_index?plan.canonical_heading:line).join("\n");
  for (const proof of plan.events) {
    const matches=group.filter(row=>row.event_key===proof.event_key && row.label===proof.label && row.competition===proof.competition && row.source_url===proof.source_url);
    if (matches.length!==1 || proof.short_id!==proof.event_key.split(":").at(-1)?.toLowerCase() || proof.pair!==proof.label.slice(tournament.length+1) || !proof.pair.includes("–") ||
        lines[proof.row.line_index]!==proof.row.text || proof.row.line_index<=plan.original_heading.line_index || lines.slice(plan.original_heading.line_index+1,proof.row.line_index).some(line=>/^\s{0,3}#{1,6}\s+/.test(line)) || createHash("sha256").update(proof.row.text).digest("hex")!==proof.row.sha256 ||
        !hasVisibleCoverageEventIdentity(derived,matches[0],report.inventory,proof.row.line_index)) throw new Error("Invalid approved heading event identity");
  }
  return derived;
}
export const COMPLETED_REPAIR_VERSION = "official-source-coverage-v1";
const object = (value: unknown): Row => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected saved object");
  return value as Row;
};
export function deriveCompletedRepair(saved: CompletedRepairSnapshot, correction?: CoverageKeyCorrection, headingCorrection?: RepairHeadingCorrection, trustedOptions: { independentSourceVerifications?: unknown[] } = {}) {
  const { job, attempt, message } = saved;
  const metadata = object(message.metadata), jobMetadata = object(job.provider_metadata), attemptMetadata = object(attempt.provider_metadata), input = object(attempt.input_snapshot);
  if (job.status !== "completed" || job.provider !== "openllms" || attempt.status !== "completed" || message.role !== "assistant" || job.result_type === "conversation" ||
      job.current_attempt_id !== attempt.id || job.result_message_id !== message.id || attempt.job_id !== job.id || message.analysis_job_id !== job.id ||
      attempt.owner_id !== job.owner_id || message.owner_id !== job.owner_id || message.sport_id !== job.sport_id) throw new Error("Not a linked completed analysis");
  const raw = metadata.original_model_response;
  if (typeof raw !== "string" || !raw.trim() || !Number.isFinite(Date.parse(String(metadata.checked_at)))) throw new Error("Saved raw response/check time required");
  for (const value of [metadata, jobMetadata, attemptMetadata]) {
    if (value.type !== "analysis" || value.result_type === "conversation" || value.terminalStatus !== "completed" || value.verified !== true || value.searched !== true ||
        value.original_model_response !== raw || value.checked_at !== metadata.checked_at || !isDeepStrictEqual(value.sources, metadata.sources)) throw new Error("Immutable result provenance differs");
    if (!isDeepStrictEqual(object(value.input_snapshot).common_policy ?? null, input.common_policy ?? null)) throw new Error("Original attempt policy differs");
  }
  if (!Array.isArray(metadata.sources) || !metadata.sources.length) throw new Error("Saved searched sources required");
  const sources = metadata.sources as GatewaySource[];
  const raw_sha256 = createHash("sha256").update(raw).digest("hex");
  const context = JSON.parse(String(input.context)) as Row;
  const scope = context.analysis_scope as AnalysisScope;
  if (!scope || scope.sport !== saved.sport) throw new Error("Original input scope required");
  const purpose = extractResponsePurpose(raw, new Set<string>());
  let response=purpose.purpose ? purpose.answer : raw;
  const original = extractCoverageReport(response, scope, sources);
  let coverage = original;
  if (headingCorrection) {
    if (!original.report) throw new Error("Invalid approved heading report");
    const opening=original.answer.lastIndexOf("```analysis-record");
    const originalBody=original.answer.slice(0,opening).trimEnd();
    const derivedBody=applyApprovedHeadingCorrection(originalBody,original.report,scope,raw_sha256,headingCorrection);
    // Only this exact visible heading is overlaid; original response stays immutable.
    if (derivedBody===originalBody) throw new Error("Invalid approved heading no-op");
    const responseLines=response.split(/\r?\n/);
    if (responseLines.filter(line=>line===headingCorrection.original_heading.text).length!==1) throw new Error("Invalid approved heading source line");
    response=responseLines.map(line=>line===headingCorrection.original_heading.text?headingCorrection.canonical_heading:line).join("\n");
    coverage=extractCoverageReport(response,scope,sources);
  }
  if (correction) {
    if (correction.raw_sha256 !== raw_sha256 || saved.sport !== "tennis" || !original.report || correction.from === correction.to) throw new Error("Invalid correction provenance");
    const report = structuredClone(original.report);
    const from = report.assessments.filter(row => row.event_key === correction.from);
    const target = report.inventory.filter(row => row.event_key === correction.to);
    const shortId = correction.from.match(/^ten:([a-z0-9-]+)$/)?.[1];
    if (!shortId || !correction.to.startsWith(`tennis:${scope.date_et}:`) || !correction.to.endsWith(`:${shortId}`) || from.length !== 1 || target.length !== 1 ||
        report.inventory.some(row => row.event_key === correction.from) || report.assessments.some(row => row.event_key === correction.to) ||
        report.inventory.filter(row => row.event_key.endsWith(`:${shortId}`)).length !== 1) throw new Error("Correction does not identify a unique orphan");
    // The body validator independently requires the exact pair, tournament and unique ID.
    if (!hasVisibleCoverageEventIdentity(coverage.answer.replace(/^```analysis-record\s*\n[\s\S]*?^```\s*$/gm,""),target[0],report.inventory)) throw new Error("Correction lacks body identity evidence");
    from[0].event_key = correction.to;
    const corrected = response.replace(/(^```analysis-coverage[^\S\r\n]*\r?\n)[\s\S]*?^```[^\S\r\n]*(?:\r?\n|$)/m, () => `\`\`\`analysis-coverage\n${JSON.stringify(report)}\n\`\`\`\n`);
    coverage = extractCoverageReport(corrected, scope, sources);
  }
  const opening = coverage.answer.lastIndexOf("```analysis-record");
  const visibleBody = coverage.answer.slice(0,opening).trim();
  const block = /^```analysis-record\s*\n([\s\S]*?)\n```\s*$/.exec(coverage.answer.slice(opening));
  if (!block) throw new Error("Saved record still invalid: malformed_block");
  const rawRecord = object(JSON.parse(block[1]));
  if (!Array.isArray(rawRecord.events)) throw new Error("Saved record still invalid: schema_invalid");
  const independent_source_verifications: IndependentSourceVerification[] = [];
  const verifiedSources = [...sources]; // Ephemeral only: original searched sources remain immutable.
  let source_verified_at: string | null = null;
  if (trustedOptions.independentSourceVerifications?.length) {
    if (trustedOptions.independentSourceVerifications.length !== 1 || saved.sport !== "tennis" || rawRecord.sport !== "tennis" || !Array.isArray(rawRecord.recommendations)) throw new Error("Invalid independent source authority");
    const envelope = trustedOptions.independentSourceVerifications[0];
    const proof = parseApprovedIndependentSourceVerification(envelope);
    if (!proof || proof.job_id !== job.id || proof.message_id !== message.id || proof.raw_sha256 !== raw_sha256 || proof.original_checked_at !== metadata.checked_at || proof.date_et !== scope.date_et ||
        rawRecord.events.length !== proof.events.length || rawRecord.events.some(item => object(item).analysis_status === "BET") || rawRecord.recommendations.some(item => { const r = object(item); return ["BET","GO","EARLY GO"].includes(String(r.decision)) || Number(r.suggested_units ?? 0) > 0; })) throw new Error("Independent source target differs");
    const now = Date.now();
    for (const doc of proof.documents) {
      if (doc.final_url !== doc.source_url || Date.parse(doc.fetched_at) <= Date.parse(String(metadata.checked_at)) || Date.parse(doc.fetched_at) > now) throw new Error("Independent source retrieval time differs");
      if (!source_verified_at || Date.parse(doc.fetched_at) > Date.parse(source_verified_at)) source_verified_at = doc.fetched_at;
    }
    for (const binding of proof.events) {
      const matches = rawRecord.events.filter(item => {const e=object(item);return e.event_key === binding.event_key && e.label === binding.label && e.source_url === binding.source_url && e.starts_at === binding.original_starts_at;});
      if (matches.length !== 1 || rawRecord.events.filter(item=>object(item).event_key===binding.event_key).length !== 1 ||
          sources.some(source=>source.url===binding.source_url) !== binding.original_searched_membership || !proof.documents.some(doc=>doc.source_url===binding.source_url)) throw new Error("Independent source event binding differs");
      if (!verifiedSources.some(source=>source.url===binding.source_url)) verifiedSources.push({url:binding.source_url,title:"Independently verified schedule"});
    }
    independent_source_verifications.push(envelope as IndependentSourceVerification);
  }
  const repair_citation_supplements: RepairCitationSupplement[] = [];
  for (const item of rawRecord.events) {
    const event = object(item);
    if (typeof event.source_url !== "string" || typeof event.label !== "string" || typeof event.event_key !== "string") throw new Error("Saved record still invalid: schema_invalid");
    const url = new URL(event.source_url);
    if (visibleBody.includes(event.source_url) || visibleBody.includes(url.href)) continue;
    const binding = original.report?.inventory.filter(row => row.event_key===event.event_key && row.label===event.label && row.source_url===event.source_url);
    if (saved.sport!=="nhl" || !binding || binding.length!==1 || original.report?.inventory.filter(row => row.event_key===event.event_key).length!==1 ||
        url.protocol!=="https:" || url.username || url.password || url.port || !["nhl.com","www.nhl.com","frontend.d3.nhle.com"].includes(url.hostname) ||
        !sources.some(source => source.url===url.href) || !(` ${normalizeLabel(visibleBody)} `).includes(` ${normalizeLabel(event.label)} `)) throw new Error("Saved citation lacks original inventory binding");
    repair_citation_supplements.push({event_key:event.event_key,label:event.label,source_url:url.href,reason:"original_inventory_citation"});
  }
  const materialized = `${visibleBody}\n\n${renderRepairCitationSupplements(repair_citation_supplements)}\n\n${coverage.answer.slice(opening)}`;
  const extracted = extractAnalysisRecord(materialized, saved.sport, verifiedSources, new Date(String(metadata.checked_at)), { commonPolicyAdopted: Boolean(input.common_policy), scopeDate: scope.date_et, originalRawSha256: raw_sha256 });
  if (!extracted.record) throw new Error(`Saved record still invalid: ${extracted.failure.code}`);
  return { version: extracted.recommendation_key_corrections?.length || independent_source_verifications.length ? "official-source-coverage-v2" : COMPLETED_REPAIR_VERSION,
    ...(extracted.recommendation_key_corrections?.length || independent_source_verifications.length ? { recommendation_key_corrections: extracted.recommendation_key_corrections ?? [], independent_source_verifications, source_verified_at, source_verification_scope: independent_source_verifications.length ? "schedule_pair_and_date" : null } : {}), raw_sha256, analysis_record: extracted.record, coverage: coverage.validation, coverage_report: coverage.report,
    repair_citation_supplements, repair_heading_corrections:headingCorrection?[headingCorrection]:[], correction: correction ?? null, original_coverage_report: original.report };
}

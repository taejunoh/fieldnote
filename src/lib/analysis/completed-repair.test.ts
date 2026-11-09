import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { deriveCompletedRepair } from "./completed-repair";
const source = { url: "https://www.nhl.com/game", title: "Official" };
const scope = { version: 1 as const, sport: "nhl", date_et: "2026-10-20", timezone: "America/New_York" as const, mode: "daily" as const, competitions: ["NHL"], basis: "default" as const, notes: [] };
const key = "nhl:2026-10-20:bos@nyr:src";
const report = { version: 1, scope, inventory: [{ event_key: key, label: "Boston at New York", starts_at: null, competition: "NHL", source_url: source.url }], assessments: [{ event_key: key, disposition: "deferred", reason: "Wait" }], schedule_sources: [], inventory_complete: false, limitations: [] };
const record = { version: 1, sport: "nhl", events: [{ event_key: key, label: "Boston at New York", starts_at: null, source_url: source.url, analysis_status: "WAIT" }], recommendations: [{ item_key: "main", event_key: key, market: "Moneyline", selection: "Boston", decision: "WAIT", suggested_units: null, price_gate: null }] };
const raw = `Boston at New York ${source.url}\n\n\`\`\`analysis-coverage\n${JSON.stringify(report)}\n\`\`\`\n\n\`\`\`analysis-record\n${JSON.stringify(record)}\n\`\`\``;
const meta = { terminalStatus: "completed", type: "analysis", result_type: "analysis", searched: true, verified: true, original_model_response: raw, checked_at: "2026-10-20T12:00:00Z", sources: [source], coverage: { scope }, coverage_report: report, extraction_failure: { code: "unofficial_source" }, input_snapshot: { common_policy: null } };
const snapshot = () => ({ sport: "nhl", job: { id: "job", owner_id: "owner", sport_id: "sport", current_attempt_id: "attempt", result_message_id: "message", status: "completed", provider: "openllms", provider_metadata: structuredClone(meta) }, attempt: { id: "attempt", job_id: "job", owner_id: "owner", status: "completed", provider_metadata: structuredClone(meta), input_snapshot: { context: JSON.stringify({ analysis_scope: scope }), common_policy: null } }, message: { id: "message", owner_id: "owner", sport_id: "sport", analysis_job_id: "job", role: "assistant", content: "saved content", metadata: structuredClone(meta) } });
describe("completed analysis repair derivation", () => {
 it("replays saved raw without changing snapshots or analysis judgments", () => {
  const saved = snapshot(), original = structuredClone(saved);
  const result = deriveCompletedRepair(saved);
  expect(saved).toEqual(original);
  expect(result.analysis_record.events[0].event_key).toBe(`${key}-${createHash("sha256").update(source.url).digest("hex").slice(0,32)}`);
  expect(result.analysis_record.recommendations[0].decision).toBe("WAIT");
  expect(result.coverage.status).toBe("incomplete");
  expect(result.raw_sha256).toBe(createHash("sha256").update(raw).digest("hex"));
 });
 it.each(["running", "conversation", "raw", "sources"])("rejects unsafe %s snapshot", kind => {
  const saved = snapshot();
  if (kind === "running") saved.job.status = "running";
  if (kind === "conversation") saved.message.metadata.type = "conversation";
  if (kind === "raw") saved.attempt.provider_metadata.original_model_response += "changed";
  if (kind === "sources") saved.attempt.provider_metadata.sources = [];
  expect(() => deriveCompletedRepair(saved)).toThrow();
 });
 it("rejects a correction not bound to the exact raw hash and known orphan", () => {
  expect(() => deriveCompletedRepair(snapshot(), { from: "ten:fake", to: key, raw_sha256: "0".repeat(64) })).toThrow();
 });
});

it("materializes a missing NHL citation only from an exact original inventory binding", () => {
 const saved = snapshot();
 const original = raw.replace(`Boston at New York ${source.url}`, "Boston at New York");
 for (const metadata of [saved.job.provider_metadata,saved.attempt.provider_metadata,saved.message.metadata]) metadata.original_model_response = original;
 const result = deriveCompletedRepair(saved);
 expect(result.repair_citation_supplements).toEqual([{event_key:key,label:"Boston at New York",source_url:source.url,reason:"original_inventory_citation"}]);
 expect(result.analysis_record.recommendations[0].decision).toBe("WAIT");
});
it("rejects a citation binding appearing only inside control JSON", () => {
 const saved = snapshot();
 const original = raw.replace(`Boston at New York ${source.url}`, "No visible event identity");
 for (const metadata of [saved.job.provider_metadata,saved.attempt.provider_metadata,saved.message.metadata]) metadata.original_model_response = original;
 expect(() => deriveCompletedRepair(saved)).toThrow();
});
it("rejects a substituted inventory source URL", () => {
 const saved = snapshot();
 const changedReport=structuredClone(report); changedReport.inventory[0].source_url="https://www.nhl.com/different";
 const original=raw.replace(`Boston at New York ${source.url}`,"Boston at New York").replace(JSON.stringify(report),JSON.stringify(changedReport));
 for (const metadata of [saved.job.provider_metadata,saved.attempt.provider_metadata,saved.message.metadata]) {metadata.original_model_response=original; metadata.coverage_report=changedReport;}
 expect(() => deriveCompletedRepair(saved)).toThrow();
});

function tennisSnapshot(body: string) {
 const saved = snapshot(), url="https://www.atptour.com/schedule";
 const tennisScope={...scope,sport:"tennis",competitions:["ATP"]};
 const tennisReport={...structuredClone(report),scope:tennisScope,
  inventory:[{event_key:"tennis:2026-10-20:p03",label:"Doha Alpha–Beta",starts_at:null,competition:"ATP",source_url:url}],
  assessments:[{event_key:"ten:p03",disposition:"deferred",reason:"Wait"}]};
 const tennisRaw=`${body}\n\n\`\`\`analysis-coverage\n${JSON.stringify(tennisReport)}\n\`\`\`\n\`\`\`analysis-record\n${JSON.stringify({version:1,sport:"tennis",events:[],recommendations:[]})}\n\`\`\``;
 saved.sport="tennis"; saved.attempt.input_snapshot.context=JSON.stringify({analysis_scope:tennisScope});
 for (const metadata of [saved.job.provider_metadata,saved.attempt.provider_metadata,saved.message.metadata]) {
  metadata.original_model_response=tennisRaw; metadata.sources=[{url,title:"Official"}]; metadata.coverage_report=tennisReport;
 }
 return {saved,correction:{from:"ten:p03",to:"tennis:2026-10-20:p03",raw_sha256:createHash("sha256").update(tennisRaw).digest("hex")}};
}
it("requires a visible same-row ID and pair under the correct tournament for explicit correction", () => {
 const {saved,correction}=tennisSnapshot("Doha Alpha–Beta");
 expect(() => deriveCompletedRepair(saved,correction)).toThrow();
});
it("audits one proven orphan without changing disposition or completeness limitations", () => {
 const {saved,correction}=tennisSnapshot("### Section — Doha 1항목\n\n| 경기 | 상태 |\n| --- | --- |\n| P03 Alpha–Beta | deferred |");
 const result=deriveCompletedRepair(saved,correction);
 expect(result.coverage.assessed_count).toBe(1); expect(result.coverage.missing_event_keys).toEqual([]);
 expect(result.coverage_report?.assessments[0]).toMatchObject({event_key:correction.to,disposition:"deferred",reason:"Wait"});
 expect(result.original_coverage_report?.assessments[0].event_key).toBe(correction.from);
 expect(result.coverage_report?.inventory_complete).toBe(false); expect(result.coverage.status).toBe("incomplete");
});

it("uses an explicitly approved historical heading overlay only for derived coverage", () => {
 const {saved,correction}=tennisSnapshot("### Section — FormerDoha 1항목\n\n| 경기 | 상태 |\n| --- | --- |\n| P03 Alpha–Beta | deferred |");
 const text="### Section — FormerDoha 1항목", row="| P03 Alpha–Beta | deferred |";
 const heading={reason:"approved_historical_tournament_heading" as const,raw_sha256:correction.raw_sha256,sport:"tennis" as const,date_et:"2026-10-20",competition:"ATP",
  original_heading:{line_index:0,text,sha256:createHash("sha256").update(text).digest("hex")},canonical_heading:"### Section — Doha 1항목",
  events:[{event_key:correction.to,label:"Doha Alpha–Beta",competition:"ATP",source_url:"https://www.atptour.com/schedule",short_id:"p03",pair:"Alpha–Beta",row:{line_index:4,text:row,sha256:createHash("sha256").update(row).digest("hex")}}],
  authority:{url:"https://www.atptour.com/en/tournaments/doha/123/overview",observed_at:"2026-10-20T12:00:00Z",evidence_kind:"official_page_via_search_index" as const,direct_fetch_verified:false as const,evidence_sha256:"a".repeat(64)},approved_plan_sha256:"b".repeat(64)};
 const before=structuredClone(saved);
 const result=deriveCompletedRepair(saved,correction,heading);
 expect(result.coverage.reasons.filter(reason=>reason.startsWith("body_inventory_missing:"))).toEqual([]);
 expect(result.repair_heading_corrections).toEqual([heading]);expect(saved).toEqual(before);expect(result.coverage.status).toBe("incomplete");
 expect(()=>deriveCompletedRepair(saved,correction,{...heading,events:[{...heading.events[0],pair:"Fabricated–Pair"}]})).toThrow();
});

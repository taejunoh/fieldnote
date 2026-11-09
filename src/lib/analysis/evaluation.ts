import { z } from "zod";
import { sportSlugs } from "../sports";
import type { CoverageReport } from "./coverage";

const text = z.string().trim().min(1).max(1200);
const short = z.string().trim().min(1).max(200);
const url = z.string().url().max(2000).refine(value => /^https?:\/\//i.test(value));
const timestamp = z.string().datetime({ offset: true });
export const evaluationStates = ["valuation_complete", "information_wait", "research_incomplete", "not_evaluated"] as const;
const checkCategories = ["participants", "matchup", "workload", "dependencies"] as const;
const marketSchema = z.object({
  event_key: short, label: short, market: short, selection: short, line: short.nullable(),
  original_decision: z.enum(["GO", "EARLY GO", "BET", "WAIT", "PASS", "WATCH", "PAPER", "LEAN", "EVALUATION INCOMPLETE"]),
  state: z.enum(evaluationStates),
  observed_price: z.object({ value: short, source_url: url, checked_at: timestamp }).strict().nullable(),
  price_condition: text.nullable(), suggested_units: z.number().finite().min(0).max(100).nullable(),
  thesis: text, countercase: text,
  critical_checks: z.array(z.object({ category: z.enum(checkCategories), status: z.enum(["confirmed", "missing", "conflicting", "not_applicable"]), evidence: text, source_urls: z.array(url).max(8), checked_at: timestamp.nullable() }).strict()).max(12),
  uncertainty: z.object({ impact: text, scenario: text, reopen_trigger: text }).strict(),
}).strict();
const reportSchema = z.object({ version: z.literal(1), sport: z.enum(sportSlugs), date_et: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => { const date = new Date(`${value}T12:00:00Z`); return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value; }), scope: z.literal("selected_markets"), scope_note: text, truncated: z.boolean(), markets: z.array(marketSchema).max(20) }).strict();
const envelopeSchema = z.object({ version: z.literal(1), sport: z.enum(sportSlugs), date_et: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => { const date = new Date(`${value}T12:00:00Z`); return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value; }), scope: z.literal("selected_markets"), scope_note: text, truncated: z.boolean(), markets: z.array(z.unknown()).max(20) }).strict();
export type EvaluationMarket = z.infer<typeof marketSchema>;
export type EvaluationReport = z.infer<typeof reportSchema>;
export type EvaluationCounts = Record<typeof evaluationStates[number], number>;
export type EvaluationIssue = { code: string; path: string; message: string };
export type EvaluationQuarantine = { originalIndex: number; eventKey?: string | null; label: string; market: string; selection: string; line?: string | null; originalDecision: EvaluationMarket["original_decision"] | null; reasons: string[] };
export type EvaluationValidation = { version: 1; status: "valid" | "partial" | "invalid" | "unavailable"; reasons: string[]; counts: EvaluationCounts; details?: EvaluationIssue[]; normalizations?: { path: string; type: string }[]; acceptedMarketIndexes?: number[] };
export type EvaluationDisplay = { report: EvaluationReport | null; validation: EvaluationValidation; quarantinedMarkets: EvaluationQuarantine[]; summary?: { clean_complete: number; challenged_complete: number; rows_with_diagnostics: number } };
const emptyCounts = (): EvaluationCounts => ({ valuation_complete: 0, information_wait: 0, research_incomplete: 0, not_evaluated: 0 });
function counts(report: EvaluationReport) { const result = emptyCounts(); for (const row of report.markets) result[row.state]++; return result; }
function normalizeUrl(value: string) { try { const parsed = new URL(value); parsed.hash = ""; return parsed.href; } catch { return value; } }
function normalize(value: string) { return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " "); }
const safePathFields = new Set(["version", "sport", "date_et", "scope", "scope_note", "truncated", "markets", "event_key", "label", "market", "selection", "line", "original_decision", "state", "observed_price", "value", "source_url", "checked_at", "price_condition", "suggested_units", "thesis", "countercase", "critical_checks", "category", "status", "evidence", "source_urls", "uncertainty", "impact", "scenario", "reopen_trigger"]);
function safeIssues(issues: z.ZodIssue[], prefix: (string | number)[] = [], limit = 40): EvaluationIssue[] {
  const messages: Record<string, string> = {
      invalid_enum_value: "Value is not an allowed enum option.",
      invalid_literal: "Value does not match the required literal.",
      unrecognized_keys: "Unrecognized field(s).",
      invalid_string: "String format is invalid.",
      too_small: "Value is below the allowed bounds.",
      too_big: "Value exceeds the allowed bounds.",
      invalid_union: "Value does not match an allowed variant.",
      invalid_union_discriminator: "Discriminator is not an allowed option.",
      not_multiple_of: "Number does not meet the required multiple.",
      custom: "Value failed a custom validation rule.",
  };
  return issues.slice(0, limit).map(issue => {
    const message = issue.code === "invalid_type" ? `Expected ${issue.expected}; received type differs.` : messages[issue.code] || "Value failed schema validation.";
    return {
      code: issue.code.slice(0, 80),
      path: [...prefix, ...issue.path].map(part => typeof part === "number" ? String(part) : safePathFields.has(part) ? part : "[unknown]").join(".").slice(0, 200),
      message: message.slice(0, 240),
    };
  });
}
const originalDecisions = ["GO", "EARLY GO", "BET", "WAIT", "PASS", "WATCH", "PAPER", "LEAN", "EVALUATION INCOMPLETE"] as const;
function safeQuarantine(row: unknown, originalIndex: number, reasons: string[]): EvaluationQuarantine {
  const value = row && typeof row === "object" && !Array.isArray(row) ? row as Record<string, unknown> : {};
  const shortText = (input: unknown) => typeof input === "string" ? input.trim().slice(0, 200) : "";
  const eventKey = typeof value.event_key === "string" ? value.event_key.slice(0, 200) : null;
  const line = typeof value.line === "string" ? value.line.slice(0, 200) : typeof value.line === "number" && Number.isFinite(value.line) ? String(value.line) : null;
  return { originalIndex, eventKey, label: shortText(value.label), market: shortText(value.market), selection: shortText(value.selection), line, originalDecision: typeof value.original_decision === "string" && originalDecisions.includes(value.original_decision as typeof originalDecisions[number]) ? value.original_decision as EvaluationQuarantine["originalDecision"] : null, reasons: reasons.slice(0, 8) };
}
/** No official-source or financial eligibility is conferred by this self-report. */
export function extractEvaluationReport(response: string, options: {
  sport: string; dateEt: string; coverageReport: CoverageReport | null; sources: { url: string }[];
  record?: { events: { event_key: string; label: string; source_url: string }[]; recommendations: { event_key: string; market: string; selection: string; decision: string; price_gate: string | null; suggested_units: number | null }[] } | null;
  canonicalEventKeys?: Record<string, string>;
}): EvaluationDisplay & { answer: string } {
  // Also remove unclosed/malformed machine blocks; preserve surrounding prose and all other fences.
  const pattern = /^\s{0,3}```analysis-evaluation[^\n]*(?:\r?\n|$(?![\s\S]))([\s\S]*?)(?:^\s{0,3}```[^\S\r\n]*(?:\r?\n|$)|(?=^\s{0,3}```(?:analysis-(?!evaluation)[^\n]*|response-purpose)[^\n]*\r?\n)|$(?![\s\S]))/gm;
  const blocks = [...response.matchAll(pattern)];
  const answer = response.replace(pattern, "").trim();
  const validation: EvaluationValidation = { version: 1, status: "unavailable", reasons: [], counts: emptyCounts(), details: [], normalizations: [], acceptedMarketIndexes: [] };
  const invalid = (reason: string, details: EvaluationIssue[] = []) => ({ answer, report: null, validation: { ...validation, status: "invalid" as const, reasons: [reason], details } , quarantinedMarkets: [] });
  if (!blocks.length) { validation.reasons.push("evaluation_report_absent"); return { answer, report: null, validation, quarantinedMarkets: [] }; }
  if (blocks.length !== 1) return invalid("multiple_evaluation_blocks");
  if (!/\n[ \t]{0,3}```[^\S\r\n]*(?:\r?\n)?$/.test(blocks[0][0])) return invalid("evaluation_block_unclosed");
  if (new TextEncoder().encode(blocks[0][1]).length > 96 * 1024) return invalid("evaluation_block_too_large");
  let value: unknown;
  try { value = JSON.parse(blocks[0][1]); } catch { return invalid("evaluation_invalid_json"); }
  const parsed = envelopeSchema.safeParse(value);
  if (!parsed.success) return invalid("evaluation_invalid_schema", safeIssues(parsed.error.issues));
  const { markets: rawMarkets, ...envelope } = parsed.data;
  if (envelope.sport !== options.sport || envelope.date_et !== options.dateEt) return invalid("evaluation_scope_mismatch");
  const sources = new Set(options.sources.map(row => normalizeUrl(row.url)));
  const seen = new Set<string>();
  const accepted: EvaluationMarket[] = [];
  const acceptedMarketIndexes: number[] = [];
  const quarantinedMarkets: EvaluationQuarantine[] = [];
  for (const [index, rawRow] of rawMarkets.entries()) {
    let normalizedRow = rawRow;
    if (rawRow && typeof rawRow === "object" && !Array.isArray(rawRow)) {
      const candidate = rawRow as Record<string, unknown>;
      if (typeof candidate.line === "number" && Number.isFinite(candidate.line)) {
        normalizedRow = { ...candidate, line: String(candidate.line) };
        validation.normalizations?.push({ path: `markets.${index}.line`, type: "number" });
      }
    }
    const parsedRow = marketSchema.safeParse(normalizedRow);
    if (!parsedRow.success) {
      validation.reasons.push(`evaluation_market_schema_invalid:${index}`);
      validation.details?.push(...safeIssues(parsedRow.error.issues, ["markets", index], Math.max(0, 40 - (validation.details?.length || 0))));
      quarantinedMarkets.push(safeQuarantine(rawRow, index, [`evaluation_market_schema_invalid:${index}`]));
      continue;
    }
    const row = parsedRow.data;
    const rowReasons: string[] = [];
    const inventory = options.coverageReport?.inventory.filter(event => event.event_key === row.event_key);
    if (inventory?.length !== 1 || inventory[0].label !== row.label || !row.event_key.startsWith(`${options.sport}:${options.dateEt}:`)) rowReasons.push(`evaluation_unknown_event:${index}`);
    const identity = JSON.stringify([row.event_key, row.market, row.selection, row.line].map(value => value === null ? null : normalize(value)));
    if (seen.has(identity)) rowReasons.push(`evaluation_duplicate_market:${index}`);
    const referenced = [...row.critical_checks.flatMap(check => check.source_urls), ...(row.observed_price ? [row.observed_price.source_url] : [])];
    if (referenced.some(source => !sources.has(normalizeUrl(source)))) rowReasons.push(`evaluation_unknown_source:${index}`);
    if (new Set(row.critical_checks.map(check => check.category)).size !== row.critical_checks.length) rowReasons.push(`evaluation_duplicate_check:${index}`);
    if (rowReasons.length) {
      validation.reasons.push(...rowReasons);
      quarantinedMarkets.push(safeQuarantine(rawRow, index, rowReasons));
      continue;
    }
    seen.add(identity);
    accepted.push(row);
    acceptedMarketIndexes.push(index);
    for (const category of checkCategories) if (!row.critical_checks.some(check => check.category === category)) validation.reasons.push(`critical_check_missing:${index}:${category}`);
    for (const check of row.critical_checks) {
      if (check.status === "confirmed" && (!check.source_urls.length || !check.checked_at)) validation.reasons.push(`critical_evidence_missing:${index}:${check.category}`);
      if (check.status === "missing" || check.status === "conflicting") validation.reasons.push(`critical_${check.status}:${index}:${check.category}`);
    }
    if (row.state === "valuation_complete" && !row.observed_price) validation.reasons.push(`valuation_price_missing:${index}`);
    if (row.original_decision === "WAIT" && row.state !== "information_wait") validation.reasons.push(`wait_state_conflict:${index}`);
    if (row.original_decision === "PASS" && row.state !== "valuation_complete") validation.reasons.push(`pass_state_conflict:${index}`);
    const canonicalKey = options.canonicalEventKeys?.[row.event_key] || row.event_key;
    // A canonical row has no explicit line field: compare only unlined markets or an exact encoded line.
    const matching = options.record?.recommendations.filter(rec => rec.event_key === canonicalKey && normalize(rec.market) === normalize(row.market) && normalize(rec.selection) === normalize(row.selection) && (row.line === null || `${rec.market} ${rec.selection}`.includes(row.line)));
    if (matching?.length === 1) {
      const rec = matching[0];
      const decision = ["GO", "EARLY GO"].includes(row.original_decision) ? "BET" : row.original_decision === "LEAN" ? "WATCH" : row.original_decision;
      if (rec.decision !== decision) validation.reasons.push(`canonical_decision_conflict:${index}`);
      if (rec.price_gate !== row.price_condition) validation.reasons.push(`canonical_price_conflict:${index}`);
      if (rec.suggested_units !== row.suggested_units) validation.reasons.push(`canonical_units_conflict:${index}`);
    }
  }
  validation.acceptedMarketIndexes = acceptedMarketIndexes;
  if (rawMarkets.length > 0 && accepted.length === 0) {
    validation.status = "invalid";
    return { answer, report: null, validation, quarantinedMarkets };
  }
  const report: EvaluationReport = { ...envelope, markets: accepted };
  validation.status = quarantinedMarkets.length ? "partial" : "valid";
  validation.counts = counts(report);
  return { answer, report, validation, quarantinedMarkets };
}
const issueSchema = z.object({ code: z.string().min(1).max(80), path: z.string().max(200), message: z.string().max(240) }).strict();
const quarantineSchema = z.object({ originalIndex: z.number().int().min(0).max(19), eventKey: z.string().max(200).nullable().optional(), label: z.string().max(200), market: z.string().max(200), selection: z.string().max(200), line: z.string().max(200).nullable().optional(), originalDecision: z.enum(originalDecisions).nullable(), reasons: z.array(z.string().max(300)).max(8) }).strict();
const validationSchema = z.object({ version: z.literal(1), status: z.enum(["valid", "partial", "invalid", "unavailable"]), reasons: z.array(z.string().max(300)).max(200), counts: z.object({ valuation_complete: z.number().int().min(0).max(20), information_wait: z.number().int().min(0).max(20), research_incomplete: z.number().int().min(0).max(20), not_evaluated: z.number().int().min(0).max(20) }).strict(), details: z.array(issueSchema).max(40).optional(), normalizations: z.array(z.object({ path: z.string().max(200), type: z.string().max(40) }).strict()).max(20).optional(), acceptedMarketIndexes: z.array(z.number().int().min(0).max(19)).max(20).optional() }).strict();
/** Browser-safe allowlist; never copy raw provider text, source snapshots or financial records. */
export function evaluationDisplayFromMetadata(metadata: unknown): EvaluationDisplay | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = metadata as Record<string, unknown>;
  if (!value.evaluation_validation && !value.evaluation_report) return null;
  const validation = validationSchema.safeParse(value.evaluation_validation);
  const report = reportSchema.safeParse(value.evaluation_report);
  const quarantined = z.array(quarantineSchema).max(20).safeParse(value.evaluation_quarantined_markets ?? []);
  const acceptedStatus = validation.success && ["valid", "partial"].includes(validation.data.status);
  const acceptedIndexes = validation.success ? validation.data.acceptedMarketIndexes : undefined;
  const quarantineRows: EvaluationQuarantine[] = quarantined.success ? quarantined.data.map(row => ({ ...row, eventKey: row.eventKey ?? null, line: row.line ?? null })) : [];
  const quarantineIndexes = quarantineRows.map(row => row.originalIndex);
  const indexMappingInvalid = acceptedStatus && report.success && (
    (validation.data.status === "partial" && (quarantineRows.length === 0 || report.data.markets.length === 0 || acceptedIndexes === undefined))
    || (validation.data.status === "valid" && quarantineRows.length > 0)
    || (acceptedIndexes !== undefined && (acceptedIndexes.length !== report.data.markets.length || new Set(acceptedIndexes).size !== acceptedIndexes.length))
    || (validation.data.status === "valid" && acceptedIndexes !== undefined && acceptedIndexes.some((index, position) => index !== position))
    || new Set(quarantineIndexes).size !== quarantineIndexes.length
    || (acceptedIndexes !== undefined && acceptedIndexes.some(index => quarantineIndexes.includes(index)))
  );
  const reportStateInvalid = acceptedStatus
    ? !report.success || JSON.stringify(counts(report.data)) !== JSON.stringify(validation.data.counts)
    : validation.success && acceptedIndexes !== undefined && acceptedIndexes.length > 0;
  if (!validation.success || !quarantined.success || reportStateInvalid || indexMappingInvalid) return { report: null, validation: { version: 1, status: "invalid", reasons: ["evaluation_metadata_invalid"], counts: emptyCounts() }, quarantinedMarkets: [] };
  const display: EvaluationDisplay = { report: ["valid", "partial"].includes(validation.data.status) && report.success ? report.data : null, validation: validation.data, quarantinedMarkets: quarantined.data };
  if (display.report) {
    const originalIndexes = validation.data.acceptedMarketIndexes || display.report.markets.map((_, index) => index);
    const challenged = new Set(validation.data.reasons.flatMap(reason => {
      const index = reason.match(/^[^:]+:(\d+)(?::|$)/)?.[1];
      return index === undefined ? [] : [originalIndexes.indexOf(Number(index))].filter(value => value >= 0);
    }));
    const challengedComplete = display.report.markets.filter((row, index) => row.state === "valuation_complete" && challenged.has(index)).length;
    display.summary = { clean_complete: display.validation.counts.valuation_complete - challengedComplete, challenged_complete: challengedComplete, rows_with_diagnostics: display.report.markets.filter((_, index) => challenged.has(index)).length };
  }
  return display;
}

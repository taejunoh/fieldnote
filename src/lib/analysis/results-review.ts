import { createHash } from "node:crypto";
import { calculateBetProfit } from "../records/settlement";

type Row = Record<string, unknown>;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.filter((row): row is Row => Boolean(row) && typeof row === "object" && !Array.isArray(row)) : [];

function actualNumber(value: unknown): unknown {
  if (typeof value === "string" && /^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) return Number(value);
  return value;
}

function hasNonstandardSettlement(row: Row, conditional: Row | undefined): boolean {
  const candidate = row.source_candidate && typeof row.source_candidate === "object" ? row.source_candidate as Row : {};
  const marker = /cash[ _-]?out|캐시\s*아웃|캐시아웃|캐쉬아웃|promo(?:tion)?|bonus[ _-]?bet|free[ _-]?bet|partial|retire(?:ment|d)?|기권|부분\s*정산|프로모션|보너스/i;
  const evidence = [row.source_ref, row.settlement_type, row.settlement_conditions, candidate.provenance, candidate.settlementType, candidate.settlement_type, candidate.settlement_conditions, candidate.promotion, candidate.priceGate, conditional?.provenance, conditional?.priceGate];
  return evidence.some(value => typeof value === "string" && marker.test(value))
    || [row, candidate].some(source => ["cashout", "cash_out", "partial_settlement", "is_bonus_bet", "promotion"].some(key => source[key] === true));
}

/** Phase one is local bookkeeping only; original decision bodies remain in recent_messages. */
export function prepareResultsReview(context: string) {
  let input: Row;
  try { input = JSON.parse(context); if (!input || typeof input !== "object" || Array.isArray(input)) return { context, packet: null }; }
  catch { return { context, packet: null }; }
  const limitations = Array.isArray(input.scope_limitations) ? input.scope_limitations : [];
  const packet = {
    version: 1,
    original_context_sha256: hash(context),
    scope: input.analysis_scope || null,
    scope_status: limitations.some(reason => ["review_scope_unresolved", "review_source_history_incomplete", "invalid_or_ambiguous_request_date"].includes(String(reason))) ? "unresolved" : "bounded",
    scope_limitations: limitations,
    review_obligation: "Review ALL original decisions: wins, losses, GO/BET, PASS, WAIT, WATCH, PAPER, incomplete evaluations and misses, including body-only recommendations. Source references are an index, never an exhaustive parsed decision list. Read each full original body and all user corrections; never outcome-select or infer executions.",
    source_messages: rows(input.recent_messages).map(row => ({ id: row.id, role: row.role, created_at: row.created_at, content_sha256: hash(typeof row.content === "string" ? row.content : ""), content_utf8_bytes: Buffer.byteLength(typeof row.content === "string" ? row.content : "", "utf8"), body_location: "recent_messages", ...((row.metadata as Row | undefined)?.historical_structured_decisions ? { structured_decisions_location: "recent_messages.metadata.historical_structured_decisions" } : {}), evidence_status: "historical_recorded" })),
    facts: rows(input.active_events).map(row => ({ ...row, evidence_status: "historical_recorded", independently_verified: false })),
    decisions: rows(input.relevant_recommendations),
    conditional_entry_sources: rows(input.conditional_entry_sources),
    tickets: rows(input.confirmed_bets).map(row => {
      const conditional = rows(input.conditional_entry_sources).find(source => source.bet_id === row.id);
      const nonstandard = hasNonstandardSettlement(row, conditional);
      const profit = nonstandard ? null : calculateBetProfit(String(row.result || ""), actualNumber(row.stake_units), actualNumber(row.executed_price));
      const recordedProfit = actualNumber(row.profit_units);
      const profitDiscrepancy = profit !== null && typeof recordedProfit === "number" && Number.isFinite(recordedProfit) ? Math.abs(profit - recordedProfit) > 1e-9 : null;
      return { ...row, evidence_status: "historical_recorded", recorded_profit_units: row.profit_units ?? null, calculated_profit_units: profit, profit_discrepancy: profitDiscrepancy, resolution: profit === null ? "unresolved" : "recorded_result_preview", ...(nonstandard ? { unresolved_reason: "nonstandard_ticket_settlement" } : {}) };
    }),
    ledger_scope: { complete_ledger: false, ...(input.review_ledger_coverage && typeof input.review_ledger_coverage === "object" ? input.review_ledger_coverage : {}), meaning: "Bounded saved actual tickets only. Missing matches do not establish no bet; unavailable older records and body-only executions may exist." },
    required_verification: "live_search_required: saved results are historical_recorded, never fresh independent verification. Verify absent, incomplete, stale or conflicting outcomes and source identity through live search; leave unresolved when unavailable.",
    settlement_authority: "Deterministic P&L preview only, not sportsbook payout or settlement authority. Stored actual risk/price/settled result only; never suggested units, price gates or implied executions. Retirement, cashout, promotions, ticket ambiguity and unknown actuals remain unresolved. No automatic ledger or mistake-note mutation.",
  };
  const modelPacket: Row = { ...packet };
  delete modelPacket.source_messages;
  delete modelPacket.original_context_sha256;
  const prepared: Row = { ...input, results_review: modelPacket };
  // Structured source rows appear once in the packet; full original prose and authority stay untouched.
  for (const key of ["active_events", "relevant_recommendations", "confirmed_bets", "conditional_entry_sources", "review_ledger_coverage"]) delete prepared[key];
  return { context: JSON.stringify(prepared), packet };
}

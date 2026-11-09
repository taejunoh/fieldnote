import { z } from "zod";
import { sportSlugs } from "../sports";

export type AnalysisScope = {
  version: 1; sport: string; date_et: string; timezone: "America/New_York";
  mode: "daily" | "explicit"; competitions: string[]; basis: "default" | "request" | "previous";
  parent_message_id?: string; notes?: string[];
};
export type CoverageReport = {
  version: 1; scope: AnalysisScope;
  inventory: { event_key: string; label: string; starts_at: string | null; competition: string; source_url: string }[];
  assessments: { event_key: string; disposition: "evaluated" | "deferred" | "excluded"; reason: string }[];
  schedule_sources: { url: string; competition: string; expected_count: number | null }[];
  inventory_complete: boolean; limitations: string[];
};
export type CoverageValidation = {
  status: "complete" | "incomplete" | "unverified"; scope: AnalysisScope;
  listed_count: number; assessed_count: number; missing_event_keys: string[]; reasons: string[];
};
const text = z.string().trim().min(1).max(2000);
function validDate(date: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T12:00:00Z`)) && new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date;
}
export function dateInET(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  return ["year", "month", "day"].map(key => parts.find(p => p.type === key)!.value).join("-");
}
const scopeSchema = z.object({ version: z.literal(1), sport: z.enum(sportSlugs), date_et: z.string().refine(validDate), timezone: z.literal("America/New_York"), mode: z.enum(["daily", "explicit"]), competitions: z.array(text).max(100), basis: z.enum(["default", "request", "previous"]), parent_message_id: text.optional(), notes: z.array(text).max(100).optional() }).strict();
/** Return only persisted, schema-valid coverage suitable for identifying a prior report's scope. */
export function parseStoredCoverageScope(metadata: unknown, expectedSport: string): AnalysisScope | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const coverage = (metadata as Record<string, unknown>).coverage;
  if (!coverage || typeof coverage !== "object" || Array.isArray(coverage)) return null;
  const value = coverage as Record<string, unknown>;
  if (!["complete", "incomplete", "unverified"].includes(String(value.status))) return null;
  const parsed = scopeSchema.safeParse(value.scope);
  if (!parsed.success || parsed.data.sport !== expectedSport || parsed.data.notes?.some(note => ["invalid_or_ambiguous_request_date", "review_scope_unresolved"].includes(note))) return null;
  return parsed.data;
}
const reportSchema = z.object({
  version: z.literal(1), scope: scopeSchema,
  inventory: z.array(z.object({ event_key: text, label: text, starts_at: z.string().max(100).nullable(), competition: text, source_url: text }).strict()).max(500),
  assessments: z.array(z.object({ event_key: text, disposition: z.enum(["evaluated", "deferred", "excluded"]), reason: text }).strict()).max(500),
  schedule_sources: z.array(z.object({ url: text, competition: text, expected_count: z.number().int().min(0).max(500).nullable() }).strict()).max(100),
  inventory_complete: z.boolean(), limitations: z.array(text).max(100),
}).strict();
const defaults: Record<string, string[]> = { mlb: ["MLB"], nfl: ["NFL"], cfb: ["FBS"], soccer: [], tennis: ["ATP singles main draw", "ATP singles qualifying", "WTA singles main draw", "WTA singles qualifying"], nba: ["NBA"], wnba: ["WNBA"], nhl: ["NHL"] };
type Row = Record<string, unknown>;
export type ScopeInput = { sport: string; request: string; kind: string; now: Date; criteria?: Row[]; events?: Row[]; messages?: Row[]; requestCreatedAt?: string; reviewSourceHistoryIncomplete?: boolean };
function explicitlyExcluded(value: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}\\s*(?:은|는|을|를)?\\s*(?:제외|빼고|말고|exclude(?:d)?\\b)`, "i").test(value)
    || new RegExp(`(?:without|except|excluding|exclude)\\s+${escaped}\\b`, "i").test(value);
}
function competitionRange(value: string, sport: string): string[] {
  const declared = value.match(/(?:competitions?|대회 범위|대회|리그 범위|리그)\s*[:=]\s*([^\n]+)/i);
  if (declared) return declared[1].split(/[,;|]/).map(s => s.trim()).filter(name => name && !/(?:제외|빼고|말고|\b(?:exclude|excluding|without|except)\b)/i.test(name) && !explicitlyExcluded(value, name)).slice(0, 100);
  const names = sport === "cfb" ? ["FBS", "FCS"] : sport === "soccer" ? ["Premier League", "La Liga", "Bundesliga", "Serie A", "Ligue 1", "MLS", "K League 1", "K League 2", "J1 League", "UEFA Champions League"] : [];
  return names.filter(name => !explicitlyExcluded(value, name) && new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(value));
}
export function isRecheckRequest(request: string): boolean {
  const command = request.replace(/\b\d{4}-\d{2}-\d{2}\b/g, "").replace(/(?:(?:\d{4})년\s*)?\d{1,2}월\s*\d{1,2}일/g, "").trim();
  return /^(?:(?:라인업|출전\s*정보|일정)\s*)?재확인\s*(?:해\s*줘|해\s*주세요|부탁해|부탁합니다)?[.!]?$/u.test(command);
}
export function hasHistoricalComparisonIntent(request: string): boolean {
  const korean = /(과거|이전\s*날짜|다른\s*날짜|날짜\s*간|지난주|지난달|전날|어제)[^\n]{0,40}(비교|대조)|(비교|대조)[^\n]{0,40}(과거|이전\s*날짜|다른\s*날짜|날짜\s*간|지난주|지난달|전날|어제)/u;
  const english = /(?:historical|cross[- ]date|previous\s+(?:day|date|week)|prior\s+(?:day|date|week)|last\s+week|yesterday)[^\n]{0,40}(?:compare|comparison|contrast)|(?:compare|comparison|contrast)[^\n]{0,40}(?:historical|cross[- ]date|previous\s+(?:day|date|week)|prior\s+(?:day|date|week)|last\s+week|yesterday)/i;
  return korean.test(request) || english.test(request);
}
export function resolveAnalysisScope(input: ScopeInput): { scope: AnalysisScope; limitations: string[] } {
  const limitations: string[] = [];
  let scope: AnalysisScope = { version: 1, sport: input.sport, date_et: dateInET(input.now), timezone: "America/New_York", mode: "daily", competitions: [...(defaults[input.sport] || [])], basis: "default" };
  const cutoff = input.requestCreatedAt ? Date.parse(input.requestCreatedAt) : input.now.getTime();
  const reviewResults = input.kind === "review_results";
  const hasHistoricalComparison = reviewResults && hasHistoricalComparisonIntent(input.request);
  const hasExplicitReviewRefs = reviewResults && /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i.test(input.request);
  if (reviewResults && input.reviewSourceHistoryIncomplete) limitations.push("review_source_history_incomplete");
  const isoDates = input.request.match(/\b\d{4}-\d{2}-\d{2}\b/g) || [];
  const koreanDates = [...input.request.matchAll(/(?:(\d{4})년\s*)?(\d{1,2})월\s*(\d{1,2})일/g)].map(m => `${m[1] || dateInET(input.now).slice(0, 4)}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`);
  const absoluteDates = [...new Set([...isoDates, ...koreanDates])];
  const relativeBase = input.requestCreatedAt && Number.isFinite(Date.parse(input.requestCreatedAt)) ? new Date(input.requestCreatedAt) : input.now;
  const relativeBaseDate = dateInET(relativeBase);
  const [baseYear, baseMonth, baseDay] = relativeBaseDate.split("-").map(Number);
  const previousRelativeDate = new Date(Date.UTC(baseYear, baseMonth - 1, baseDay - 1, 12)).toISOString().slice(0, 10);
  const relativeDates = reviewResults && !absoluteDates.length
    ? [...new Set([...input.request.matchAll(/오늘|어제|\btoday\b|\byesterday\b/giu)].map(match => /오늘|\btoday\b/iu.test(match[0]) ? relativeBaseDate : previousRelativeDate))]
    : [];
  const dates = absoluteDates.length ? absoluteDates : relativeDates;
  const unsupportedRelativePeriod = reviewResults && /(?:최근|지난)\s*(?:(?:\d+|한|두|세|네|몇)\s*)?(?:일|주|개월|달|일주일|한주|한 달|기간)|(?:past|last|recent)\s+(?:(?:\d+|a|one|two|three|several)\s+)?(?:days?|weeks?|months?)|(?:since|between)\s+\w+/iu.test(input.request);
  const ambiguousDate = dates.length > 1 || Boolean(dates.length && !validDate(dates[0])) || /\b\d{1,2}\/\d{1,2}\b/.test(input.request) || unsupportedRelativePeriod;
  let reviewAnchor: { id: string; created_at: string; scope: AnalysisScope } | undefined;
  if (reviewResults && !hasExplicitReviewRefs && !hasHistoricalComparison && !ambiguousDate) {
    const explicitDate = dates.length === 1 ? dates[0] : undefined;
    const candidates = (input.messages || []).flatMap(row => {
      const createdAt = typeof row.created_at === "string" ? Date.parse(row.created_at) : NaN;
      if (row.role !== "assistant" || typeof row.id !== "string" || !Number.isFinite(createdAt) || createdAt >= cutoff) return [];
      const parsed = parseStoredCoverageScope(row.metadata, input.sport);
      if (!parsed || (explicitDate ? parsed.date_et !== explicitDate : false)) return [];
      return [{ id: row.id, created_at: String(row.created_at), scope: parsed }];
    }).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id.localeCompare(a.id));
    reviewAnchor = candidates[0];
    if (!reviewAnchor) limitations.push("review_scope_unresolved");
  }
  if (reviewResults && !hasExplicitReviewRefs && (ambiguousDate || hasHistoricalComparison) && !limitations.includes("review_scope_unresolved")) limitations.push("review_scope_unresolved");
  if (input.kind === "recheck" || input.kind === "recheck_lineup" || input.kind === "check_status" || (input.kind === "message" && isRecheckRequest(input.request))) {
    const previous = (input.messages || []).filter(row => row.role === "assistant" && Number.isFinite(Date.parse(String(row.created_at))) && Date.parse(String(row.created_at)) < cutoff).sort((a, b) => Date.parse(String(b.created_at)) - Date.parse(String(a.created_at))).find(row => {
      const metadata = row.metadata as Row | undefined;
      const coverage = metadata?.coverage as Row | undefined;
      const parsed = scopeSchema.safeParse(coverage?.scope);
      return ["complete", "incomplete", "unverified"].includes(String(coverage?.status)) && parsed.success && parsed.data.sport === input.sport && !parsed.data.notes?.includes("invalid_or_ambiguous_request_date");
    });
    if (previous) {
      const metadata = previous.metadata as Row;
      const coverage = metadata.coverage as Row;
      scope = { ...scopeSchema.parse(coverage.scope), basis: "previous", parent_message_id: String(previous.id) };
    }
  }
  if (dates.length === 1 && validDate(dates[0])) scope = { ...scope, date_et: dates[0], mode: "explicit", basis: "request" };
  if (ambiguousDate && !limitations.includes("invalid_or_ambiguous_request_date")) limitations.push("invalid_or_ambiguous_request_date");
  if (reviewAnchor && !ambiguousDate && !hasHistoricalComparison) {
    if (dates.length === 1) scope = { ...scope, parent_message_id: reviewAnchor.id };
    else scope = { ...reviewAnchor.scope, basis: "previous", parent_message_id: reviewAnchor.id };
  }
  const requested = competitionRange(input.request, input.sport);
  const adopted = (input.criteria || []).flatMap(row => competitionRange(String(row.content || ""), input.sport));
  if (requested.length) scope = { ...scope, competitions: [...new Set(requested)], basis: "request" };
  else if (scope.basis !== "previous" && adopted.length) scope.competitions = [...new Set(adopted)];
  const included = scope.competitions.filter(name => !explicitlyExcluded(input.request, name));
  if (included.length !== scope.competitions.length) scope = { ...scope, competitions: included, basis: "request" };
  if (input.sport === "tennis" && !requested.length) {
    const tracked = (input.events || []).flatMap(row => {
      const storedDate = String(row.event_key || "").match(/^(?:tennis:)?(\d{4}-\d{2}-\d{2})(?::|-)/)?.[1];
      const timestamp = typeof row.starts_at === "string" && Number.isFinite(Date.parse(row.starts_at)) ? dateInET(new Date(row.starts_at)) : null;
      if ((storedDate && storedDate !== scope.date_et) || (timestamp && timestamp !== scope.date_et) || ["final", "completed", "cancelled"].includes(String(row.game_status).toLowerCase())) return [];
      const value = String(row.competition || "");
      if (/Challenger|ITF/i.test(value)) return [value];
      const reference = `${String(row.label || "")} ${String(row.notes || "")}`;
      return ["Challenger", "ITF"].filter(tier => new RegExp(`\\b${tier}\\b`, "i").test(reference)).map(tier => `${tier} singles (tracked)`);
    });
    scope.competitions = [...new Set([...scope.competitions, ...tracked])].slice(0, 100);
  }
  if (!scope.competitions.length) limitations.push("competition_scope_unknown");
  scope.notes = limitations;
  return { scope, limitations };
}
function normalizedUrl(value: string) {
  try { const url = new URL(value); if (!["http:", "https:"].includes(url.protocol)) return null; url.hash = ""; return url.href; } catch { return null; }
}
function normalizeLabel(value: string) { return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim(); }
function plainMarkdown(value: string) { return value.replace(/[*`]/g, "").normalize("NFKC").replace(/\s+/g, " ").trim(); }
function sectionTableRows(body: string): { headings: string[]; cells: string[]; lineIndex: number }[] {
  const rows: { headings: string[]; cells: string[]; lineIndex: number }[] = [];
  const headings: { level: number; title: string }[] = [];
  let fence: string | null = null;
  let previousTableLine = false;
  let inTable = false;
  for (const [lineIndex, line] of body.split(/\r?\n/).entries()) {
    if (/^(?: {4}| {0,3}\t)/.test(line)) {
      previousTableLine = inTable = false;
      continue;
    }
    const fenced = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    if (fenced) {
      if (!fence) fence = fenced[1];
      else if (fenced[1][0] === fence[0] && fenced[1].length >= fence.length && !fenced[2].trim()) fence = null;
      previousTableLine = inTable = false;
      continue;
    }
    if (fence) continue;
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      while (headings.length && headings[headings.length - 1].level >= heading[1].length) headings.pop();
      headings.push({ level: heading[1].length, title: plainMarkdown(heading[2]) });
      previousTableLine = inTable = false;
      continue;
    }
    const tableLine = /^\s*\|.*\|\s*$/.test(line);
    const cells = tableLine ? line.trim().slice(1, -1).split("|").map(plainMarkdown) : [];
    if (previousTableLine && cells.length && cells.every(cell => /^:?-{3,}:?$/.test(cell))) inTable = true;
    else if (inTable && tableLine) rows.push({ headings: headings.map(heading => heading.title), cells, lineIndex });
    else inTable = false;
    previousTableLine = tableLine;
  }
  return rows;
}
function hasSectionTableEntry(event: CoverageReport["inventory"][number], inventory: CoverageReport["inventory"], rows: ReturnType<typeof sectionTableRows>, requiredRowIndex?: number): boolean {
  const shortId = event.event_key.split(":").at(-1)?.toLowerCase();
  if (!shortId || inventory.filter(entry => entry.event_key.split(":").at(-1)?.toLowerCase() === shortId).length !== 1) return false;
  // The displayed ID may use uppercase; event and assessment keys remain exact.
  const tournamentOf = (row: ReturnType<typeof sectionTableRows>[number]) => [...row.headings].reverse().map(title => title.match(/^[^—]+ — (.+?) \d+(?:항목|경기)$/)?.[1]).find(Boolean);
  const identifiedRows = rows.filter(row => tournamentOf(row) && row.cells.some(cell => cell.split(/\s+/).some(token => token.toLowerCase() === shortId)));
  if (identifiedRows.length !== 1 || (requiredRowIndex !== undefined && identifiedRows[0].lineIndex !== requiredRowIndex)) return false;
  const row = identifiedRows[0];
  const tournament = tournamentOf(row);
  const label = plainMarkdown(event.label);
  if (!tournament || !label.startsWith(`${tournament} `)) return false;
  const pair = label.slice(tournament.length + 1);
  return pair.includes("–") && row.cells.some(cell => {
    const separator = cell.indexOf(" ");
    return separator > 0 && cell.slice(0, separator).toLowerCase() === shortId && cell.slice(separator + 1) === pair;
  });
}
/** Strict visible identity proof for audited repairs; a full-label mention alone is insufficient. */
export function hasVisibleCoverageEventIdentity(body: string, event: CoverageReport["inventory"][number], inventory: CoverageReport["inventory"], requiredRowIndex?: number): boolean {
  return hasSectionTableEntry(event, inventory, sectionTableRows(body), requiredRowIndex);
}
export function extractCoverageReport(response: string, expectedScope: AnalysisScope, sources: { url: string }[]): { answer: string; report: CoverageReport | null; validation: CoverageValidation } {
  const blocks = [...response.matchAll(/^```analysis-coverage[^\S\r\n]*\r?\n([\s\S]*?)^```[^\S\r\n]*(?:\r?\n|$)/gm)];
  const answer = response.replace(/^```analysis-coverage[^\S\r\n]*\r?\n[\s\S]*?^```[^\S\r\n]*(?:\r?\n|$)/gm, "").trim();
  const validation: CoverageValidation = { status: "unverified", scope: expectedScope, listed_count: 0, assessed_count: 0, missing_event_keys: [], reasons: [...(expectedScope.notes || [])] };
  const invalid = (reason: string) => { validation.status = "incomplete"; validation.reasons.push(reason); };
  if (!blocks.length) { validation.reasons.push("coverage_report_absent"); if (response.includes("```analysis-coverage")) invalid("coverage_block_unclosed"); return { answer, report: null, validation }; }
  if (blocks.length !== 1) invalid("multiple_coverage_blocks");
  if (new TextEncoder().encode(blocks[0][1]).length > 512 * 1024) { invalid("coverage_block_too_large"); return { answer, report: null, validation }; }
  let value: unknown;
  try { value = JSON.parse(blocks[0][1]); } catch { invalid("coverage_invalid_json"); return { answer, report: null, validation }; }
  const parsed = reportSchema.safeParse(value);
  if (!parsed.success) { invalid(`coverage_invalid_schema:${parsed.error.issues.map(issue => issue.path.join(".")).join(",").slice(0, 2000)}`); return { answer, report: null, validation }; }
  const report: CoverageReport = parsed.data;
  const expected = scopeSchema.safeParse(expectedScope);
  if (!expected.success || ["sport", "date_et", "timezone", "mode", "basis", "parent_message_id"].some(key => report.scope[key as keyof AnalysisScope] !== expectedScope[key as keyof AnalysisScope]) || JSON.stringify([...report.scope.competitions].sort()) !== JSON.stringify([...expectedScope.competitions].sort())) invalid("coverage_scope_mismatch");
  const accepted = new Set(sources.map(source => normalizedUrl(source.url)).filter(Boolean));
  const inventory = new Set<string>();
  const competitions = new Set(expectedScope.competitions);
  const visibleBody = answer.replace(/^```analysis-record\s*\n[\s\S]*?^```\s*$/gm, "");
  const body = normalizeLabel(visibleBody);
  const tableRows = expectedScope.sport === "tennis" ? sectionTableRows(visibleBody) : [];
  for (const event of report.inventory) {
    if (inventory.has(event.event_key)) invalid(`duplicate_event_key:${event.event_key}`);
    inventory.add(event.event_key);
    if (!event.event_key.startsWith(`${expectedScope.sport}:${expectedScope.date_et}:`)) invalid(`event_scope_mismatch:${event.event_key}`);
    if (!competitions.has(event.competition)) invalid(`event_competition_mismatch:${event.event_key}`);
    if (!accepted.has(normalizedUrl(event.source_url))) invalid(`event_source_unverified:${event.event_key}`);
    if (event.starts_at !== null) {
      if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(event.starts_at) || !Number.isFinite(Date.parse(event.starts_at))) invalid(`event_timestamp_invalid:${event.event_key}`);
      else if (dateInET(new Date(event.starts_at)) !== expectedScope.date_et) invalid(`event_date_mismatch:${event.event_key}`);
    }
    if (!(` ${body} `).includes(` ${normalizeLabel(event.label)} `) && !hasSectionTableEntry(event, report.inventory, tableRows)) invalid(`body_inventory_missing:${event.event_key}`);
  }
  const assessed = new Set<string>();
  for (const assessment of report.assessments) {
    if (assessed.has(assessment.event_key)) invalid(`duplicate_assessment:${assessment.event_key}`);
    if (!inventory.has(assessment.event_key)) invalid(`assessment_outside_inventory:${assessment.event_key}`);
    assessed.add(assessment.event_key);
  }
  validation.listed_count = inventory.size;
  validation.assessed_count = [...assessed].filter(key => inventory.has(key)).length;
  validation.missing_event_keys = [...inventory].filter(key => !assessed.has(key));
  if (validation.missing_event_keys.length) invalid("inventory_assessments_missing");
  const scheduleCompetitions = new Set<string>();
  for (const source of report.schedule_sources) {
    if (!accepted.has(normalizedUrl(source.url))) invalid(`schedule_source_unverified:${source.competition}`);
    if (!competitions.has(source.competition)) invalid(`schedule_competition_mismatch:${source.competition}`);
    if (scheduleCompetitions.has(source.competition)) invalid(`duplicate_schedule_competition:${source.competition}`);
    scheduleCompetitions.add(source.competition);
    const count = report.inventory.filter(event => event.competition === source.competition).length;
    if (source.expected_count !== null && source.expected_count !== count) invalid(`schedule_count_mismatch:${source.competition}:${source.expected_count}:${count}`);
  }
  if (!report.inventory_complete) invalid("inventory_declared_incomplete");
  if (!expectedScope.competitions.length) validation.reasons.push("competition_scope_unknown");
  if ([...competitions].some(competition => !scheduleCompetitions.has(competition))) validation.reasons.push("schedule_scope_not_proven");
  if (!report.inventory.length && (!report.schedule_sources.length || report.schedule_sources.some(source => source.expected_count !== 0))) validation.reasons.push("zero_inventory_not_proven");
  validation.reasons.push(...report.limitations, "independent_schedule_verification_unavailable");
  return { answer, report, validation };
}

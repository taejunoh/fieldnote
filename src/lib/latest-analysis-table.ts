import { extractExecutionRows, type ExecutionRow } from "./execution-table";
import type { CoverageValidation } from "./analysis/coverage";
import type { RecordRecoveryDTO } from "./record-recovery";
import { evaluationDisplayFromMetadata, type EvaluationDisplay } from "./analysis/evaluation";

export { evaluationDisplayFromMetadata };
import type { VerifiedEvaluationPresentation } from "./analysis/evaluation-recovery";

export const MAX_LATEST_TABLE_CHARS = 24_000;

/** Display-only recommendation; priceGate is a condition, never an actual fill. */
export type ActionableBet = {
  eventKey: string;
  match: string;
  startsAt: string;
  market: string;
  selection: string;
  suggestedUnits: number;
  priceGate: string;
  checkedAt: string;
  messageId: string;
  jobId: string;
  provenance?: "reviewed_original_body";
  originalDecision?: "BET" | "GO" | "EARLY GO";
  displayOnly?: true;
};

export type ConditionalBet = Omit<ActionableBet, "startsAt"> & {
  startsAt: null;
  displayOnly: true;
  entrySource: import("./records/entry-types").ConditionalEntrySource;
  schedule: { precision: "not_before" | "estimated" | "date_only" | "unknown"; dateEt: string; at: string | null; label: string };
  statusAtAssessment: "scheduled" | "unknown";
};

export type BettingOverviewProjection = {
  conditionalBets: ConditionalBet[];
  actionableBets: ActionableBet[];
  actionState: "ready" | "unavailable" | "not_applicable";
  actionReason?: string;
  needsReview: { count: number; reasons: string[] };
};

export type CoverageDisplay = Pick<CoverageValidation, "status" | "listed_count" | "assessed_count" | "missing_event_keys" | "reasons"> & {
  scope: Pick<CoverageValidation["scope"], "date_et" | "competitions"> & { notes: string[] };
};

export type EvaluationDTO = EvaluationDisplay;

/** Keep stored validation metadata to the fields intended for display. */
export function coverageDisplayFromMetadata(metadata: unknown): CoverageDisplay | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const coverage = (metadata as Record<string, unknown>).coverage;
  if (!coverage || typeof coverage !== "object" || Array.isArray(coverage)) return null;
  const value = coverage as Record<string, unknown>;
  const scope = value.scope;
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) return null;
  const scopeValue = scope as Record<string, unknown>;
  if (
    !["complete", "incomplete", "unverified"].includes(String(value.status)) ||
    typeof scopeValue.date_et !== "string" ||
    !Array.isArray(scopeValue.competitions) ||
    !scopeValue.competitions.every((item) => typeof item === "string") ||
    typeof value.listed_count !== "number" || !Number.isFinite(value.listed_count) ||
    typeof value.assessed_count !== "number" || !Number.isFinite(value.assessed_count) ||
    !Array.isArray(value.missing_event_keys) || !value.missing_event_keys.every((item) => typeof item === "string") ||
    !Array.isArray(value.reasons) || !value.reasons.every((item) => typeof item === "string")
  ) return null;

  return {
    status: value.status as CoverageValidation["status"],
    scope: {
      date_et: scopeValue.date_et,
      competitions: [...scopeValue.competitions] as string[],
      notes: Array.isArray(scopeValue.notes)
        ? scopeValue.notes.filter((item): item is string => typeof item === "string").slice(0, 20).map((item) => item.trim().slice(0, 500)).filter(Boolean)
        : [],
    },
    listed_count: value.listed_count,
    assessed_count: value.assessed_count,
    missing_event_keys: [...value.missing_event_keys] as string[],
    reasons: [...value.reasons] as string[],
  };
}

export type LatestAnalysisTable = {
  analysisTitle: string | null;
  tableTitle: string | null;
  tableMarkdown: string | null;
  hasTable: boolean;
  tableContext: "current" | "historical" | "schedule" | "unavailable";
  executionRows?: ExecutionRow[];
  unavailableReason?: string;
};

export type LatestAnalysisRecovery = RecordRecoveryDTO | null;

function headingFromLine(line: string): string | null {
  const match = line.match(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
  if (!match) return null;
  const displayText = match[1]
    .replace(/!?\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(\*\*|__|\*|_|~~)(.*?)\1/g, "$2")
    .trim();
  return displayText || null;
}

function isFence(line: string): { marker: string; length: number } | null {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
  return match ? { marker: match[1][0], length: match[1].length } : null;
}

function splitCells(line: string): string[] | null {
  let value = line.trim();
  if (!value.includes("|")) return null;
  if (value.startsWith("|")) value = value.slice(1);
  if (value.endsWith("|") && !value.endsWith("\\|")) value = value.slice(0, -1);

  const cells: string[] = [];
  let cell = "";
  let escaped = false;
  let codeTicks = 0;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (escaped) {
      cell += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      cell += character;
      escaped = true;
      continue;
    }
    if (character === "`") {
      let tickRun = 1;
      while (value[index + tickRun] === "`") tickRun++;
      codeTicks = codeTicks === 0 ? tickRun : codeTicks === tickRun ? 0 : codeTicks;
      cell += "`".repeat(tickRun);
      index += tickRun - 1;
      continue;
    }
    if (character === "|" && codeTicks === 0) {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += character;
  }
  cells.push(cell.trim());
  return cells;
}

function isDelimiter(line: string, expectedCells: number): boolean {
  const cells = splitCells(line);
  return !!cells && cells.length === expectedCells && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function referenceLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function tableReferenceDefinitions(table: string, content: string): string[] {
  const labels = new Set<string>();
  for (const match of table.matchAll(/\[[^\]]+\]\[([^\]]*)\]/g)) {
    const label = referenceLabel(match[1] || match[0].slice(1, match[0].indexOf("]")));
    if (label) labels.add(label);
  }
  if (!labels.size) return [];

  const definitions: string[] = [];
  const found = new Set<string>();
  for (const line of content.split(/\r?\n/)) {
    if (line.length > 4096) continue;
    const match = line.match(/^ {0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))(?:\s+.+)?\s*$/);
    if (!match) continue;
    const label = referenceLabel(match[1]);
    const destination = match[2] || match[3];
    if (!labels.has(label) || found.has(label) || !/^https?:\/\//i.test(destination) || destination.length > 2048) continue;
    found.add(label);
    definitions.push(line);
  }
  return definitions;
}

/** Select market judgments conservatively; other tables remain display-only. */
export function extractLatestAnalysisTable(content: string, presentation?: VerifiedEvaluationPresentation | null): LatestAnalysisTable {
  if (presentation?.excerpts.length) {
    const tableMarkdown = presentation.excerpts.join("\n\n");
    return { analysisTitle: null, tableTitle: "저장된 원문 인용", tableMarkdown, hasTable: true, tableContext: presentation.context, executionRows: [], unavailableReason: presentation.reason };
  }
  const candidates: { table: string; heading: string | null; context: string; keepContext: boolean; market: boolean; historical: boolean }[] = [];
  const lines = content.split(/\r?\n/);
  let firstHeading: string | null = null;
  let nearestHeading: string | null = null;
  let fence: { marker: string; length: number } | null = null;
  const headings: { level: number; line: string }[] = [];
  let contextStart = 0;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (fence) {
      const close = line.match(/^ {0,3}(`+|~+)\s*$/);
      if (close && close[1][0] === fence.marker && close[1].length >= fence.length) fence = null;
      continue;
    }
    const openingFence = isFence(line);
    if (openingFence) {
      fence = openingFence;
      continue;
    }
    // Four-space and tab-indented lines are code blocks in Markdown, even if
    // their contents happen to look like a pipe table.
    if (/^( {4}|\t)/.test(line)) continue;

    const heading = headingFromLine(line);
    if (heading) {
      firstHeading ||= heading;
      nearestHeading = heading;
      const level = line.match(/^ {0,3}(#+)/)![1].length;
      while (headings.length && headings[headings.length - 1].level >= level) headings.pop();
      headings.push({ level, line });
      contextStart = index + 1;
    }

    const headers = splitCells(line);
    const delimiter = lines[index + 1];
    if (!headers || !delimiter || !isDelimiter(delimiter, headers.length)) continue;

    const tableLines = [line, delimiter];
    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex++) {
      const row = lines[rowIndex];
      if (/^( {4}|\t)/.test(row)) break;
      const cells = splitCells(row);
      if (!row.trim() || !cells) break;
      tableLines.push(row);
    }
    const table = tableLines.join("\n");
    const context = [...headings.map(heading => heading.line), ...lines.slice(contextStart, index).filter(line => !line.includes("|")).slice(-12)].join("\n");
    const normalized = headers.join(" ").replace(/[*_`]/g, "").toLowerCase();
    const hasSubject = /경기|매치|대진|시장|선택|match|game|event|market|selection/.test(normalized);
    const marketSubject = /시장|선택|market|selection/.test(normalized);
    const hasDecision = headers.some(header => /^(?:(?:현재|최종)\s*)?(?:판단|결정|추천|결과|현재\s*분석\s*상태|decision|judgment|recommendation)$/i.test(header.replace(/[*_`]/g, "").trim())) || (marketSubject && /판단|결론|decision|judgment|recommendation/.test(normalized));
    const excluded = /판단에\s*미치는|라인업\s*재확인|coverage|인벤토리|inventory|출처별/.test(`${normalized} ${nearestHeading ?? ""}`);
    // A mixed report title must not mark a later explicitly current section historical.
    // "가정" in a thesis can mean an assumption; only heading/header roles identify hypothetical scope.
    const scopeHeadings = headings.length > 1 ? headings.slice(1) : headings;
    const historical = /사후|과거|가정|historical|hypothetical|finished|completed|종료/i.test(`${scopeHeadings.map(heading => heading.line).join(" ")} ${normalized}`) || /공식\s*종료|종료\s*확인|\b(?:finished|completed)\b/i.test(table);
    const keepContext = headings.length > 2 || lines.slice(contextStart, index).some(line => !!line.trim() && !line.includes("|"));
    candidates.push({ table, heading: nearestHeading, context, keepContext, market: hasSubject && hasDecision && !excluded, historical });
    index += tableLines.length - 1;
    contextStart = index + 1;
  }

  const marketTables = candidates.filter(candidate => candidate.market);
  const currentTables = marketTables.filter(candidate => !candidate.historical);
  const selected = currentTables.length ? currentTables : marketTables.length ? marketTables : candidates.slice(0, 1);
  if (selected.length) {
    const first = selected[0];
    const historical = presentation?.context === "historical" || selected.some(candidate => candidate.historical);
    const tableContext = presentation?.context === "unavailable" ? "unavailable" : historical ? "historical" : marketTables.length ? "current" : "schedule";
    const table = selected.map(candidate => selected.length > 1 || candidate.keepContext ? `${candidate.context}\n\n${candidate.table}` : candidate.table).join("\n\n");
    const definitions = tableReferenceDefinitions(table, content);
    const tableMarkdown = definitions.length ? `${table}\n\n${definitions.join("\n")}` : table;
    if (tableMarkdown.length > MAX_LATEST_TABLE_CHARS) {
      return {
        analysisTitle: firstHeading,
        tableTitle: first.heading,
        tableMarkdown: null,
        hasTable: false,
        tableContext,
        executionRows: [],
        unavailableReason: "The latest analysis table is too large to display.",
      };
    }
    return {
      analysisTitle: firstHeading,
      tableTitle: first.heading,
      tableMarkdown,
      hasTable: true,
      tableContext,
      ...(tableContext === "current" ? { executionRows: selected.flatMap(candidate => extractExecutionRows(candidate.table + "\n\n" + definitions.join("\n"))) } : { executionRows: [] }),
    };
  }

  return {
    analysisTitle: firstHeading,
    tableTitle: null,
    tableMarkdown: null,
    hasTable: false,
    tableContext: "unavailable",
    ...(presentation ? { tableContext: presentation.context, executionRows: [], unavailableReason: presentation.reason } : {}),
  };
}

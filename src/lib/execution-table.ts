export type ExecutionRow = {
  match: string;
  startTime: string | null;
  decision: string | null;
  units: string | null;
  unknowns: string | null;
  context?: string | null;
};

type Column = "match" | "startTime" | "decision" | "units" | "unknowns" | "purpose";
type ParsedTable = { headers: string[]; rows: string[][] };

const HEADER_ALIASES: Record<Column, string[]> = {
  match: ["경기", "매치", "대진", "경기명", "match", "matchup", "game", "event"],
  startTime: ["시작시각(et)", "시작시각(kst)", "시작시각", "경기시작(et)", "경기시작(kst)", "경기시작", "starttime(et)", "starttime(kst)", "starttime", "gametime(et)", "gametime(kst)", "gametime"],
  decision: ["판단", "결정", "최종판단", "추천", "현재 분석 상태", "현재분석상태", "decision", "judgment", "recommendation", "current analysis status"],
  units: ["권장유닛", "추천유닛", "권장베팅유닛", "recommendedunits", "recommendedbetunits", "recommendunits"],
  unknowns: ["미확인항목", "미확인사항", "미확인", "확인필요", "미확인정보", "남은확인", "unknownitems", "unknowns", "unconfirmeditems"],
  purpose: ["목적", "검토 목적", "purpose"],
};

function headerKey(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s()[\]{}·:._-]/g, "");
}

function columnForHeader(value: string): Column | null {
  const key = headerKey(value);
  for (const [column, aliases] of Object.entries(HEADER_ALIASES) as [Column, string[]][]) {
    if (aliases.some((alias) => headerKey(alias) === key)) return column;
  }
  return null;
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
      let run = 1;
      while (value[index + run] === "`") run++;
      codeTicks = codeTicks === 0 ? run : codeTicks === run ? 0 : codeTicks;
      cell += "`".repeat(run);
      index += run - 1;
      continue;
    }
    if (character === "|" && codeTicks === 0) {
      cells.push(cell.trim());
      cell = "";
    } else cell += character;
  }
  cells.push(cell.trim());
  return cells;
}

function isDelimiter(line: string, count: number): boolean {
  const cells = splitCells(line);
  return !!cells && cells.length === count && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function tablesOutsideCode(content: string): ParsedTable[] {
  const lines = content.split(/\r?\n/);
  const tables: ParsedTable[] = [];
  let fence: { marker: string; length: number } | null = null;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (fence) {
      const close = line.match(/^ {0,3}(`+|~+)\s*$/);
      if (close && close[1][0] === fence.marker && close[1].length >= fence.length) fence = null;
      continue;
    }
    const opening = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (opening) {
      fence = { marker: opening[1][0], length: opening[1].length };
      continue;
    }
    if (/^( {4}|\t)/.test(line)) continue;
    const headers = splitCells(line);
    if (!headers || !lines[index + 1] || !isDelimiter(lines[index + 1], headers.length)) continue;
    const rows: string[][] = [];
    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex++) {
      const row = lines[rowIndex];
      if (/^( {4}|\t)/.test(row) || !row.trim()) break;
      const cells = splitCells(row);
      if (!cells) break;
      rows.push(cells);
    }
    tables.push({ headers, rows });
    index += rows.length + 1;
  }
  return tables;
}

function textContent(value: string): string {
  return value
    .replace(/!?\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    .replace(/\[([^\]]+)\]/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/(\*\*|__|\*|_|~~)(.*?)\1/g, "$2")
    .replace(/\\([\\`*_{}\[\]()#+.!|>~-])/g, "$1")
    .trim();
}

function valueAt(cells: string[], index: number | undefined): string | null {
  if (index == null || index >= cells.length) return null;
  return cells[index].trim() || null;
}

function referenceDefinitions(content: string): Map<string, { url: string; title?: string }> {
  const definitions = new Map<string, { url: string; title?: string }>();
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^ {0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))(?:\s+["'(](.*?)["')])?\s*$/);
    if (!match) continue;
    const url = match[2] || match[3];
    if (!/^https?:\/\//i.test(url)) continue;
    definitions.set(match[1].replace(/\s+/g, " ").toLocaleLowerCase(), {
      url,
      ...(match[4] ? { title: match[4] } : {}),
    });
  }
  return definitions;
}

function resolveReferenceLinks(value: string | null, definitions: Map<string, { url: string; title?: string }>): string | null {
  if (!value || !definitions.size) return value;
  return value.replace(/\[([^\]]+)\]\[([^\]]*)\]/g, (source, text: string, rawLabel: string) => {
    const label = (rawLabel || text).replace(/\s+/g, " ").toLocaleLowerCase();
    const definition = definitions.get(label);
    if (!definition) return source;
    const title = definition.title ? ` "${definition.title.replace(/"/g, "&quot;")}"` : "";
    return `[${text}](${definition.url}${title})`;
  });
}

function mappedTable(table: ParsedTable, definitions: Map<string, { url: string; title?: string }>): { rows: ExecutionRow[]; columns: Map<Column, number> } | null {
  const columns = new Map<Column, number>();
  table.headers.forEach((header, index) => {
    const column = columnForHeader(textContent(header));
    if (column && !columns.has(column)) columns.set(column, index);
  });
  if (!columns.has("match") || !["startTime", "decision", "units", "unknowns", "purpose"].some((column) => columns.has(column as Column))) return null;
  const matchIndex = columns.get("match")!;
  const timeHeader = columns.has("startTime") ? textContent(table.headers[columns.get("startTime")!]).toLocaleUpperCase() : "";
  const timezone = /\bKST\b/.test(timeHeader) ? "KST" : /\bET\b/.test(timeHeader) ? "ET" : "미기재";
  const standardIndexes = new Set([...columns.entries()].filter(([column]) => column !== "purpose").map(([, index]) => index));
  const contextIndexes = table.headers
    .map((header, index) => ({ header: textContent(header), index }))
    .filter(({ index, header }) => !standardIndexes.has(index) && Boolean(header));
  const rows = table.rows
    .filter((cells) => valueAt(cells, matchIndex) !== null)
    .map((cells) => {
      const time = valueAt(cells, columns.get("startTime"));
      const context = contextIndexes
        .map(({ header, index }) => {
          const value = resolveReferenceLinks(valueAt(cells, index), definitions);
          return value ? `${header}: ${value}` : null;
        })
        .filter((value): value is string => Boolean(value))
        .join(" · ");
      return {
        match: resolveReferenceLinks(valueAt(cells, matchIndex), definitions)!,
        startTime: time ? `${time}${timezone === "ET" ? "" : ` (${timezone} 시간대)`}` : null,
        decision: resolveReferenceLinks(valueAt(cells, columns.get("decision")), definitions),
        units: resolveReferenceLinks(valueAt(cells, columns.get("units")), definitions),
        unknowns: resolveReferenceLinks(valueAt(cells, columns.get("unknowns")), definitions),
        ...(context ? { context } : {}),
      };
    });
  return rows.length ? { rows, columns } : null;
}

/** Extracts a normalized execution view from the complete saved analysis message. */
export function extractExecutionRows(content: string): ExecutionRow[] {
  const definitions = referenceDefinitions(content);
  const mapped = tablesOutsideCode(content).map((table) => mappedTable(table, definitions)).filter((table): table is NonNullable<typeof table> => !!table);
  if (!mapped.length) return [];
  return mapped.flatMap((table) => table.rows.map((row) => ({ ...row })));
}

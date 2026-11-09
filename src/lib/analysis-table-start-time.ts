const START_TIME_HEADER =
  /^(?:(?:경기\s*)?(?:시작(?:\s*(?:시간|시각))?|킥오프|팁오프|일시|시간|시각)|(?:날짜|일자)\s*(?:\/|및|와|과)\s*시간|(?:(?:game\s*)?(?:start(?:\s*time)?|kick[\s-]?off|tip[\s-]?off|time)|date\s*(?:\/|&|and)\s*time|datetime))(?:\s*\([^)]*\))?$/i;

function splitCells(line: string) {
  let value = line.trim();
  if (!value.includes("|")) return null;
  if (value.startsWith("|")) value = value.slice(1);
  if (value.endsWith("|") && !value.endsWith("\\|")) value = value.slice(0, -1);

  const cells: string[] = [];
  let cell = "";
  let escaped = false;
  let codeTicks = 0;
  for (let index = 0; index < value.length; index += 1) {
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
      while (value[index + tickRun] === "`") tickRun += 1;
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

function firstTableHeaders(markdown: string | null | undefined) {
  if (!markdown) return null;

  const lines = markdown.split(/\r?\n/);
  for (let index = 0; index < lines.length - 1; index += 1) {
    const cells = splitCells(lines[index]);
    const separatorCells = splitCells(lines[index + 1]);
    if (!cells || !separatorCells || cells.length !== separatorCells.length) continue;
    if (!separatorCells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;

    return cells.map((cell) => cell.replace(/[\`*_]/g, "").replace(/\s+/g, " ").trim());
  }

  return null;
}

export function hasMatchStartTimeColumn(markdown: string | null | undefined) {
  const headers = firstTableHeaders(markdown);
  return Boolean(headers?.some((cell) => START_TIME_HEADER.test(cell)));
}

function hasMatchOrMarketRows(markdown: string | null | undefined) {
  const headers = firstTableHeaders(markdown);
  if (!headers) return false;

  const normalized = headers.map((cell) => cell.toLowerCase());
  const hasMatchHeader = normalized.some((cell) =>
    /^(?:경기(?:명)?|매치업|대진|match(?:up)?|game|fixture)$/.test(cell),
  );
  const hasCombinedMarketSelection = normalized.some((cell) =>
    /^(?:시장\s*[·/&+]\s*선택|market\s*[/&·-]\s*(?:pick|selection))$/.test(cell),
  );
  const hasSeparateMarketAndSelection =
    normalized.some((cell) => cell === "시장" || cell === "market") &&
    normalized.some((cell) => cell === "선택" || cell === "pick" || cell === "selection");

  return hasMatchHeader || hasCombinedMarketSelection || hasSeparateMarketAndSelection;
}

export function shouldShowMissingMatchStartTime(
  kind: string | null | undefined,
  markdown: string | null | undefined,
) {
  return (
    (kind === "analyze_today" || kind === "recheck_lineup") &&
    Boolean(markdown) &&
    hasMatchOrMarketRows(markdown) &&
    !hasMatchStartTimeColumn(markdown)
  );
}

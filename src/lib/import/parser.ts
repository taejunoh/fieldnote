export type RuleDraft = {
  title: string;
  content: string;
  status: "adopted" | "proposed";
  sourceRef: string;
};
export type EventDraft = {
  eventKey: string;
  label: string;
  analysisStatus: string;
  gameStatus: string;
  notes: string;
  sourceRef: string;
};
export type BetDraft = {
  eventKey: string;
  market: string;
  selection: string;
  stakeUnits: number | null;
  executedPrice: number | null;
  result: string;
  profitUnits: number | null;
  sourceRef: string;
};
export type RecommendationDraft = {
  eventKey: string;
  market: string;
  selection: string;
  decision: string;
  suggestedUnits: number | null;
  priceGate: string | null;
  sourceRef: string;
};
export type MistakeDraft = {
  eventKey?: string;
  title: string;
  decisionAtTime: string | null;
  outcome: string | null;
  lesson: string;
  sourceRef: string;
};
export type ImportDraft = {
  rules: RuleDraft[];
  events: EventDraft[];
  recommendations: RecommendationDraft[];
  bets: BetDraft[];
  mistakeNotes: MistakeDraft[];
  summary: string;
  summarySourceRef?: string;
  warnings: string[];
};

type Section = {
  heading: string;
  level: number;
  start: number;
  end: number;
  bodyStart: number;
  body: string;
};

function sections(text: string): Section[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const headings = lines.flatMap((line, index) => {
    const match = /^(#{1,3})\s+(.+?)\s*$/.exec(line);
    return match
      ? [{ heading: match[2], level: match[1].length, start: index }]
      : [];
  });
  return headings.map((heading, index) => {
    const next = headings
      .slice(index + 1)
      .find((other) => other.level <= heading.level);
    const end = next ? next.start - 1 : lines.length - 1;
    const rawBody = lines.slice(heading.start + 1, end + 1);
    const firstNonblank = rawBody.findIndex((line) => line.trim());
    return {
      ...heading,
      end,
      bodyStart: heading.start + 1 + Math.max(firstNonblank, 0),
      body: rawBody.join("\n").trim(),
    };
  });
}

function ref(section: Section): string {
  return `L${section.start + 1}-L${section.end + 1}: ${section.heading}`;
}
function topLevel(sections: Section[], number: number): Section | undefined {
  return sections.find(
    (section) =>
      section.level === 1 && section.heading.startsWith(`${number}.`),
  );
}
function within(section: Section | undefined, candidate: Section): boolean {
  return (
    !!section && candidate.start > section.start && candidate.end <= section.end
  );
}
function eventKey(date: string, label: string): string {
  return `${date}-${label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")}`.replace(/-$/, "");
}
function decision(body: string, fallback: string): string {
  if (/EVALUATION INCOMPLETE/i.test(body)) return "EVALUATION INCOMPLETE";
  if (/final[^\n]*PASS|lean\s*\/\s*PASS/i.test(body)) return "PASS";
  if (/\bPAPER\b/i.test(body)) return "PAPER";
  if (/\bWAIT\b/i.test(body)) return "WAIT";
  return /\bWATCH\b/i.test(body) ? "WATCH" : fallback;
}

function parseMlb(text: string): ImportDraft {
  const all = sections(text);
  const draft: ImportDraft = {
    rules: [],
    events: [],
    recommendations: [],
    bets: [],
    mistakeNotes: [],
    summary: "",
    warnings: [
      "가져온 파일의 경기·가격·결과는 현재 웹 검증을 거치지 않은 과거 기록입니다.",
    ],
  };
  const ruleNumbers = new Set([
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 16, 17, 20, 22,
  ]);
  for (const section of all) {
    const number = Number(/^([0-9]+)\./.exec(section.heading)?.[1]);
    if (section.level === 1 && ruleNumbers.has(number)) {
      draft.rules.push({
        title: section.heading.replace(/^\d+\.\s*/, ""),
        content: section.body,
        status: "adopted",
        sourceRef: ref(section),
      });
    }
  }

  const stateSections = [topLevel(all, 18), topLevel(all, 19)];
  for (const parent of stateSections) {
    const expectedLevel = parent === stateSections[0] ? 3 : 2;
    for (const section of all.filter(
      (section) => section.level === expectedLevel && within(parent, section),
    )) {
      const match =
        /(?:[A-F]\.\s*)?([A-Z]{2,3})\s*@\s*([A-Z]{2,3})(?:\s+(Game\s*\d))?/i.exec(
          section.heading,
        );
      if (!match) continue;
      const label = `${match[1]} @ ${match[2]}${match[3] ? ` ${match[3]}` : ""}`;
      const key = eventKey("2026-09-23", label);
      const status = decision(
        section.body,
        parent === stateSections[0] ? "PASS" : "WATCH",
      );
      draft.events.push({
        eventKey: key,
        label,
        analysisStatus: status,
        gameStatus: "unknown",
        notes: section.body,
        sourceRef: ref(section),
      });
      if (status === "PASS") {
        draft.recommendations.push({
          eventKey: key,
          market: "ML / total",
          selection: label,
          decision: "PASS",
          suggestedUnits: 0,
          priceGate: null,
          sourceRef: ref(section),
        });
      }
    }
  }

  const ledger = topLevel(all, 13);
  for (const day of all.filter(
    (section) => section.level === 2 && within(ledger, section),
  )) {
    const date = /^(\d{1,2})\/(\d{1,2})/.exec(day.heading);
    if (!date) continue;
    const dateText = `2026-${date[1].padStart(2, "0")}-${date[2].padStart(2, "0")}`;
    const dayLines = day.body.split("\n");
    for (const [offset, line] of dayLines.entries()) {
      const bold = /^\s*(?:-\s*|\d+\.\s*)\*\*(.+?)\*\*/.exec(line)?.[1];
      if (
        !bold ||
        !/\b(?:ML|Over|Under)\b/i.test(bold) ||
        !/\b\d+(?:\.\d+)?u\b/i.test(bold)
      )
        continue;
      const unit = Number(/(\d+(?:\.\d+)?)u/.exec(bold)?.[1]);
      const selection = bold.split(/\s+[—–]\s+/)[0].trim();
      const market = /\bML\b/i.test(selection)
        ? "ML"
        : /\bOver\b/i.test(selection)
          ? "Over"
          : "Under";
      const key = eventKey(
        dateText,
        selection.replace(/[≤≥+-]\s*\d+.*/, "").trim(),
      );
      const sourceRef = `L${day.bodyStart + 1 + offset}: ${day.heading}`;
      const result = bold.includes("✅")
        ? "won"
        : bold.includes("❌")
          ? "lost"
          : "unknown";
      // A reference limit is not an executed price. Historical P/L is left unknown unless a fill is explicit.
      draft.events.push({
        eventKey: key,
        label: `${selection} (${dateText})`,
        analysisStatus: "BET",
        gameStatus: "unknown",
        notes:
          "Imported confirmed entry; result is from the handoff and has not been independently checked.",
        sourceRef,
      });
      const exactPrice = !/[≤≥]|or better|entry gate/i.test(selection)
        ? /(?:^|\s)([+-]\d{3,4})(?:\s|$)/.exec(selection)?.[1]
        : undefined;
      draft.bets.push({
        eventKey: key,
        market,
        selection,
        stakeUnits: unit,
        executedPrice: exactPrice ? Number(exactPrice) : null,
        result,
        profitUnits: null,
        sourceRef,
      });
    }
  }

  // Explicit recommendations without confirmed entry must never enter the actual ledger.
  for (const item of [
    {
      date: "2026-09-16",
      label: "BAL ML +104",
      sourceText: "BAL +104",
      units: 0.5,
      section: "9/16",
    },
    {
      date: "2026-09-19",
      label: "LAA ML -111",
      sourceText: "LAA ML -111",
      units: 0.5,
      section: "9/19",
    },
  ]) {
    const day = all.find(
      (section) =>
        section.level === 2 &&
        section.heading === item.section &&
        within(ledger, section),
    );
    if (!day || !day.body.includes(item.sourceText)) continue;
    const key = eventKey(
      item.date,
      item.label.split(" ").slice(0, 2).join(" "),
    );
    draft.events.push({
      eventKey: key,
      label: `${item.label} (${item.date})`,
      analysisStatus: "BET",
      gameStatus: "unknown",
      notes: "Historical recommendation only. User entry was not confirmed.",
      sourceRef: ref(day),
    });
    draft.recommendations.push({
      eventKey: key,
      market: "ML",
      selection: item.label.split(" ")[0],
      decision: "BET",
      suggestedUnits: item.units,
      priceGate: item.label.split(" ").at(-1) ?? null,
      sourceRef: ref(day),
    });
  }

  const postmortems = topLevel(all, 14);
  for (const section of all.filter(
    (section) => section.level === 2 && within(postmortems, section),
  )) {
    draft.mistakeNotes.push({
      title: section.heading,
      decisionAtTime: section.heading,
      outcome:
        section.body
          .split("\n")
          .find((line) =>
            /\b(?:won|lost|pass|failed|scoreless|\d+–\d+)\b/i.test(line),
          ) ?? null,
      lesson: section.body,
      sourceRef: ref(section),
    });
  }
  const handoff = topLevel(all, 21);
  if (handoff) {
    draft.summary = `Historical handoff as of 2026-09-23; verify current facts before analysis.\n${handoff.body}`;
    draft.summarySourceRef = ref(handoff);
  }
  return draft;
}

function parseNfl(text: string): ImportDraft {
  const all = sections(text);
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const draft: ImportDraft = {
    rules: [],
    events: [],
    recommendations: [],
    bets: [],
    mistakeNotes: [],
    summary: "",
    warnings: [
      "NFL 문서의 경기·진입·결과는 현재 웹 검증을 거치지 않은 과거 기록입니다.",
      "NFL 기준은 제공된 인계 문서에서 채택 상태로 가져왔습니다. 검토·정정할 수 있으며 프리시즌 카드와 미진입 후보는 실제 베팅 장부에서 제외했습니다.",
      "정확한 실제 배당·유닛이 없는 항목의 손익은 계산하지 않았습니다.",
      "프리시즌 카드의 실제 진입 여부와 현금화된 DET ML의 손익은 문서만으로 확정할 수 없어 장부에 넣지 않았습니다.",
    ],
  };

  for (const number of [1, 2, 3, 11, 12]) {
    const section = topLevel(all, number);
    if (section) {
      draft.rules.push({
        title: section.heading.replace(/^\d+\.\s*/, ""),
        content: section.body,
        status: "adopted",
        sourceRef: ref(section),
      });
    }
  }

  const regularSeason = topLevel(all, 5);
  const weekTwo = topLevel(all, 6);
  const preseason = topLevel(all, 4);
  for (const day of all.filter((section) => section.level === 2 && within(preseason, section))) {
    const lesson = all.find((section) =>
      section.level === 3 && within(day, section) && /^Lessons?$|^Key lesson$/i.test(section.heading),
    );
    if (lesson) draft.mistakeNotes.push({
      title: `${day.heading} — preseason review`,
      decisionAtTime: null,
      outcome: null,
      lesson: lesson.body,
      sourceRef: ref(lesson),
    });
  }
  const entrySections = all.filter(
    (section) =>
      /^(?:Confirmed actual entr(?:y|ies))$/i.test(section.heading) &&
      (within(regularSeason, section) || within(weekTwo, section)),
  );
  const selectionsByDay = new Map<string, { key: string; selection: string; result: string }[]>();
  for (const entry of entrySections) {
    const day = all
      .filter((section) => section.level === 2 && section.start < entry.start && section.end >= entry.end)
      .at(-1);
    const date = /Sep\s+(\d{1,2})/i.exec(day?.heading ?? entry.heading);
    const dateText = date
      ? `2026-09-${date[1].padStart(2, "0")}`
      : within(weekTwo, entry)
        ? "2026-09-20"
        : null;
    if (!dateText) continue;
    for (let lineIndex = entry.start + 1; lineIndex <= entry.end; lineIndex++) {
      const line = lines[lineIndex];
      if (entry.level === 2 && /^Final:/i.test(line.trim())) break;
      const bold = /^\s*-\s*\*\*(.+?)\*\*/.exec(line)?.[1];
      if (!bold || (!/[✅❌]/u.test(bold) && !/actual entry confirmed/i.test(bold))) continue;
      const selection = bold.replace(/\s*[✅❌]\s*$/u, "").replace(/\s*[—–]\s*actual entry confirmed$/i, "").trim();
      const key = eventKey(dateText, selection);
      const sourceRef = `L${lineIndex + 1}: ${day?.heading ?? entry.heading}`;
      const result = bold.includes("✅")
        ? "won"
        : bold.includes("❌") || (within(weekTwo, entry) && /JAX\s*\+2\.5\s*❌/u.test(weekTwo?.body ?? ""))
          ? "lost"
          : "unknown";
      const stakeText = /[—–-]\s*(\d+(?:\.\d+)?)u\b/i.exec(selection)?.[1];
      const stakeUnits = stakeText === undefined ? null : Number(stakeText);
      const explicitOdds = /(?:^|\s)([+-]\d{3,4})(?=\s|\s*[—–]|$)/.exec(selection)?.[1];
      const executedPrice = /boost|Early Win|7-Up/i.test(selection)
        ? null
        : explicitOdds === undefined
          ? null
          : Number(explicitOdds);
      const market = /\bML\b/i.test(selection)
        ? "Moneyline"
        : /rushing|receiving|passing/i.test(selection)
          ? "Player prop"
          : /\bU\d|\bUnder\b/i.test(selection)
            ? "Total under"
            : /\bO\d|\bOver\b/i.test(selection)
              ? "Total over"
              : "Spread";
      draft.events.push({
        eventKey: key,
        label: `${selection} (${dateText})`,
        analysisStatus: "BET",
        gameStatus: "unknown",
        notes: `Confirmed actual entry in imported NFL handoff. Imported result: ${result}. Result has not been independently verified. ${stakeUnits === null ? "Actual stake in units unconfirmed." : ""}`,
        sourceRef,
      });
      draft.bets.push({
        eventKey: key,
        market,
        selection,
        stakeUnits,
        executedPrice,
        result,
        profitUnits: null,
        sourceRef,
      });
      const list = selectionsByDay.get(dateText) ?? [];
      list.push({ key, selection, result });
      selectionsByDay.set(dateText, list);
    }
  }

  const addMistake = (
    section: Section,
    title: string,
    day: string,
    selectionHint?: string,
  ) => {
    const items = selectionsByDay.get(day) ?? [];
    const target = selectionHint
      ? items.find((item) => item.selection.toUpperCase().startsWith(selectionHint.toUpperCase()))
      : items[0];
    draft.mistakeNotes.push({
      eventKey: target?.key,
      title,
      decisionAtTime: target?.selection ?? null,
      outcome: target?.result ?? null,
      lesson: section.body,
      sourceRef: ref(section),
    });
  };
  for (const daySection of all.filter((section) => section.level === 2 && within(regularSeason, section))) {
    const day = /Sep\s+(\d{1,2})/i.exec(daySection.heading)?.[1];
    if (!day) continue;
    const dateText = `2026-09-${day.padStart(2, "0")}`;
    const lesson = all.find((section) => section.level === 3 && within(daySection, section) && /^Lessons$|^Early Win$/i.test(section.heading));
    if (!lesson) continue;
    if (day === "13") {
      // The source uses level-four headings for each pick; retain each lesson's exact line range.
      const headings = lines.flatMap((line, index) =>
        index > lesson.start && index <= lesson.end && /^####\s+(MIN|HOU|TB|DAL)(?:\s+.*)?$/.test(line)
          ? [{ index, team: /^####\s+(MIN|HOU|TB|DAL)/.exec(line)![1] }]
          : [],
      );
      for (const [index, heading] of headings.entries()) {
        const end = (headings[index + 1]?.index ?? lesson.end + 1) - 1;
        const body = lines.slice(heading.index + 1, end + 1).join("\n").trim();
        const target = selectionsByDay.get(dateText)?.find((item) => item.selection.startsWith(heading.team));
        draft.mistakeNotes.push({
          eventKey: target?.key,
          title: `${daySection.heading} — ${heading.team}`,
          decisionAtTime: target?.selection ?? null,
          outcome: target?.result ?? null,
          lesson: body,
          sourceRef: `L${heading.index + 1}-L${end + 1}: ${heading.team}`,
        });
      }
    } else {
      addMistake(
        lesson,
        daySection.heading,
        dateText,
        lesson.heading === "Early Win" ? "DET ML" : undefined,
      );
    }
  }
  if (weekTwo) {
    for (const heading of ["JAX postmortem", "CIN", "ARI"]) {
      const note = all.find((section) => within(weekTwo, section) && section.heading === heading);
      if (note) addMistake(note, `Sep 20 — ${heading}`, "2026-09-20", heading === "JAX postmortem" ? "JAX" : heading);
    }
    const nonEntries = all.find((section) => within(weekTwo, section) && section.heading === "Important note");
    for (const candidate of [
      { team: "CIN", opponent: "HOU", selection: "CIN +2.5" },
      { team: "ARI", opponent: "SEA", selection: "ARI +4.5" },
    ]) {
      const note = all.find((section) => within(weekTwo, section) && section.heading === candidate.team);
      const sourceLine = nonEntries
        ? lines.findIndex((line, index) => index > nonEntries.start && index <= nonEntries.end && line.trim() === `- ${candidate.selection}`)
        : -1;
      if (!note || sourceLine < 0 || !note.body.includes(candidate.opponent)) continue;
      const key = eventKey("2026-09-20", `${candidate.team} @ ${candidate.opponent}`);
      draft.events.push({
        eventKey: key,
        label: `${candidate.team} @ ${candidate.opponent} — unentered historical candidate`,
        analysisStatus: "WATCH",
        gameStatus: "unknown",
        notes: `Imported conditional candidate only; no actual entry was confirmed. ${note.body}`,
        sourceRef: ref(note),
      });
      draft.recommendations.push({
        eventKey: key,
        market: "Spread",
        selection: candidate.selection,
        decision: "WATCH",
        suggestedUnits: null,
        priceGate: null,
        sourceRef: `L${sourceLine + 1}: Important note`,
      });
    }
    if (nonEntries?.body.includes("IND +6.5")) {
      draft.warnings.push("Sep 20 IND +6.5는 문서에 상대팀이 없어 별도 경기·추천 기록으로 만들지 않았습니다.");
    }
  }
  for (const number of [7, 8]) {
    const section = topLevel(all, number);
    if (!section) continue;
    const date = /Sep\s+(\d{1,2})/i.exec(section.heading)?.[1];
    if (!date) continue;
    const key = eventKey(`2026-09-${date.padStart(2, "0")}`, section.heading);
    draft.events.push({
      eventKey: key,
      label: section.heading,
      analysisStatus: "PASS",
      gameStatus: "unknown",
      notes: section.body,
      sourceRef: ref(section),
    });
    const lesson = all.find((item) => within(section, item) && /Key lessons|Important analysis notes/i.test(item.heading));
    if (lesson) draft.mistakeNotes.push({
      eventKey: key,
      title: section.heading,
      decisionAtTime: "PASS all markets; no confirmed actual bet",
      outcome: null,
      lesson: lesson.body,
      sourceRef: ref(lesson),
    });
  }

  const future = topLevel(all, 9);
  const openBet = all.find((section) => within(future, section) && /Detroit Lions O10\.5 Wins/i.test(section.heading));
  if (openBet && /\bOPEN\b/.test(openBet.body)) {
    const key = eventKey("2026", "detroit-lions-over-10-5-wins");
    draft.events.push({
      eventKey: key,
      label: "Detroit Lions over 10.5 regular-season wins",
      analysisStatus: "BET",
      gameStatus: "unknown",
      notes: "Imported open long-term bet; selected by user per handoff. Actual price and stake were not recorded. Do not settle before season conclusion.",
      sourceRef: ref(openBet),
    });
    draft.bets.push({
      eventKey: key,
      market: "Season win total",
      selection: openBet.heading,
      stakeUnits: null,
      executedPrice: null,
      result: "unknown",
      profitUnits: null,
      sourceRef: ref(openBet),
    });
  }

  const continuation = topLevel(all, 13);
  if (continuation) {
    draft.events.push({
      eventKey: eventKey("2026-09-27", "nfl-week-3-slate"),
      label: "NFL Sep 27, 2026 slate",
      analysisStatus: "WATCH",
      gameStatus: "unknown",
      notes: "Imported continuation request only. No analysis was completed; schedule, injuries, odds, and game status require current verification.",
      sourceRef: ref(continuation),
    });
    draft.summary = "Imported NFL handoff through 2026-09-25. The Sep 27 Week 3 evaluation was requested in the previous conversation but not completed. Current schedule, injuries, odds, and game status require fresh verification. The imported regular-season record states 7 wins and 8 losses on 15 confirmed entries; exact aggregate profit is unknown. The Detroit over 10.5 wins future is open with actual price and stake unconfirmed.";
    draft.summarySourceRef = ref(continuation);
  }
  return draft;
}

function parseTennis(text: string): ImportDraft {
  const all = sections(text);
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const draft: ImportDraft = {
    rules: [], events: [], recommendations: [], bets: [], mistakeNotes: [],
    summary: "", warnings: [
      "테니스 문서의 경기·결과·가격은 가져온 과거 기록이며 최신 웹 검증 결과가 아닙니다.",
      "매수 기준 가격은 실제 체결 배당이 아닙니다. 명시되지 않은 체결가·실제 유닛·손익은 비워 두었습니다.",
      "8월 및 예선 결과는 사용자 실제 진입 확인이 부족해 실제 베팅 장부에 넣지 않았습니다.",
      "Laver Cup의 시장 가용성은 문서 작성 당시의 주장으로만 보관하고 현재 사실·채택 규칙으로 가져오지 않았습니다.",
    ],
  };
  for (const number of [1, 2, 3, 4, 8, 9, 10]) {
    const section = topLevel(all, number);
    if (section) draft.rules.push({
      title: section.heading.replace(/^\d+\.\s*/, ""),
      content: section.body,
      status: "adopted", sourceRef: ref(section),
    });
  }
  const dated = (date: string, selection: string) => eventKey(date, selection);
  const addBet = (date: string, selection: string, lineIndex: number, result: string, opts?: {
    stake?: number | null; price?: number | null; note?: string; evidenceRef?: string;
  }) => {
    const key = dated(date, selection);
    const sourceRef = `L${lineIndex + 1}: confirmed historical entry${opts?.evidenceRef ? `; ${opts.evidenceRef}` : ""}`;
    const stake = opts?.stake === undefined
      ? Number(/(?:^|\s|[—–])([0-9]+(?:\.[0-9]+)?)u\b/i.exec(selection)?.[1] ?? NaN)
      : opts.stake;
    const market = /\bML\b/i.test(selection) ? "Moneyline"
      : /\b(?:O\d+(?:\.\d+)?|U\d+(?:\.\d+)?|Over|Under)\b/i.test(selection) ? "Total"
      : /\bSets?\b/i.test(selection) ? "Set market"
      : /\bGames?\b/i.test(selection) ? "Game spread" : "Unknown";
    draft.events.push({ eventKey: key, label: `${selection} (${date})`,
      analysisStatus: "BET", gameStatus: "unknown",
      notes: `Imported confirmed entry. Settlement is from the handoff, not independently verified. ${opts?.note ?? ""}`,
      sourceRef });
    draft.bets.push({ eventKey: key, market, selection,
      stakeUnits: stake === null || !Number.isFinite(stake) ? null : stake,
      executedPrice: opts?.price ?? null, result, profitUnits: null, sourceRef });
  };

  // Only day headings that explicitly say the user entered, or label the card actual,
  // qualify for the historical betting ledger. Qualifying/August results lack that confirmation.
  const history = topLevel(all, 5);
  for (const day of all.filter((s) => s.level === 2 && within(history, s))) {
    const dateMatch = /^(?:Sep\s+)(\d{1,2})/.exec(day.heading);
    if (!dateMatch || !/User entered|\bactual\b/i.test(day.body + " " + day.heading) || /paper/i.test(day.heading)) continue;
    const date = `2026-09-${dateMatch[1].padStart(2, "0")}`;
    for (let i = day.start + 1; i <= day.end; i++) {
      const line = lines[i];
      if (!/^(?:- |\d+\. )/.test(line) || !/[✅❌]/u.test(line)) continue;
      if (/\b(?:passed|fade|PASS|paper)\b/i.test(line)) continue;
      const selection = line.replace(/^(?:- |\d+\. )/, "").replace(/\s*[✅❌].*$/u, "").trim();
      if (!/\d+(?:\.\d+)?u\b/i.test(selection)) continue;
      addBet(date, selection, i, line.includes("✅") ? "won" : "lost");
    }
  }
  const gap = topLevel(all, 6);
  if (gap && /All four Sep 8 recommendations were actual entered bets/.test(gap.body)) {
    const confirmation = lines.findIndex((line, i) => i > gap.start && i <= gap.end && /All four Sep 8 recommendations were actual entered bets/.test(line));
    const gapEvidence = `L${Math.min(gap.start + 3, confirmation + 1)}-L${Math.min(gap.end + 1, confirmation + 3)}: four entries confirmed; ticket details missing`;
    for (let n = 1; n <= 4; n++) {
      addBet("2026-09-08", `Unknown Sep 8 QF ticket ${n}`, confirmation,
        "unknown", { stake: null, evidenceRef: gapEvidence, note: "Four entries confirmed as a group; exact match, market, line, stake and result per ticket are unrecoverable." });
    }
  }

  const ledger = topLevel(all, 7);
  for (const day of all.filter((s) => s.level === 2 && within(ledger, s))) {
    const dateMatch = /^Sep\s+(\d{1,2})/.exec(day.heading);
    if (!dateMatch || !/Actual|entered|confirmed|transition/i.test(day.heading + " " + day.body)) continue;
    const date = `2026-09-${dateMatch[1].padStart(2, "0")}`;
    for (let i = day.start + 1; i <= day.end; i++) {
      const line = lines[i];
      const selection = /\*\*(.+?)\*\*/.exec(line)?.[1];
      if (!selection || !/^(?:- |\d+\. )/.test(line)) continue;
      if (/\b(?:PASS|LOSS|WIN|profit|Existing|not entered)\b/i.test(line)) continue;
      if (!/\bML\b|\bSets?\b|\bGames?\b|\bO\d/i.test(selection)) continue;
      if (date === "2026-09-25") continue;
      if (date === "2026-09-17" && /^3\./.test(line)) continue;
      let result = line.includes("✅") ? "won" : line.includes("❌") ? "lost" : "unknown";
      if (/Khachanov|Kostyuk/.test(selection)) result = "unknown";
      if (date === "2026-09-09" && /Gauff|Zverev/.test(selection)) result = "won";
      if (/Tiafoe/.test(selection)) result = "lost";
      if (/Stearns ML \+277/.test(selection)) result = "lost";
      if (/Podoroska ML/.test(selection)) result = "won";
      if (date === "2026-09-15" && /Claire Liu/.test(selection)) result = "lost";
      const explicitPrice = /(?:Zverev ML -138|Podoroska ML -120|Stearns ML \+277|Over 2\.5 Sets \+115)/.test(selection)
        ? Number(/([+-]\d{3,4})/.exec(selection)?.[1]) : null;
      const stake = /Tiafoe|Stearns ML \+277/.test(selection) ? null : undefined;
      // Claire Liu was entered Sep 15 and moved to Sep 16; keep the original ticket once.
      if (date === "2026-09-16" && /Claire Liu/.test(selection)) continue;
      if (date === "2026-09-15" && /Podoroska/.test(selection)) continue;
      const resultEvidence = date === "2026-09-15" && /Claire Liu/.test(selection)
        ? all.find((s) => s.level === 2 && within(ledger, s) && /^Sep 16/.test(s.heading))
        : day;
      addBet(date, selection, i, result, { stake, price: explicitPrice,
        evidenceRef: resultEvidence ? ref(resultEvidence) : undefined,
        note: /Khachanov|Kostyuk/.test(selection) ? "Sportsbook settlement unconfirmed." : "" });
    }
  }
  const state = all.find((s) => s.level === 2 && /^Sep 25 status/.test(s.heading));
  if (state) {
    for (const item of [
      { label: "Botic match", status: "WAIT", game: "live", needle: "Botic ML -178", detail: "Botic match was already live" },
      { label: "Wang Xinyu match", status: "PASS", game: "final", needle: "Wang Xinyu ML -208", detail: "Wang Xinyu lost" },
      { label: "Preston–Korneeva", status: "WAIT", game: "postponed", needle: "Preston ML +257", detail: "Preston–Korneeva still rescheduled" },
      { label: "Volynets–Birrell", status: "WAIT", game: "postponed", needle: "Volynets–Birrell remained suspended", detail: "Volynets–Birrell suspended" },
    ]) {
      const lineIndex = lines.findIndex((line, i) => i > state.start && i <= state.end && line.includes(item.needle));
      if (lineIndex < 0) continue;
      const detailIndex = lines.findIndex((line, i) => i > state.start && i <= state.end && line.includes(item.detail));
      const priorIndex = item.label === "Volynets–Birrell"
        ? lines.findIndex((line) => line.includes("Volynets–Birrell suspended") && line.includes("6-2"))
        : -1;
      const eligibility = item.label === "Botic match"
        ? "Already live at recheck; excluded from pre-match recommendations."
        : item.label === "Volynets–Birrell"
          ? "Match had started and was suspended; not eligible for a fresh pre-match pick."
          : "";
      draft.events.push({ eventKey: dated("2026-09-25", item.label), label: item.label,
        analysisStatus: item.status, gameStatus: item.game,
        notes: `Imported source snapshot as of Sep 25 ~11:02 ET, not current verification. ${lines[lineIndex].trim()} ${detailIndex >= 0 && detailIndex !== lineIndex ? lines[detailIndex].trim() : ""} ${priorIndex >= 0 ? lines[priorIndex].trim() : ""} No actual entry confirmed. ${eligibility}`,
        sourceRef: `L${lineIndex + 1}${detailIndex >= 0 && detailIndex !== lineIndex ? `; L${detailIndex + 1}` : ""}${priorIndex >= 0 ? `; L${priorIndex + 1}` : ""}: ${state.heading}` });
    }
  }
  for (const number of [3, 8]) {
    const parent = topLevel(all, number);
    for (const section of all.filter((s) => s.level === 2 && within(parent, s))) {
      draft.mistakeNotes.push({ title: section.heading, decisionAtTime: null,
        outcome: null, lesson: section.body, sourceRef: ref(section) });
    }
  }
  draft.summary = "Imported tennis handoff through Sep 25, 2026. Sep 25 entries were not confirmed. Preston–Korneeva was pending and Volynets–Birrell suspended in the source snapshot; verify current status. The source claimed Laver Cup was unavailable in the user's app at the time; current market availability has not been verified by this import. Imported results and sportsbook settlements are not current web verification.";
  draft.summarySourceRef = state ? ref(state) : undefined;
  return draft;
}

function parseSoccer(text: string): ImportDraft {
  const all = sections(text);
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const draft: ImportDraft = {
    rules: [], events: [], recommendations: [], bets: [], mistakeNotes: [],
    summary: "", warnings: [
      "축구 인계 문서의 경기·배당·결과는 가져온 과거 기록이며 최신 웹 검증 결과가 아닙니다.",
      "조회 가격·추천 유닛·부스터 한도는 실제 체결 가격·베팅액이 아닙니다. 미확인 손익은 계산하지 않았습니다.",
      "9/25 후보 및 Spain +140은 사용자 진입이 확인되지 않아 실제 베팅 장부에서 제외했습니다.",
    ],
  };
  const numbered = (number: number) => all.find((s) => s.level === 2 && s.heading.startsWith(`${number}.`));
  const firstLine = (part: Section | undefined, needle: string) => {
    if (!part) return -1;
    return lines.findIndex((line, i) => i > part.start && i <= part.end && line.includes(needle));
  };
  const lineRef = (index: number, label: string) => `L${index + 1}: ${label}`;
  const indexedSources = (...ids: string[]) => ids.flatMap((id) => {
    const part = all.find((s) => s.level === 3 && s.heading.startsWith(`${id} `));
    return part ? [`${ref(part)}\n${part.body}`] : [];
  }).join("\n");
  const citedIds = (body: string) => {
    const ids = new Set(Array.from(body.matchAll(/\[S(\d{2})\]/g), (match) => Number(match[1])));
    for (const range of body.matchAll(/\[S(\d{2})\]~\[S(\d{2})\]/g)) {
      for (let n = Number(range[1]); n <= Number(range[2]); n++) ids.add(n);
    }
    return [...ids].sort((a, b) => a - b).map((n) => `S${String(n).padStart(2, "0")}`);
  };
  const latestCorrection = all.find((s) => s.level === 3 && s.heading.startsWith("0.2"));
  for (const part of [numbered(1), numbered(2), latestCorrection]) {
    if (!part) continue;
    draft.rules.push({
      title: part.heading.replace(/^\d+(?:\.\d+)?\.\s*/, ""),
      content: part.body,
      status: "adopted",
      sourceRef: ref(part),
    });
  }

  const ledger = all.find((s) => s.level === 3 && s.heading.startsWith("3.1"));
  const older = numbered(8);
  const entries = [
    { section: ledger, needle: "Arsenal ML @ Brighton", date: "2026-09-19", label: "Brighton–Arsenal", selection: "Arsenal ML", result: "lost", stake: null, price: null, profit: null, game: "final" },
    { section: ledger, needle: "Liverpool ML @ Bournemouth", date: "2026-09-20", label: "Bournemouth–Liverpool", selection: "Liverpool ML", result: "won", stake: null, price: 127, profit: null, game: "final" },
    { section: older, needle: "Villarreal ML +117 @ Málaga", date: "2026-09-17", label: "Málaga–Villarreal", selection: "Villarreal ML", result: "won", stake: .25, price: 117, profit: .2925, game: "final" },
    { section: older, needle: "Racing +3.25 +106 @ Barcelona", date: "2026-09-16", label: "Barcelona–Racing", selection: "Racing +3.25", result: "lost", stake: .25, price: 106, profit: -.25, game: "final" },
    { section: older, needle: "Levante +0.25 -105", date: "2026-09-16", label: "Levante +0.25 (opponent unconfirmed)", selection: "Levante +0.25", result: "unknown", stake: .25, price: -105, profit: null, game: "postponed" },
  ] as const;
  for (const entry of entries) {
    const i = firstLine(entry.section, entry.needle);
    if (i < 0 || !lines[i].trim().startsWith("|")) continue;
    const key = eventKey(entry.date, entry.label);
    const sourceRef = lineRef(i, entry.section?.heading ?? "historical ledger");
    draft.events.push({ eventKey: key, label: `${entry.label} (${entry.date})`,
      analysisStatus: "BET", gameStatus: entry.game,
      notes: `Historical confirmed entry from imported handoff. ${lines[i].trim()} The reported result/settlement has not been independently verified.`,
      sourceRef });
    draft.bets.push({ eventKey: key, market: entry.selection.includes("ML") ? "Moneyline" : "Asian handicap",
      selection: entry.selection, stakeUnits: entry.stake, executedPrice: entry.price,
      result: entry.result, profitUnits: entry.profit, sourceRef });
  }

  const current = all.find((s) => s.level === 3 && s.heading.startsWith("0.1"));
  const currentCandidates = [
    { needle: "Türkiye–France / France ML", label: "Türkiye–France", selection: "France ML", price: "-340", status: "PASS", detail: "4.1", sources: ["S19"] },
    { needle: "Louisville–San Diego / San Diego 여자 ML", label: "Louisville–San Diego Wave W", selection: "San Diego Wave W ML", price: "-130", status: "PASS", detail: "4.2", sources: ["S21", "S22"] },
    { needle: "Atlante–Monterrey / Monterrey ML", label: "Atlante–Monterrey", selection: "Monterrey ML", price: "+105", status: "WAIT", detail: "4.3", sources: ["S23"] },
    { needle: "Tijuana–Atlas / Tijuana ML", label: "Tijuana–Atlas", selection: "Tijuana ML", price: "+105", status: "PASS", detail: "4.4", sources: ["S24"] },
    { needle: "Seattle Reign–Boston / Seattle Reign 여자 ML", label: "Seattle Reign W–Boston Legacy W", selection: "Seattle Reign W ML", price: "-110", status: "PASS", detail: "4.5", sources: ["S20", "S21"] },
  ] as const;
  for (const item of currentCandidates) {
    const i = firstLine(current, item.needle);
    if (i < 0 || !lines[i].trim().startsWith("|")) continue;
    const key = eventKey("2026-09-25", item.label);
    const detail = all.find((s) => s.level === 3 && s.heading.startsWith(item.detail));
    const sourceRef = `${lineRef(i, current?.heading ?? "current snapshot")}${detail ? `; ${ref(detail)}` : ""}`;
    draft.events.push({ eventKey: key, label: item.label, analysisStatus: item.status,
      gameStatus: "unknown", notes: `Imported 9/25 historical snapshot, not live verification. User-quoted price ${item.price}; no confirmed entry. ${lines[i].trim()}\n${detail?.body ?? ""}\nHistorical source index (not rechecked):\n${indexedSources(...item.sources)}`,
      sourceRef });
    draft.recommendations.push({ eventKey: key, market: "Moneyline", selection: item.selection,
      decision: item.status, suggestedUnits: 0, priceGate: `Historical user quote ${item.price}; not a current executable price`, sourceRef });
  }
  const spain = all.find((s) => s.level === 3 && s.heading.startsWith("5.1"));
  const spainLine = firstLine(spain, "Spain ML +140");
  if (spainLine >= 0) {
    const key = eventKey("2026-09-26", "England–Spain");
    const sourceRef = spain ? ref(spain) : lineRef(spainLine, "Spain correction");
    draft.events.push({ eventKey: key, label: "England–Spain", analysisStatus: "PASS", gameStatus: "unknown",
      notes: `Imported correction: Spain ML +140 is the latest user quote, not a fill; the later +190 recommendation was retracted. No confirmed entry. ${spain?.body ?? ""}\nHistorical source index (not rechecked):\n${indexedSources("S16", "S17")}`,
      sourceRef });
    draft.recommendations.push({ eventKey: key, market: "Moneyline", selection: "Spain ML", decision: "PASS",
      suggestedUnits: 0, priceGate: "Historical corrected user quote +140; +190 recommendation retracted", sourceRef });
  }
  const kansasCity = all.find((s) => s.level === 3 && s.heading.startsWith("5.2"));
  if (kansasCity) {
    draft.events.push({
      eventKey: eventKey("2026-09-26", "Kansas City W–Denver Summit W"),
      label: "Kansas City W–Denver Summit W",
      analysisStatus: "WAIT",
      gameStatus: "unknown",
      notes: `Imported 9/26 candidate, not live verification and no confirmed entry. The old +105 Kansas City screenshot quote is not a current executable price. ${kansasCity.body}\nHistorical source index (not rechecked):\n${indexedSources("S25")}`,
      sourceRef: ref(kansasCity),
    });
  }

  const reviews = numbered(6);
  for (const part of all.filter((s) => s.level === 3 && within(reviews, s))) {
    const citations = citedIds(part.body);
    const sourceSections = citations.flatMap((id) => {
      const source = all.find((s) => s.level === 3 && s.heading.startsWith(`${id} `));
      return source ? [source] : [];
    });
    draft.mistakeNotes.push({ title: part.heading, decisionAtTime: null,
      outcome: null,
      lesson: `${part.body}${sourceSections.length ? `\nHistorical source index (not rechecked):\n${indexedSources(...citations)}` : ""}`,
      sourceRef: [part, ...sourceSections].map(ref).join("; ") });
  }
  if (current) {
    const excluded = numbered(7);
    draft.summary = `Imported soccer handoff as of 2026-09-25. Five historical entries are confirmed in the source: Arsenal loss, Liverpool win, Villarreal win, Racing loss, and Levante postponed with sportsbook settlement unknown. Arsenal actual price/stake and Liverpool actual stake are unknown. Sep 25 France, San Diego Wave W, Monterrey, Tijuana and Seattle Reign W prices were user quotes only, with no confirmed entries. Spain ML +140 is the corrected historical quote; the +190 recommendation was retracted. Kansas City W–Denver on Sep 26 was an unapproved candidate with only an old screenshot quote; Chawinga started Sep 18 despite earlier questionable status, and Bethune/Rouse require updated checks. Seattle Reign W and Seattle Sounders are distinct teams. All game status, lineups and prices require current verification before new analysis.\nHistorical withdrawn candidates and criteria (not current BUY rules):\n${excluded?.body ?? ""}\nOlder case lessons and documented outcomes (not newly verified):\n${older?.body ?? ""}`;
    draft.summarySourceRef = [current, latestCorrection, ledger, older, spain, kansasCity, all.find((s) => s.level === 3 && s.heading.startsWith("4.5")), excluded].filter((s): s is Section => !!s).map(ref).join("; ");
  }
  return draft;
}

function parseNhl(text: string): ImportDraft {
  const all = sections(text);
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const draft: ImportDraft = {
    rules: [], events: [], recommendations: [], bets: [], mistakeNotes: [],
    summary: "", warnings: [
      "NHL 인계 문서의 경기·결과·골리 정보는 당시 기록이며 이번 가져오기에서 최신 웹 검증을 하지 않았습니다.",
      "프리시즌은 관찰만 하고 실전은 PASS·0u입니다. WATCH는 추천 또는 모의 베팅 티켓이 아닙니다.",
      "NHL 실제 진입 확인은 0건입니다. 다른 종목의 일반 유닛 기준을 NHL 권고로 적용하지 않았습니다.",
    ],
  };
  const subsection = (prefix: string) => all.find((s) => s.level === 3 && s.heading.startsWith(prefix));
  const numbered = (number: number) => all.find((s) => s.level === 2 && s.heading.startsWith(`${number}.`));
  const source = (id: string) => {
    const lineIndex = lines.findIndex((line) => line.includes(`**${id} —`));
    return lineIndex < 0 ? "" : `\nHistorical source index (not rechecked): L${lineIndex + 1} ${lines[lineIndex].trim()}`;
  };

  // These are operating rules and the explicit latest decision. The general
  // cross-sport unit table in 2.3 is deliberately not adopted for NHL.
  for (const prefix of ["2.1", "2.2", "3.1", "3.2", "3.3", "8.2"]) {
    const section = subsection(prefix);
    if (!section) continue;
    draft.rules.push({
      title: section.heading.replace(/^\d+\.\d+\s*/, ""),
      content: section.body,
      status: "adopted",
      sourceRef: ref(section),
    });
  }

  const tableRows = (section: Section | undefined) => {
    if (!section) return [] as { index: number; cells: string[] }[];
    return lines.flatMap((line, index) => {
      if (index <= section.start || index > section.end || !/^\s*\|/.test(line)) return [];
      const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
      if (cells.length < 2 || /^:?-{2,}/.test(cells[0])) return [];
      return [{ index, cells }];
    });
  };
  const current = numbered(8);
  const currentSourceIds: Record<string, string[]> = {
    "BOS @ WSH": ["S19"],
    "NYR @ NYI": ["S20", "S21"],
    "DAL @ MIN": ["S22", "S23"],
    "WPG @ COL": ["S24"],
  };
  for (const { index, cells } of tableRows(current)) {
    const [time, label, score, observation, evidence, realDecision] = cells;
    if (!/^\d{1,2}:\d{2}$/.test(time) || !label.includes("@")) continue;
    const status = /WATCH/i.test(observation) ? "WATCH" : /WAIT/i.test(observation) ? "WAIT" : null;
    if (!status) continue;
    const detail = current && all.find((s) => s.level === 3 && within(current, s) && s.heading === "8.1 경기별 해석");
    const detailLine = detail && lines.findIndex((line, i) => i > detail.start && i <= detail.end && line === `**${label}**`);
    const nextDetailLine = detailLine !== undefined && detailLine >= 0
      ? lines.findIndex((line, i) => i > detailLine && i <= (detail?.end ?? i) && /^\*\*[^*]+\*\*$/.test(line))
      : -1;
    const details = detailLine !== undefined && detailLine >= 0
      ? lines.slice(detailLine + 1, nextDetailLine >= 0 ? nextDetailLine : detail!.end + 1).join("\n").trim()
      : "";
    const key = eventKey("2026-09-25", label);
    draft.events.push({
      eventKey: key, label, analysisStatus: status, gameStatus: "unknown",
      notes: `Imported 2026-09-25 morning (~06:00 ET) observation, not current verification. Subjective observation/information-completeness score ${score}; not probability, EV or unit grade. Observation ${observation}; betting ${realDecision || "PASS·0u"}. Result unconfirmed in source. ${evidence}. Goalie/lineup and goalie time allocation require recheck. ${details}${["S18", ...(currentSourceIds[label] ?? [])].map(source).join("")}`,
      sourceRef: `L${index + 1}: ${current?.heading}${detailLine !== undefined && detailLine >= 0 ? `; L${detailLine + 1}-L${(nextDetailLine >= 0 ? nextDetailLine : detail!.end + 1)}: detail` : ""}`,
    });
  }

  const historical = [
    { section: numbered(5), date: "2026-09-23", provenance: "Previous conversation summary; individual box scores were not rechecked in source compilation." },
    { section: numbered(7), date: "2026-09-24", provenance: "Result reported in imported handoff; not reverified during import." },
  ];
  const september24Prior = new Map(tableRows(numbered(6)).map((row) => [row.cells[0], row]));
  for (const group of historical) {
    for (const { index, cells } of tableRows(group.section)) {
      const [label, result, detail, sourceIds] = cells;
      if (label === "경기" || !result || !/\d+\s*[–-]\s*\d+/.test(result)) continue;
      const normalized = label.replace(/[–—-]/g, " @ ");
      const prior = group.date === "2026-09-24" ? september24Prior.get(label) : undefined;
      draft.events.push({
        eventKey: eventKey(group.date, normalized), label: `${label} (${group.date})`,
        analysisStatus: "PASS", gameStatus: "final",
        notes: `${group.provenance} Historical observation only; betting PASS·0u, no actual or paper ticket. ${prior ? `Prior observation (2026-09-24 18:11 ET): ${prior.cells[1]}; uncertainty: ${prior.cells[2]}. ` : ""}Reported result: ${result}. ${detail}.${group.date === "2026-09-24" ? (sourceIds || "").split(/[,\s]+/).filter((id) => /^S\d{2}$/.test(id)).map(source).join("") : ""}`,
        sourceRef: `L${index + 1}: ${group.section?.heading}${prior ? `; L${prior.index + 1}: 9/24 pregame observation` : ""}`,
      });
    }
  }

  const limitations = subsection("7.1");
  if (limitations) draft.mistakeNotes.push({
    title: "9/24 통계 근거의 한계",
    decisionAtTime: "2026-09-24 preseason observations",
    outcome: "2026-09-25 morning historical review; statistics not independently reverified during import",
    lesson: limitations.body,
    sourceRef: ref(limitations),
  });
  const postmortem = subsection("7.2");
  if (postmortem) {
    const headings = lines.flatMap((line, index) => index > postmortem.start && index <= postmortem.end && /^####\s+([A-D])\.\s+(.+)$/.test(line)
      ? [{ index, match: /^####\s+([A-D])\.\s+(.+)$/.exec(line)! }] : []);
    for (const [position, heading] of headings.entries()) {
      const end = (headings[position + 1]?.index ?? postmortem.end + 1) - 1;
      const body = lines.slice(heading.index + 1, end + 1).join("\n").trim();
      const citedSources = [...new Set(Array.from(body.matchAll(/\[S(\d{2})\]/g), (match) => `S${match[1]}`))];
      draft.mistakeNotes.push({
        title: `${heading.match[1]}. ${heading.match[2]}`,
        decisionAtTime: "2026-09-24 preseason observation; no betting entry",
        outcome: "Historical 2026-09-24 game results reported in source; no betting settlement",
        lesson: `${body}${citedSources.map(source).join("")}`,
        sourceRef: `L${heading.index + 1}-L${end + 1}: ${postmortem.heading}`,
      });
    }
  }
  const injuries = subsection("7.3");
  if (injuries) draft.mistakeNotes.push({
    title: "9/25 부상 후속 확인: Lyon, Kulich, Chytil",
    decisionAtTime: "2026-09-25 early-morning source snapshot",
    outcome: null,
    lesson: `${injuries.body}\nThese are historical follow-up items, not current injury status.${source("S16")}${source("S17")}`,
    sourceRef: ref(injuries),
  });

  const latest = subsection("8.2");
  draft.summary = `Imported NHL preseason handoff as of 2026-09-25 11:51 ET, with last game research around 06:00 ET. Latest user decision was observation only, all real betting PASS·0u. Confirmed actual NHL entries: 0; confirmed paper tickets: 0. The four Sep 25 games have no confirmed results in this source. Sep 24 results and Sep 23 weaker-provenance summaries are imported history, not newly verified facts. Observation scores reflect subjective information completeness and interest, not win probability, EV or staking. Recheck schedule, lineups, goalies and TOI before further analysis. Earlier season-preparation hypotheses are historical only and require fresh team-source verification.`;
  draft.summarySourceRef = [numbered(1), numbered(4), numbered(5), numbered(7), current, latest].filter((s): s is Section => !!s).map(ref).join("; ");
  return draft;
}

function parseWnba(text: string): ImportDraft {
  const all = sections(text);
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const numbered = (number: number) => all.find((section) =>
    section.level === 2 && section.heading.startsWith(`${number}.`));
  const draft: ImportDraft = {
    rules: [], events: [], recommendations: [], bets: [], mistakeNotes: [],
    summary: "", warnings: [
      "WNBA 문서의 경기·결과·배당은 가져온 과거 기록이며 이번 가져오기에서 최신 웹 검증을 거치지 않았습니다.",
      "권장 0.25u는 실제 베팅 크기가 아닙니다. 확인되지 않은 실제 유닛·금액·손익은 비워 두었습니다.",
      "8월 후보와 가상 적중, 9월 미진입 후보는 실제 베팅 원장에 넣지 않았습니다.",
      "9월 25일 무경기 및 9월 27일 플레이오프 대진은 문서 당시의 주장입니다. 분석 전에 공식 일정과 최신 출전·배당을 재확인해야 합니다.",
    ],
  };

  for (const number of [3, 4, 5, 8]) {
    const section = numbered(number);
    if (section) draft.rules.push({
      title: section.heading.replace(/^\d+\.\s*/, ""),
      content: section.body,
      status: "adopted",
      sourceRef: ref(section),
    });
  }

  const ledger = numbered(10);
  const jsonStart = ledger && lines.findIndex((line, index) =>
    index > ledger.start && index <= ledger.end && line.trim() === "```json");
  const jsonEnd = jsonStart !== undefined && jsonStart >= 0
    ? lines.findIndex((line, index) => index > jsonStart && line.trim() === "```")
    : -1;
  type LedgerRow = {
    id: string; game_date_et: string; away: string; home: string;
    market: string; selection: string; line: number;
    entry_status: string; american_odds: number | null;
    recommended_stake_u: number | null; actual_stake_u: number | null; result: string;
    final_away_score?: number; final_home_score?: number; final_total?: number;
    cover_margin_points?: number;
  };
  let rows: LedgerRow[] = [];
  if (jsonStart !== undefined && jsonStart >= 0 && jsonEnd > jsonStart) {
    try {
      const parsed: unknown = JSON.parse(lines.slice(jsonStart + 1, jsonEnd).join("\n"));
      if (Array.isArray(parsed)) rows = parsed as LedgerRow[];
    } catch {
      draft.warnings.push("확정 원장 JSON을 읽지 못해 실제 진입을 가져오지 않았습니다. 원문을 검토하세요.");
    }
  } else {
    draft.warnings.push("확정 원장 JSON이 없어 실제 진입을 가져오지 않았습니다. 원문을 검토하세요.");
  }
  for (const row of rows.filter((item) => item.entry_status === "USER_CONFIRMED")) {
    const location = lines.findIndex((line, index) =>
      index > (jsonStart ?? -1) && index < jsonEnd && line.includes(`"id": "${row.id}"`));
    const rowEnd = lines.findIndex((line, index) =>
      index > location && index < jsonEnd && /^  \},?$/.test(line));
    const selection = row.market === "full_game_total"
      ? `${row.selection.toUpperCase() === "UNDER" ? "Under" : "Over"} ${row.line}`
      : `${row.selection} ${row.line >= 0 ? "+" : ""}${row.line}`;
    const key = eventKey(row.game_date_et, `${row.away}-${row.home}-${selection}`);
    const sourceRef = `L${location + 1}-L${rowEnd >= 0 ? rowEnd + 1 : location + 1}: ${row.id}; ${ref(numbered(2) ?? ledger!)}`;
    const review = all.find((section) => section.level === 3 &&
      section.heading.startsWith(row.game_date_et === "2026-09-18" ? "6.2 "
        : row.game_date_et === "2026-09-22" ? "6.6 " : "6.7 "));
    const importedResult = row.final_away_score !== undefined && row.final_home_score !== undefined
      ? `Imported final: ${row.away} ${row.final_away_score}–${row.final_home_score} ${row.home}${row.final_total === undefined ? "" : `, total ${row.final_total}`}.`
      : "Final score was not recorded in the machine ledger.";
    const causalCaveat = row.game_date_et === "2026-09-18"
      ? "The game under won, but NYL scored 93; opposing team-score errors offset, so the total result alone does not validate the estimate."
      : row.game_date_et === "2026-09-22"
        ? "Miles OUT was confirmed before the game; the source does not establish whether that confirmation preceded the user's entry. MIN resting most starters after an early deficit happened during the game and is a separate cause."
        : "ATL +1.5 was entered assuming Stewart could play; Stewart OUT was confirmed later. Jonquel Jones was injured and Reese exited during the game, so NYL's 65 points cannot be attributed to Stewart alone.";
    const coverMargin = row.cover_margin_points === undefined ? ""
      : ` Imported cover margin: ${row.cover_margin_points} points; this is a result margin, not a pregame edge.`;
    draft.events.push({
      eventKey: key, label: `${row.away} @ ${row.home} — ${selection} (${row.game_date_et})`,
      analysisStatus: "BET", gameStatus: "final",
      notes: `User-confirmed historical entry. ${importedResult}${coverMargin} ${causalCaveat} The reported result was checked in the prior conversation, not independently re-fetched for this handoff. Actual stake and profit are unconfirmed.${review ? ` Postmortem source: ${ref(review)}.` : ""}`,
      sourceRef: `${sourceRef}${review ? `; ${ref(review)}` : ""}`,
    });
    draft.bets.push({
      eventKey: key,
      market: row.market === "full_game_total" ? "Game total" : "Spread",
      selection,
      stakeUnits: row.actual_stake_u,
      executedPrice: row.american_odds,
      result: row.result === "WIN" ? "won" : row.result === "LOSS" ? "lost" : "unknown",
      profitUnits: null,
      sourceRef,
    });
    draft.recommendations.push({
      eventKey: key,
      market: row.market === "full_game_total" ? "Game total" : "Spread",
      selection,
      decision: "BET",
      suggestedUnits: row.recommended_stake_u,
      priceGate: null,
      sourceRef,
    });
  }

  const history = numbered(6);
  const candidateSpecs = [
    { date: "2026-08-25", game: "CHI–CON", selection: "Game Under 169.5", units: 0.5, state: "BET", hint: "CHI–CON U169.5" },
    { date: "2026-08-25", game: "PDX–DAL", selection: "Game Under 177.5", units: 0.5, state: "BET", hint: "PDX–DAL U177.5" },
    { date: "2026-08-26", game: "GSV–CON", selection: "Game Under 151.5", units: 0.5, state: "BET", hint: "Game U151.5 0.5u" },
    { date: "2026-08-28", game: "CON–IND", selection: "CON Team Total Under 80.5", units: null, state: "BET", hint: "CON TT U80.5 추천" },
    { date: "2026-08-28", game: "LAS–WAS", selection: "LAS +5", units: null, state: "BET", hint: "LAS +5 추천" },
    { date: "2026-08-29", game: "TOR–PHX", selection: "Game Under 180.5", units: null, state: "BET", hint: "U180.5 추천" },
    { date: "2026-08-30", game: "MIN–ATL", selection: "MIN -2.5", units: 0.5, state: "WATCH", hint: "MIN -2.5" },
    { date: "2026-08-30", game: "GSV–PDX", selection: "Game Under 158.5", units: 0.5, state: "WATCH", hint: "GSV–PDX U158.5" },
    { date: "2026-09-20", game: "WAS @ IND", selection: "WAS +6.5", units: 0, state: "PASS", hint: "최종 PASS/0u로 철회" },
    { date: "2026-09-20", game: "PDX @ LAS", selection: "PDX +1.5", units: null, state: "WAIT", hint: "PDX +1.5 이상" },
  ] as const;
  for (const item of candidateSpecs) {
    const index = lines.findIndex((line, lineIndex) =>
      !!history && lineIndex > history.start && lineIndex <= history.end && line.includes(item.hint));
    if (index < 0) continue;
    const key = eventKey(item.date, item.game);
    const sourceRef = `L${index + 1}: ${item.game} historical recommendation`;
    const isWithdrawn = item.state === "PASS";
    draft.events.push({
      eventKey: key, label: `${item.game} (${item.date})`,
      analysisStatus: item.state, gameStatus: "unknown",
      notes: `${isWithdrawn ? "Historical candidate withdrawn to final PASS/0u." : "Historical unentered candidate/recommendation only."} No user-confirmed entry; reported or hypothetical result is not a betting settlement. ${lines[index].trim()}`,
      sourceRef,
    });
    draft.recommendations.push({
      eventKey: key,
      market: /Team Total/.test(item.selection) ? "Team total" : /Under|Over/.test(item.selection) ? "Game total" : "Spread",
      selection: item.selection,
      decision: item.state,
      suggestedUnits: item.units,
      priceGate: item.selection === "WAS +6.5" || item.selection === "PDX +1.5" ? "-110 or better (historical only)" : null,
      sourceRef,
    });
  }

  const mistakes = numbered(7);
  if (mistakes) {
    for (let index = mistakes.start + 1; index <= mistakes.end; index++) {
      const cells = lines[index].split("|").slice(1, -1).map((cell) => cell.trim());
      if (cells.length !== 2 || !cells[0] || cells[0] === "과거 문제" || /^-+$/.test(cells[0])) continue;
      draft.mistakeNotes.push({
        title: cells[0], decisionAtTime: cells[0], outcome: null,
        lesson: cells[1], sourceRef: `L${index + 1}: ${mistakes.heading}`,
      });
    }
  }

  const future = numbered(9);
  if (future) {
    const series = ["MIN–NYL", "GSV–DAL", "LVA–IND", "ATL–WAS"];
    for (const label of series) {
      const index = lines.findIndex((line, lineIndex) =>
        lineIndex > future.start && lineIndex <= future.end && line.includes(`| ${label} |`));
      if (index < 0) continue;
      draft.events.push({
        eventKey: eventKey("2026-09-27", label), label: `${label} playoff series — historical schedule claim`,
        analysisStatus: "WAIT", gameStatus: "unknown",
        notes: "Imported Sep 25 claim of a Sep 27 playoff series only. Official schedule, matchup, start time, format, injuries and current markets must be freshly verified. No current selection or entry.",
        sourceRef: `L${index + 1}: ${future.heading}`,
      });
    }
  }
  const summary = numbered(1);
  draft.summary = "WNBA handoff through 2026-09-25: three user-confirmed historical winning entries, all with actual stake and profit unknown. Only Sep 22 -110 and Sep 23 +100 executed prices are recorded; Sep 18 price is unknown. August candidate outcomes and Sep 19–23 hypothetical comparisons are not actual bets. No active unfilled recommendation carries into the playoffs. Sep 25 no-game and Sep 27 series statements are historical claims requiring fresh official verification. Do not treat prior injury, lineup or odds details as current.";
  draft.summarySourceRef = [summary, numbered(2), history, future, ledger].filter((section): section is Section => !!section).map(ref).join("; ");
  return draft;
}

function parseNba(): ImportDraft {
  return {
    rules: [],
    events: [],
    recommendations: [],
    bets: [],
    mistakeNotes: [],
    summary: "The NBA source text remains saved as an import document for review. No historical entry, settlement, current schedule, lineup, injury, or price was inferred by this import.",
    summarySourceRef: "Original NBA source document retained verbatim",
    warnings: [
      "No NBA recommendation is imported as an actual entry without an explicit user-confirmed ledger row.",
      "Review the retained source text; its historical facts are not current web verification.",
    ],
  };
}

function parseCfb(text: string): ImportDraft {
  const all = sections(text);
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const numberedSection = (number: number) =>
    all.find((section) => section.heading.startsWith(`${number}.`));
  const draft: ImportDraft = {
    rules: [],
    events: [],
    recommendations: [],
    bets: [],
    mistakeNotes: [],
    summary: "",
    warnings: [
      "CFB handoff의 경기·가격·결과는 과거 기록이며 현재 웹 검증을 거치지 않았습니다.",
      "확인된 22개 실제 티켓만 베팅 장부에 넣었습니다. 추천, PASS, WAIT, 미확인 진입은 실제 베팅으로 세지 않았습니다.",
      "달러 금액은 1u 환산값이 없어 stakeUnits로 변환하지 않았고, 부스터 적용 후 배당·정산 손익을 추정하지 않았습니다.",
      "9/25 상태는 마지막 재확인 표를 우선했습니다. 이 파일 밖의 결과와 진입은 추가하지 않았습니다.",
    ],
  };

  // These sections state the CFB rules and operating preferences carried forward.
  for (const number of [1, 5, 6, 7, 11, 12]) {
    const section = numberedSection(number);
    if (!section) continue;
    draft.rules.push({
      title: section.heading.replace(/^\d+\.\s*/, ""),
      content: section.body,
      status: "adopted",
      sourceRef: ref(section),
    });
  }
  const processEvolution = numberedSection(5);
  for (const lesson of all.filter(
    (section) =>
      section.level === 2 &&
      within(processEvolution, section) &&
      /^[A-Q]\.\s/.test(section.heading),
  )) {
    draft.mistakeNotes.push({
      title: lesson.heading,
      decisionAtTime: null,
      outcome: null,
      lesson: lesson.body,
      sourceRef: ref(lesson),
    });
  }

  const ledger = numberedSection(2);
  const ledgerDays = all.filter(
    (section) =>
      section.level === 2 &&
      within(ledger, section) &&
      /^September\s+\d+/i.test(section.heading),
  );
  for (const day of ledgerDays) {
    const datePart = /September\s+(\d+)/i.exec(day.heading)?.[1];
    if (!datePart) continue;
    const date = `2026-09-${datePart.padStart(2, "0")}`;
    for (let lineIndex = day.start + 1; lineIndex <= day.end; lineIndex++) {
      const line = lines[lineIndex];
      if (!/^\s*\|/.test(line) || /^\s*\|\s*:?-+/.test(line)) continue;
      const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
      if (cells.length < 3 || /^(?:bet|selection)$/i.test(cells[0])) continue;
      const selection = cells[0];
      const stakeText = cells[1];
      const resultText = cells.find((cell) => /[✅❌]/u.test(cell));
      const boostText = cells.find((cell) => /\d+%/.test(cell)) ?? null;
      const resultIndex = resultText ? cells.indexOf(resultText) : -1;
      const rowNotes = resultIndex >= 0 ? cells.slice(resultIndex + 1).join(" | ").trim() : "";
      if (!resultText) continue;
      if (!/[✅❌]/u.test(resultText)) continue;
      const key = eventKey(date, selection);
      const result = /✅/u.test(resultText) ? "won" : "lost";
      const stakeMatch = /^(\d+(?:\.\d+)?)\s*u$/i.exec(stakeText);
      const odds = /(?:^|\s)([+-]\d{3,4})(?=\s|$)/.exec(selection)?.[1];
      const market = /\b1H\b/i.test(selection)
        ? "1st half spread"
        : /\bTT\b|team total/i.test(selection)
          ? /\bU\d|under/i.test(selection) ? "Team total under" : "Team total over"
          : /\bU\d|under/i.test(selection)
            ? "Total under"
            : /\bO\d|over/i.test(selection)
              ? "Total over"
              : /\bML\b/i.test(selection)
                ? "Moneyline"
                : "Spread";
      const dollarStake = /^\$\d+(?:\.\d+)?$/.test(stakeText);
      draft.events.push({
        eventKey: key,
        label: `${selection} (${date})`,
        analysisStatus: "BET",
        gameStatus: "final",
        notes: `User-confirmed historical CFB entry. Imported result: ${result}. ${stakeMatch ? `Stake recorded as ${stakeMatch[1]}u.` : dollarStake ? `Dollar stake ${stakeText} retained in the imported raw handoff; actual units are unknown.` : "Actual stake is unknown."} ${boostText ? `${boostText} boost; boosted payout and profit are not inferred.` : "Result and fill details are historical handoff claims, not independently re-verified."}${rowNotes ? ` Source row note: ${rowNotes}` : ""}`,
        sourceRef: `L${lineIndex + 1}: ${day.heading}`,
      });
      draft.bets.push({
        eventKey: key,
        market,
        selection,
        stakeUnits: stakeMatch ? Number(stakeMatch[1]) : null,
        executedPrice: odds === undefined ? null : Number(odds),
        result,
        profitUnits: null,
        sourceRef: `L${lineIndex + 1}: ${day.heading}`,
      });
    }
    const dayNotes = day.body
      .split("\n")
      .filter((line) => !/^\s*\|/.test(line) && line.trim())
      .join("\n")
      .trim();
    if (dayNotes) {
      draft.mistakeNotes.push({
        title: `${day.heading} — ledger context and day notes`,
        decisionAtTime: null,
        outcome: null,
        lesson: dayNotes,
        sourceRef: ref(day),
      });
    }
  }

  const sep24 = all.find(
    (section) => section.level === 1 && /^8\.\s*September 24/i.test(section.heading),
  );
  if (sep24) {
    const section = all.find(
      (candidate) => candidate.level === 2 && within(sep24, candidate) && /^8\.1\s/.test(candidate.heading),
    );
    if (section) {
      const eventDate = "2026-09-24";
      const key = eventKey(eventDate, "Liberty @ Coastal Carolina");
      const sources = all.filter(
        (candidate) => candidate.level === 2 && within(sep24, candidate) && /^8\.[345]\s/.test(candidate.heading),
      );
      draft.events.push({
        eventKey: key,
        label: "Liberty @ Coastal Carolina (2026-09-24)",
        analysisStatus: "PASS",
        gameStatus: "final",
        notes: `Historical result reported as Liberty 34–17 (51 points); pregame recommendation was PASS / 0u and user entry was not confirmed. The reported result was not independently re-fetched.${sources.length ? ` Postmortem and evidence limits: ${sources.map(ref).join("; ")}` : ""}`,
        sourceRef: ref(section),
      });
      const markets = [
        { market: "Spread", selection: "Liberty -2.5", price: "-110", source: "Liberty -2.5" },
        { market: "Spread", selection: "Coastal +2.5", price: "-110", source: "Coastal +2.5" },
        { market: "Total under", selection: "Under 49.5", price: "-110", source: "Under 49.5" },
        { market: "Total over", selection: "Over 49.5", price: "-115", source: "Over 49.5" },
      ];
      for (const item of markets) {
        const tableRow = lines.findIndex((line) => line.includes(`| ${item.source} |`));
        draft.recommendations.push({
          eventKey: key,
          market: item.market,
          selection: item.selection,
          decision: "PASS",
          suggestedUnits: 0,
          priceGate: `${item.price}; historical reference only`,
          sourceRef: tableRow >= 0 ? `L${tableRow + 1}: 8.1 경기 전 마지막 판단` : ref(section),
        });
      }
      for (const postmortem of sources) {
        if (/^8\.[34]\s/.test(postmortem.heading)) {
          draft.mistakeNotes.push({
            eventKey: key,
            title: postmortem.heading.replace(/^8\.\d+\s*/, ""),
            decisionAtTime: "PASS / 0u",
            outcome: "Liberty 34–17 Coastal Carolina; 51 total points (historical handoff claim)",
            lesson: postmortem.body,
            sourceRef: ref(postmortem),
          });
        }
      }
    }
  }

  const latest = all.find(
    (section) => section.level === 2 && /^9\.3\s/.test(section.heading),
  );
  if (latest) {
    const detailSections = all.filter(
      (section) => section.level === 2 && /^10\.\d\s/.test(section.heading),
    );
    for (let lineIndex = latest.start + 1; lineIndex <= latest.end; lineIndex++) {
      const line = lines[lineIndex];
      if (!/^\s*\|/.test(line) || /^\s*\|\s*:?-+/.test(line)) continue;
      const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
      if (cells.length < 6 || !/\d{2}:\d{2}/.test(cells[0])) continue;
      const [, rawMatchup, marketText, , statusText, unitsText] = cells;
      const matchup = rawMatchup.replace(/\*/g, "").trim();
      const teams = /(.+?)\s*@\s*(.+)/.exec(matchup);
      if (!teams) continue;
      const label = `${teams[1].trim()} @ ${teams[2].trim()}`;
      const key = eventKey("2026-09-25", label);
      const marketLine = /(?:^|\s)([+-]\d+(?:\.\d+)?)(?:,\s*([+-]\d+)(?:\s*[~–]\s*([+-]\d+))?)?/.exec(marketText);
      const selection = marketText.replace(/\*/g, "").split(/\s+[+-]\d+(?:\.\d+)?/)[0].trim();
      const decisionText = /\bWAIT\b/i.test(statusText) ? "WAIT" : "PASS";
      const detail = detailSections.find((candidate) => candidate.heading.includes(label));
      const firstEvalNote = `Latest recorded pregame status from 2026-09-25 18:37 ET; historical only. ${statusText}. Recommendation was ${unitsText}.`;
      draft.events.push({
        eventKey: key,
        label: `${label} (2026-09-25)`,
        analysisStatus: decisionText,
        gameStatus: "unknown",
        notes: `${firstEvalNote}${detail ? ` ${detail.body}` : ""}`,
        sourceRef: [`L${lineIndex + 1}: ${latest.heading}`, detail ? ref(detail) : ""].filter(Boolean).join("; "),
      });
      const odds = marketLine?.[2] && marketLine?.[3]
        ? `${marketLine[2]} to ${marketLine[3]}`
        : marketLine?.[2] ?? null;
      const selectionTeam = /^Northwestern/i.test(selection) ? "Northwestern" : /^Rutgers/i.test(selection) ? "Rutgers" : /^Navy/i.test(selection) ? "Navy" : /^Clemson/i.test(selection) ? "Clemson" : selection;
      const reconsideration = /^Northwestern/i.test(selection)
        ? "; +21.5 at -110 or better was a review condition only, not an automatic bet"
        : /^Navy/i.test(selection)
          ? "; Woodson start/usage must be confirmed; -6.5 at -110 or better was only a reevaluation condition"
          : "";
      draft.recommendations.push({
        eventKey: key,
        market: "Spread",
        selection: selectionTeam,
        decision: decisionText,
        suggestedUnits: 0,
        priceGate: `${marketLine?.[1] ?? marketText}${odds ? `, ${odds}` : ""}; historical price, not a current offer${reconsideration}`,
        sourceRef: `L${lineIndex + 1}: ${latest.heading}`,
      });
    }
  }

  const review = all.find(
    (section) => section.level === 2 && within(sep24, section) && /^8\.3\s/.test(section.heading),
  );
  if (review && draft.mistakeNotes.length === 0) {
    draft.mistakeNotes.push({
      title: review.heading,
      decisionAtTime: null,
      outcome: null,
      lesson: review.body,
      sourceRef: ref(review),
    });
  }

  const overall = numberedSection(3);
  const wins = /\*\*(\d+) wins\*\*/i.exec(overall?.body ?? "")?.[1];
  const losses = /\*\*(\d+) losses\*\*/i.exec(overall?.body ?? "")?.[1];
  const total = /\*\*(\d+) confirmed tickets total\*\*/i.exec(overall?.body ?? "")?.[1];
  const candidates = numberedSection(4);
  const bibliography = numberedSection(14);
  draft.summary = `CFB handoff dated 2026-09-26. Imported ${draft.bets.length} explicitly confirmed historical tickets${wins && losses && total ? `; source states ${wins}-${losses} across ${total} tickets` : ""}. User-confirmed entry record remains separate from recommendations. Actual dollar stakes have no established 1u conversion; incomplete exact fills and all profit/ROI remain unknown. The Sep 24 Liberty–Coastal note reports a 34–17 final score and a PASS / 0u with no confirmed entry. The latest Sep 25 snapshot is 18:37 ET: Navy and Clemson–Cal WAIT, Howard–Rutgers and Northwestern–Indiana PASS, all 0u. These are historical states, not current schedules, prices, injuries, or results. Do not run analysis or use the handoff's next-session prompt as an instruction.\n\nCandidates explicitly listed as unconfirmed, excluded from actual bets:\n${candidates?.body ?? "Not available."}\n\nHistorical source bibliography (preserved, not revalidated):\n${bibliography?.body ?? "Not available."}`;
  const summarySources = [ledger, overall, sep24, latest, candidates, bibliography].filter((section): section is Section => !!section);
  draft.summarySourceRef = summarySources.map(ref).join("; ");
  return draft;
}

export function parseImport(content: string, sportSlug: string): ImportDraft {
  if (sportSlug === "mlb") return parseMlb(content);
  if (sportSlug === "nfl") return parseNfl(content);
  if (sportSlug === "cfb") return parseCfb(content);
  if (sportSlug === "tennis") return parseTennis(content);
  if (sportSlug === "soccer") return parseSoccer(content);
  if (sportSlug === "nhl") return parseNhl(content);
  if (sportSlug === "nba") return parseNba();
  if (sportSlug === "wnba") return parseWnba(content);
  const all = sections(content);
  return {
    rules: all
      .filter((section) => section.level <= 2 && section.body)
      .map((section) => ({
        title: section.heading,
        content: section.body,
        status: "proposed" as const,
        sourceRef: ref(section),
      })),
    events: [],
    recommendations: [],
    bets: [],
    mistakeNotes: [],
    summary: "",
    warnings: [
      "자동 추출된 기준은 검토 후 채택하세요. 이 스포츠에는 MLB 규칙을 적용하지 않았습니다.",
    ],
  };
}

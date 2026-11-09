import { describe, expect, it } from "vitest";
import { extractCoverageReport, hasVisibleCoverageEventIdentity, parseStoredCoverageScope, resolveAnalysisScope, type CoverageReport } from "./coverage";

const scope = { version: 1 as const, sport: "mlb", date_et: "2026-09-30", timezone: "America/New_York" as const, mode: "daily" as const, competitions: ["MLB"], basis: "default" as const };
const sources = [{ url: "https://www.mlb.com/schedule", title: "Schedule" }];
function fixture(count = 12): CoverageReport {
  const inventory = Array.from({ length: count }, (_, n) => ({ event_key: `mlb:2026-09-30:away${n}@home${n}:id-${100 + n}`, label: `Game ${n}`, starts_at: null, competition: "MLB", source_url: sources[0].url }));
  return { version: 1, scope, inventory, assessments: inventory.map(e => ({ event_key: e.event_key, disposition: "evaluated", reason: "Current lineup reviewed" })), schedule_sources: [{ url: sources[0].url, competition: "MLB", expected_count: count }], inventory_complete: true, limitations: [] };
}
function extract(report: CoverageReport, body = report.inventory.map(e => e.label).join("\n")) {
  return extractCoverageReport(`${body}\n\`\`\`analysis-coverage\n${JSON.stringify(report)}\n\`\`\`\n\`\`\`analysis-record\n{}\n\`\`\``, scope, sources);
}

function tennisFixture(): CoverageReport {
  const report = fixture(1);
  report.scope = { ...scope, sport: "tennis", competitions: ["ATP singles main draw"] };
  report.inventory = [{ event_key: "tennis:2026-09-30:match-101", label: "Harbor Open Alex Example–Ben Sample", starts_at: null, competition: "ATP singles main draw", source_url: sources[0].url }];
  report.assessments = [{ event_key: "tennis:2026-09-30:match-101", disposition: "deferred", reason: "Lineup unavailable" }];
  report.schedule_sources = [{ url: sources[0].url, competition: "ATP singles main draw", expected_count: 1 }];
  return report;
}
function extractTennis(report: CoverageReport, body: string) {
  return extractCoverageReport(`${body}\n\`\`\`analysis-coverage\n${JSON.stringify(report)}\n\`\`\``, report.scope, sources);
}
const tennisTable = "| ID | Match |\n| --- | --- |\n";

describe("analysis coverage", () => {
  it.each(["14항목", "14경기"])("accounts for a tennis pair under its tournament heading with %s and its unique displayed ID", count => {
    const result = extractTennis(tennisFixture(), `### Challenger — Harbor Open ${count}\n\n${tennisTable}| MATCH-101 Alex Example–Ben Sample | Deferred |`);
    expect(result.validation).toMatchObject({ status: "unverified", listed_count: 1, assessed_count: 1, missing_event_keys: [] });
    expect(result.validation.reasons).not.toContain("body_inventory_missing:tennis:2026-09-30:match-101");
    expect(result.validation.reasons).toContain("independent_schedule_verification_unavailable");
  });
  it("uses the unique sectioned identity when a separate candidate recap repeats its ID", () => {
    const body = `## Candidate details\n${tennisTable}| **MATCH-101 Harbor Open Alex Example–Given Ben Sample** | Deferred |\n\n### Challenger — Harbor Open 14항목\n${tennisTable}| MATCH-101 Alex Example–Ben Sample | Deferred |`;
    expect(extractTennis(tennisFixture(), body).validation.reasons).not.toContain("body_inventory_missing:tennis:2026-09-30:match-101");
  });
  it("rejects a short ID repeated across conflicting tournament sections", () => {
    const body = `### Challenger — Harbor Open 14항목\n${tennisTable}| MATCH-101 Alex Example–Ben Sample | Deferred |\n\n### Challenger — Lake Open 14항목\n${tennisTable}| MATCH-101 Alex Example–Ben Sample | Deferred |`;
    expect(extractTennis(tennisFixture(), body).validation.reasons).toContain("body_inventory_missing:tennis:2026-09-30:match-101");
  });
  it.each([
    ["wrong tournament", "### Challenger — Lake Open 14항목\n| MATCH-101 Alex Example–Ben Sample |"],
    ["substring tournament", "### Challenger — North Harbor Open 14항목\n| MATCH-101 Alex Example–Ben Sample |"],
    ["absent row", "### Challenger — Harbor Open 14항목\nNo matches available."],
    ["ID in prose", "### Challenger — Harbor Open 14항목\nmatch-101\n| OTHER-ID Alex Example–Ben Sample |"],
    ["ID in another row", "### Challenger — Harbor Open 14항목\n| MATCH-101 Other Player–Third Player |\n| OTHER-ID Alex Example–Ben Sample |"],
    ["mismatching pair", "### Challenger — Harbor Open 14항목\n| MATCH-101 Alex Example–Other Player |"],
    ["changed participant punctuation", "### Challenger — Harbor Open 14항목\n| MATCH-101 Alex Example-Ben Sample |"],
    ["duplicate row ID", "### Challenger — Harbor Open 14항목\n| MATCH-101 Alex Example–Ben Sample |\n| MATCH-101 Other Player–Third Player |"],
    ["ID substring", "### Challenger — Harbor Open 14항목\n| MATCH-1010 Alex Example–Ben Sample |"],
    ["sibling heading", "### Challenger — Harbor Open 14항목\n### Matches\n### Challenger — Lake Open 14항목\n| MATCH-101 Alex Example–Ben Sample |"],
    ["closed ancestor heading", "### Challenger — Harbor Open 14항목\n### Matches\n# Other analysis\n| MATCH-101 Alex Example–Ben Sample |"],
    ["prose disguised as table", "### Challenger — Harbor Open 14항목\nmatch-101 | Alex Example–Ben Sample"],
    ["code fence", "```markdown\n### Challenger — Harbor Open 14항목\n| MATCH-101 Alex Example–Ben Sample |\n```"],
    ["invalid fence closer", "```markdown\n```still-code\n### Challenger — Harbor Open 14항목\n| MATCH-101 Alex Example–Ben Sample |\n```"],
  ])("does not account for a split tennis label using %s", (_name, body) => {
    expect(extractTennis(tennisFixture(), body.replace(/(?=^\|)/m, tennisTable)).validation.reasons).toContain("body_inventory_missing:tennis:2026-09-30:match-101");
  });
  it("requires an actual Markdown table instead of a standalone pipe-delimited line", () => {
    expect(extractTennis(tennisFixture(), "### Challenger — Harbor Open 14항목\n| MATCH-101 Alex Example–Ben Sample |").validation.reasons).toContain("body_inventory_missing:tennis:2026-09-30:match-101");
  });
  it.each(["    ", "\t", "  \t"])("rejects code-indented identity tables with prefix %j", indentation => {
    const report = tennisFixture();
    const table = `${tennisTable}| MATCH-101 Alex Example–Ben Sample | Deferred |`.split("\n").map(line => `${indentation}${line}`).join("\n");
    const body = `### Challenger — Harbor Open 14항목\n\n${table}`;
    expect(hasVisibleCoverageEventIdentity(body, report.inventory[0], report.inventory)).toBe(false);
  });
  it.each([
    ["indented header", `    | ID | Match |\n| --- | --- |\n| MATCH-101 Alex Example–Ben Sample | Deferred |`],
    ["indented separator", `| ID | Match |\n    | --- | --- |\n| MATCH-101 Alex Example–Ben Sample | Deferred |`],
    ["indented data row", `${tennisTable}    | MATCH-101 Alex Example–Ben Sample | Deferred |`],
    ["continuation after indented row", `${tennisTable}    | OTHER-ID Other Player–Third Player | Deferred |\n| MATCH-101 Alex Example–Ben Sample | Deferred |`],
    ["continuation after tabbed row", `${tennisTable}\t| OTHER-ID Other Player–Third Player | Deferred |\n| MATCH-101 Alex Example–Ben Sample | Deferred |`],
  ])("resets table identity proof for %s", (_name, table) => {
    const report = tennisFixture();
    expect(hasVisibleCoverageEventIdentity(`### Challenger — Harbor Open 14항목\n\n${table}`, report.inventory[0], report.inventory)).toBe(false);
  });
  it.each([0, 1, 2, 3])("accepts visible table rows with %i leading spaces", count => {
    const report = tennisFixture();
    const table = `${tennisTable}| MATCH-101 Alex Example–Ben Sample | Deferred |`.split("\n").map(line => `${" ".repeat(count)}${line}`).join("\n");
    expect(hasVisibleCoverageEventIdentity(`### Challenger — Harbor Open 14항목\n\n${table}`, report.inventory[0], report.inventory)).toBe(true);
  });
  it("binds an audited identity to the required visible data-row index", () => {
    const report = tennisFixture();
    const body = `### Challenger — Harbor Open 14항목\n\n${tennisTable}| OTHER-ID Other Player–Third Player | Deferred |\n| MATCH-101 Alex Example–Ben Sample | Deferred |`;
    expect(hasVisibleCoverageEventIdentity(body, report.inventory[0], report.inventory, 5)).toBe(true);
    expect(hasVisibleCoverageEventIdentity(body, report.inventory[0], report.inventory, 4)).toBe(false);
  });
  it("does not use a short ID shared by inventory entries", () => {
    const report = tennisFixture();
    report.inventory.push({ ...report.inventory[0], event_key: "tennis:2026-09-30:other:MATCH-101" });
    expect(extractTennis(report, `### Challenger — Harbor Open 14항목\n${tennisTable}| MATCH-101 Alex Example–Ben Sample |`).validation.reasons).toContain("body_inventory_missing:tennis:2026-09-30:match-101");
  });
  it("retains exact full-label accounting without an ID or heading", () => {
    expect(extractTennis(tennisFixture(), "Harbor Open Alex Example–Ben Sample").validation.reasons).not.toContain("body_inventory_missing:tennis:2026-09-30:match-101");
  });
  it("keeps split-label accounting incomplete for a partial inventory or a mistyped assessment key", () => {
    const report = tennisFixture();
    report.inventory_complete = false;
    report.assessments[0].event_key = "ten:match-101";
    const result = extractTennis(report, `### Challenger — Harbor Open 14항목\n${tennisTable}| MATCH-101 Alex Example–Ben Sample |`);
    expect(result.validation).toMatchObject({ status: "incomplete", assessed_count: 0, missing_event_keys: ["tennis:2026-09-30:match-101"] });
    expect(result.validation.reasons).toEqual(expect.arrayContaining(["inventory_declared_incomplete", "inventory_assessments_missing", "assessment_outside_inventory:ten:match-101", "independent_schedule_verification_unavailable"]));
  });
  it("parses only stored coverage with the exact supported scope schema", () => {
    const validScope = { version: 1, sport: "tennis", date_et: "2026-10-10", timezone: "America/New_York", mode: "explicit", competitions: ["ATP"], basis: "request" };
    expect(parseStoredCoverageScope({ coverage: { status: "complete", scope: validScope } }, "tennis")).toEqual(validScope);
    expect(parseStoredCoverageScope({ coverage: { status: "unknown", scope: validScope } }, "tennis")).toBeNull();
    expect(parseStoredCoverageScope({ coverage: { status: "complete", scope: { ...validScope, extra: true } } }, "tennis")).toBeNull();
    expect(parseStoredCoverageScope({ coverage: { status: "complete", scope: { ...validScope, notes: ["invalid_or_ambiguous_request_date"] } } }, "tennis")).toBeNull();
    expect(parseStoredCoverageScope({ coverage: { status: "complete", scope: { ...validScope, notes: ["review_scope_unresolved"] } } }, "tennis")).toBeNull();
    expect(parseStoredCoverageScope({ coverage: { status: "complete", scope: { ...validScope, sport: "mlb" } } }, "tennis")).toBeNull();
  });
  it.each([["mlb", ["MLB"]], ["nfl", ["NFL"]], ["cfb", ["FBS"]], ["soccer", []], ["tennis", ["ATP singles main draw", "ATP singles qualifying", "WTA singles main draw", "WTA singles qualifying"]], ["nba", ["NBA"]], ["wnba", ["WNBA"]], ["nhl", ["NHL"]]])("defines conservative defaults for %s", (sport, competitions) => {
    expect(resolveAnalysisScope({ sport: sport as string, request: "분석", kind: "analyze_today", now: new Date("2026-10-01T03:59:00Z") }).scope).toMatchObject({ date_et: "2026-09-30", competitions });
  });
  it("uses DST-aware ET day and includes Asian next-day timestamps", () => {
    expect(resolveAnalysisScope({ sport: "mlb", request: "", kind: "analyze_today", now: new Date("2026-03-08T04:59:00Z") }).scope.date_et).toBe("2026-03-07");
    const report = fixture(1); report.inventory[0].starts_at = "2026-10-01T08:30:00+09:00";
    expect(extract(report).validation.status).toBe("unverified");
  });
  it("retains only validated earlier scope on recheck, while explicit date and daily jobs win", () => {
    const previous = [{ id: "a", role: "assistant", created_at: "2026-09-29T10:00:00Z", metadata: { coverage: { status: "unverified", scope: { ...scope, date_et: "2026-09-28" } } } }];
    const input = { sport: "mlb", request: "재확인", kind: "recheck_lineup", now: new Date("2026-10-01T03:00:00Z"), messages: previous };
    expect(resolveAnalysisScope(input).scope).toMatchObject({ date_et: "2026-09-28", basis: "previous", parent_message_id: "a" });
    expect(resolveAnalysisScope({ ...input, request: "9월 30일 재확인" }).scope.date_et).toBe("2026-09-30");
    expect(resolveAnalysisScope({ ...input, kind: "analyze_today" }).scope).toMatchObject({ date_et: "2026-09-30", basis: "default" });
    expect(resolveAnalysisScope({ ...input, request: "2026-02-30 분석" }).limitations).toContain("invalid_or_ambiguous_request_date");
  });
  it("inherits scope for a narrow free-text recheck command but not a mention or new daily request", () => {
    const previous = [{ id: "old", role: "assistant", created_at: "2026-09-29T10:00:00Z", metadata: { coverage: { status: "unverified", scope: { ...scope, date_et: "2026-09-28" } } } }];
    const input = { sport: "mlb", kind: "message", now: new Date("2026-09-30T12:00:00Z"), messages: previous };
    expect(resolveAnalysisScope({ ...input, request: "라인업 재확인해줘" }).scope.date_et).toBe("2026-09-28");
    expect(resolveAnalysisScope({ ...input, request: "라인업 재확인이 무슨 뜻이야?" }).scope.date_et).toBe("2026-09-30");
    expect(resolveAnalysisScope({ ...input, request: "오늘 경기 분석해줘" }).scope.date_et).toBe("2026-09-30");
  });
  it("marks a declared partial inventory incomplete and never resolves an invalid request date", () => {
    const report = fixture(1); report.inventory_complete = false;
    expect(extract(report).validation.status).toBe("incomplete");
    expect(resolveAnalysisScope({ sport: "mlb", kind: "analyze_today", now: new Date(), request: "2026-02-30 분석" }).scope.notes).toContain("invalid_or_ambiguous_request_date");
  });

  it("preserves latest valid requested scope even when its coverage assessments were incomplete", () => {
    const messages = [{ id: "latest", role: "assistant", created_at: "2026-09-29T11:00:00Z", metadata: { coverage: { status: "incomplete", scope: { ...scope, date_et: "2026-09-29" } } } }, { id: "older", role: "assistant", created_at: "2026-09-28T11:00:00Z", metadata: { coverage: { status: "unverified", scope: { ...scope, date_et: "2026-09-28" } } } }];
    expect(resolveAnalysisScope({ sport: "mlb", request: "라인업 재확인", kind: "recheck_lineup", now: new Date("2026-09-30T12:00:00Z"), messages }).scope).toMatchObject({ date_et: "2026-09-29", parent_message_id: "latest" });
  });
  it("anchors result reviews to the newest strict-valid stored scope before the request", () => {
    const make = (id: string, created_at: string, date_et: string, status = "complete") => ({ id, role: "assistant", created_at, metadata: { coverage: { status, scope: { ...scope, date_et } } } });
    const messages = [
      make("invalid-newer", "2026-10-13T12:00:00Z", "2026-02-30"),
      { ...make("unresolved-newer", "2026-10-13T11:00:00Z", "2026-10-12"), metadata: { coverage: { status: "complete", scope: { ...scope, date_et: "2026-10-12", notes: ["review_scope_unresolved"] } } } },
      make("future", "2026-10-14T16:00:00Z", "2026-10-13"),
      make("latest-valid", "2026-10-12T12:00:00Z", "2026-10-11", "incomplete"),
      make("older", "2026-10-11T12:00:00Z", "2026-10-10"),
    ];
    expect(resolveAnalysisScope({ sport: "mlb", request: "종료된 경기 결과 확인", kind: "review_results", now: new Date("2026-10-14T17:00:00Z"), requestCreatedAt: "2026-10-14T15:00:00Z", messages }).scope)
      .toMatchObject({ date_et: "2026-10-11", basis: "previous", parent_message_id: "latest-valid" });
  });
  it("lets a valid explicit result date win and links only a source from that date", () => {
    const make = (id: string, date_et: string) => ({ id, role: "assistant", created_at: "2026-10-12T12:00:00Z", metadata: { coverage: { status: "complete", scope: { ...scope, date_et } } } });
    const result = resolveAnalysisScope({ sport: "mlb", request: "2026-10-09 결과 확인", kind: "review_results", now: new Date("2026-10-14T17:00:00Z"), messages: [make("wrong-date", "2026-10-10"), make("same-date", "2026-10-09")] });
    expect(result.scope).toMatchObject({ date_et: "2026-10-09", basis: "request", parent_message_id: "same-date" });
  });
  it("does not inherit a different-date parent when an explicit review date has no matching source", () => {
    const messages = [{ id: "wrong-date", role: "assistant", created_at: "2026-10-12T12:00:00Z", metadata: { coverage: { status: "complete", scope: { ...scope, date_et: "2026-10-10" } } } }];
    const result = resolveAnalysisScope({ sport: "mlb", request: "2026-10-09 결과 확인", kind: "review_results", now: new Date("2026-10-14T17:00:00Z"), messages });
    expect(result.scope).toMatchObject({ date_et: "2026-10-09", basis: "request" });
    expect(result.scope.parent_message_id).toBeUndefined();
    expect(result.limitations).toContain("review_scope_unresolved");
  });
  it("does not infer a single review scope for comparison intent or multiple dates", () => {
    const messages = [{ id: "anchor", role: "assistant", created_at: "2026-10-12T12:00:00Z", metadata: { coverage: { status: "complete", scope: { ...scope, date_et: "2026-10-10" } } } }];
    for (const request of ["2026-10-13 결과를 지난주와 비교해줘", "2026-10-13과 2026-10-10 결과 비교"]) {
      const result = resolveAnalysisScope({ sport: "mlb", request, kind: "review_results", now: new Date("2026-10-14T17:00:00Z"), messages });
      expect(result.scope.parent_message_id).toBeUndefined();
      expect(result.scope.basis).not.toBe("previous");
    }
  });
  it("does not prune a competition-only review merely because a UUID appears", () => {
    const messages = [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", role: "assistant", created_at: "2026-10-12T12:00:00Z", metadata: { coverage: { status: "complete", scope: { ...scope, date_et: "2026-10-10" } } } }];
    const result = resolveAnalysisScope({ sport: "mlb", request: `대회: MLB ${messages[0].id}`, kind: "review_results", now: new Date("2026-10-14T17:00:00Z"), messages });
    expect(result.scope.mode).toBe("daily");
    expect(result.scope.basis).toBe("request");
  });
  it("anchors standalone today and yesterday to ET calendar dates, including daylight-saving changes", () => {
    const messages = [{ id: "anchor", role: "assistant", created_at: "2026-10-12T12:00:00Z", metadata: { coverage: { status: "complete", scope: { ...scope, date_et: "2026-10-10" } } } }];
    expect(resolveAnalysisScope({ sport: "mlb", request: "오늘 결과 확인", kind: "review_results", now: new Date("2026-10-14T17:00:00Z"), messages }).scope).toMatchObject({ date_et: "2026-10-14", basis: "request" });
    expect(resolveAnalysisScope({ sport: "mlb", request: "어제 결과 복기", kind: "review_results", now: new Date("2026-10-14T17:00:00Z"), messages }).scope).toMatchObject({ date_et: "2026-10-13", basis: "request" });
    expect(resolveAnalysisScope({ sport: "mlb", request: "yesterday results", kind: "review_results", now: new Date("2026-03-09T04:30:00Z"), messages }).scope).toMatchObject({ date_et: "2026-03-08", basis: "request" });
  });
  it("uses the queued request timestamp for relative review dates after midnight", () => {
    const result = resolveAnalysisScope({ sport: "mlb", request: "오늘 결과 확인", kind: "review_results", now: new Date("2026-10-15T05:00:00Z"), requestCreatedAt: "2026-10-15T03:55:00Z" });
    expect(result.scope.date_et).toBe("2026-10-14");
  });
  it("does not collapse multi-date or period requests into the latest source scope", () => {
    const messages = [{ id: "anchor", role: "assistant", created_at: "2026-10-12T12:00:00Z", metadata: { coverage: { status: "complete", scope: { ...scope, date_et: "2026-10-10" } } } }];
    for (const request of ["오늘과 어제 결과 비교", "지난주 결과 확인", "최근 3일 결과 복기", "지난 3일 결과 확인", "지난 일주일 결과", "past 3 days results"]) {
      const result = resolveAnalysisScope({ sport: "mlb", request, kind: "review_results", now: new Date("2026-10-14T17:00:00Z"), messages });
      expect(result.scope.parent_message_id).toBeUndefined();
      expect(result.limitations).toContain("review_scope_unresolved");
      expect(result.limitations).toContain("invalid_or_ambiguous_request_date");
    }
  });
  it.each(["mlb", "nfl", "cfb", "soccer", "tennis", "wnba", "nba", "nhl"])("anchors generic result review for %s without manual IDs", sport => {
    const storedScope = { version: 1, sport, date_et: "2026-10-10", timezone: "America/New_York", mode: "daily", competitions: [], basis: "default" };
    const result = resolveAnalysisScope({ sport, request: "종료된 경기 결과를 확인하고 오답노트를 작성해줘", kind: "review_results", now: new Date("2026-10-14T17:00:00Z"), messages: [{ id: "parent", role: "assistant", created_at: "2026-10-12T12:00:00Z", metadata: { coverage: { status: "complete", scope: storedScope } } }] });
    expect(result.scope).toMatchObject({ sport, date_et: "2026-10-10", basis: "previous", parent_message_id: "parent" });
  });
  it("uses a league-wide NBA default and reads NBA coverage scopes independently", () => {
    const result = resolveAnalysisScope({ sport: "nba", request: "오늘 경기 분석", kind: "analyze_today", now: new Date("2026-10-27T15:00:00Z") });
    expect(result.scope).toMatchObject({ sport: "nba", competitions: ["NBA"], basis: "default" });
    expect(parseStoredCoverageScope({ coverage: { status: "complete", scope: result.scope } }, "nba")).toEqual(result.scope);
    expect(parseStoredCoverageScope({ coverage: { status: "complete", scope: result.scope } }, "wnba")).toBeNull();
  });
  it("never treats explicitly excluded competitions as included request scope", () => {
    expect(resolveAnalysisScope({ sport: "soccer", request: "MLS 제외하고 Premier League 분석", kind: "analyze_today", now: new Date() }).scope.competitions).toEqual(["Premier League"]);
    expect(resolveAnalysisScope({ sport: "soccer", request: "Premier League without MLS", kind: "analyze_today", now: new Date() }).scope.competitions).toEqual(["Premier League"]);
  });

  it("ignores future messages and invalid persisted scope", () => {
    const input = { sport: "mlb", request: "재확인", kind: "recheck_lineup", now: new Date("2026-09-30T12:00:00Z"), requestCreatedAt: "2026-09-30T10:00:00Z", messages: [{ id: "future", role: "assistant", created_at: "2026-09-30T11:00:00Z", metadata: { coverage: { status: "complete", scope } } }, { id: "bad", role: "assistant", created_at: "2026-09-29", metadata: { coverage: { status: "incomplete", scope: { ...scope, date_et: "2026-02-30" } } } }] };
    expect(resolveAnalysisScope(input).scope.basis).toBe("default");
  });
  it("supports request competition override and tracked tennis tiers", () => {
    expect(resolveAnalysisScope({ sport: "cfb", request: "FCS 분석", kind: "analyze_today", now: new Date(), criteria: [] }).scope.competitions).toEqual(["FCS"]);
    expect(resolveAnalysisScope({ sport: "soccer", request: "분석", kind: "analyze_today", now: new Date(), criteria: [{ content: "competitions: Premier League, K League 1" }] }).scope.competitions).toEqual(["Premier League", "K League 1"]);
    expect(resolveAnalysisScope({ sport: "tennis", request: "분석", kind: "analyze_today", now: new Date(), events: [{ competition: "ITF W15" }] }).scope.competitions).toContain("ITF W15");
  });
  it("retains tracked tennis tiers from the actual stored label/notes shape", () => {
    const result = resolveAnalysisScope({ sport: "tennis", request: "분석", kind: "analyze_today", now: new Date(), events: [{ label: "ITF W15 tracked match", notes: "historical tracked candidate" }, { label: "A vs B", notes: "Challenger tour" }, { label: "Archived ITF match", notes: "ITF", event_key: "tennis:2020-01-01:aa@bb:src", analysis_status: "PASS" }] });
    expect(result.scope.competitions).toContain("ITF singles (tracked)");
    expect(result.scope.competitions).toContain("Challenger singles (tracked)");
    expect(resolveAnalysisScope({ sport: "tennis", request: "분석", kind: "analyze_today", now: new Date(), events: [{ label: "ITF", notes: "ITF", event_key: "tennis:2020-01-01:aa@bb:src", analysis_status: "PASS" }] }).scope.competitions).not.toContain("ITF singles (tracked)");
  });

  it("excludes stale imported date-prefixed tennis keys even with unknown timestamp and status", () => {
    const result = resolveAnalysisScope({ sport: "tennis", request: "분석", kind: "analyze_today", now: new Date("2026-09-30T12:00:00Z"), events: [{ event_key: "2026-09-23-player-a-player-b", label: "ITF W15 old candidate", starts_at: null, game_status: "unknown" }] });
    expect(result.scope.competitions).not.toContain("ITF singles (tracked)");
  });

  it("never promotes a self-reported complete schedule to verified coverage", () => {
    expect(extract(fixture()).validation).toMatchObject({ status: "unverified", listed_count: 12, assessed_count: 12, missing_event_keys: [] });
    expect(extract(fixture(21)).report?.inventory).toHaveLength(21);
  });
  it("detects twelve discovered games evaluated only as three old candidates", () => {
    const report = fixture(); report.assessments = report.assessments.slice(0, 3);
    expect(extract(report).validation).toMatchObject({ status: "incomplete", assessed_count: 3, missing_event_keys: report.inventory.slice(3).map(e => e.event_key) });
  });
  it.each(["duplicate", "assessment_duplicate", "outside", "reason", "date", "sport", "competition", "count", "source", "timestamp"])("rejects structurally invalid %s", condition => {
    const report = fixture(2);
    if (condition === "duplicate") report.inventory[1].event_key = report.inventory[0].event_key;
    if (condition === "assessment_duplicate") report.assessments[1].event_key = report.assessments[0].event_key;
    if (condition === "outside") report.assessments[0].event_key = "not-in-inventory";
    if (condition === "reason") report.assessments[0].reason = "";
    if (condition === "date") report.scope = { ...scope, date_et: "2026-09-29" };
    if (condition === "sport") report.scope = { ...scope, sport: "nfl" };
    if (condition === "competition") report.inventory[0].competition = "NFL";
    if (condition === "count") report.schedule_sources[0].expected_count = 3;
    if (condition === "source") report.inventory[0].source_url = "https://unknown.test";
    if (condition === "timestamp") report.inventory[0].starts_at = "2026-09-30T10:00:00";
    expect(extract(report).validation.status).toBe("incomplete");
  });
  it("keeps absent timestamps and no-schedule zero inventory unknown", () => {
    const report = fixture(0); report.schedule_sources = [];
    expect(extract(report).validation.status).toBe("unverified");
    expect(extract(fixture(1)).report?.inventory[0].starts_at).toBeNull();
    expect(extractCoverageReport("본문", scope, sources).validation.status).toBe("unverified");
  });
  it("requires body accounting and rejects oversized reports without touching other code", () => {
    expect(extract(fixture(), "only three rows").validation.status).toBe("incomplete");
    expect(extract(fixture(501)).validation.status).toBe("incomplete");
    const result = extractCoverageReport(`본문\n\`\`\`typescript\nconst x = 1;\n\`\`\`\n\`\`\`analysis-coverage\n{bad}\n\`\`\``, scope, sources);
    expect(result.answer).toContain("const x = 1;"); expect(result.answer).not.toContain("analysis-coverage");
    const large = extractCoverageReport(`\`\`\`analysis-coverage\n${"x".repeat(512 * 1024 + 1)}\n\`\`\``, scope, sources);
    expect(large.validation.status).toBe("incomplete");
  });
  it("normalizes source membership without mutating source objects", () => {
    const report = fixture(1); report.inventory[0].source_url = "https://WWW.MLB.COM:443/schedule";
    const original = structuredClone(sources); expect(extract(report).validation.status).toBe("unverified"); expect(sources).toEqual(original);
  });
});

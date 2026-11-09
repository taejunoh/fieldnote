import { describe, expect, it } from "vitest";
import { ANALYSIS_INSTRUCTIONS, assembleContext, instructionsForContext } from "./context";

const now = new Date("2026-10-14T16:00:00.000Z");
const scope = (date_et: string, sport = "tennis", extra = {}) => ({
  version: 1,
  sport,
  date_et,
  timezone: "America/New_York",
  mode: "explicit",
  competitions: ["ATP singles main draw"],
  basis: "request",
  ...extra,
});
const assistant = (id: string, date: string, content = `report ${id}`, extra: Record<string, unknown> = {}) => ({
  id,
  role: "assistant",
  content,
  created_at: "2026-10-13T20:00:00.000Z",
  metadata: { coverage: { status: "complete", scope: scope(date), ...extra } },
});

function build(request: string, messages: Record<string, unknown>[], kind = "review_results") {
  return JSON.parse(assembleContext({
    sport: "tennis",
    now,
    request,
    current_job_kind: kind,
    request_created_at: "2026-10-14T15:00:00.000Z",
    criteria: [],
    events: [{ id: "event", notes: "keep event" }],
    messages,
    recommendations: [{ id: "rec", selection: "keep recommendation" }],
    bets: [{ id: "bet", result: "keep bet" }],
    mistakes: [{ id: "note", lesson: "keep note" }],
    summaries: [{ id: "summary", content: "keep summary" }],
  }));
}

describe("review-results context pruning", () => {
  it("omits only verified out-of-date assistant reports and records body-free hashes", () => {
    const old = assistant("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "2026-10-10", "old full report 🔒");
    const pinned = assistant("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "2026-10-10", "explicitly referenced old report");
    const sameDate = assistant("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "2026-10-13", "same date report");
    const messages = [old, pinned, sameDate,
      { id: "user-correction", role: "user", content: "keep correction", created_at: "2026-10-13T22:00:00Z" },
      { id: "unscoped", role: "assistant", content: "keep unscoped addendum", created_at: "2026-10-13T23:00:00Z" },
    ];
    const request = `2026-10-13 결과 회고 ${pinned.id.toUpperCase()}`;
    const result = build(request, messages);
    const unpruned = build(request, messages, "message");

    expect(result.recent_messages.map((row: { id: string }) => row.id)).toEqual(messages.filter(row => row.id !== old.id).map(row => row.id));
    expect(result.recent_messages.find((row: { id: string }) => row.id === pinned.id).content).toBe(pinned.content);
    expect(result.omitted_messages).toEqual([expect.objectContaining({
      id: old.id,
      scope_date_et: "2026-10-10",
      content_bytes: new TextEncoder().encode(old.content).length,
      reason: "outside_requested_review_date",
      note: "stored_original_omitted_not_summarized",
    })]);
    expect(result.omitted_messages[0]).not.toHaveProperty("content");
    expect(result.omitted_messages[0].content_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result.omitted_messages)).not.toContain(old.content);
    expect(result.active_events).toEqual(expect.arrayContaining([expect.objectContaining({ id: "event", notes: "keep event" })]));
    expect(result.relevant_recommendations).toEqual(expect.arrayContaining([expect.objectContaining({ id: "rec" })]));
    expect(result.confirmed_bets).toEqual(expect.arrayContaining([expect.objectContaining({ id: "bet" })]));
    expect(result.mistake_notes).toEqual(expect.arrayContaining([expect.objectContaining({ id: "note" })]));
    expect(result.older_summaries).toEqual(expect.arrayContaining([expect.objectContaining({ id: "summary", content: "keep summary" })]));
    for (const key of ["analysis_scope", "scope_limitations", "common_operating_policy", "adopted_criteria", "active_events", "relevant_recommendations", "confirmed_bets", "mistake_notes", "older_summaries"]) {
      expect(result[key]).toEqual(unpruned[key]);
    }
  });

  it.each([
    ["analyze_today", "2026-10-13 결과 회고"],
    ["review_results", "결과 회고"],
    ["review_results", "2026-10-13과 2026-10-10 비교 회고"],
    ["review_results", "2026-10-13 과거 날짜 비교 회고"],
    ["review_results", "2026-02-30 결과 회고"],
  ])("does not prune outside a clear single-date review (%s, %s)", (kind, prompt) => {
    const anchor = assistant("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "2026-10-13", "explicit anchor");
    const target = assistant("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "2026-10-10");
    const request = `${prompt} ${anchor.id}`;
    expect(build(request, [target, anchor], kind).recent_messages).toHaveLength(2);
  });

  it("does not prune when the UUID is not a resolved assistant message", () => {
    const messages = [assistant("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "2026-10-10")];
    expect(build("2026-10-13 결과 회고 dddddddd-dddd-4ddd-8ddd-dddddddddddd", messages).recent_messages).toHaveLength(1);
  });
  it("does not treat a competition override plus UUID as a resolved review date", () => {
    const target = assistant("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "2026-10-10");
    const result = build(`대회: ATP ${target.id}`, [target]);
    expect(result.analysis_scope.mode).toBe("daily");
    expect(result.recent_messages).toHaveLength(1);
    expect(result).not.toHaveProperty("omitted_messages");
  });

  it.each([
    { status: "unknown", scope: scope("2026-10-10") },
    { status: "complete", scope: scope("2026-10-10", "mlb") },
    { status: "complete", scope: scope("2026-02-30") },
    { status: "complete", scope: { ...scope("2026-10-10"), timezone: "UTC" } },
    { status: "complete", scope: { ...scope("2026-10-10"), notes: ["invalid_or_ambiguous_request_date"] } },
    { status: "complete", scope: { ...scope("2026-10-10"), extra: true } },
  ])("retains reports whose stored coverage metadata is not valid and complete", coverage => {
    const row = { ...assistant("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "2026-10-10"), metadata: { coverage } };
    const anchor = assistant("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "2026-10-13", "explicit anchor");
    expect(build(`2026-10-13 결과 회고 ${anchor.id}`, [row, anchor]).recent_messages).toHaveLength(2);
  });

  it("retains omitted-eligible messages when historical comparison intent is explicit", () => {
    const message = assistant("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "2026-10-10");
    const anchor = assistant("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "2026-10-13", "explicit anchor");
    expect(build(`2026-10-13 결과를 지난주와 비교해줘 ${anchor.id}`, [message, anchor]).recent_messages).toHaveLength(2);
  });
  it("does not prune when one absolute date is paired with a second slash date", () => {
    const target = assistant("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "2026-10-10");
    const anchor = assistant("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "2026-10-13", "explicit anchor");
    const result = build(`2026-10-13과 10/12 비교 ${anchor.id}`, [target, anchor]);
    expect(result.scope_limitations).toContain("invalid_or_ambiguous_request_date");
    expect(result.recent_messages).toHaveLength(2);
    expect(result).not.toHaveProperty("omitted_messages");
  });

  it("uses a valid prior report to anchor a generic result review without a date or UUID", () => {
    const old = assistant("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "2026-10-10", "different-day report");
    const parent = { ...assistant("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "2026-10-13", "latest valid report"), created_at: "2026-10-13T21:00:00Z" };
    const sameDate = { ...assistant("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "2026-10-13", "same-day original"), created_at: "2026-10-13T20:00:00Z" };
    const correction = { id: "user-note", role: "user", content: "keep correction", created_at: "2026-10-13T22:00:00Z" };
    const result = build("종료된 경기 결과를 확인하고 오답노트를 작성해줘", [old, parent, sameDate, correction]);
    expect(result.analysis_scope).toMatchObject({ date_et: "2026-10-13", basis: "previous", parent_message_id: parent.id });
    expect(result.recent_messages.map((row: { id: string }) => row.id)).toEqual([parent.id, sameDate.id, correction.id]);
    expect(result.omitted_messages).toEqual([expect.objectContaining({ id: old.id, scope_date_et: "2026-10-10" })]);
  });

  it("marks a result review unresolved without verified stored coverage and preserves every message", () => {
    const messages = [{ id: "user", role: "user", content: "review results" }, { id: "unscoped", role: "assistant", content: "not a verified report" }];
    const result = build("종료된 경기 결과를 확인해줘", messages);
    expect(result.scope_limitations).toContain("review_scope_unresolved");
    expect(result.recent_messages.map((row: { id: string }) => row.id)).toEqual(["user", "unscoped"]);
    expect(result).not.toHaveProperty("omitted_messages");
  });
});

describe("official source instructions", () => {
  it("distinguishes exact NHL/WTA hosts from tennis apex/www sources and preserves cited URLs", () => {
    expect(ANALYSIS_INSTRUCTIONS).toContain("frontend.d3.nhle.com");
    expect(ANALYSIS_INSTRUCTIONS).toContain("wtafiles.wtatennis.com");
    expect(ANALYSIS_INSTRUCTIONS).toContain("frontend.d3.nhle.com과 wtafiles.wtatennis.com은 정확한 호스트만 허용하며 이 두 호스트의 www 별칭이나 임의 하위 도메인을 허용하지 않는다.");
    expect(ANALYSIS_INSTRUCTIONS).toContain("japanopentennis.com과 protennislive.com은 각각 apex 및 www 호스트를 허용한다.");
    expect(ANALYSIS_INSTRUCTIONS).toContain("추천의 event_key에는 events.event_key를 문자 그대로 복사한다.");
    expect(ANALYSIS_INSTRUCTIONS).toContain("source_url은 본문 인용과 검색 결과에 있는 실제 URL과 정확히 일치시킨다.");
    expect(ANALYSIS_INSTRUCTIONS).toContain("서버가 인용된 공식 URL로 출처 해시 키를 생성하므로 해시를 직접 만들지 않는다.");
  });

  it("limits CFB school sources to the observed apex and www hosts", () => {
    for (const host of ["dsuhornets.com", "virginiasports.com", "uconnhuskies.com", "pennathletics.com", "tulsahurricane.com", "goairforcefalcons.com", "gostanford.com"]) {
      expect(ANALYSIS_INSTRUCTIONS).toContain(host);
    }
    expect(ANALYSIS_INSTRUCTIONS).toContain("CFB 공식 Conference USA 일정·리그 출처는 conferenceusa.com이며 apex 또는 www 호스트만 허용한다.");
    expect(ANALYSIS_INSTRUCTIONS).toContain("각 등록 도메인의 apex 또는 www 호스트만 허용하며 임의 하위 도메인이나 목록에 없는 학교 도메인을 공식 출처로 추측하지 않는다.");
    expect(ANALYSIS_INSTRUCTIONS).toContain("검색 결과와 본문에서 확인한 전체 source_url을 그대로 사용하고, URL을 다른 호스트로 바꾸거나 출처 해시 키를 직접 만들지 않는다.");
  });

  it("limits known soccer club sources to the observed official domains", () => {
    for (const host of ["dcunited.com", "atlasfc.com.mx", "clubpuebla.com", "tuzos.com.mx", "clubsantos.mx"]) {
      expect(ANALYSIS_INSTRUCTIONS).toContain(host);
    }
    expect(ANALYSIS_INSTRUCTIONS).toContain("목록에 없는 리그·클럽 도메인을 공식 출처로 추측해 사용하지 않는다.");
  });

  it("limits added soccer league and club sources to the observed apex and www hosts", () => {
    for (const host of ["bundesliga.com", "laliga.com", "acmonza.com", "ogcnice.com", "chicagostars.com", "reignfc.com", "thorns.com"]) {
      expect(ANALYSIS_INSTRUCTIONS).toContain(host);
    }
    expect(ANALYSIS_INSTRUCTIONS).toContain("각 등록 도메인의 apex 또는 www 호스트만 허용하며 목록에 없는 리그·클럽 도메인을 공식 출처로 추측해 사용하지 않는다.");
    expect(ANALYSIS_INSTRUCTIONS).toContain("검색 결과와 본문에서 확인한 전체 source_url을 그대로 사용하고, URL을 다른 호스트로 바꾸거나 출처 해시 키를 직접 만들지 않는다.");
  });

  it("documents the observed federation, NFL club, and tennis tournament hosts", () => {
    for (const host of ["federacaopr.com.br", "atletico.com.br", "philadelphiaeagles.com", "toray-ppo.com"]) {
      expect(ANALYSIS_INSTRUCTIONS).toContain(host);
    }
  });

  it("keeps grouped tournament headings and short event IDs identical to coverage keys", () => {
    expect(ANALYSIS_INSTRUCTIONS).toContain("대회별로 묶어 본문 제목을 쓸 때 제목의 대회명은 해당 경기 inventory.label의 대회명 접두어와 정확히 같게 쓴다");
    expect(ANALYSIS_INSTRUCTIONS).toContain("본문에 짧은 경기 ID를 표시하면 해당 경기 canonical event_key의 접미부를 변경 없이 그대로 복사한다.");
  });
});

describe("shared assessment and record-admission instructions", () => {
  const sports = ["mlb", "nfl", "cfb", "soccer", "tennis", "nba", "wnba", "nhl"];

  it.each(sports)("keeps assessment and per-record admission separate for %s", () => {
    for (const commonPolicyAdopted of [false, true]) {
      for (const conversation of [false, true]) {
        const instructions = instructionsForContext(commonPolicyAdopted, conversation);
        expect(instructions).toContain("구조화 기록의 저장 자격과 본문에서 가능한 경기·가격 평가는 별개다.");
        expect(instructions).toContain("명시적 경기 전 상태 표시가 없다는 이유만으로 시작했다고 추정하지 않는다.");
        expect(instructions).toContain("최신 공식 일정에 시작 시각이 현재보다 뒤로 제시되고 현재 조회에서 최신의 반대 상태 증거가 없으면 초기 평가와 채택 정책상 EARLY GO 검토가 가능하다.");
        expect(instructions).toContain("확인된 실제 live/final 상태 또는 서로 상충하는 최신 상태 증거가 있으면 현재 추천으로 새 GO/BET를 권하지 않는다.");
        expect(instructions).toContain("저장 부적격 사유만으로 본문 판단을 EVALUATION INCOMPLETE로 바꾸거나 적격한 다른 행까지 비우지 않는다.");
        expect(instructions).toContain("시작 뒤의 가정 평가는 현재 analysis-record의 events와 recommendations 양쪽에 넣지 않는다.");
        expect(instructions).toContain("공식 출처, 인용, 경기 식별, 시작 시각 및 출처 provenance 검증은 그대로 지킨다.");
        expect(instructions).toContain("실제 분석 자료가 부족하면 현재 적용되는 상태 규칙에 맞춰 정직하게 EVALUATION INCOMPLETE 또는 조건부 WAIT를 쓰고, 가격 비교를 끝낸 경우에만 PASS를 쓴다.");
        expect(instructions).toContain("과거 요청의 작업별 제한을 영구 기준으로 승계하지 않고 현재 요청을 우선한다.");
      }
    }
  });

  it("qualifies adopted-policy GO persistence while preserving each mode's incomplete semantics", () => {
    const legacy = instructionsForContext(false, false);
    const adoptedAnalysis = instructionsForContext(true, false);
    const adoptedConversation = instructionsForContext(true, true);

    expect(legacy).toContain("EVALUATION INCOMPLETE는 확인된 시작 시각이 이미 지났을 때만 쓴다.");
    expect(adoptedAnalysis).toContain("EVALUATION INCOMPLETE는 시작 전이나 시각 미확인에도 미평가·자료 부족을 나타낸다.");
    expect(adoptedConversation).toContain("EVALUATION INCOMPLETE는 시작 전이나 시각 미확인에도 미평가·자료 부족을 나타낸다.");
    expect(adoptedAnalysis).not.toContain("본문 EARLY GO도 동일한 GO이며 analysis-record에는 decision=BET와 timing=early를 기록한다.");
    expect(adoptedAnalysis).toContain("구조화 기록 적격성이 확인된 경우에만 analysis-record에 decision=BET와 timing=early를 기록한다.");
    expect(adoptedAnalysis).not.toContain("본문 EARLY GO도 동일한 GO이며 analysis-record에는 decision=BET와 timing=early를 기록한다. 일반 GO도 decision=BET로 기록한다.");
  });

  it("keeps exact-time official future GO decisions in the native analysis record without requiring numeric fixture IDs", () => {
    const instructions = instructionsForContext(true, false);
    expect(instructions).toContain("공식 숫자 경기 ID가 없어도 공식 출처에서 확인한 미래 경기의 정확한 시작 시각이 있으면 해당 GO를 analysis-record에 기록한다.");
    expect(instructions).toContain("EARLY GO는 analysis-record에서 decision=BET와 timing=early로 기록하며, 공식 URL 인용과 :src 경기 키를 사용한다.");
    expect(instructions).toContain("nashvillesc.com");
  });
});

it("bounds historical raw excerpts while retaining beginning, latest and request-relevant original line provenance",async()=>{
 const { historicalDocumentExcerpts }=await import("./context");
 const raw=["Beginning NBA criteria",...Array.from({length:200},(_,i)=>`Line ${i} ${i===95?"needle95":""} ${"x".repeat(100)}`),"Latest rotation correction"].join("\n");
 const docs=Array.from({length:5},(_,i)=>({id:`d${i}`,sha256:"a".repeat(64),raw_text:raw,imported_at:`2026-10-0${i+1}T00:00:00Z`}));
 const result=historicalDocumentExcerpts(docs,"needle95 rotation","2026-10-27T12:00:00Z");
 expect(result.documents).toHaveLength(3);expect(result.truncated).toBe(true);
 expect(result.documents.reduce((sum,doc)=>sum+doc.included_characters,0)).toBeLessThanOrEqual(18000);
 for(const doc of result.documents){expect(doc.truncated).toBe(true);expect(doc.excerpts.some(part=>part.text.includes("needle95"))).toBe(true);expect(doc.excerpts.some(part=>part.text.includes("Beginning NBA criteria"))).toBe(true);expect(doc.excerpts.some(part=>part.text.includes("Latest rotation correction"))).toBe(true);for(const part of doc.excerpts){expect(part.text).toBe(raw.split("\n")[part.line-1].slice(part.start_character,part.end_character));expect(part.source_ref).toBe(`L${part.line}`);}}
 expect(docs[0].raw_text).toBe(raw);
});
it("keeps oversized single-line sources within the budget with exact beginning/latest character offsets",async()=>{
 const {historicalDocumentExcerpts}=await import("./context");
 const raw="BEGIN "+"x".repeat(20000)+" needle "+"x".repeat(20000)+" LATEST";
 const result=historicalDocumentExcerpts([{id:"long",sha256:"a".repeat(64),imported_at:"2026-10-01T00:00:00Z",raw_text:raw}],"needle","2026-10-27T12:00:00Z");
 const doc=result.documents[0];expect(doc.included_characters).toBeLessThanOrEqual(6000);expect(doc.truncated).toBe(true);
 expect(doc.excerpts.some(part=>part.text.includes("BEGIN"))).toBe(true);expect(doc.excerpts.some(part=>part.text.includes("LATEST"))).toBe(true);expect(doc.excerpts.some(part=>part.text.includes("needle"))).toBe(true);
 for(const part of doc.excerpts)expect(part.text).toBe(raw.slice(part.start_character,part.end_character));
});

it("preserves NULL actuals and original GO separately from manual incomplete registration",()=>{
 const source={version:1,provenance:"manual_confirmed_conditional",eventKey:"tennis:2026-10-27:alpha@beta:src-hash",match:"Alpha versus Beta",market:"Moneyline",selection:"Alpha",originalDecision:"GO",suggestedUnits:0.25,priceGate:"2.04 or better",schedule:{precision:"not_before",dateEt:"2026-10-27",at:"2026-10-27T22:30:00-04:00",label:"NB 22:30"},checkedAt:"original checked",createdAt:"original created",deliveredAt:"original delivery",sourceUrl:"https://example.org/original"};
 const context=JSON.parse(assembleContext({sport:"tennis",now,request:"Review records",criteria:[],events:[{id:"event",starts_at:null,analysis_status:"EVALUATION INCOMPLETE",source_ref:"manual-confirmed:conditional:message:hash"}],messages:[],recommendations:[],bets:[{id:"bet",source_candidate:source,stake_units:null,executed_price:null,result:"unknown",profit_units:null}],mistakes:[],summaries:[]}));
 expect(context.manual_registration_explanation).toContain("never a retroactive replacement");
 expect(context.conditional_entry_sources[0]).toMatchObject({originalDecision:"GO",suggestedUnits:0.25,sourceUrl:source.sourceUrl,schedule:source.schedule});
 expect(context.confirmed_bets[0]).toMatchObject({stake_units:null,executed_price:null,profit_units:null});
 expect(context.active_events[0]).toMatchObject({starts_at:null,analysis_status:"EVALUATION INCOMPLETE"});
});

describe('selected-market evaluation instructions', () => {
  it('keeps sport-specific critical checks and selected scope separate from canonical record rules', () => {
    for (const adopted of [false, true]) {
      const instructions = instructionsForContext(adopted, false);
      expect(instructions).toContain('analysis-evaluation');
      expect(instructions).toContain('selected_markets');
      expect(instructions).toContain('observed_price');
      expect(instructions).toContain('research_incomplete');
      for (const sport of ['MLB', 'NFL', 'CFB', 'NBA', 'WNBA', 'NHL', 'soccer', 'tennis']) expect(instructions).toContain(`평가 체크 ${sport}:`);
    }
    expect(instructionsForContext(false, false)).toContain('EVALUATION INCOMPLETE는 경기 시작 시각이 지났고');
    expect(instructionsForContext(false, true)).toContain('review_results/단순 상태');
  });
});

it("uses review-specific authority and full-decision instructions without pregame schemas", async () => {
  const { resultsReviewInstructions } = await import("./context");
  const instructions = resultsReviewInstructions(true);
  expect(instructions).toContain("PASS");
  expect(instructions).toContain("body-only");
  expect(instructions).toContain("common_operating_policy");
  expect(instructions).toContain("실제 가격/금액이 빠지면 임의로 채우지 않고");
  expect(instructions).toContain("최신 경기, 라인업, 결과, 배당을 답할 때 반드시 웹 검색");
  expect(instructions).not.toContain("selected_markets");
  expect(instructions).not.toContain("첫 단계는 현재 웹 검색으로 analysis_scope의 전체 일정 발견");
  expect(instructions.length).toBeLessThan(instructionsForContext(true, false).length);
});

it("preserves saved result URL and checked-time lineage as historical evidence through review preparation", async () => {
  const { prepareResultsReview } = await import("./results-review");
  const resultFields = { result_source_url: "https://www.atptour.com/en/scores/known-match", result_checked_at: "2026-10-28T23:00:00Z" };
  const context = assembleContext({ sport: "tennis", now, request: "2026-10-28 결과 회고", current_job_kind: "review_results", criteria: [], messages: [{ id: "source", role: "assistant", content: "Original PASS", metadata: { sources: [{ title: "Source", url: resultFields.result_source_url }], checked_at: resultFields.result_checked_at } }], events: [{ id: "event", ...resultFields }], recommendations: [], bets: [{ id: "ticket", result: "won", stake_units: 1, executed_price: 100, ...resultFields }], mistakes: [], summaries: [] });
  const packet = prepareResultsReview(context).packet!;
  expect(packet.facts[0]).toMatchObject({ ...resultFields, evidence_status: "historical_recorded", independently_verified: false });
  expect(packet.tickets[0]).toMatchObject({ ...resultFields, evidence_status: "historical_recorded" });
  expect(JSON.parse(context).recent_messages[0].metadata).toMatchObject({ historical_result_sources: [{ title: "Source", url: resultFields.result_source_url }], checked_at: resultFields.result_checked_at, evidence_type: "historical_recorded" });
});

it("retains conditional source lineage for scoped older review tickets beyond the first30", async () => {
  const { prepareResultsReview } = await import("./results-review");
  const bets = Array.from({ length: 31 }, (_, index) => ({ id: `ticket-${index}`, source_candidate: { provenance: "manual_confirmed_conditional", originalDecision: "GO", sourceUrl: `https://www.atptour.com/match-${index}`, schedule: { precision: "not_before", label: `NB ${index}` } } }));
  const context = assembleContext({ sport: "tennis", now, request: "2026-10-28 결과 회고", current_job_kind: "review_results", criteria: [], messages: [], events: [], recommendations: [], bets, mistakes: [], summaries: [] });
  expect(prepareResultsReview(context).packet!.conditional_entry_sources).toEqual(expect.arrayContaining([expect.objectContaining({ bet_id: "ticket-30", sourceUrl: "https://www.atptour.com/match-30", originalDecision: "GO", schedule: expect.objectContaining({ label: "NB 30" }) })]));
});

it("keeps explicit special settlement provenance through assemble→prepare without ordinary loss arithmetic", async () => {
  const { prepareResultsReview } = await import("./results-review");
  const context = assembleContext({ sport: "nba", now, request: "2026-10-28 결과 회고", current_job_kind: "review_results", criteria: [], messages: [], events: [], recommendations: [], bets: [{ id: "legacy-SAS", source_ref: "cashout:legacy-SAS", result: "lost", stake_units: 1, executed_price: -110, profit_units: -0.25 }, { id: "promo", source_candidate: { promotion: "bonus_bet" }, result: "won", stake_units: "2", executed_price: "150", profit_units: 1 }], mistakes: [], summaries: [] });
  const tickets = prepareResultsReview(context).packet!.tickets;
  expect(tickets[0]).toMatchObject({ source_ref: "cashout:legacy-SAS", calculated_profit_units: null, recorded_profit_units: -0.25, unresolved_reason: "nonstandard_ticket_settlement" });
  expect(tickets[1]).toMatchObject({ source_candidate: { promotion: "bonus_bet" }, calculated_profit_units: null, recorded_profit_units: 1, unresolved_reason: "nonstandard_ticket_settlement" });
});

it("retains selected historical native-only decisions and coverage reasons after visible machine blocks were stripped", async () => {
  const { prepareResultsReview } = await import("./results-review");
  const selectedScope = { version: 1, sport: "tennis", date_et: "2026-10-28", timezone: "America/New_York", mode: "explicit", competitions: ["ATP"], basis: "request" };
  const coverageReport = { version: 1, scope: selectedScope, inventory: [{ event_key: "tennis:2026-10-28:alpha@beta:id-123", label: "Alpha versus Beta" }], assessments: [{ event_key: "tennis:2026-10-28:alpha@beta:id-123", disposition: "deferred", reason: "Unique retirement-risk concern" }, { event_key: "tennis:2026-10-28:gamma@delta:id-456", disposition: "excluded", reason: "Native-only exclusion" }] };
  const nativeRecord = { version: 1, sport: "tennis", events: [{ event_key: "tennis:2026-10-28:alpha@beta:id-123" }], recommendations: [{ item_key: "native-pass", event_key: "tennis:2026-10-28:alpha@beta:id-123", decision: "PASS", price_gate: "+150 or better", suggested_units: 0 }, { item_key: "native-wait", event_key: "tennis:2026-10-28:alpha@beta:id-123", decision: "WAIT", suggested_units: null, price_gate: null, direction_note: "Need retirement confirmation" }] };
  const context = assembleContext({ sport: "tennis", now, request: "2026-10-28 결과 회고", current_job_kind: "review_results", criteria: [], messages: [{ id: "selected-source", role: "assistant", content: "Visible answer after machine blocks were stripped", metadata: { coverage: { status: "complete", scope: selectedScope }, coverage_report: coverageReport, analysis_record: nativeRecord, original_model_response: "Do not duplicate raw provider payload" } }, { id: "user-latest", role: "user", content: "Latest correction stays authoritative" }], events: [], recommendations: [], bets: [], mistakes: [], summaries: [] });
  const prepared = prepareResultsReview(context);
  const actual = JSON.parse(prepared.context);
  expect(actual.recent_messages[0].metadata.historical_structured_decisions).toMatchObject({ evidence_type: "historical quoted analysis decisions; not current facts or confirmed tickets", coverage_report: coverageReport, analysis_record: nativeRecord });
  expect(actual.recent_messages[1].content).toBe("Latest correction stays authoritative");
  expect(prepared.packet!.source_messages[0]).toMatchObject({ structured_decisions_location: "recent_messages.metadata.historical_structured_decisions" });
  expect(prepared.context).not.toContain("Do not duplicate raw provider payload");
  expect(actual.results_review.tickets).toEqual([]);
});

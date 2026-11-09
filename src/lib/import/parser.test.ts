import { describe, expect, it } from "vitest";
import { parseImport } from "./parser";

const fixture = `# 1. Project Goal
MLB rule.
# 2. Unit System
Unit rule.
# 3. Evaluation Order
Pitching first.
# 4. Counter Rule
No double count.
# 5. SP Rules
Check health.
# 6. Pitching Structure
Check bridge.
# 7. Bullpen Rules
Check use.
# 8. Lineup Rules
Confirmed lineup.
# 9. Team Rules
Check strength.
# 10. Price Gate
Price last.
# 11. Full Agreement
Rare.
# 12. Totals Rules
Separate.
# 13. Actual Betting Ledger — Confirmed Entries Only
## 9/13
- **ATL ML ≤ -135 — 0.5u ❌**
## 9/14
- **LAA ML +100 — 0.5u ✅**
## 9/16
- BAL +104 was recommended 0.5u. User did not confirm entry.
## 9/17
- **BOS ML -113 — 0.5u ✅**
## 9/19
- LAA ML -111 was quoted and 0.5u recommended. User never confirmed entry.
# 14. Post-Mortems
## 9/16 — NYY failed
NYY lost. Lesson.
# 15. Scoring
Score does not determine units.
# 16. Output
Output format.
# 17. Labels
WATCH remains WATCH.
# 18. Current Day State
## 1 PM games
### WSH @ DET
Final: DET lean / PASS.
# 19. Unresolved
## A. MIN @ SF
MIN ML WATCH.
## B. CLE @ BOS
BOS candidate.
## C. MIL @ PHI
Under WATCH.
## D. LAA @ ATH
LAA WAIT.
## E. TOR @ BAL Game 2
Evaluate from scratch.
# 20. Lessons
Model lessons.
# 21. Next Chat
Recheck lineup.
# 22. Philosophy
Verify facts.`;

describe("MLB handoff import", () => {
  const draft = parseImport(fixture, "mlb");

  it("retains reviewable rules, provenance, and unresolved current candidates", () => {
    expect(draft.rules.length).toBeGreaterThan(10);
    expect(
      draft.rules.every((rule) => /^L\d+-L\d+:/.test(rule.sourceRef)),
    ).toBe(true);
    expect(
      draft.events.find((event) => event.label === "MIN @ SF")?.analysisStatus,
    ).toBe("WATCH");
    expect(
      draft.events.find((event) => event.label === "LAA @ ATH")?.analysisStatus,
    ).toBe("WAIT");
    expect(
      draft.events.find((event) => event.label === "TOR @ BAL Game 2"),
    ).toBeTruthy();
    expect(
      draft.events.find((event) => event.label === "WSH @ DET")?.analysisStatus,
    ).toBe("PASS");
    expect(draft.summary).toContain("verify current facts");
  });

  it("separates actual entries from unconfirmed recommendations and price gates from fills", () => {
    expect(draft.bets.some((bet) => bet.selection.includes("BAL +104"))).toBe(
      false,
    );
    expect(
      draft.bets.some((bet) => bet.selection.includes("LAA ML -111")),
    ).toBe(false);
    expect(draft.recommendations.some((item) => item.selection === "BAL")).toBe(
      true,
    );
    expect(
      draft.bets.find((bet) => bet.selection.includes("BOS ML -113"))
        ?.executedPrice,
    ).toBe(-113);
    expect(
      draft.bets.find((bet) => bet.selection.includes("LAA ML +100"))
        ?.executedPrice,
    ).toBe(100);
    expect(
      draft.bets.find((bet) => bet.selection.includes("ATL ML ≤ -135"))
        ?.executedPrice,
    ).toBeNull();
    expect(draft.bets.every((bet) => bet.profitUnits === null)).toBe(true);
  });

  it("does not apply MLB rules to another sport", () => {
    const other = parseImport("# NFL Notes\n## My idea\nTest idea", "nfl");
    expect(other.rules.every((rule) => rule.status === "proposed")).toBe(true);
    expect(other.bets).toEqual([]);
  });
});

describe("NBA import review", () => {
  it("does not infer actual entries or apply WNBA parsing rules to narrative recommendations", () => {
    const draft = parseImport(`# NBA handoff\n\n## Criteria\nCheck current starters.\n\n## Historical review\nBoston ML was recommended at -110; no entry was confirmed.`, "nba");

    expect(draft.bets).toEqual([]);
    expect(draft.events).toEqual([]);
    expect(draft.recommendations).toEqual([]);
    expect(draft.summary).toContain("source text remains saved");
    expect(draft.warnings?.join(" ")).toContain("No NBA recommendation is imported as an actual entry");
    expect(draft.warnings?.join(" ")).not.toContain("WNBA");
  });
});

describe("NFL handoff import", () => {
  const nflFixture = `# NFL Handoff
# 1. Betting Style / Unit Rules
Full Agreement = 1u. A recommendation is not an actual bet.
# 2. Current NFL Evaluation Framework
Check official inactives and role.
# 3. Booster / Promo Rules
Evaluate the underlying side before a boost.
# 4. Confirmed Preseason Betting History
## Aug 27 — Preseason
### Confirmed / final recommended card
- NE ML 0.5u ❌
# 5. Regular Season Confirmed Betting History
## Sep 10 — SF @ LAR
### Confirmed actual entries
- **SF +3.5 -102 — 0.5u ✅**
- **Kyren Williams O55.5 rushing — 0.5u ❌**
- **U48.5 -115 — 0.25u ✅**
### Lessons
The rushing prop failed because carries were missed.
## Sep 17 — DET @ BUF
### Confirmed actual entries
- **BUF -2.5 + 50% boost — $15 ✅**
- **DET ML +190 Early Win 7-Up — $25 ❌**
### Lessons
Do not duplicate a thesis.
# 6. Sep 20 Week 2 Sunday
## Confirmed actual entry
- **JAX +2.5 — actual entry confirmed**
- Recommended size was 0.25u, but actual user stake was not explicitly confirmed.
Final: JAX +2.5 ❌
### Important note
Do NOT book CIN +2.5 as an actual bet.
### JAX postmortem
Remaining offensive paths were missed.
# 7. Sep 21 — NYG @ LAR
### Final decision
- **PASS all markets**
- No confirmed actual bet
### Important analysis notes
Process review without an entry.
# 9. Current Futures / Open Long-Term Bet
## Detroit Lions O10.5 Wins — 50% boost
User chose this future. Status: **OPEN**.
# 11. Analysis Rules That Must Be Preserved
Keep recommendations separate from bets.
# 12. Preferred Output Format for Future NFL Analysis
Show the price gate.
# 13. Current Continuation Point
Analyze NFL Sep 27, 2026 slate. Prior attempt failed.
`;
  const draft = parseImport(nflFixture, "nfl");

  it("imports only explicit regular-season entries and the open future", () => {
    expect(draft.bets).toHaveLength(7);
    expect(draft.bets.filter((bet) => bet.result !== "unknown")).toHaveLength(6);
    expect(draft.bets.some((bet) => bet.selection.includes("NE ML"))).toBe(false);
    expect(draft.bets.some((bet) => bet.selection.includes("CIN +2.5"))).toBe(false);
    expect(draft.bets.some((bet) => bet.selection.includes("PASS"))).toBe(false);
    expect(draft.bets.find((bet) => bet.selection === "JAX +2.5")).toMatchObject({
      stakeUnits: null,
      executedPrice: null,
      result: "lost",
    });
    expect(draft.bets.find((bet) => bet.market === "Season win total")?.result).toBe("unknown");
  });

  it("keeps actual dollars and promotions distinct from unit stakes and computed profit", () => {
    expect(draft.bets.find((bet) => bet.selection.includes("$15"))).toMatchObject({
      stakeUnits: null,
      executedPrice: null,
      profitUnits: null,
    });
    expect(draft.bets.find((bet) => bet.selection.includes("$25"))).toMatchObject({
      stakeUnits: null,
      executedPrice: null,
      profitUnits: null,
    });
    expect(draft.bets.find((bet) => bet.selection.startsWith("SF +3.5"))?.executedPrice).toBe(-102);
    expect(draft.bets.find((bet) => bet.selection.startsWith("U48.5"))).toMatchObject({
      market: "Total under",
      executedPrice: -115,
      profitUnits: null,
    });
  });

  it("traces rules, records and lessons to the imported text", () => {
    expect(draft.rules.every((rule) => rule.status === "adopted" && /^L\d+-L\d+:/.test(rule.sourceRef))).toBe(true);
    expect(draft.bets.every((bet) => /^L\d+(?:-L\d+)?:/.test(bet.sourceRef))).toBe(true);
    expect(draft.mistakeNotes.some((note) => note.title.includes("JAX"))).toBe(true);
    expect(draft.events.find((event) => event.label.includes("Sep 27"))).toMatchObject({
      analysisStatus: "WATCH",
      gameStatus: "unknown",
    });
    expect(draft.warnings.join(" ")).toContain("웹 검증");
  });

  it("attributes boosted and Early Win postmortems to the right entered pick", () => {
    const review = parseImport(`# 5. Regular Season Confirmed Betting History
## Sep 13 — Sunday card
### Confirmed actual entries
- **TB +3.5 — 0.25u ❌**
- **DAL ML -158 + 50% boost — 0.5u ❌**
### Lessons
#### TB
Key number was over-weighted.
#### DAL boosted ML
Booster was the last step, but the underlying side was weak.
## Sep 17 — DET @ BUF
### Confirmed actual entries
- **BUF -2.5 + 50% boost — $15 ✅**
- **DET ML +190 Early Win 7-Up — $25 ❌**
### Early Win
Detroit never led; fast-start chance was missed.
`, "nfl");
    const tb = review.mistakeNotes.find((note) => note.title.includes("TB"));
    const dal = review.mistakeNotes.find((note) => note.title.includes("DAL"));
    const earlyWin = review.mistakeNotes.find((note) => note.title.includes("Sep 17"));
    expect(tb?.decisionAtTime).toContain("TB +3.5");
    expect(tb?.lesson).not.toContain("Booster was the last step");
    expect(dal?.decisionAtTime).toContain("DAL ML");
    expect(dal?.lesson).toContain("Booster was the last step");
    expect(earlyWin?.decisionAtTime).toContain("DET ML");
    expect(earlyWin?.outcome).toBe("lost");
  });

  it("records unentered Sep 20 candidates as recommendations without a bet or retroactive result", () => {
    const candidates = parseImport(`# 6. Sep 20 Week 2 Sunday
## Confirmed actual entry
- **JAX +2.5 — actual entry confirmed**
Final:
- **JAX +2.5 ❌**
### Important note
Do NOT book:
- CIN +2.5
- ARI +4.5
- IND +6.5
as actual bets. They were candidates only.
### CIN
CIN beat HOU. It was not entered.
### ARI
ARI lost to SEA. Conditional idea only.
`, "nfl");
    expect(candidates.bets.map((bet) => bet.selection)).toEqual(["JAX +2.5"]);
    expect(candidates.recommendations).toMatchObject([
      { selection: "CIN +2.5", decision: "WATCH", suggestedUnits: null },
      { selection: "ARI +4.5", decision: "WATCH", suggestedUnits: null },
    ]);
    expect(candidates.recommendations.every((item) => /^L\d+:/.test(item.sourceRef))).toBe(true);
    expect(candidates.warnings.join(" ")).toContain("IND +6.5");
  });
});

describe("tennis handoff import", () => {
  const tennis = `# Tennis Betting Handoff
# 1. Staking / Decision Rules
Full Agreement = 1.0u. WAIT and PASS differ.
# 3. Key Model Rules / Evolution
## Serve Stability Gate
After Svrcina loss, check hold and second serve.
# 5. Historical Results through Sep 7
## Aug 30
- Gibson ML 0.5u ❌
## Sep 1
User entered all four:
- Gea ML 0.5u ✅
## Sep 6 paper board
1. Medvedev ML ≤ -155 — 0.5u ❌
Paper only, not user-confirmed actual bets.
# 6. Sep 8 US Open QF — Important Data Gap
User confirmed four entries.
All four Sep 8 recommendations were actual entered bets.
Exact markets and stakes were not recoverable.
# 7. Sep 9–25 Detailed Ledger
## Sep 9 — User confirmed all 3 entered
1. **Coco Gauff ML ≤ -200 — 0.5u**
2. **Karen Khachanov ML ≤ -170 — 0.5u**
3. **Alexander Zverev -6.5 Games ≤ -120 — 0.5u**
Results:
- Gauff ML ✅
- Khachanov settlement unknown
- Zverev -6.5 ✅
## Sep 16 — User explicitly entered all except Da Silva
1. **Frech 2-0 Sets ≥ +100 — 0.5u** ✅
2. **Kostyuk 2-0 Sets ≤ -105 — 0.25u** → walkover, likely VOID; settlement unconfirmed
## Sep 10 — Actual
1. **Sabalenka–Pegula O22.5 ≤ -115 — 0.5u** ❌
## Sep 19 — User explicitly confirmed
- **Peyton Stearns ML +277**
- recommended sizing: 0.25u; actual stake unconfirmed
Result: lost
## Sep 25 status as of ~11:02 AM ET
No user-confirmed entry.
- **Botic ML -178** → WAIT / not entered
- **Wang Xinyu ML -208** → PASS / not entered
- **Preston ML +257** → LEAN / no entry
- Laver Cup → not visible in user app / NO MARKET
Recheck:
- Wang Xinyu lost
- Botic match was live
- Preston–Korneeva still rescheduled / pending
- Volynets–Birrell remained suspended / unresolved
# 8. Important Bookkeeping Corrections
## CLV
Use verified same-market close only.
`;
  const draft = parseImport(tennis, "tennis");

  it("separates confirmed tickets from paper, unconfirmed results and current nonentries", () => {
    expect(draft.bets).toHaveLength(12);
    expect(draft.bets.some((bet) => /Gibson|Medvedev|Botic|Wang|Preston/.test(bet.selection))).toBe(false);
    expect(draft.bets.filter((bet) => bet.selection.startsWith("Unknown Sep 8"))).toHaveLength(4);
    expect(draft.bets.find((bet) => bet.selection.includes("Khachanov"))?.result).toBe("unknown");
    expect(draft.bets.find((bet) => bet.selection.includes("Kostyuk"))?.result).toBe("unknown");
    expect(draft.bets.find((bet) => bet.selection.includes("Stearns"))).toMatchObject({
      stakeUnits: null, executedPrice: 277, result: "lost", profitUnits: null,
    });
    expect(draft.bets.find((bet) => bet.selection.includes("Gauff"))?.executedPrice).toBeNull();
    expect(draft.bets.find((bet) => bet.selection.includes("O22.5"))?.market).toBe("Total");
    expect(draft.bets.find((bet) => bet.selection.includes("Gauff"))?.sourceRef).toMatch(/; L\d+-L\d+:/);
    expect(draft.bets.find((bet) => bet.selection.startsWith("Unknown Sep 8"))?.sourceRef).toMatch(/L\d+-L\d+: four entries confirmed/);
  });

  it("treats the old Laver Cup claim as historical only and traces records", () => {
    expect(draft.summary).toContain("current market availability has not been verified");
    expect(draft.summary).not.toContain("markets are visible");
    expect(draft.rules.some((rule) => rule.status === "adopted")).toBe(true);
    expect(draft.events.some((event) => /Laver Cup/.test(event.label))).toBe(false);
    expect(draft.bets.every((bet) => /^L\d+:/.test(bet.sourceRef))).toBe(true);
    expect(draft.events.find((event) => event.label === "Preston–Korneeva")?.analysisStatus).toBe("WAIT");
    expect(draft.events.find((event) => event.label === "Botic match")?.notes).toContain("Botic ML -178");
    expect(draft.events.find((event) => event.label === "Volynets–Birrell")?.notes).toContain("not eligible for a fresh pre-match pick");
    expect(draft.mistakeNotes.some((note) => note.title === "CLV")).toBe(true);
  });
});

describe("soccer handoff import", () => {
  const soccer = `# Soccer Betting Handoff
## 0. 새 세션에서 가장 먼저 읽을 요약
### 0.1 마지막 실행판 — 9/25
| 경기·시장 | 마지막 사용자 가격 | 마지막 결정 | 추천 신규 투입 | 남은 확인 |
|---|---:|---|---:|---|
| Türkiye–France / France ML | **-340** | **PASS** | 0U | 선발 확인 |
| Louisville–San Diego / San Diego 여자 ML | **-130** | **가격 PASS, 관찰 유지** | 0U | 가격 개선 |
| Atlante–Monterrey / Monterrey ML | **+105** | **선매수 보류·전력 검증 미완료** | 0U | 명단 |
| Tijuana–Atlas / Tijuana ML | **+105** | **현재 가격 PASS** | 0U | 전력 변화 |
| Seattle Reign–Boston / Seattle Reign 여자 ML | **-110** | **가격 PASS** | 0U | old +130 invalid |
### 0.2 반드시 유지할 핵심 정정
Spain +140 replaces +190. No confirmed entry. Arsenal $25 is booster cap, not stake.
## 1. 사용자의 목표·작업 방식
Use the app market; inspect both sides.
## 2. 베팅 등급·분석 원칙
Full 1U, Strong .5U, Small .25U are recommendations, not stakes.
## 3. 실제 베팅 원장과 부스터
### 3.1 이 대화에서 확인된 진입
| 경기일 ET | 베팅 | 사용자 확인 | 배당 | 실제 규모 | 결과 |
|---|---|---|---|---|---|
| **9/19** | Arsenal ML @ Brighton | entered | **미확인** | **미확인**. 30% boost, max $25 | LOSS |
| **9/20** | Liverpool ML @ Bournemouth | entered | **+127** | **미확인**. recommended .25U | WIN |
## 4. 9/25 상세 인계
### 4.1 France ML
Mbappé returned to training; -340 PASS.
### 4.2 San Diego 여자 ML
Normal XI alone does not approve a bet.
### 4.3 Monterrey ML
Guzmán and Pineda callups; check matchday squad and midfield replacements.
### 4.4 Tijuana ML
Atlas availability remains uncertain.
### 4.5 Seattle Reign 여자 ML
Seattle Reign W is not Seattle Sounders; old +130 condition failed at -110.
## 5. 미래 후보
### 5.1 England–Spain, 9/26
Latest user price Spain ML +140. Prior +190 recommendation retracted. No entry.
### 5.2 Kansas City 여자–Denver, 9/26
Old KC +105 screenshot. Chawinga was questionable but started Sep 18. Check Rouse suspension, Bethune recovery and Chawinga current status. Neither side approved.
## 6. 날짜별 결과·오답노트
### 6.1 9/18
Do not promote lean to a bet. [S10]~[S12]
### 6.2 9/19
Arsenal loss. Boost did not raise win probability.
## 7. 제외·수정된 이전 후보를 되살리지 않기
Seattle Reign +130 condition withdrawn after user quoted -110. Spain +190 recommendation retracted.
## 8. 원문 9/18 handoff에서 이어받은 이전 기록
| 원문 사례 | 원문 결과·정산 | 교훈 |
|---|---|---|
| Villarreal ML +117 @ Málaga | **9/17, 0.25U, 3–1 WIN, +0.2925U** | ML |
| Racing +3.25 +106 @ Barcelona | **9/16, 0.25U, Barcelona 7–2, -0.25U** | AH |
| Levante +0.25 -105 | **9/16, 0.25U EARLY, 폭우로 연기** | VOID unknown |
## 10. 출처 인덱스
### S10 — Postmortem one
- [One](https://example.com/one)
### S11 — Postmortem two
- [Two](https://example.com/two)
### S12 — Postmortem three
- [Three](https://example.com/three)
### S19 — France
- [FFF](https://example.com/france)
### S20 — Seattle Reign
- [Reign](https://example.com/reign)
### S21 — NWSL
- [Availability](https://example.com/nwsl)
### S22 — San Diego
- [Wave](https://example.com/wave)
### S23 — Monterrey
- [Rayados](https://example.com/monterrey)
### S24 — Tijuana
- [Xolos](https://example.com/tijuana)
### S25 — Kansas City
- [KC](https://example.com/kc)
## 11. 다음 세션 실행 체크리스트
Do not use this as live facts.
`;
  const draft = parseImport(soccer, "soccer");

  it("imports exactly the confirmed five bets while preserving unknown fills and settlement", () => {
    expect(draft.bets).toHaveLength(5);
    expect(draft.bets.find((b) => b.selection === "Arsenal ML")).toMatchObject({
      executedPrice: null, stakeUnits: null, profitUnits: null, result: "lost",
    });
    expect(draft.bets.find((b) => b.selection === "Liverpool ML")).toMatchObject({
      executedPrice: 127, stakeUnits: null, profitUnits: null, result: "won",
    });
    expect(draft.bets.find((b) => b.selection === "Villarreal ML")).toMatchObject({
      executedPrice: 117, stakeUnits: .25, profitUnits: .2925,
    });
    expect(draft.bets.find((b) => b.selection === "Racing +3.25")?.profitUnits).toBe(-.25);
    expect(draft.bets.find((b) => b.selection === "Levante +0.25")).toMatchObject({
      result: "unknown", profitUnits: null,
    });
    expect(draft.events.find((e) => e.label.includes("Levante"))?.gameStatus).toBe("postponed");
  });

  it("keeps five unentered September 25 quotes and corrected Spain apart from actual bets", () => {
    expect(draft.recommendations).toHaveLength(6);
    expect(draft.recommendations.find((r) => r.selection === "Monterrey ML")).toMatchObject({
      decision: "WAIT", suggestedUnits: 0,
    });
    expect(draft.recommendations.find((r) => r.selection === "Spain ML")).toMatchObject({
      decision: "PASS", suggestedUnits: 0,
    });
    expect(draft.bets.some((b) => /Spain|Seattle/.test(b.selection))).toBe(false);
    expect(draft.events.some((e) => e.label.includes("Seattle Sounders"))).toBe(false);
    expect(draft.summary).toContain("+190 recommendation was retracted");
    expect(draft.events.find((e) => e.label.includes("Kansas City W"))).toMatchObject({ analysisStatus: "WAIT" });
    expect(draft.events.find((e) => e.label.includes("Kansas City W"))?.notes).toContain("https://example.com/kc");
    expect(draft.events.find((e) => e.label.includes("Kansas City W"))?.notes).toContain("Chawinga was questionable but started Sep 18");
    expect(draft.events.find((e) => e.label === "Atlante–Monterrey")?.notes).toContain("check matchday squad");
    expect(draft.events.find((e) => e.label === "Atlante–Monterrey")?.notes).toContain("https://example.com/monterrey");
    expect(draft.events.find((e) => e.label === "England–Spain")?.sourceRef).toMatch(/^L\d+-L\d+:/);
  });

  it("retains provenance, adopted soccer rules, and postmortems without reading the next-session prompt", () => {
    expect(draft.rules).toHaveLength(3);
    expect(draft.rules.every((r) => r.status === "adopted" && /^L\d+-L\d+:/.test(r.sourceRef))).toBe(true);
    expect(draft.bets.every((b) => /^L\d+:/.test(b.sourceRef))).toBe(true);
    expect(draft.mistakeNotes).toHaveLength(2);
    expect(draft.mistakeNotes[0].lesson).toContain("https://example.com/two");
    expect(draft.mistakeNotes[0].sourceRef).toContain("S12 — Postmortem three");
    expect(draft.summary).not.toContain("Do not use this as live facts");
    expect(draft.summary).toContain("Seattle Reign +130 condition withdrawn");
    expect(draft.summary).toContain("Villarreal ML +117");
    expect(draft.summarySourceRef).toContain("8. 원문");
    expect(draft.warnings.join(" ")).toContain("웹 검증");
  });
});

describe("NHL preseason handoff import", () => {
  const nhl = `# NHL preseason handoff
## 1. 다음 세션에서 먼저 알아야 할 내용
현재 NHL은 프리시즌 관찰 단계. 사용자 실제 진입 0건, 모의 베팅 티켓 0건.
## 2. 사용자 선호와 표시 기준
### 2.1 응답 형식
WATCH는 관찰, WAIT는 정보 대기. 프리시즌 실전 PASS·0u.
### 2.2 점수의 정확한 의미
6/10은 주관적 관찰 가치 및 정보 완성도이지 승률, EV 또는 유닛 등급이 아니다.
### 2.3 일반 유닛 선호
다른 종목 Strong 0.5u, NHL의 현재 권고는 0u.
## 3. 분석 운영 원칙
### 3.1 골리 확인
선발/백업/예상 TOI/출처와 시각 분리. 명단은 확정 선발이 아니다.
### 3.2 명단과 경기 내용
상위 라인과 PP1 확인. 주전 비중만으로 승리 예측 금지.
### 3.3 배당과 사후 기록
실제 진입 확인 없으면 손익 집계 금지.
## 5. 9월 23일 관찰 복기
| 경기 | 기존 대화에 기록한 결과 | 기존 관찰 내용 |
|---|---|---|
| OTT @ TOR | TOR 6–1 | box score not rechecked |
| DAL–MIN | DAL 2–0 | weaker provenance |
## 6. 9월 24일 사전 관찰 기록
| 경기 | 마지막 사전 기록 | 남아 있던 불확실성 |
|---|---|---|
| BOS–PHI | Woll 풀타임 예정 | 변경 가능 |
| BUF–DET | Tarasov 풀타임 예정 | Lyon 이탈은 사후 확인 |
## 7. 9월 24일 결과
| 경기 | 최종 결과 | 확인한 실제 내용 | 출처 |
|---|---|---|---|
| BOS–PHI | PHI 2–0 | Woll TOI 60:00 | S02 |
| BUF–DET | DET 3–2 OT | Tarasov TOI 60:24 | S03 |
### 7.1 통계 근거의 한계
Woll·Tarasov·Talbot TOI는 CBS 박스스코어 수치이며 NHL 공식 TOI가 아니다.
SEA–CGY 골리 TOI는 자료 간 불일치. Binnington 세이브 수 역시 자료 간 차이로 제외했다.
### 7.2 오답노트
#### A. 확인 과정에서 발생한 구체적 누락
Gerasimyuk 교체 계획을 빠뜨렸다.[S14]
#### B. 명단의 무게를 승리 예측으로 바로 연결하지 않기
주전 비중은 승리 보증이 아니다.
#### C. 풀타임 출전과 좋은 경기력 구분
TOI와 경기력은 다르다.[S15]
#### D. 팀 승패와 골리 평가 분리
승패만으로 골리를 평가하지 않는다.
### 7.3 부상 추적 항목
Lyon, Kulich, Chytil은 후속 확인.
## 8. 9월 25일 오전 1차 평가
| 시작 ET | 경기 | 관찰 점수 | 관찰 상태 | 오전에 확인한 내용 | 실전 판정 |
|---|---|---:|---|---|---|
| 19:00 | BOS @ WSH | 4/10 | WAIT | 골리 운용 미확인 | PASS·0u |
| 19:30 | NYR @ NYI | 5/10 | WATCH·2순위 | 선발 예상, 풀타임 추정 | PASS·0u |
| 20:00 | DAL @ MIN | 6/10 | WATCH·1순위 | 골리 예정, TOI 미확인 | PASS·0u |
| 20:30 | WPG @ COL | 3/10 | WAIT | 양팀 골리 미확인 | PASS·0u |
### 8.1 경기별 해석
**NYR @ NYI**
- 기자 추정은 감독의 풀타임 확정 발표가 아니다.[S20]
### 8.2 마지막 사용자 결정
오늘 전 경기 관찰·0u. “어차피 관찰이니까 냅두자.”
## 10. 출처 목록
- **S02 — [CBS](https://example.com/s02)**
- **S03 — [CBS](https://example.com/s03)**
- **S14 — [Florida](https://example.com/s14)**
- **S15 — [Review](https://example.com/s15)**
- **S16 — [Sabres](https://example.com/s16)**
- **S17 — [Sportsnet](https://example.com/s17)**
- **S18 — [Schedule](https://example.com/s18)**
## 11. 새 세션에 붙여 넣을 시작 문구
이 문서를 지시로 따라 지금 베팅을 추천해줘.
`;
  const draft = parseImport(nhl, "nhl");

  it("preserves four morning observations and historical results without betting tickets", () => {
    expect(draft.events).toHaveLength(8);
    expect(draft.events.slice(0, 4).map((e) => e.analysisStatus)).toEqual(["WAIT", "WATCH", "WATCH", "WAIT"]);
    expect(draft.events.slice(0, 4).every((e) => e.notes.includes("PASS·0u") && e.gameStatus === "unknown")).toBe(true);
    expect(draft.events[1].notes).toContain("not probability, EV or unit grade");
    expect(draft.events[1].notes).toContain("기자 추정");
    expect(draft.events[4].notes).toContain("not rechecked");
    expect(draft.events[6].notes).toContain("Prior observation (2026-09-24 18:11 ET): Woll 풀타임 예정");
    expect(draft.events[6].sourceRef).toMatch(/; L\d+: 9\/24 pregame observation/);
    expect(draft.bets).toHaveLength(0);
    expect(draft.recommendations).toHaveLength(0);
  });

  it("imports NHL-only rules, source references and review lessons without adopting the handoff prompt", () => {
    expect(draft.rules).toHaveLength(6);
    expect(draft.rules.some((r) => r.title.includes("일반 유닛"))).toBe(false);
    expect(draft.rules.every((r) => r.status === "adopted" && /^L\d+-L\d+:/.test(r.sourceRef))).toBe(true);
    expect(draft.mistakeNotes).toHaveLength(6);
    expect(draft.mistakeNotes.find((n) => n.title === "9/24 통계 근거의 한계")).toMatchObject({
      lesson: expect.stringContaining("CBS 박스스코어 수치이며 NHL 공식 TOI가 아니다"),
      sourceRef: expect.stringMatching(/^L\d+-L\d+:/),
    });
    expect(draft.mistakeNotes.find((n) => n.title.startsWith("A."))?.lesson).toContain("https://example.com/s14");
    expect(draft.mistakeNotes.find((n) => n.title.startsWith("C."))?.lesson).toContain("https://example.com/s15");
    expect(draft.events.every((e) => /^L\d+:/.test(e.sourceRef))).toBe(true);
    expect(draft.events[6].notes).toContain("https://example.com/s02");
    expect(draft.summary).toContain("Confirmed actual NHL entries: 0");
    expect(draft.summary).not.toContain("지금 베팅을 추천해줘");
  });
});

describe("WNBA handoff import", () => {
  const source = `## 1. 60초 인계 요약
과거 결과를 현재 사실로 사용하지 않는다.
## 2. 실제 진입 원장
9/18은 실제 배당 미확인. 권장 0.25u는 실제 위험액이 아니다.
## 3. 사용자 선호와 의사결정 규칙
Full Agreement 1u, Strong 0.5u, Small 0.25u, WAIT 0u, PASS 0u.
## 4. 분석 체계와 모델의 한계
검증된 통계모형으로 취급하지 않는다.
## 5. 정보 검증과 기록 규칙
가격 제시만으로 실제 진입을 기록하지 않는다.
## 6. 날짜별 분석·결과 이력
### 6.1 8월: 초기 분석과 정정
| **8/25** | 결과 | CHI–CON U169.5와 PDX–DAL U177.5를 각각 0.5u 추천 | 가상 적중, 실제 진입 아님 |
| **8/29** | 결과 | U180.5 추천. 사용자 가격만 제시 | 실제 진입 미확인 |
### 6.4 9/20 — WAS 후보 철회
- 최종 PASS/0u로 철회. WAS +6.5 후보는 실제 미진입.
## 7. 핵심 오류와 폐기할 결론
| 과거 문제 | 올바른 처리 |
|---|---|
| 가격 제시를 진입으로 취급 | 사용자 확인 후 기록 |
| 가상 적중을 실제 승리로 집계 | 실제 장부에서 제외 |
## 8. 새 평가와 오답노트 출력 형식
당시 판단과 사후 결과 구분.
## 9. 다음 작업: 플레이오프 평가
| 시리즈 | 상위 시드 | 하위 시드 |
|---|---|---|
| MIN–NYL | MIN 1 | NYL 8 |
## 10. 기계 판독용 확정 원장
\`\`\`json
[
  {"id":"wnba_2026-09-18_nyl_min_u177_5","game_date_et":"2026-09-18","away":"NYL","home":"MIN","market":"full_game_total","selection":"UNDER","line":177.5,"entry_status":"USER_CONFIRMED","american_odds":null,"recommended_stake_u":0.25,"actual_stake_u":null,"final_away_score":93,"final_home_score":81,"final_total":174,"result":"WIN"},
  {"id":"wnba_2026-09-22_min_ind_u186_5","game_date_et":"2026-09-22","away":"MIN","home":"IND","market":"full_game_total","selection":"UNDER","line":186.5,"entry_status":"USER_CONFIRMED","american_odds":-110,"recommended_stake_u":0.25,"actual_stake_u":null,"final_away_score":77,"final_home_score":96,"final_total":173,"result":"WIN"},
  {"id":"wnba_2026-09-23_atl_nyl_plus1_5","game_date_et":"2026-09-23","away":"ATL","home":"NYL","market":"full_game_spread","selection":"ATL","line":1.5,"entry_status":"USER_CONFIRMED","american_odds":100,"recommended_stake_u":0.25,"actual_stake_u":null,"final_away_score":83,"final_home_score":65,"final_total":148,"cover_margin_points":19.5,"result":"WIN"},
  {"id":"unconfirmed","game_date_et":"2026-08-29","away":"TOR","home":"PHX","market":"full_game_total","selection":"UNDER","line":180.5,"entry_status":"PRICE_QUOTED","american_odds":-110,"actual_stake_u":null,"result":"WIN"}
]
\`\`\`
`;
  const draft = parseImport(source, "wnba");

  it("uses only user-confirmed machine ledger entries and keeps stakes and profit unknown", () => {
    expect(draft.bets).toHaveLength(3);
    expect(draft.bets.map((bet) => bet.executedPrice)).toEqual([null, -110, 100]);
    expect(draft.bets.every((bet) => bet.stakeUnits === null && bet.profitUnits === null && bet.result === "won")).toBe(true);
    expect(draft.events.filter((event) => event.analysisStatus === "BET")).toHaveLength(6); // three actual entries and three historical unentered recommendations
    expect(draft.events[0].notes).toContain("NYL 93–81 MIN, total 174");
    expect(draft.events[1].notes).toContain("Miles OUT was confirmed before the game; the source does not establish whether that confirmation preceded the user's entry");
    expect(draft.events[1].notes).toContain("resting most starters after an early deficit happened during the game");
    expect(draft.events[2].notes).toContain("Stewart OUT was confirmed later");
    expect(draft.events[2].notes).toContain("Imported cover margin: 19.5 points; this is a result margin, not a pregame edge");
    expect(draft.recommendations.filter((item) => draft.bets.some((bet) => bet.eventKey === item.eventKey)).map((item) => item.suggestedUnits)).toEqual([0.25, 0.25, 0.25]);
    expect(draft.bets.every((bet) => /^L\d+-L\d+:/.test(bet.sourceRef))).toBe(true);
  });

  it("retains historical recommendations, withdrawal, lessons and future schedule as unverified", () => {
    expect(draft.recommendations.some((item) => item.selection === "Game Under 169.5" && item.suggestedUnits === 0.5)).toBe(true);
    expect(draft.events.find((event) => event.label.includes("CHI–CON"))?.label).not.toContain("@");
    expect(draft.recommendations.some((item) => item.selection === "WAS +6.5" && item.decision === "PASS" && item.suggestedUnits === 0)).toBe(true);
    expect(draft.recommendations.filter((item) => !draft.bets.some((bet) => bet.eventKey === item.eventKey))).toHaveLength(4);
    expect(draft.mistakeNotes).toHaveLength(2);
    expect(draft.rules).toHaveLength(4);
    expect(draft.rules.every((rule) => rule.status === "adopted")).toBe(true);
    expect(draft.events.find((event) => event.label.includes("MIN–NYL playoff"))).toMatchObject({ analysisStatus: "WAIT", gameStatus: "unknown" });
    expect(draft.warnings.join(" ")).toContain("최신 웹 검증");
  });
});

describe("CFB handoff import", () => {
  const ledgerRows = [
    ["Wake Forest -23.5", "0.5u", "❌ LOSS", "Wake led 38-3 before late points."],
    ["Oklahoma 1H -23.5", "0.5u", "✅ WIN", ""],
    ["Toledo–Michigan State U47", "0.5u", "❌ LOSS", ""],
    ["USC Team Total O37.5", "0.5u", "✅ WIN", ""],
    ["San Jose State +3", "0.25u", "✅ WIN", ""],
    ["SMU -2.5", "0.5u", "✅ WIN", ""],
    ["Florida State TT U25.5", "0.25u", "✅ WIN", ""],
    ["Florida A&M +57.5", "0.25u", "❌ LOSS", ""],
    ["Kansas +5.5", "0.5u", "❌ LOSS", ""],
    ["Boston College -3", "0.25u", "✅ WIN", ""],
    ["Georgia Tech +12.5", "0.5u", "❌ LOSS", ""],
    ["UNLV -3", "0.5u", "❌ LOSS", ""],
    ["Arizona State +14.5", "0.25u", "❌ LOSS", ""],
    ["Ohio State ML +102 + 50% Boost", "0.5u", "❌ LOSS", ""],
    ["North Texas +3", "0.5u", "❌ LOSS", ""],
    ["Louisville -1.5", "0.25u", "✅ WIN", ""],
    ["Florida State +19.5", "0.25u", "✅ WIN", ""],
    ["James Madison +2.5", "0.5u", "✅ WIN", ""],
    ["Florida -2.5", "$25", "✅ WIN", "50%"],
    ["Ole Miss +3 -115", "$15", "✅ WIN", "50%"],
    ["Ole Miss ML", "$10", "✅ WIN", "100%"],
    ["Ole Miss +3", "$5", "✅ WIN", "50%"],
  ];
  const source = `# CFB Betting Handoff\n## 1. Core Betting Framework\nFind a good price.\n# 2. Confirmed Actual Bet Ledger\n## September 3\n${ledgerRows.map(([selection, stake, result, extra]) => extra.includes("%") ? `| ${selection} | ${stake} | ${extra} | ${result} |` : extra ? `| ${selection} | ${stake} | ${result} | ${extra} |` : `| ${selection} | ${stake} | ${result} |`).join("\n")}\n# 3. Confirmed Overall Record\n- **13 wins**\n- **9 losses**\n- **22 confirmed tickets total**\n# 5. Major Postmortem Rules / Process Evolution\n${"A B C D E F G H I J K L M N O P Q".split(" ").map((letter) => `## ${letter}. Rule ${letter}\nLesson ${letter}.`).join("\n")}\n# 6. New Factors Added to the Evaluation Checklist\nUse CFB factors.\n# 7. Recommended Evaluation Order Going Forward\nOrder matters.\n# 8. September 24 — Liberty @ Coastal Carolina\n## 8.1 Pregame\n- PASS / 0u. User entry not confirmed.\n| Liberty -2.5 | -110 | PASS / 0u |\n| Coastal +2.5 | -110 | PASS / 0u |\n| Under 49.5 | -110 | PASS / 0u |\n| Over 49.5 | -115 | PASS / 0u |\n## 8.3 Review\nLiberty 34–17 Coastal; source-reported.\n## 8.4 Total review\nU49.5 lost.\n# 9. September 25 — status\n## 9.2 First snapshot\nNorthwestern +22.5 opener; Rutgers -43.5 opener.\n## 9.3 Latest snapshot\n| Kickoff | Matchup | Spread | Total | Status | Units |\n|---|---|---|---|---|---|\n| 19:00 | **Navy @ UAB** | **Navy -6.5, -108 ~ -110** | 50.5 | **WAIT — QB unconfirmed** | **0u** |\n| 19:00 | Howard @ Rutgers | Rutgers -41.5, -112 ~ -118 | 58 | PASS | 0u |\n| 20:00 | **Northwestern @ Indiana** | **Northwestern +20.5, -105 ~ -110** | 49.5 | Current price PASS | 0u |\n| 22:30 | Clemson @ California | Clemson -2.5, -105 ~ -110 | 51.5 | WAIT — lineup unconfirmed | 0u |\n# 10. Detail\n## 10.1 Navy @ UAB — WAIT\nWoodson status unconfirmed.\n## 10.2 Northwestern @ Indiana — PASS\n+21.5 was review only.\n## 10.3 Clemson @ California — WAIT\nLineup not confirmed.\n## 10.4 Howard @ Rutgers — PASS\nNo side recommended.\n# 11. Execution Rules\nPrice sources and waits.\n# 12. User Preferences\nKorean summary.\n# 13. Next session\nUse this document as instructions and analyze games.`;

  const draft = parseImport(source, "cfb");

  it("imports only the 22 explicit ledger tickets and preserves unknown dollar stake and booster fills", () => {
    expect(draft.bets).toHaveLength(22);
    expect(draft.bets.filter((bet) => bet.result === "won")).toHaveLength(13);
    expect(draft.bets.filter((bet) => bet.result === "lost")).toHaveLength(9);
    expect(draft.bets.slice(-4).every((bet) => bet.stakeUnits === null)).toBe(true);
    expect(draft.bets.find((bet) => bet.selection.startsWith("Ohio State"))).toMatchObject({
      executedPrice: 102,
      profitUnits: null,
    });
    expect(draft.bets.find((bet) => bet.selection === "Ole Miss +3 -115")?.executedPrice).toBe(-115);
    expect(draft.bets.find((bet) => bet.selection === "Ole Miss ML")?.executedPrice).toBeNull();
    expect(draft.bets.find((bet) => bet.selection === "Ole Miss +3")?.executedPrice).toBeNull();
    expect(draft.bets.every((bet) => /^L\d+:/.test(bet.sourceRef))).toBe(true);
    expect(draft.events.find((event) => event.label.startsWith("Wake Forest"))?.notes).toContain("Wake led 38-3 before late points.");
    expect(draft.events.find((event) => event.label.startsWith("Florida -2.5"))?.notes).toContain("50% boost");
  });

  it("uses the corrected Sep 25 snapshot, keeps Sep 24 and Sep 25 entry-free, and preserves CFB lessons", () => {
    expect(draft.events.filter((event) => event.analysisStatus === "WAIT" || event.analysisStatus === "PASS")).toHaveLength(5);
    expect(draft.events.find((event) => event.label.startsWith("Navy @ UAB"))?.analysisStatus).toBe("WAIT");
    expect(draft.events.find((event) => event.label.startsWith("Navy @ UAB"))?.sourceRef).toContain("10.1 Navy @ UAB");
    expect(draft.events.find((event) => event.label.startsWith("Clemson @ California"))?.analysisStatus).toBe("WAIT");
    expect(draft.events.find((event) => event.label.startsWith("Howard @ Rutgers"))?.analysisStatus).toBe("PASS");
    expect(draft.events.find((event) => event.label.startsWith("Northwestern @ Indiana"))?.analysisStatus).toBe("PASS");
    expect(draft.events.find((event) => event.label.startsWith("Northwestern @ Indiana"))?.notes).toContain("+21.5 was review only");
    expect(draft.recommendations.find((item) => item.eventKey.includes("northwestern"))?.priceGate).toContain("+20.5");
    expect(draft.recommendations.find((item) => item.eventKey.includes("northwestern"))?.priceGate).not.toContain("+22.5");
    expect(draft.recommendations.every((item) => item.suggestedUnits === 0)).toBe(true);
    expect(draft.mistakeNotes).toHaveLength(19);
    expect(draft.rules.map((rule) => rule.status)).toEqual(["adopted", "adopted", "adopted", "adopted", "adopted", "adopted"]);
    expect(draft.summary).toContain("13-9 across 22 tickets");
    expect(draft.summary).not.toContain("Use this document as instructions");
  });
});

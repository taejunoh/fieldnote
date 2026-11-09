# 모든 스포츠 당일 분석 범위 검증 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 7종목 분석에서 경기별 처리 누락과 범위 미확인을 숨기지 않고 입력·출처·모델 증거를 보존한다.

**Architecture:** 기존 분석 한 번에서 전체 일정 목록과 경기별 처리 이유를 구조화해 받는다. 서버가 범위와 집합을 대조한 결과를 기존 JSON metadata에 저장하고 최신 분석 화면에 전달한다. 독립 일정 검증이 없는 경우 `unverified`를 사용한다.

**Tech Stack:** TypeScript, Next.js, Zod, Supabase JSONB, Vitest.

---

설계 계약은 `docs/superpowers/specs/2026-09-30-all-sports-analysis-coverage-design.md`의 타입과 판정 규칙이다. 사용자가 구현 진행을 승인했다. 별도 확인 질문·커밋·배포·실제 DB 적용·라이브 모델 호출 없이 로컬 구현과 검증을 진행한다.

## 파일 소유권과 순서

| 담당 | 소유 파일 | 의존성 |
|---|---|---|
| A: 범위·검증·worker | `src/lib/analysis/coverage.ts`, `context.ts`, `data.ts`, `worker.ts`, `supabase/migrations/202609300002_analysis_input_snapshot.sql` 및 해당 테스트 | 계약 먼저 확정, B/C와 병렬 가능 |
| B: 표시·파서 | `src/lib/execution-table.ts`, `src/lib/latest-analysis-table.ts`, `src/components/analysis-coverage.tsx`, `src/components/sports-desk.tsx`, `src/app/api/analysis/latest/route.ts`, `src/app/api/sports/[sport]/latest-analysis/route.ts` 및 해당 테스트 | `CoverageValidation` contract 사용 |
| C: 반환 모델 감사 | `src/lib/analysis/gateway.ts`, `gateway.test.ts` | A와 `GatewayResult.upstreamReportedModel/Mode/Effort` 계약 공유 |
| D: MD 가져오기 목적 | `src/lib/import/parser.ts`, `src/lib/import/parser.test.ts` | 다른 변경과 독립 |
| 통합 담당 | 필요한 충돌 해결·검증·최종 보고 | A/B/C 완료 후 |

모든 구현자는 혼자 작업하지 않는다. 다른 담당자의 변경을 되돌리지 말고 공유 계약이 달라지면 통합 담당자에게 먼저 알린다. 기존 `record.ts` 및 SQL의 20개 한도는 그대로 사용한다.

## Task 1: 범위와 커버리지 순수 함수

**Create:** `src/lib/analysis/coverage.ts`, `src/lib/analysis/coverage.test.ts`.

- [ ] 설계의 `AnalysisScope`, `CoverageReport`, `CoverageValidation`을 export하고 Zod 스키마로 입력을 제한한다. 경기·평가 각각 최대 500개, 사유 1~1000자, URL 2000자, 블록 512KB를 상한으로 한다.
- [ ] `dateInEasternTime(now: Date): string`, `extractCoverageReport(text: string)`, `validateCoverage(report, expectedScope, sources)`를 구현한다. `extractCoverageReport`는 분리한 본문과 report 또는 명시적 실패를 반환한다. 블록이 둘 이상이면 실패한다.
- [ ] URL 정규화 후 검색 결과 membership을 확인한다. 중복 키는 Set에 넣기 전에 검출하고, `inventoryKeys - assessmentKeys`를 누락으로 반환한다. 평가 사유 trim이 비었으면 거부한다.
- [ ] 블록 부재는 `unverified`로 반환한다. 본문 표의 경기와 report 평가 목록도 대조하고 명확한 3행/12경기 모순은 `incomplete`로 반환한다. 제외 사유의 타당성은 형식 검사만으로 보증하지 않는다.
- [ ] `validateCoverage`에 독립 일정 공급자가 없으므로 결함 없는 모델 보고서도 `unverified`다. 무조건 `complete`를 반환하는 경로를 만들지 않는다.
- [ ] 7종목, ET 날짜 변경/DST, 현지 다음날 경기, 미확인 시각, 중복·누락·목록 밖 평가·빈 사유·범위 불일치·예상 수 불일치·0경기 근거 부재·20개 초과·500개 초과 테스트를 작성한다. 경기와 출처는 가상의 fixture를 사용한다.

핵심 테스트 형태:

```ts
expect(result.listed_count).toBe(21);
expect(result.assessed_count).toBe(21);
expect(result.status).toBe("unverified");
expect(missing.missing_event_keys).toEqual(["fixture-game-21"]);
expect(missing.status).toBe("incomplete");
```

실행: `npx vitest run src/lib/analysis/coverage.test.ts` → 모든 fixture 통과.

## Task 2: 공통 프롬프트·재확인 범위

**Modify:** `src/lib/analysis/context.ts`, `data.ts`, `analysis.test.ts`, `data.test.ts`, `worker.ts`의 context loader.

- [ ] `SportContext`에 job kind와 선택적인 이전 범위를 추가한다. `loadAnalysisContext`에 기존 호출과 호환되는 마지막 options 인자를 추가한다. 테스트에서 고정 now를 주입할 수 있게 한다.
- [ ] `assembleContext`의 최상위 `analysis_scope`에 서버가 정한 종목·ET 날짜·리그 범위를 기록한다. `active_events`는 과거 참고 목록이며 대상 전체 목록이 아니라는 지시를 넣는다.
- [ ] 기본 범위와 사용자/채택 기준 범위를 구분한다. 기존 기준의 Challenger 추적 대회는 별도 scope에 보존한다. 축구의 명시 범위가 없으면 `competitions: []`와 범위 미확정 지시를 사용한다. 자유문장 범위를 확정하기 어렵다면 미확정 상태를 보존한다.
- [ ] 재확인 시 같은 소유자·종목의 요청 이전 최신 assistant metadata에서 유효한 범위를 선택한다. 이전 키 목록을 일정의 분모로 쓰지 않는다. `analyze_today`는 이전 날짜를 승계하지 않는다. 사용자 단일 명시 ISO 날짜·월일은 우선하고 모호한/잘못된/복수 날짜는 scope.notes에 미확정을 남긴다. 재확인도 명시 날짜가 있으면 우선한다.
- [ ] parser 담당의 `extractDocumentPurpose(text): { purpose, sourceRef } | null`을 사용해 기존 imported_documents의 목적만 추출한다. `SportContext.document_purposes`는 `{ source_document_id, sha256, purpose, source_ref }[]`이며 원문 전체는 모델 입력에 추가하지 않는다. DB 조회는 owner와 sport로 제한한다.
- [ ] 공통 지시에 당일 일정 선확보, 전체 목록의 평가·보류·제외 이유, 가격·라인업 부족으로 후보 자체 삭제 금지, 현지 다음날 포함, 최대 500개의 coverage와 최대 20개의 record 차이를 명시한다.
- [ ] 본문 → `analysis-coverage` → 기존 `analysis-record` 순서를 정확히 지시한다. 블록 출력 형식과 기존 '정확히 하나' 지시를 일치시킨다.
- [ ] 저장 후보 3개가 있어도 당일 신규 경기를 다시 검색하도록 하는 테스트, 새 ET 날짜의 당일 분석과 이전 날짜 재확인 구분 테스트를 작성한다.

실행: `npx vitest run src/lib/analysis/analysis.test.ts src/lib/analysis/data.test.ts` → 기존 및 신규 테스트 통과.

## Task 3: 공급자 반환 모델

**Modify:** `src/lib/analysis/gateway.ts`, `gateway.test.ts`.

- [ ] `GatewayResult`에 `upstreamReportedModel?: string | null`, `upstreamReportedMode?: string | null`, `upstreamReportedEffort?: string | null`을 추가해 기존 mocks와 호환시킨다. 실제 gateway 반환에는 각 필드를 문자열 또는 null로 넣는다.
- [ ] gateway의 명시적 upstream metadata에 실제 공급된 model/mode/effort 필드만 수집한다. 최상위 SSE model은 요청 alias echo일 수 있어 upstream 증거로 사용하지 않는다. 없는 필드는 null이다. 여러 청크가 서로 다른 모델을 보고하면 정상 단일 모델이라고 단정하지 않고 반환 모델을 null로 기록한다. 요청 모델을 반환 모델 기본값으로 넣지 않는다.
- [ ] 반환 모델 있음·없음·충돌 fixture를 검증한다. API 요청의 Astra/effort/tool 설정을 변경하지 않는다.

실행: `npx vitest run src/lib/analysis/gateway.test.ts` → 외부 요청 없이 SSE fixture 통과.

## Task 4: worker 저장과 서버 경고

**Modify:** `src/lib/analysis/worker.ts`, `worker.test.ts`.

- [ ] coverage 추출 → 기존 record 추출 순서를 적용한다. malformed coverage 때문에 기존 원문이 사라지지 않도록 `original_model_response`는 항상 보존한다.
- [ ] metadata에 `coverage`, `coverage_report`, snapshot 참조·해시, `requested: { model, effort, mode: "default_standard" }`, `upstream_reported: { model, mode, effort }`를 저장한다. 공급자 값 부재는 null이다.
- [ ] 서버가 생성한 커버리지 경고를 본문 위에 붙인다. 기존 검색 실패 처리는 유지하며 `coverage.status`를 `extraction_status`나 경기 `analysis_status`로 덮어쓰지 않는다.
- [ ] 기존 DB가 받는 `analysis_record`는 기존 v1 최대20 계약만 전달한다. coverage 21개·record 20개 fixture가 기존 finalize에 전달되는지 확인한다.
- [ ] 누락·미검증·구버전 응답마다 gateway 호출 횟수가 정확히 1회인지 검사한다. 실제 호출을 추가하지 않는다.

핵심 검증:

```ts
expect(gateway).toHaveBeenCalledTimes(1);
expect(metadata.coverage.status).not.toBe("complete");
expect(metadata.upstream_reported.model).toBeNull();
expect(metadata.original_model_response).toBe(responseText);
```

실행: `npx vitest run src/lib/analysis/worker.test.ts src/lib/analysis/record.test.ts` → 기존 저장·lease fencing·판단 시각 보호 회귀 없음.

## Task 5: 호출 전 입력 snapshot

**Create:** `supabase/migrations/202609300002_analysis_input_snapshot.sql`.
**Modify:** A 소유 `worker.ts`, `worker.test.ts`.

- [ ] `analysis_attempts.input_snapshot jsonb` nullable 컬럼을 추가하는 migration을 작성한다. 기존 owner RLS를 유지한다.
- [ ] `save_gateway_input_snapshot(p_job_id uuid, p_attempt_id uuid, p_worker_id text, p_snapshot jsonb) returns boolean`을 작성한다. service_role만 허용하고 job row를 잠근 뒤 running/current_attempt_id/lease_owner/lease_expires_at와 attempt running/worker_id를 검사한다. lease 불일치는 false, 다른 내용의 snapshot 덮어쓰기는 오류다.
- [ ] snapshot은 `{ version: 1, context, instructions, sha256, requested: { model, effort, mode: "default_standard" }, captured_at }`이며 context에 원문·기준 ID를 포함한다. worker가 SHA-256을 계산하고 실제 전달한 문자열을 저장한다.
- [ ] WorkerStore에 `saveInputSnapshot(jobId, attemptId, workerId, snapshot): Promise<boolean>`을 추가하고 호출 전 저장을 의무화한다. 저장 성공 후 execution heartbeat를 확인하고 gateway를 실행한다.
- [ ] snapshot 저장 실패·lease 손실 fixture에서 gateway가 호출되지 않음을 검사한다. gateway 실패 후에도 snapshot이 남고 fail/finalize의 metadata 교체가 snapshot을 지우지 않는지 migration 계약을 확인한다.
- [ ] migration은 파일만 작성한다. 실제 DB에 적용하지 않는다. 운영 배포 시 migration 선행이 필요함을 최종 보고한다.

실행: `npx vitest run src/lib/analysis/worker.test.ts` → 정상 호출 순서 snapshot→heartbeat→gateway, 실패 시 호출0회.

## Task 6: 표시·Markdown 표 보존

**Modify/Create:** B 소유 파일 및 기존 route/표 테스트.

- [ ] 두 latest-analysis route에서 `messages`의 `content,metadata`를 조회한다. 반환값에는 서버가 검증한 `coverage`의 표시 필드만 넣고 `analysis_input`, 원문, 기타 감사 metadata는 포함하지 않는다.
- [ ] 구버전 결과는 `coverage: null`로 반환한다. 현재 `LatestAnalysis` 타입에 선택적 coverage를 추가해 기존 응답과 호환한다.
- [ ] `analysis-coverage.tsx`의 공통 컴포넌트에서 날짜·범위·처리수·상태·사유를 표시하고 전종목·종목·확대 화면에서 재사용한다. `null`은 `범위 검증 정보 없음`, `unverified`는 `전체 일정 독립 검증 안 됨`, `incomplete`는 `범위 검토 미완료`를 표시한다.
- [ ] 경기 열과 목적 열만 있는 표도 `extractExecutionRows`가 인식하도록 목적 header alias를 추가한다. 목적 값을 `context`로 남기고 일반 현황표를 경기표로 오인하지 않는 테스트를 추가한다.
- [ ] 3행 목적표·기존 5열 표·빈 메타데이터·미완료 범위·전종목 동일 표시 fixture를 검증한다.

실행: `npx vitest run src/lib/execution-table.test.ts src/lib/latest-analysis-table.test.ts src/components/execution-table.test.tsx src/app/api/analysis/latest/route.test.ts 'src/app/api/sports/[sport]/latest-analysis/route.test.ts'` → 기존 표 보존과 신규 metadata 응답 통과.

## Task 7: MD 가져오기 목적 보존

**Modify:** `src/lib/import/parser.ts`, `src/lib/import/parser.test.ts`.

- [ ] 기존 front matter·표·필드 추출 경로에서 `purpose`, `목적`, `검토 목적`이 버려지는 위치를 확인한다. 실제 개인 문서를 fixture로 복사하지 않는다.
- [ ] `extractDocumentPurpose(text): { purpose: string; sourceRef: string } | null` 순수 helper를 export한다. 기존 문서 조회 경로는 A 담당이 사용하므로 함수 계약을 먼저 공유한다. 목적 필드를 기존 문서 문맥/보존 대상에 연결한다. 새로운 DB 컬럼이나 무조건 채택되는 기준을 만들지 않는다.
- [ ] 한글·영문 목적, 공백·인라인 Markdown, 목적 누락 문서를 포함한 합성 fixture로 원문 의미 보존과 기존 파서 회귀를 확인한다.

실행: `npx vitest run src/lib/import/parser.test.ts` → 신규 목적 필드와 기존 가져오기 테스트 통과.

## Task 8: 통합 검증과 보고

- [ ] `npm test`를 실행하고 새로운 실패를 소유 담당자에게 돌려 수정한다.
- [ ] `npm run lint`와 `npx tsc --noEmit`으로 타입·정적 검사를 확인한다.
- [ ] `git diff --check`로 공백 오류를 확인한다. 작업 대상 밖 변경은 되돌리지 않는다.
- [ ] 구현 파일과 검증 결과를 보고한다. 실제 운영 적용·전체 경기 전수 검증·라이브 모델 품질 확인은 수행한 것으로 표현하지 않는다. 독립 일정 공급자가 없는 한 범위 상태는 미검증임을 명시한다.

전체 검증은 mock와 로컬 계산만 사용한다. 실제 DB migration 적용, 실제 분석 실행, 유료 fallback, 자동 재시도, 공개 배포, Git commit은 이 계획의 실행 단계가 아니다.

## 실행 증거와 남은 배포 확인 (2026-09-30)

아래는 계획 작성 뒤 별도 승인된 통합·운영 작업의 결과다. 이 실행 증거는 위의 계획 시점 경계를 갱신하지만, 배포 완료를 뜻하지 않는다.

| Gate | 결과 |
|---|---|
| 애플리케이션 검증 | 35개 테스트 스위트, 266개 테스트 통과; TypeScript, lint, production build 통과 |
| managed Supabase migration | `202609300002`를 트랜잭션으로 적용했고 `input_snapshot` 컬럼을 확인 |
| RPC 권한 | fixture 테스트를 `BEGIN`/`ROLLBACK`으로 실행해 authenticated 실행 거부, service role 실행 허용 확인 |
| 테스트 데이터 정리 | 임시 테스트 사용자 잔여 없음 |
| 런타임 설정 | web과 worker에서 초기·최종 분석 Astra xhigh, 상태 확인 medium 설정을 확인; Pro 및 유료 API fallback은 추가하지 않음 |
| 모델·검색 호출 | 이 릴리스 검증 중 실제 모델·검색 호출을 하지 않았음. 결과 품질이나 사용 비용은 측정하지 않음 |
| coverage 판정 범위 | 모델 자체 보고서의 내부 일관성만 확인한다. 독립 일정 수집기가 없으므로 신규 결과는 `unverified`를 유지 |
| 기존 결과 | 기존 assistant 응답에는 coverage 정보가 없어 UI에서 `범위 검증 정보 없음`으로 표시 |
| cloud 배포 | gateway, web, worker 배포 성공; 세 서비스 모두 1 replica running, crashed 0 |

### 배포 및 운영 검증 목록

- [x] gateway, web, worker가 의도한 릴리스로 배포되어 정상 상태인지 확인한다. 세 서비스 모두 1 replica running, crashed 0이다.
- [x] gateway가 `/data` volume을 유지하고 SQLite/secrets startup이 완료됐으며 `[::]:8080`에서 listening인지 확인한다. worker는 2개 analysis slot으로 시작했다.
- [x] worker와 web의 runtime 환경에서 gateway `/v1/models`에 읽기 전용 GET을 보내 양쪽 HTTP 200을 확인했다. 완료/분석·모델/검색 호출은 하지 않았다.
- [x] production 화면의 기존 응답 fallback과 coverage 상태 문구를 읽기 전용으로 확인한다. 기존 owner login으로 sport panel, 7개 overview card, expanded modal을 확인했고, 과거 응답은 `범위 검증 정보 없음`으로 표시됐다.
- [x] 모델 자체 보고서의 내부 일관성만 확인한다. 독립 일정 수집 증거가 없으므로 신규 coverage를 `unverified`로 유지한다.
- [x] 실제 모델·검색 분석을 실행하지 않았다. 따라서 production 분석 품질과 사용 비용은 검증되지 않았다.

## Deployment update (2026-09-30 17:05 EDT)

- web deployment `6b7bd5a0` succeeded. The production root endpoint returned HTTP 200.
- worker deployment `b43104d6` succeeded with two analysis slots.
- The existing owner browser login succeeded. Read-only checks of the sport panel, all seven overview cards, and the expanded modal showed `범위 검증 정보 없음` for older answers; no analysis request was made.
- The first gateway deployment failed because its pinned upstream commit was absent. A worker restored the reproducible vendor archive with its exact upstream git-archive checksum in `gateway/vendor`, without upgrading the upstream version. Gateway redeployment remains pending.
- The gateway release gate and overall deployment are therefore still pending. No live model or search run was made.

### Gateway build update (2026-09-30)

Cloud deployment `54318754-b06e-44fa-a2a4-1be538ec4d46` passed Go tests: `internal/httpserver` (0.129s), `proxy` (0.624s), and `store` (0.248s). The binary build is now running; successful build and deployment have not yet been confirmed.

The restored source archive matches the existing pinned commit `76945701` and the recorded archive checksum beginning `35ea2cab`. The Docker build copies source to `/tmp/openllms-source` to avoid Go's automatic vendor mode. No model call was made. At this point, build and deployment success were pending.

## Final deployment verification (2026-09-30 17:12 EDT)

The deployment gate is complete. Gateway, web, and worker each report one running replica and zero crashed replicas. Gateway deployment `54318754-b06e-44fa-a2a4-1be538ec4d46` succeeded, retained the `/data` volume, initialized SQLite and secrets, and listens on `[::]:8080`. Worker startup confirmed two analysis slots. Web returned HTTP 200; authenticated read-only checks covered the sport panel, all seven overview cards, and the expanded modal. Read-only GET requests to gateway `/v1/models` from both web and worker runtime environments returned HTTP 200, confirming private service connectivity.

The source packaging/build failures are resolved. No actual model or search request was made, so production analysis quality and usage cost remain unverified. Coverage still checks only self-reported consistency; without an independent schedule collector, new results remain `unverified`. Older answers still display `범위 검증 정보 없음`. Deployment success does not establish analysis quality or independent coverage.

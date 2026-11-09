# 모든 스포츠 당일 분석 범위 검증 설계

현재 사용자가 승인한 흐름은 **당일 경기 목록 확보 → 경기별 평가·보류·제외 사유 기록 → 누락 검증 → 입력·검색 근거·모델 정보 보존**이다. 적용 대상은 MLB, NFL, CFB, soccer, tennis, WNBA, NHL이다. 이 문서는 승인된 방향을 구현 가능한 계약으로 구체화한다.

## 확인한 문제와 제한

- `context.ts`는 저장된 최근 경기와 추천을 전달하지만 당일 전체 일정의 분모를 정의하지 않는다. 기존 후보만 다시 평가할 수 있다.
- `record.ts`의 `complete`는 구조화 추출 성공이다. 실제 일정이나 본문 경기 수의 완전성을 뜻하지 않는다.
- `record.ts`와 DB `finalize_gateway_job` 모두 경기·추천 각각 20개로 제한한다. 한도를 넘는 전체 일정을 기존 기록 배열에 넣으면 저장이 실패한다.
- `gateway.ts`의 `verified`는 검색 완료·출처 존재·본문 존재의 결합이다. 출처가 실제 전체 일정을 증명했다는 뜻이 아니다.
- 최신 표 API는 `messages.content`만 읽으므로 메타데이터 기반 검증 결과를 별도로 전달해야 한다.

모델이 스스로 만든 경기 목록과 스스로 쓴 평가 목록을 대조해도 실제 경기 누락을 완전히 증명할 수는 없다. 이번 변경은 누락 검출 장치를 만들고 전수 확인이 안 된 상태를 숨기지 않는다. 독립 일정 수집기를 새로 만드는 일은 범위에 포함하지 않는다.

## 범위와 날짜

| 종목 | 기본 검색 범위 | 제외 또는 미확정 처리 |
|---|---|---|
| MLB / NFL / WNBA / NHL | 해당 리그의 ET 당일 일정 | 연기·취소·이미 시작한 경기 역시 목록에는 남기고 사유 표시 |
| CFB | NCAA FBS | FCS·Division II/III는 요청에 명시된 경우에만 포함 |
| tennis | ATP/WTA 공식 투어 단식 본선·예선 | 채택 기준의 Challenger 등 추적 대회를 별도 포함; 나머지 ITF·복식 등 제외 범위와 이유 표시 |
| soccer | 현재 요청 또는 채택 기준에 명시한 리그·대회 | 명시 범위가 없으면 범위 미확정; 전 세계 전체 경기라고 표현하지 않음 |

위 기본값은 사용자 지정보다 우선하지 않는다. 범위를 축소하거나 확대했다면 대상 리그·대회와 이유를 표시한다. 자유문장 범위를 서버가 확정할 수 없다면 임의로 승인된 범위라고 처리하지 않는다.

기준일은 `America/New_York`의 달력 날짜다. 실제 시작 시각을 ET로 변환한 날짜로 포함 여부를 판단한다. 아시아·호주의 현지 다음 날 경기도 ET 당일이면 포함한다. DST에 고정 UTC 오프셋을 쓰지 않는다. 시각 미확인 경기는 빠뜨리지 않고 날짜 포함 여부 미확인을 남긴다.

`2026-10-01`, `9월 27일` 등 사용자 명시 날짜가 있으면 우선한다. 연도 없는 단일 월일은 현재 ET 연도로 해석하고 그 해석을 notes에 기록한다. 잘못된 날짜·여러 날짜·모호한 자연어 범위는 notes에 미확정을 남기고 today로 확정하지 않는다. 표시용 date_et에 기준일을 유지하더라도 미확정 notes가 있으면 실제 요청일이 확정되었다고 주장하지 않는다. 명시 날짜가 없는 `analyze_today`는 실행 시점의 ET 날짜로 새 범위를 만든다. 명시 날짜가 없는 재확인·상태 확인은 같은 소유자·종목의 이전 분석 범위와 날짜를 유지하고 전체 목록을 다시 조회한다. 이전 후보만 재사용하지 않는다. 이전 범위가 없으면 기본 범위와 미확정 사유를 사용한다. 사용자 메시지보다 나중에 생성된 분석을 재확인의 선행 범위로 선택하지 않는다.

## 데이터 계약

기존 `analysis-record` v1과 DB 저장 계약을 유지한다. 전체 목록은 별도 `analysis-coverage` JSON 블록으로 받는다. 출력 순서는 본문, coverage 블록, 마지막 record 블록이다. worker는 coverage 블록을 분리한 다음 기존 record 추출기를 호출한다. 잘못된 블록을 성공으로 처리하지 않으며 원문을 감사 메타데이터에 보존한다.

```ts
type AnalysisScope = {
  version: 1;
  sport: "mlb" | "nfl" | "cfb" | "soccer" | "tennis" | "wnba" | "nhl";
  date_et: string;
  timezone: "America/New_York";
  mode: "daily" | "explicit";
  competitions: string[];
  basis: "default" | "request" | "previous";
  parent_message_id?: string;
  notes?: string[];
};
type CoverageReport = {
  version: 1;
  scope: AnalysisScope;
  inventory: Array<{
    event_key: string;
    label: string;
    starts_at: string | null;
    competition: string;
    source_url: string;
  }>;
  assessments: Array<{
    event_key: string;
    disposition: "evaluated" | "deferred" | "excluded";
    reason: string;
  }>;
  schedule_sources: Array<{
    url: string;
    competition: string;
    expected_count: number | null;
  }>;
  inventory_complete: boolean;
  limitations: string[];
};
type CoverageValidation = {
  status: "complete" | "incomplete" | "unverified";
  scope: AnalysisScope;
  listed_count: number;
  assessed_count: number;
  missing_event_keys: string[];
  reasons: string[];
};
```

`metadata.coverage`는 서버가 만든 `CoverageValidation`이다. 모델의 전체 JSON은 `metadata.coverage_report`에 별도로 저장한다. 전체 목록 최대 500개, 모든 문자열과 블록 크기는 제한한다. 초과하면 자르지 말고 미완료로 처리한다. 기존 record의 최대 20개는 확인된 추천과 연결된 저장 대상이다. 전체 검토 목록 수와 장부 저장 수를 혼동하지 않는다.

## 서버 판정

1. 블록 수·JSON·타입·범위를 검사한다. 요청 종목·날짜·대회와 다르면 미완료다.
2. 모든 일정 출처와 경기 출처는 실제 검색 결과 URL에 있어야 한다. HTTPS URL을 정규화해 비교한다. 출처 URL 존재만으로 내용까지 독립 검증했다고 주장하지 않는다.
3. 경기 키 중복, 평가 중복, 목록 밖 평가, 사유 없는 평가를 거부한다. 목록의 모든 경기에 평가·보류·제외 중 하나와 구체적인 이유가 있어야 한다.
4. 시작 시각이 있으면 ET 날짜를 대조한다. 시각·대회·일정 범위가 불명확하면 사유를 남긴다. 일정 출처별 예상 수와 실제 수가 다르면 미완료다. 예상 수 미확인은 0으로 바꾸지 않는다.
5. coverage 블록 부재는 구버전과 새 응답 모두 `unverified`로 처리한다. `inventory_complete: false`, 제한 사항 존재, 근거 부족, 범위 불일치, 평가 누락은 미완료다. 0경기도 해당 날짜·대회 일정 근거 없이 완료 처리하지 않는다.
6. 모델 자체 목록이 내부적으로 일치하더라도 독립 일정 집합을 확보하지 못했다면 `unverified`다. 이번 최소 구현은 이 경로를 사용한다. `complete`는 앞으로 서버에서 확보한 신뢰 일정의 경기 ID 집합과 대조한 경우에만 허용한다.

본문 경기표도 구조화 목록과 대조한다. 정규화한 경기명이 명확히 일치하는 경우 본문 3경기·평가 12경기의 불일치는 미완료 사유다. 본문에 없는 평가를 전부 처리한 것으로 표시하지 않는다. 자유문장 경기명 대응이 불명확하면 대조 미확인을 남긴다. `excluded`의 사유가 존재해도 그 판단의 타당성을 서버가 증명하지는 못한다. 가격·라인업 미확인은 `deferred`여야 하며, 제외 사유를 이용한 분석 회피는 후속 검토가 필요한 한계다.

커버리지 미완료와 경기 판단 `EVALUATION INCOMPLETE`는 다른 상태다. 후자는 기존의 경기 시작 후 평가 누락 의미를 유지한다. 작업 실행 `completed`도 커버리지 완료와 구분한다. 검색·응답 실행이 끝나면 불완전한 분석 역시 원문과 서버 경고를 저장할 수 있지만 전체 검토 완료라고 표시하지 않는다. 자동 모델 재호출은 하지 않는다.

## 입력 및 모델 감사

worker는 호출 **전에** 실제 context와 instructions, SHA-256 해시, 기준·원문 참조 ID, 요청 모델·effort·mode를 `analysis_attempts.input_snapshot`에 영속 저장한다. 해당 JSONB 컬럼과 `save_gateway_input_snapshot` RPC의 migration 소스만 작성한다. RPC는 service role과 현재 job/attempt/worker/유효 lease를 검사하고 job row lock 후 한 번만 쓴다. 같은 snapshot의 재저장은 허용할 수 있으나 내용 변경은 거부한다. 실패하거나 lease를 잃으면 모델을 호출하지 않는다. 기존 fail/finalize는 새 컬럼을 덮어쓰지 않아 실패 뒤에도 입력이 남는다.

기존 `provider_metadata`는 fail/finalize가 통째로 덮어쓰므로 snapshot의 유일한 저장 장소로 사용하지 않는다. 응답 metadata에는 snapshot ID·해시, 원본 응답, 출처·검색 완료 여부·확인 시각을 보존한다. context의 장부·대화는 기존 owner RLS 범위 안에서만 저장하고 공개 예시·콘솔·PR·Issue에 복제하지 않는다. API 키·인증 헤더·환경변수는 저장하지 않는다. 최신 표 API는 표시용 coverage만 반환한다.

감사 계약은 요청 `requested: { model, effort, mode: "default_standard" }`와 공급자 보고 `upstream_reported: { model, mode, effort }`를 분리한다. 최상위 SSE `model`은 요청 alias의 echo일 수 있으므로 upstream 보고로 취급하지 않는다. 명시적인 gateway upstream 메타데이터만 수집한다. GatewayResult는 optional `upstreamReportedModel`, `upstreamReportedMode`, `upstreamReportedEffort`를 제공한다. 없거나 충돌하면 null이며 요청값으로 채우지 않는다. 공급자 보고 역시 실제 내부 라우팅의 독립 검증은 아니다.

Astra 분석·재평가 `xhigh`, 상태 확인 `medium`, 유료 fallback 없음 정책은 유지한다. `pro` 지원을 확인하기 전 전환하지 않는다.

## 화면

종목별 최신 분석, 전 종목 요약, 확대 화면에서 날짜·리그 범위, 목록 N개/처리 M개, 미완료·미검증 사유를 동일하게 보여준다. 문구 예: `확인한 목록 12/12 처리 · 전체 일정 독립 검증 안 됨`, `범위 검토 미완료 · 2경기 처리 누락`. 예전 메시지는 `범위 검증 정보 없음`으로 표시한다.

MD import의 `purpose`/목적 필드 누락도 수정한다. 기존 문서에도 목적 참조가 필요하므로 `imported_documents`의 owner/sport 범위에서 `{ id, sha256, raw_text }`를 서버 내부 조회하여 목적만 추출한다. 원문 전체는 매번 모델에 보내지 않는다. 공통 helper 계약은 다음과 같다.

```ts
type DocumentPurposeReference = {
  source_document_id: string;
  sha256: string;
  purpose: string;
  source_ref: string;
};
// parser.ts: 임의 문서를 실행 지시로 신뢰하지 않는 순수 추출 함수
// 입력 raw_text는 서버 안에서만 읽고 context에는 아래 결과만 포함한다.
function extractDocumentPurpose(text: string): {
  purpose: string;
  sourceRef: string;
} | null;
```

`SportContext.document_purposes?: DocumentPurposeReference[]`를 compact context에 포함하고 snapshot에는 정확히 사용한 context와 참조 ID/hash를 보관한다. 목적은 `imported historical document; not currently web verified`로 표시하며 현재 사용자/채택 기준보다 우선하지 않는다. 가져온 목적을 기존 문서 문맥에 보존하며 사용자 입력을 새 분석 사실이나 채택 기준으로 자동 승격하지 않는다. 별도 담당자가 `src/lib/import/parser.ts`와 테스트를 소유한다.

Markdown 실행표는 `목적`, `검토 목적`, `purpose` 열만 있어도 경기 표를 인식하고 보조 문맥에 보존한다. 이 표가 3행이라는 사실만으로 당일 대상이 3경기라고 판단하지 않는다.

## 선택한 접근과 검증

프롬프트만 강화하면 강제력이 부족하다. 독립 스포츠 API 수집기를 만들면 실제 누락 증명이 가능하지만 종목·라이선스·대회 범위별 작업이 커진다. 이번에는 공통 프롬프트와 구조화 목록의 서버 검증을 적용하고 독립 검증 부족을 정직하게 표시한다.

완료 조건은 7종목 공통 지시, 날짜 경계, 재확인 범위 유지, 20개 초과 목록, 누락·중복·빈 사유·근거 없는 0경기 검출, 구버전 표시, 원문·모델 감사 저장을 네트워크 없는 테스트로 입증하는 것이다. 독립 ESPN 일정 수집기는 이번 필수 범위 밖이다. 라이브 모델 호출, 배포, 실제 DB 적용, Git commit은 하지 않는다.

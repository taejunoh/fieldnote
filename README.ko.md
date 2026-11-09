# Fieldnote

[English README](README.md)

Fieldnote는 종목마다 하나의 지속 대화와 베팅 장부를 제공한 개인용 스포츠 분석 앱입니다. Markdown 인계본을 가져오고 백그라운드에서 검색 분석을 실행하며, 모델 추천과 사용자가 확인한 실제 진입을 분리했습니다.

**프로젝트 상태 — 운영 종료.** Railway 배포를 종료하고 Hobby 구독을 취소했으며, Supabase 프로젝트는 일시 중지했습니다. 개발용 Mac에서는 로그인 자동 실행을 끄고 로컬 웹 앱과 분석 작업자를 종료했습니다. 이 저장소에는 앱 소스와 운영 종료 보고서의 비식별 근거를 보관합니다. 검증한 DB 및 게이트웨이 백업은 접근이 제한된 로컬 경로에 별도로 보관합니다.

- [운영 종료 보고서](docs/fieldnote-postmortem.md)
- [English postmortem](docs/fieldnote-postmortem.en.md)
- [집계 근거 및 재현 방법](docs/postmortem/README.md)

## 아키텍처

```text
Next.js + TypeScript 웹 앱
    │ 분석 요청 등록
    ▼
Supabase Postgres ──▶ 백그라운드 작업자 ──▶ openllms 게이트웨이 ──▶ Codex 웹 검색
    ▲                          │
    │                          └─ 응답 원문 저장, 검증 후 분석표에 게시
    └── 사용자 확인 진입은 추천과 별도로 저장
```

8개 종목마다 지속 대화가 하나씩 있었습니다. Postgres에는 메시지 원문, 분석 기준, 작업, 장부를 저장했습니다. Markdown 인계본은 검토용 초안으로 만들었습니다. 작업자는 요청마다 최근 대화, 관련 과거 기록, 경기 상태를 모았습니다. 응답 원문을 저장한 뒤 경기·시장·가격·출처를 검증해 분석표에 게시했습니다.

보관본의 기본 모델은 `gpt-6-astra`입니다. 분석과 재평가는 `high`, 단순 상태 확인은 `medium`을 사용합니다. 서버 설정은 `OPENLLMS_*` 환경변수로 지정합니다.

## 운영 결과

- **기록된 요청 423건**의 최종 상태는 완료 405건, 실패 7건, 중단 11건이었습니다. 최종 실패·중단 비율은 4.26%입니다. 완료 상태에도 앞선 시도의 실패나 분석표 누락이 있을 수 있습니다.
- 별도 7종목 감사에서는 원문 응답 7건이 모두 저장됐지만, 처음에는 모두 분석표 게시 조건을 통과하지 못했습니다. 평가 블록 누락 2건, 스키마 검증 실패 4건, 출처 URL 연결 실패 1건이었습니다.
- Fieldnote에서 직접 확인한 진입은 6건으로 2승 4패, 2.75U 투입에 결과 기준 0.7891U 손실이었습니다. 표본이 작고 ChatGPT 기록과 날짜·시장·체결가가 달라, 같은 조건에서 어느 쪽 성적이 나았는지는 미확인입니다. [종목별 상세 성적표](docs/fieldnote-postmortem.md#3-분석-성적-비교)

## 종료 이유

종목별 지속 대화 덕분에 채팅 사이에서 맥락을 옮기는 작업은 줄었습니다. 다만 요청이 끊기거나 분석표 행이 누락될 때는 추천과 가격 조건을 확인하려고 원문으로 돌아가야 했습니다. 운영 검토로 어느 단계에서 결과가 빠지는지는 확인할 수 있었지만, 실제 진입 성적을 같은 조건에서 비교할 자료는 부족했습니다.

중요한 지표는 첫 요청에서 읽고 쓸 수 있는 결과가 분석표에 얼마나 자주 게시되는가였습니다. Fieldnote는 2026년 11월에 운영을 종료했습니다. 종료 전에 격리 환경에서 DB를 복원해 주요 건수를 대조했고, 게이트웨이 백업을 원본 파일과 검증했습니다. [호스팅 종료와 백업 검증](docs/fieldnote-postmortem.md#7-호스팅-종료와-백업-검증)

## 로컬 준비

보관된 소스를 로컬에서 실행하는 방법입니다. Node.js 20 이상, Docker, Supabase CLI가 필요합니다.

```sh
npm ci
supabase start
supabase migration up --local
cp .env.example .env.local
```

`.env.local`에 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OWNER_EMAIL`을 설정합니다. Supabase Auth에서 소유자 이메일 OTP를 켜고 `http://localhost:3000/auth/callback`을 리디렉션 URL로 허용한 뒤 공개 가입을 끕니다. 자격증명은 로컬 환경 파일에 보관합니다.

[게이트웨이 설정 안내](gateway/README.md)에 따라 openllms를 빌드·실행하고 Codex 계정을 연결해 라우트를 만듭니다. 라우트 키를 `OPENLLMS_API_KEY`로, `/v1`로 끝나는 라우트 주소를 `OPENLLMS_BASE_URL`로 설정합니다.

웹 앱과 작업자를 서로 다른 터미널에서 실행합니다.

```sh
npm run dev
npm run worker
```

작업자는 기본적으로 서로 다른 두 종목을 동시에 처리합니다. `ANALYSIS_CONCURRENCY`를 1~4로 설정해 한도를 바꿀 수 있습니다. 같은 사용자와 종목의 요청은 순서대로 처리합니다. `SIGTERM` 또는 `SIGINT`를 받으면 새 작업을 가져오는 것을 멈추고 진행 중인 작업을 마칩니다.

### macOS에서 로컬 실행

`npm run build`와 `npm run start`로 `127.0.0.1:3000`에서 운영 빌드를 실행할 수 있습니다. 로컬 서비스를 한꺼번에 실행하려면 `bash scripts/backup-local.sh` 다음에 `bash scripts/local-start.sh`를 실행합니다. 시작 스크립트는 Supabase가 루프백에 바인딩됐는지 확인합니다.

로그인 시 자동 실행은 `bash scripts/install-launch-agent.sh`로 등록합니다. Supabase와 게이트웨이를 따로 관리한다면 `--app-only`를 추가합니다. 등록 전에 앱을 빌드하고 수동 실행 중인 웹 앱과 작업자를 종료합니다. `bash scripts/local-stop.sh`는 웹 앱과 작업자를 중지합니다. DB와 게이트웨이 백업 절차는 [로컬 백업·복원 안내](docs/local-backup.md)에 있습니다.

## 검증

```sh
npm test
npx tsc --noEmit
npm run lint
npm run build
```

게이트웨이 테스트는 모의 응답을 사용합니다. 실제 분석은 Codex 라우트 연결이 필요하며 구독 사용량 또는 크레딧을 사용할 수 있습니다.

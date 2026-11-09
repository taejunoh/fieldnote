# Fieldnote

[English README](README.md)

Fieldnote는 종목마다 하나의 지속 대화와 베팅 장부를 제공한 개인용 스포츠 분석 앱입니다. Markdown 인계본을 가져오고 백그라운드에서 검색 분석을 실행하며, 모델 추천과 사용자가 확인한 실제 진입을 분리했습니다.

**프로젝트 상태 — 운영 종료.** Railway 배포를 종료하고 Hobby 구독을 취소했으며, Supabase 프로젝트는 일시 중지했습니다. 이 저장소에는 앱 소스와 운영 종료 보고서의 비식별 근거를 보관합니다. 검증한 DB 및 게이트웨이 백업은 접근이 제한된 로컬 경로에 별도로 보관합니다.

- [운영 종료 보고서](docs/fieldnote-postmortem.md)
- [English postmortem](docs/fieldnote-postmortem.en.md)
- [집계 근거 및 재현 방법](docs/postmortem/README.md)

## 작동 방식

- 종목마다 대화가 하나씩 있고, 메시지 원문은 Postgres에 저장했습니다. Markdown을 가져오면 분석 기준, 후보, 과거 기록을 검토할 수 있는 초안을 만들었습니다.
- 별도 작업자가 맥락을 구성하고 버전을 고정한 openllms 게이트웨이를 통해 Codex 웹 검색을 호출했습니다. 페이지를 닫아도 작업은 DB에 남아 나중에 상태를 확인할 수 있었습니다.
- 검증된 분석을 게시하려면 게이트웨이 응답 완료, 웹 검색 완료, 출처 URL을 확인했습니다. 중단과 검증 실패는 사용자 확인 진입과 별도로 기록했습니다.
- 보관본의 기본 모델은 `gpt-6-astra`입니다. 분석과 재평가는 `high`, 단순 상태 확인은 `medium`을 사용합니다. 서버 설정은 `OPENLLMS_*` 환경변수로 지정합니다.

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

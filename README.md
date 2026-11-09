# Fieldnote

이 저장소는 중단된 Fieldnote 프로젝트의 보관본입니다. [운영 종료 보고서](docs/fieldnote-postmortem.md)와 [집계 근거 및 재현 방법](docs/postmortem/README.md)을 확인하세요. 아래 설치·운영 지침은 보관된 당시 문서입니다.

개인용 종목별 지속 대화와 스포츠 분석 기록 앱입니다. MLB handoff MD를 가져와 검토한 뒤, 같은 대화에서 검색 기반 분석을 이어갑니다.

## 로컬 준비

Node.js 20 이상, Docker, Supabase가 필요합니다. `.env.example`을 `.env.local`로 복사해 Supabase URL, anon key, service role key, `OWNER_EMAIL`을 채웁니다. Supabase Auth에서 본인 이메일 OTP를 켜고 리디렉션 URL `http://localhost:3000/auth/callback`을 허용합니다. 공개 가입은 끕니다. 기존 로컬 DB에는 `supabase migration up --local`로 새 이전 파일을 적용하며, 데이터를 지우는 `db reset`은 사용하지 않습니다.

```bash
npm install
supabase start
supabase migration up --local
docker compose -f gateway/compose.yaml build
docker compose -f gateway/compose.yaml up -d
```

게이트웨이 초기 설정과 Codex 계정 연결은 [gateway/README.md](gateway/README.md)를 따릅니다. **Codex 계정만** 연결하고 유료 OpenAI API 계정은 라우트에 추가하지 않습니다. 게이트웨이가 발급한 라우트 키를 `OPENLLMS_API_KEY`로, 해당 라우트 주소의 `/v1`까지를 `OPENLLMS_BASE_URL`로 `.env.local`에 저장합니다. Codex 로그인 토큰이나 OpenAI API 키를 앱 파일에 넣지 않습니다.

두 개의 터미널에서 웹 서버와 작업 프로세스를 각각 실행합니다. 작업 프로세스가 꺼져 있어도 요청은 DB에 대기하며, 다시 켜면 처리됩니다.

```bash
npm run dev
npm run worker
```

작업자는 기본적으로 서로 다른 종목 2개를 동시에 처리합니다. `ANALYSIS_CONCURRENCY`를 1–4로 설정해 동시 실행 수를 조절합니다. 같은 사용자의 같은 종목 요청은 DB에서 순서대로 실행해 이전 결과를 맥락에 반영합니다. 이 설정에는 `202609260001_concurrent_sport_workers.sql` 이전이 필요합니다. 작업자에 `SIGTERM` 또는 `SIGINT`를 보내면 새 요청을 가져오지 않고 진행 중인 분석과 저장을 마친 뒤 종료합니다.

## 이 Mac에서 계속 실행하기

개발 서버 대신 `npm run build`와 `npm run start`로 웹을 운영 모드로 실행할 수 있습니다. `npm run start`는 `127.0.0.1:3000`에서만 수신합니다. 백업을 만든 뒤 `scripts/local-start.sh`를 실행하면 로컬 Supabase, openllms, 웹, 별도 작업자를 순서대로 확인·시작합니다. 실행 중인 Supabase가 외부 인터페이스에 열려 있으면 안전을 위해 시작을 거부합니다. 데이터 보존 방식의 `supabase stop` 후 재시작하더라도 Docker Desktop이 네트워크의 로컬 바인딩 설정을 무시할 수 있습니다. 스크립트는 재시작 후 실제 포트를 검사해 여전히 공개되어 있으면 Supabase를 종료합니다. `--no-backup`과 `db reset`은 사용하지 않습니다.

```bash
bash scripts/backup-local.sh
bash scripts/local-start.sh
```

macOS 로그인 후 자동 시작은 수동 실행 프로세스를 종료한 상태에서 `bash scripts/install-launch-agent.sh`로 등록합니다. Docker Desktop도 실행 중이어야 하며, 아직 준비되지 않았으면 LaunchAgent가 재시도합니다. `bash scripts/local-stop.sh`는 웹과 작업자만 중지하고 데이터베이스와 게이트웨이 컨테이너는 유지합니다. 백업·검증·복구 제한은 [docs/local-backup.md](docs/local-backup.md)를 참조하세요.

Supabase와 게이트웨이가 별도로 실행 중인 환경에서 웹과 작업자만 지속 실행하려면 `bash scripts/install-launch-agent.sh --app-only`를 사용합니다. 이 모드는 기존 로컬 서비스의 건강 상태만 확인하며 Docker 컨테이너나 네트워크를 변경하지 않습니다. 기존 Supabase의 포트 노출을 수정하거나 안전성을 검증하는 모드는 아닙니다. 일반 시작의 포트 보호 검사는 유지됩니다. 등록 전에 개발 서버를 종료하고 `npm run build`로 최신 운영 빌드를 준비하세요. 실행 로그는 `~/Library/Application Support/SportsDesk/app.log`, `worker.log`에 남고, LaunchAgent는 로그인 후 앱을 시작하며 프로세스 종료 시 재시작합니다.


기본 모델은 `gpt-6-astra`입니다. 초기 분석, 최종 재평가, 일반 분석은 `xhigh`, 결론을 바꾸지 않는 단순 상태 확인은 `medium`입니다. 모델과 effort는 `OPENLLMS_*` 서버 환경변수로 지정합니다. 유료 API 자동 전환은 구현하지 않았으며 Codex 사용량이 소진되면 작업을 대기 상태로 표시합니다.

## 작동 방식

- 종목마다 지속 대화가 하나이며, 모든 메시지 원문은 Postgres에 남습니다.
- MD 가져오기는 분석 기준, 후보, 과거 기록을 검토용 초안으로 만든 뒤 확정합니다. 가져온 내용은 당시 문서의 사실로 표시합니다.
- 분석 요청은 DB 작업으로 저장됩니다. 별도 작업 프로세스가 맥락을 구성하고 `openllms`의 Codex 경유 웹 검색을 호출합니다. 페이지를 닫아도 작업은 계속되고, 새로고침하면 저장된 상태를 다시 읽습니다.
- 게이트웨이 응답의 명시적인 완료 상태, 웹 검색 완료, 출처 URL이 확인되어야 분석 답변을 저장합니다. 연결이 끊기거나 출처가 없으면 실패 상태를 남깁니다.
- 모델 추천과 사용자가 확인한 실제 베팅 진입은 별도 기록입니다.

## 검증

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
```

자동 테스트는 모의 게이트웨이 응답을 사용하므로 Codex 사용량을 쓰지 않습니다. 실제 검색 분석은 Codex 로그인과 라우트 설정 후 웹에서 요청해야 실행됩니다. 실제 분석 호출은 구독 사용량 또는 추가 크레딧을 사용할 수 있습니다.

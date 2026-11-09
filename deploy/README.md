# Managed Supabase and Railway deployment

Status: Railway services have been provisioned in the dedicated AllinSimple Edge Hobby workspace. Web, gateway, and worker are deployed. Server Codex authorization and the app search adapter are verified. Production URL: https://web-production-4e33a.up.railway.app. Workspace soft alert is $8 and compute hard stop is $10.

Use the existing managed Supabase `allinsimple-edge` project. Deploy three separate Railway services in one project:

| Service | Source/config | Exposure |
| --- | --- | --- |
| web | repository root, `deploy/railway-web.toml` | Railway HTTPS domain |
| worker | repository root, `deploy/railway-worker.toml` | private, one replica |
| gateway | `gateway/` root, existing `Dockerfile` | private; volume mounted at `/data` |

Railway currently rejects legacy Config as Code paths. The TOML files are reference values; actual service settings were applied through the public ServiceInstanceUpdate API, with Dockerfile paths, worker start command, one replica, and sleeping disabled. Do not start the worker until the data migration and local-worker cutover are verified. Keep web and worker application sleeping disabled. The worker polls even when browsers are closed.

## App variables

Both web and worker need the new project's `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, runtime-only `SUPABASE_SERVICE_ROLE_KEY`, and `OWNER_EMAIL`. Only the URL and anon key may be passed to the image build; they are public browser settings. Service keys must not be Docker build arguments or committed files.

Set `OPENLLMS_BASE_URL=http://<gateway-private-host>:8080/r/sports-desk/v1` and the gateway route-scoped `OPENLLMS_API_KEY` at runtime. The web uses these settings when validating and scheduling requests; the worker executes them. Set the shared `OPENLLMS_UPSTREAM_TIMEOUT_SECONDS=2700` on gateway and worker; it accepts integers from 60 through 3600. The gateway's default request deadline is 45 minutes, and the worker's header/body transport timeouts allow 60 seconds more (46 minutes by default). Keep `OPENLLMS_MODEL=gpt-6-astra`, `OPENLLMS_EFFORT_ANALYSIS=high`, `OPENLLMS_EFFORT_RECHECK=high`, `OPENLLMS_EFFORT_STATUS=medium`, and `ANALYSIS_CONCURRENCY=2`. Analysis and recheck may explicitly use `xhigh` when configured; new default jobs use `high` and queued `xhigh` jobs remain supported.

## Gateway

Use the existing pinned, patched gateway Dockerfile, not an unrelated public image. Set `HTTP_ADDR=[::]:8080`, `DATABASE_URL=sqlite:/data/llms.db`, `LLMS_SECRETS_DIR=/data/secrets`, and a strong bootstrap token privately. Mount a persistent volume at `/data`. Do not publish its administration endpoint. Use an authenticated temporary administrative path such as a secure tunnel to perform fresh device authorization and create the sports-desk route/key. Do not reuse the Codex desktop token store or enable paid API fallback.

Verify private service connectivity on the actual provider network; the gateway address must listen on the IP family used by that network. Allow active analyses the configured gateway deadline (45 minutes by default) and the worker's additional 60-second transport margin before termination. Redeploy only while analyses are idle if the platform cannot allow that full drain. Lease fencing prevents stale writes after forced termination; interrupted requests require an explicit retry.

## Release gates

1. Preserve the owner UUID and identities; restore app data against the managed schema without overwriting unrelated Supabase system objects.
2. Verify counts, document hashes, bet unknowns, RLS, and service-only worker RPC permissions.
3. Configure owner-only login, disabled public signup, exact HTTPS callback URLs, and suitable production email delivery.
4. Drain local jobs before final synchronization and enable exactly one production worker process with two slots. Preserve local data for rollback.
5. Confirm phone login and history, durable requests after browser closure, same-sport serialization, server restart, and Mac-off access.

Railway's $5 minimum is not a fixed total. Obtain paid-plan and spend-limit approval before provisioning chargeable services; document that a hard spend limit can stop analyses. Supabase Free can pause after low activity. See `docs/server-deployment.md` for migration boundaries and cost scenarios.

## Migration evidence (2026-09-26)

The final local snapshot was restored transactionally after local jobs were idle and the local launch agent was stopped. Owner UUID and email identity were preserved. Counts matched for 7 sports, 7 documents, 37 messages, 18 jobs, 50 criteria versions, 221 events, 57 recommendations, 107 bets, 108 mistake notes, and 7 summaries. Auth sessions and refresh tokens were not migrated. Private dumps and deployment credentials are stored outside the repository. Cloud public signup is disabled; the HTTPS callback is configured. Fresh server Codex authorization is complete. The gateway retained its SQLite database and credential files across redeployment; bootstrap is disabled. The sports-desk route contains exactly one Codex account and no paid API fallback. A Medium live search through the production app adapter returned searched=true and verified=true with an official MLB source. Initial/final analysis remains xhigh; simple status remains medium. Owner browser login, phone use, and a persisted production analysis job still need end-user confirmation.

## Owner email login correction (2026-09-26)

Cloud auth has `auth.enable_signup=false` and `auth.email.enable_signup=true`: email login is enabled while public registration remains disabled. The imported local seed user used a test email; Supabase Admin updated that existing user to the real owner email with its UUID unchanged. The Railway owner allowlist was corrected and web redeployed. The owner magic-link request returned HTTP 200; actual inbox delivery and sign-in are awaiting the owner. No second user or copied conversation was created.

## Auth callback deployment correction

Set server-only `APP_URL` to the exact public HTTPS app origin. Railway request URLs may contain the internal bind address; callback redirects must use the configured origin. The callback accepts email `token_hash` verification and retains legacy PKCE code exchange. Apply `supabase/templates/magic-link.html` as the hosted Magic Link template after deploying the callback. This creates a server-verifiable one-time link and does not require the original browser verifier cookie. Never print one-time tokens, session cookies, or admin-generated test links. Supabase shared SMTP remains limited to two emails per hour; this redirect correction does not change that mail limit.

Verification: production callback now returns the public HTTPS origin, replacing the internal 0.0.0.0 address. An isolated no-email admin-generated one-time token test established cookies, returned owner auth API HTTP 200 with the original UUID, and loaded MLB records (12 messages, 19 criteria, 11 bets, 19 notes); only that isolated test session was revoked (HTTP 204). Hosted Supabase rejected custom magic-link templates on Free with shared SMTP (HTTP 400). The token_hash route is deployed and verified, but email-template activation is blocked until custom SMTP or a suitable plan is configured. Default PKCE email links still require the browser that requested them. The staged custom template reference was removed so future config pushes remain usable.

### 비밀번호 로그인 (2026-09-26)

기본 로그인은 등록된 개인 이메일과 비밀번호로 진행한다. 공개 회원가입은 비활성 상태다. 최초 비밀번호는 `/auth/password`에서 인증된 소유자가 직접 설정한다. 이메일 발송 제한에 걸려 최초 인증을 할 수 없으면 운영자가 기존 소유자에 한해 Supabase Admin `generate_link`로 일회성 인증 링크를 생성하여 비공개 로컬 전달 파일로 설정 화면을 연다. 서비스 키·링크·세션·비밀번호를 대화/저장소/배포 소스에 포함하지 않는다. 설정 후 전달 파일을 삭제한다. 비밀번호 분실 시 동일한 소유자 확인 절차로 설정을 진행하며 공개 복구 엔드포인트는 제공하지 않는다.

## All-sports coverage release evidence (2026-09-30)

The application release gates passed: 35 test suites and 266 tests, TypeScript, lint, and production build. Migration `202609300002` was applied transactionally to managed Supabase. The `input_snapshot` column is present. Transaction-wrapped fixture checks (`BEGIN`/`ROLLBACK`) confirmed that authenticated callers cannot execute the snapshot RPC and the service role can. No temporary test users remain.

Runtime configuration was confirmed on both web and worker: Astra xhigh for initial and final analysis, and medium for status checks. Pro and paid API fallback were not added. No live model or search request was run for this release, so analysis quality and model/search usage cost were not measured.

Coverage currently verifies only the model report's internal consistency. There is no independent schedule collector, so new coverage results remain `unverified`. Older assistant messages have no coverage metadata and display `범위 검증 정보 없음`.

Gateway, web, and worker deployments are now verified successful. Read-only production checks passed; actual analysis quality remains unverified because no live model or search request was made.

### Deployment verification checklist

- [x] Confirm all three deployments are healthy: one running replica and zero crashed replicas for each service.
- [x] Confirm gateway startup retained `/data`, initialized SQLite and secrets, and is listening on `[::]:8080`; worker startup has two analysis slots.
- [x] Confirm private connectivity using read-only GET requests to gateway `/v1/models` from both web and worker runtime environments; both returned HTTP 200. No completion or model/search request was made.
- [x] Read-only check the production coverage display. The existing owner login worked, the root endpoint returned HTTP 200, and the sport panel, all seven overview cards, and expanded modal showed `범위 검증 정보 없음` for older answers.
- [x] Keep new coverage marked `unverified`; no independent schedule collector is available.

### Deployment update (2026-09-30 17:05 EDT)

Web deployment `6b7bd5a0` succeeded. Worker deployment `b43104d6` succeeded with two analysis slots. These checks did not trigger an analysis request.

The first gateway deployment failed because its pinned upstream commit was absent. A worker restored the reproducible vendor archive and its exact upstream git-archive checksum in `gateway/vendor`; the upstream version was not changed. Gateway redeployment is pending, so the gateway release gate and overall deployment remain incomplete.

No live model or search request was run. Current evidence supports only internal consistency checks on self-reported coverage; without an independent schedule collector, coverage remains `unverified`.

### Gateway build update (2026-09-30)

Gateway deployment `54318754-b06e-44fa-a2a4-1be538ec4d46` passed the Go tests for `internal/httpserver` (0.129s), `proxy` (0.624s), and `store` (0.248s). The restored source archive matches pinned commit `76945701` and the recorded archive checksum beginning `35ea2cab`. The Docker build copies source to `/tmp/openllms-source` to avoid Go automatic vendor mode. The build and deployment subsequently succeeded, as recorded below.

### Final deployment verification (2026-09-30 17:12 EDT)

The deployment gate is complete. Gateway, web, and worker each report one running replica and zero crashed replicas. Gateway deployment `54318754-b06e-44fa-a2a4-1be538ec4d46` succeeded, retained the `/data` volume, initialized SQLite and secrets, and listens on `[::]:8080`. Worker startup confirmed two analysis slots. Web returned HTTP 200. Read-only GET requests to gateway `/v1/models` from both web and worker runtime environments returned HTTP 200, confirming private service connectivity. Authenticated read-only checks of the sport panel, all seven overview cards, and the expanded modal showed `범위 검증 정보 없음` for older answers.

No actual model or search request was made, so production analysis quality and usage cost remain unverified. Coverage checks only self-reported consistency; without an independent schedule collector, new results remain `unverified`. Deployment success does not establish analysis quality or independent coverage.

# Server deployment plan

## Objective

Use the existing personal sports desk from Chrome and a phone while the Mac is off. Preserve all documents, conversations, adopted criteria, recommendations, confirmed bets, and source references. This is a preparation plan; no server has been provisioned or deployed.

## Proposed topology

### Current lower-cost preparation (2026-09-26)

The user has a Supabase dashboard account and wants to avoid buying a domain. Prepare managed Supabase plus three Railway services (web, analysis worker, patched gateway), using the provider HTTPS hostname. This replaces the all-in-one VPS sizing below for this path; it does not commit to a paid plan.

A dedicated Free organization has been created and renamed AllinSimple Edge. The user completed creation of allinsimple-edge (project ref <production project ref>, us-west-2). Its status is ACTIVE_HEALTHY. All seven app migrations were applied from an isolated private CLI staging directory; local project linking and .env.local were left unchanged. Verification found 11 public app tables with RLS enabled on all 11, claim_gateway_job EXECUTE denied to anon/authenticated and allowed to service_role. Existing messages have not been copied yet. Connection keys are stored outside the repository in a private local deployment directory. Existing organizations and projects are untouched.

Railway Hobby is a minimum $5/month including $5 usage, not a fixed total or three separate subscriptions. At the published per-second rates, 30 days of average 0.25 GB RAM plus 0.02 vCPU and 1 GB volume is about $3.06 before the $5 minimum, egress, and taxes; 0.5 GB RAM plus 0.05 vCPU and 1 GB volume is about $6.16. These are scenarios, not measured production usage or a promise. Build usage and analysis workload can increase the cost. Railway login and explicit paid-plan approval remain required before chargeable provisioning.

Supabase Free may pause after seven days of low activity. Its schema/data permissions, owner identity migration, production email authentication, and restore validation still need to be configured. No local records have been uploaded to the cloud yet.

References: https://railway.com/pricing and https://supabase.com/docs/guides/platform/free-project-pausing

### Alternative all-in-one VPS

One Linux VPS with 4 vCPU, 8 GB RAM, and at least 80 GB SSD. No GPU is needed. Run official production Supabase Docker services, Next.js web, one analysis worker, the patched openllms gateway, and an HTTPS proxy as separately supervised services. Supabase CLI development services are not the production deployment.

Expose HTTPS for the app and Supabase API. Keep Postgres, gateway administration, Studio, and development mail tools private. The browser currently connects directly to Supabase Auth, so its Supabase URL must be reachable over HTTPS. Add a separate internal Supabase URL for server and worker traffic if needed.

Keep gpt-6-astra, xhigh for analysis and final reassessment, medium only for status updates that do not need a changed conclusion. Keep ANALYSIS_CONCURRENCY=2 and the existing same-sport serialization. Set the shared `OPENLLMS_UPSTREAM_TIMEOUT_SECONDS=2700` on gateway and worker (valid range 60–3600 seconds): gateway deadline is 45 minutes by default, with the worker's header/body transport timeouts set 60 seconds longer (46 minutes by default). Do not enable paid API fallback.

## Inputs required before provisioning

- Existing server details or selected provider and approved monthly cost, including backup/storage charges.
- App and API hostnames and DNS access; confirm an HTTPS hostname option if no domain is owned.
- Production email delivery configuration for the current magic-link login, or an explicitly selected alternative login design.
- Server access and a new gateway device authorization when requested. Never put credentials in chat or tracked files.

## Deployment artifacts to implement

- Production web/worker image with required worker runtime dependencies and no embedded service secrets.
- Compose services with restart policies, health checks, bounded logs, persistent volumes, and a worker shutdown allowance covering the configured transport budget (46 minutes by default). If the host cannot wait through a 45-minute analysis plus the worker margin, terminate or redeploy only while analyses are idle.
- HTTPS proxy configuration and private gateway service networking.
- Pinned official Supabase production configuration, signup disabled, existing owner preserved, real SMTP, exact callback URLs.
- Secret-free environment template, deployment validation, encrypted off-server backups, and restore instructions.

## Migration and cutover

1. Prepare the target without changing local services. Confirm database versions and supported schema migration boundaries.
2. Restore into a disposable target first. Preserve the existing auth.users UUID and identities because owner_id references it. Do not blindly restore a development full dump with --clean into an operating production database.
3. Reapply and verify app RLS and GRANTs. The existing dump omits ACLs; anon and ordinary authenticated roles must not execute worker claim/finalize functions.
4. Validate source-document hashes, table counts, owner access, adopted criteria, and confirmed-bet unknown values against the local database.
5. Configure production login and HTTPS; verify unauthenticated and other-account access is denied.
6. Authorize openllms on the server. Prefer fresh device authorization; do not read or copy the Codex desktop token store. If gateway data is migrated instead, transfer its SQLite database and secret directory together over an encrypted channel and avoid concurrent refresh credential use.
7. Block new local submissions, drain active analyses, and take the final backup. The existing local backup pauses the gateway and must only run when no analysis is active.
8. Restore the final data, validate permissions again, and enable the server worker. Stop local automatic workers at cutover; preserve the local data and backup for rollback.

## Acceptance evidence

- Owner can log in from a phone on a different network and read the existing sports history.
- A request persists across refresh and browser closure; no duplicate records on retries.
- Independent sports run concurrently, the same sport remains serialized, and unknown outcomes stay interrupted rather than automatically replayed.
- Server reboot restores services and data. Mac shutdown does not affect access or execution.
- A separate restoration exercise demonstrates recovery of database and gateway data.

## Current limitations

Provider, budget, domain, SMTP, and server access are not selected. This document does not establish a deployed service or a verified production restore. Existing local credentials and loopback addresses are not production settings.

## References

- https://supabase.com/docs/guides/self-hosting/docker
- https://supabase.com/docs/guides/auth/auth-smtp

## Deployment artifact verification

Prepared deploy/Dockerfile, deploy/railway-web.toml, deploy/railway-worker.toml, deploy/README.md and .dockerignore. A local container build with a non-secret placeholder anon key passed Next.js build, lint/type checks, and a web HTTP 200 smoke check. Runtime runs as non-root; .env.local/.env.production are absent and tsx is available. The temporary smoke container was stopped. No production Railway service or remote gateway is running yet. A private data-only archive of public app tables and auth.users/auth.identities was validated with pg_restore --list; auth sessions were excluded. This snapshot is a preparation artifact, not a tested full restore or final cutover backup.


## 공통 운영 기준

공통 기준은 종목별 `criteria_versions`와 별도로 `common_policy_versions`에 저장됩니다. 소유자당 채택 버전은 하나이며, 원문 SHA-256과 이전 버전 연결을 유지합니다. 앱의 **기준 · 기록 열기 → 공통 운영 기준 · 모든 종목**에서 확인하거나 수정합니다. 파일을 종목별로 다시 가져올 필요가 없습니다.

- 새 요청과 명시적인 재시도는 실행 시작 시 최신 채택 기준을 읽습니다. 실행 중인 작업은 해당 시도의 원문과 정책 ID·해시를 스냅샷에 고정합니다.
- 사용자 명시 지시, 공통 운영 기준, 해당 종목 분석 보충 기준, 과거 요약·가설 순서로 적용합니다. 실제 베팅·과거 판단·손익은 기준 변경으로 수정하지 않습니다.
- 저장 요청은 편집을 시작한 `expectedVersionId`를 전달합니다. 다른 곳에서 먼저 변경됐다면 409를 반환하므로 최신 기준을 확인한 뒤 다시 저장합니다. 같은 제목·날짜·본문은 새 이력을 만들지 않습니다.
- `202610060001_common_operating_policy.sql`은 원문 및 불변 이력/RLS/RPC를, `202610060002_common_policy_attempts.sql`은 실행 종료·lease 만료 시 정책 감사 정보를 추가합니다. 기존 큐의 locking/fencing 함수는 유지합니다.
- 새 환경에는 기존 필요한 마이그레이션 뒤 위 두 파일을 순서대로 적용합니다. 운영 DB의 오래된 migration registry가 불완전하면 전체 `db push` 대신 실제 스키마와 이력을 먼저 확인합니다.

ChatGPT Project Instructions가 Fieldnote에 자동 전달되는 것은 아닙니다. Fieldnote에 채택된 원문은 앱의 분석 요청에 명시적으로 포함되며, ChatGPT 쪽 설정 변경만으로 앱 기준이 갱신되지는 않습니다.

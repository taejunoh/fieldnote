# Fieldnote

[한국어 README](README.ko.md)

Fieldnote was a personal sports analysis app with a persistent conversation and betting ledger for each sport. It imported Markdown handoffs, queued research in a background worker, and kept recommendations separate from user-confirmed bets.

**Project status: retired.** The Railway deployments were stopped, the Hobby subscription was canceled, and the Supabase project was paused. This repository preserves the application source and the de-identified evidence behind the postmortem. Verified database and gateway backups are stored separately in restricted local storage.

- [Operations postmortem](docs/fieldnote-postmortem.en.md)
- [운영 종료 보고서](docs/fieldnote-postmortem.md)
- [Evidence and reproduction guide](docs/postmortem/README.md)

## How it worked

- Each sport had one conversation, with original messages stored in Postgres. Markdown imports produced reviewable drafts of evaluation rules, candidates, and historical records.
- A separate worker assembled context and called Codex web search through the pinned openllms gateway. Jobs remained in the database when the page closed and could be checked again on reload.
- Publishing a verified analysis required a completed gateway response, completed web search, and source URLs. The app recorded interruptions and verification failures separately from confirmed bets.
- The preserved application defaults to `gpt-6-astra` with `high` effort for analysis and reevaluation and `medium` for simple status checks. The server settings use the `OPENLLMS_*` environment variables.

## Local setup

These instructions document how to run the preserved source locally. You need Node.js 20 or later, Docker, and the Supabase CLI.

```sh
npm ci
supabase start
supabase migration up --local
cp .env.example .env.local
```

Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `OWNER_EMAIL` in `.env.local`. Enable email OTP for the owner, allow `http://localhost:3000/auth/callback` as an Auth redirect, and disable public signups. Keep credentials in your local environment file.

Follow the [gateway setup guide](gateway/README.md) to build and start openllms, connect a Codex account, and create a route. Set `OPENLLMS_API_KEY` to the route key and `OPENLLMS_BASE_URL` to the route URL ending in `/v1`.

Run the web app and the worker in separate terminals.

```sh
npm run dev
npm run worker
```

The worker runs two sports in parallel by default. Set `ANALYSIS_CONCURRENCY` to a value from 1 to 4 to change that limit. Jobs for the same user and sport run in order. On `SIGTERM` or `SIGINT`, the worker stops claiming jobs and finishes work already in progress.

### Running locally on macOS

`npm run build` and `npm run start` run the production build on `127.0.0.1:3000`. For the managed local startup, run `bash scripts/backup-local.sh` before `bash scripts/local-start.sh`. The startup script checks that Supabase is bound to loopback before starting the stack.

Use `bash scripts/install-launch-agent.sh` for login startup, or add `--app-only` if Supabase and the gateway are managed separately. Build the app and stop any manually started web or worker process before registering the agent. `bash scripts/local-stop.sh` stops the web app and worker. See the [local backup and restore guide](docs/local-backup.md) for the database and gateway backup procedure.

## Verification

```sh
npm test
npx tsc --noEmit
npm run lint
npm run build
```

Gateway tests use mock responses. Live analysis requires a connected Codex route and can consume subscription usage or credits.

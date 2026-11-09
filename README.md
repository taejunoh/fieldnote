# Fieldnote

Fieldnote was a personal sports analysis app with a persistent conversation and betting ledger for each sport. It imported Markdown handoffs, queued research in a background worker, and kept recommendations separate from user-confirmed bets.

**Project status: retired.** The Railway deployments were stopped, the Hobby subscription was canceled, and the Supabase project was paused. On the development Mac, login startup was disabled and the local web app and analysis worker were stopped. This repository preserves the application source and the de-identified evidence behind the postmortem. Verified database and gateway backups are stored separately in restricted local storage.

- [Operations postmortem](docs/fieldnote-postmortem.en.md)
- [Evidence and reproduction guide](docs/postmortem/README.md)

## Architecture

```text
Next.js + TypeScript UI
    │ enqueue a research request
    ▼
Supabase Postgres ──▶ Background worker ──▶ openllms gateway ──▶ Codex web search
    ▲                         │
    │                         └─ save raw response, validate and publish rows
    └── store confirmed bets separately from recommendations
```

Each of the eight sports had a persistent conversation. Postgres stored the original messages, analysis rules, jobs, and ledger. Markdown imports created drafts for review. For each request, the worker assembled recent messages, relevant history, and game state. After saving the raw response, it validated the game, market, price, and source references before publishing structured rows.

The preserved app defaults to `gpt-6-astra` with `high` effort for analysis and reevaluation and `medium` for simple status checks. Server settings use the `OPENLLMS_*` environment variables.

## Operating results

- **423 recorded requests** finished with 405 completed, 7 failed, and 11 interrupted. The final failure or interruption rate was 4.26%. Completed jobs could still have missing rows or earlier failed attempts.
- In a separate seven-sport audit, all seven raw responses were saved, but none initially passed the checks for a structured table. Two lacked an evaluation block, four failed schema validation, and one failed source URL matching.
- Six bets confirmed directly in Fieldnote went 2–4 on 2.75U risked, for a result-based loss of 0.7891U. The sample was small, and the available ChatGPT records covered different dates, markets, and accepted prices. A matched comparison remains unverified. [Detailed performance by sport](docs/fieldnote-postmortem.en.md#3-analysis-and-bet-performance)

## Why it stopped

Persistent threads reduced the work of moving context between chats. Interrupted requests and missing table rows still sent the user back to the raw answer to verify recommendations and price conditions. The review could establish where results went missing. It had too little comparable data to establish which workflow performed better on confirmed bets.

The useful reliability measure was how often the first request put a complete, usable result in the table. Fieldnote was retired in November 2026. The shutdown included an isolated database restore with matching record counts and a gateway backup verified against the source files. [Hosting shutdown and backup verification](docs/fieldnote-postmortem.en.md#7-hosting-shutdown-and-backup-verification)

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

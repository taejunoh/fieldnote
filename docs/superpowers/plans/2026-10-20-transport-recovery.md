# Bounded transport recovery implementation plan

> Execution is assigned to the current worker under parent supervision; no deployment, database changes, paid model calls, staging, or commits.

**Goal:** Recover once from positively identified transient WebSocket interruptions without saving partial output or multiplying the analysis time budget.

**Architecture:** `worker.ts` owns two sequential generation attempts under one configured absolute deadline and lease. `gateway.ts` retains one POST per invocation and forwards the shared abort signal. Each invocation creates fresh text/source accumulators. Safe terminal metadata records at most two attempts and maps the final upstream response ID to the existing failure RPC metadata contract.

**Stack:** TypeScript, Undici, Vitest fake timers and local HTTP fixtures.

- [x] Read parent AGENTS.md and INITIAL_PROMPT.md; current Fieldnote bugfix request controls scope.
- [x] Add regression cases to `src/lib/analysis/worker.test.ts`; observe 8 expected RED failures before implementation.
- [x] Implement maximum two calls only for interrupted WebSocket transport errors: unexpected EOF, connection reset, or close 1011/1012/1013. Exclude cancellation, timeout, protocol/oversize errors and other terminal states.
- [x] Require authoritative ownership before retry; abort an in-flight request when a heartbeat reports ownership loss. Keep snapshot/model/effort/instructions identical.
- [x] Share one configured deadline, including 250ms abortable backoff; retain the existing Undici inactivity margin. Clear timers/listeners on completion or failure.
- [x] Save only final completed verified output; record bounded safe attempts and failure top-level `upstreamResponseId` without raw partial text or error messages.
- [x] Verify real gateway parsing and public request shape with fixtures; verify stream abort against a local HTTP server.
- [x] Run `npm test`, `npx tsc --noEmit`, `npm run lint`; report actual results and review limitations to parent.

Historic interruption metadata cannot establish the exact low-level cause of earlier Tennis/WNBA failures. This fix permits a fresh generation, not stream resumption, and may consume up to one additional generation within the same budget. Only the configured hosted public web search request is replayed.

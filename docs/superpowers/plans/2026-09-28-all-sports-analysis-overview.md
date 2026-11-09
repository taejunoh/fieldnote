# All Sports Analysis Overview Implementation Plan

> **For agentic workers:** Implement the two independent tasks below and verify their shared response contract before deployment.

**Goal:** Add a WORKSPACES entry that opens a single view of the latest completed analysis table for all seven sports.

**Architecture:** A new owner-authenticated endpoint returns the same latest-analysis shape for every sport in one browser request. The existing sport conversation keeps its pinned table; a separate central overview renders seven compact cards, shows analysis type and completion time, and links each card back to its sport. An analysis without a table remains explicitly empty, and recommendations are never shown as actual bets.

**Tech Stack:** Next.js 15 route handlers, React 19, Supabase Postgres, ReactMarkdown/GFM, Vitest.

---

### Task 1: Read-only all-sports latest-analysis API

**Files:** Create `src/app/api/analysis/latest/route.ts` and `route.test.ts`; reuse `src/lib/latest-analysis-table.ts`.

- [ ] Test an owner-scoped response with all seven sport slugs, null for sports without completed jobs, and the newest completed job for each sport even when its answer has no Markdown table.
- [ ] Test that each linked assistant message is queried with owner and sport filters, and the response is `private, no-store`.
- [ ] Implement `GET /api/analysis/latest` with `{ sports: [{ sport, analysis }] }`, where `analysis` matches the existing per-sport latest-analysis response shape. Do not launch analyses or create sport records.
- [ ] Run focused Vitest, TypeScript, and ESLint checks.

### Task 2: WORKSPACES navigation and overview

**Files:** Modify `src/components/sports-desk.tsx` and `src/app/globals.css`; add focused UI tests if the existing test harness can render this path.

- [ ] Add a selected WORKSPACES entry labeled `전체 분석표` above the seven sport buttons.
- [ ] On selection, fetch the batch endpoint, keep the prior overview while refreshing, and show an explicit error/retry state if no overview has loaded.
- [ ] Render seven compact responsive cards with sport, analysis title/type, completion time in America/New_York, first saved table or clear no-table state, and `대화 열기` action.
- [ ] Reuse safe Markdown link rendering. Label analysis recommendations as distinct from actual confirmed bets.
- [ ] Refresh the overview when opened and while it remains visible so newly completed results appear without a new conversation.
- [ ] Verify sport switching, recent table preservation, narrow layout, and production build.

### Release

- [ ] Run full tests, TypeScript, lint on changed files, and production build.
- [ ] Deploy only the web service; no schema migration or paid model request is needed.
- [ ] Verify the authenticated production endpoint and rendered overview for all seven sports.

# Market evaluation quality implementation plan

> **For agentic workers:** Use subagent-driven-development in this session. The user approved execution; continue through implementation and review without requesting another execution choice.

**Goal:** Make unfinished valuations and material uncertainty explicit across all sports without weakening financial or source controls.

**Architecture:** Add bounded self-reported market evidence metadata alongside existing schedule coverage and canonical records. Parse once in worker finalization, render through a safe display DTO, and leave existing decision/extraction/entry logic unchanged.

**Tech Stack:** TypeScript, Zod, Next.js/React, Vitest; existing Supabase JSON metadata, no migration.

## Task 1: Shared evaluation evidence contract and workflow

Own `src/lib/analysis/evaluation.ts`, its tests, `context.ts`/prompt tests and `worker.ts`/worker tests. Follow existing extraction conventions and preserve the original provider text. Suggested public boundary:

```ts
extractEvaluationReport(text, { sport, dateEt, coverageReport, sources, record })
// => { answer, report?, validation: { version: 1, status, reasons, counts } }
evaluationDisplayFromMetadata(metadata)
// => safe, bounded display DTO or null; never canonical financial data
```

- [ ] Write meaningful failing tests for a complete valuation with separate observed quote/gate; WAIT with material condition/scenario/trigger; research-incomplete without forced WAIT or PASS; missing sport critical checks; malformed/duplicate/oversized blocks; sport/date/event/source mismatch; conflicting canonical decisions; absent legacy metadata.
- [ ] Implement bounded strict extraction and diagnostics. Limit to twenty selected markets and preserve all canonical data on any diagnostic failure. Tests assert no automatic recommendation promotion/demotion or financial side effects.
- [ ] Add shared all-sport checklist guidance and bounded report contract to the applicable fresh-analysis prompt. Do not impose report generation on conversation, results review or status-only requests. Explain completing price comparisons and uncertainty scenarios before writing extensive inventory commentary. Do not copy facts from the comparison fixtures into current instructions.
- [ ] Integrate parsing before native extraction, metadata after native extraction, and machine-block removal for both complete and failed native extraction. Verify durable recovered completion follows exactly the same path and no extra provider request is added.
- [ ] Run focused evaluation/context/worker/common-policy tests and TypeScript. Report exact commands and results.

## Task 2: Readable evaluation summary

Own a focused `src/components/market-evaluation.tsx` and tests, minimal integration in `analysis-message.tsx`/tests and `sports-desk.tsx`, coverage labels and scoped CSS. Reuse Task 1's safe DTO; do not mutate report data or parse bets from prose.

- [ ] Test selected-market counts, collapsed details, separate observed price and gate, material unknown/trigger, model-self-report caveat, malformed/old metadata and conversation omission.
- [ ] Render through chat messages and latest-analysis details using existing metadata/DTO boundaries. Do not expose raw prompt/provider/private metadata to the browser API.
- [ ] Rename misleading coverage text to schedule inventory processing; preserve schedule validation status and reasons. Do not infer market completeness from event assessed_count.
- [ ] Run focused UI and latest-analysis tests and TypeScript.

## Task 3: Review, regression and safe release

- [ ] Independent spec review against the approved design, followed by code-quality/security review; fix all material findings and re-review.
- [ ] Run `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`. Keep local verification evidence outside private runtime configuration and do not print credentials.
- [ ] Audit source diff for unexpected source-admission, actual-entry, automatic fallback/scheduling or canonical decision changes. Existing protected behavior must remain unchanged.
- [ ] If safe production tooling is available, snapshot protected-row hashes/counts and active-job state, stage only allowlisted release files including existing private display manifest, deploy idle existing web/worker, and verify deployment identities, auth isolation and unchanged protected data. Gateway remains untouched. No live model request.
- [ ] Report what is deployed and locally verified, what remains unmeasured, and which broader improvement areas remain outstanding. No PR/commit against AllinSimple Desk.

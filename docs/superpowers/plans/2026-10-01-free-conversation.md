# Implementation and verification plan

1. Reproduce the source-gate failure using seven varied ordinary messages. Add purpose-contract, current-request, mixed, strict-action and fake-reference cases before implementation.
2. Add CHAT_INSTRUCTIONS and strict response-purpose extraction. Select auto search for message jobs and required search for explicit actions. Preserve exact input snapshots and all requested/reported model fields.
3. Route conversation and safe server clarification through a separate atomic finalizer. Keep fresh analysis source checks and record extraction strict. Never create analysis or ledger rows from conversational replies.
4. Remove the new-message entry phrase fast path; retain existing local request replay and rule command behavior.
5. Add result_type and a service-role conversation finalizer with the same attempt/worker/lease fences as analysis. Test side effects, invalid payloads, duplicate calls and stale attempts in SQL.
6. Filter latest-analysis and notices by result_type, keeping legacy NULL analysis compatibility. Render conversation as normal prose.
7. Run targeted tests, full npm test, TypeScript and build. Inspect actual gateway auto/required request behavior before deployment. Deploy only after the backend, SQL and UI changes are all present; then verify one ordinary live conversation and preserved prior latest analysis without creating a sports analysis request.

Backend red evidence: 12 new worker behaviors failed because unsourced conversation was rejected or sourced conversation was promoted into analysis; nine route expectations failed because the closed entry phrases still bypassed the model. These failures passed after the implementation.

## Completion evidence — October 1, 2026, 20:46 ET

- Full verification: 37 suites and 357 tests passed; TypeScript, lint and Next production build passed.
- SQL gate: the new migration and all seven fixtures passed with transaction rollback; residual schema and fixture checks were empty. The migration then committed successfully.
- Review: all three findings were fixed with regression tests. Fresh-web basis requires actual evidence, current question forms cannot downgrade into unsourced conversation, and case/whitespace/underscore variants of forbidden analysis blocks receive fixed clarification.
- Gateway: the pinned deployment preserved tool_choice=auto. No gateway change was required.
- Deployment: web and worker succeeded, each with one running instance and zero crashed instances.
- Live conversation: one question about saved WNBA WATCH/BET criteria completed on its first attempt, saved one natural assistant reply, used valid stored-context references, and truthfully retained searched=false, verified=false and no sources. The UI displayed FIELDNOTE without a failure banner.
- Side effects: existing bets, events, recommendations and criteria remained unchanged; the previous latest WNBA analysis remained selected.
- Usage: one OpenLLMs subscription call, with no paid API fallback.

A current sports-analysis request was not rerun. This completion evidence does not estimate the overall analysis failure rate after deployment. After a fresh UI reload, the natural conversation remained saved with its FIELDNOTE label and no error; the prior latest-analysis region remained unchanged. A screenshot was captured and visually inspected as local verification evidence.

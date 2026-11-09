# Sports Desk v1 implementation plan

1. Create the single-owner Supabase schema, RLS policies, and auth boundary. Verify that an unauthenticated request cannot read or write sport data.
2. Parse the MLB handoff into a reviewable draft with source line references. Commit raw MD and extracted records in one idempotent import. Verify repeated import leaves row counts unchanged.
3. Build one persistent chat per sport with pagination and date dividers. Verify refresh and sport switching preserve messages.
4. Assemble bounded analysis context from adopted rules, event state, recent messages, source-linked history, and summaries. Start a `web_search` Responses background run with a stable idempotency key. Store its response ID and reconcile status/result on later GET requests. Verify a replay or retry creates one final assistant message.
5. Keep recommendations, user-confirmed entries, final results, and postmortems separate. Verify a price-only message does not enter the confirmed ledger, and an adopted user correction outranks imported rules.
6. Run typecheck, lint, build, and fixture-based tests. Live API verification is deferred until credentials and a cost scope are agreed.

The first working slice is the MLB import → ongoing conversation → searchable analysis → persisted result. Other sports share the same data flow and start without MLB rules.

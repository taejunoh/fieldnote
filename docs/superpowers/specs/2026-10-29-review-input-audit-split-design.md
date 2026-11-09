# Lossless review audit separation

This is the user's authorized continuation of quality-preserving optimization after the first measured MLB pair used more tokens. Preserve the standalone Fieldnote workspace and all prior evidence. Do not stage, commit, push, use the parent repository, add resources, change models, or enable paid fallback.

## Evidence and chosen scope

The completed pilot reported 229,215 input / 8,857 output tokens for the deployed review path, versus 203,573 / 9,743 for the legacy instructions with the same enriched source context. A separate blinded review found core coverage of ten original decisions preserved, with extra depth in the deployed path. A single pair cannot attribute the token difference to one cause.

Read-only sizing found a redundant source_messages audit index in the deployed model payload: 21,621 UTF-8 bytes across 73 MLB messages and 11,310 bytes across 37 tennis messages. Those IDs, roles, times and complete original bodies already exist in recent_messages. Hashes, byte counts and source-location pointers are server audit information.

Choose audit-only separation. Defer removal of scope/profit aliases and conditional-source projections because their marginal byte savings are small and they alter additional field contracts. Do not trim summaries, original messages, policies, corrections, structured judgments, facts, ticket rows or search depth.

## Data contract

Keep prepareResultsReview(context)'s full returned packet as the server preparation result. Serialize a separate model packet that omits exactly source_messages and original_context_sha256. All other packet fields, values and order remain unchanged. recent_messages, historical_structured_decisions, adopted criteria, policy, corrections and every other original context field retain their existing behavior.

Persist the source-message audit manifest and original-context hash in the existing private input snapshot's review_preparation data before any provider call. Retain the exact original_context and exact prepared context/instructions and their existing hashes. Do not place the full audit index in assistant-message metadata or send it back to the provider. Update only the review instruction sentence that currently says the index is in the packet: tell the model to use original IDs, roles, times and bodies in recent_messages and preserve the existing completeness warning.

Completion recovery uses captured context and instructions exactly, including old checkpoints that still contain the inline index. Preserve a stored audit manifest on recovery; absence in legacy checkpoints remains absence, not fabricated completeness. Snapshot persistence failure prevents provider execution. No migration, new RPC, ledger write, note adoption or record reclassification is needed.

## Verification and release

Tests must compare every semantic input field deeply before/after, cover all eight sports, verify body-only and native-only PASS/WAIT reasoning, preserve special settlement and unknown actuals, prove snapshot audit persistence before the call and exact old/new checkpoint recovery without a new call. Requested Astra/xhigh and required live search remain unchanged.

Measure real frozen-input byte sizes privately for MLB and tennis without printing source bodies. Bytes are not tokens, weekly quota or dollar savings. Run full tests, lint, typecheck, production build, independent specification and code-quality reviews. Deploy only the reviewed source to the existing idle web/worker services; gateway, auth and operating records remain unchanged.

After a separate scope/usage notice, at most one new paired MLB experiment may compare the pre-change deployed input with the optimized input using identical frozen evidence, Astra/xhigh and required search. Preserve full private GatewayResult and raw stdout/stderr, unique correlation IDs, detached per-call checkpoints and unknown failures. Do not resubmit the earlier unresolved tennis attempts or rerun until a favorable result appears. Lock a blinded quality judgment before revealing routes and usage. Report observed results and limited scope without claiming global quality parity or guaranteed subscription savings.

# Local rule instruction route

## Scope

Route only three anchored standalone settings to deterministic local persistence: the default recommended unit, official source preference, and the captured pre-game hypothetical reevaluation request. Preserve all other text and explicit actions on the existing sourced analysis path.

## Persistence

An authenticated transaction saves the user's raw message, a fixed assistant acknowledgment, and an adopted criterion with its source message. A stable command key links revisions of the same setting. Revisions supersede the previous adopted rule. Local rule handling creates no events, recommendations, bets, or mistake notes and carries no web verification metadata.

## Idempotency and retries

Analysis jobs and local instructions share a transaction-locked idempotency namespace. Replaying the same key and text returns the original rows; a different text or cross-mode collision returns a conflict. A failed recognized message can resolve through the same transaction while retaining its job status, attempt number, and failure record and dismissing only that attempt. Active jobs continue through the existing retry path.

## Hypothetical reevaluation policy

A request after a game's start may receive a separate prose-only hypothetical based solely on information from before the start. Exclude live and post-start outcome information. The response must not suggest the game is still unstarted or pretend the original judgment was made earlier. Preserve the stored time, status, original judgment, and result, and do not save hypothetical recommendations to current records.

## Verification

- `npm test`: 204 tests passed. `next build` passed.
- The rollback-only database regression passed with the failed-attempt fixture seeded before switching to the authenticated role. No production grants were broadened.
- Real Management API concurrency checks passed in both directions: the losing cross-mode request received SQLSTATE `23505` after waiting, and concurrent same-key local requests returned identical message, acknowledgment, and criterion IDs. Fixture data was cleaned up.
- Migration `202609300001` was applied. Web deployment `ef2845a7-21eb-4744-8378-25a2061b189d` and worker deployment `de7887b0-2e7f-4e48-9e9f-252ec63ff772` succeeded.
- UI recovery was checked for MLB, soccer, tennis, and WNBA. Each saved one criterion and acknowledgment, preserved attempt count and failure history, and dismissed only the failed attempt. No model calls were made; events, recommendations, bets, and mistake notes stayed unchanged.
- The local route remains limited to the three supported command classes. Other and mixed messages continue through sourced analysis.

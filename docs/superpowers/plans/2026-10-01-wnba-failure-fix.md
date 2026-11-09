# WNBA entry confirmation failure fix

The WNBA message `들어갔어` completed seven gateway calls, but each output claimed a search with no sources and failed the analysis source guard. A report of execution needs a closed local conversation response.

1. Recognize only the eight explicit Korean entry confirmation phrases, after NFC/whitespace normalization and one optional trailing punctuation mark. Mixed analysis requests retain analysis validation.
2. Store a report-only acknowledgment atomically through `apply_entry_confirmation_ack`. Ask for actual game, selection, executed price, and amount. Do not infer an execution from previous recommendations or write criteria, events, recommendations, or bets.
3. Share the owner/sport/request-key namespace with analysis jobs and rule instructions. Exact original payload replay returns the original rows; mismatches conflict.
4. Recover only a matching failed job and its current failed attempt, reusing its original user message. Record dismissal and resolution while retaining the job failure and all attempt history.
5. Verify all seven sports, phrase boundaries, metadata, idempotency, owner access, cross-mode collisions, historical preservation, and no ledger/criteria writes. Review SQL before any database application; no model call is needed.

## Verification and recovery evidence

Verified on October 1, 2026 at 19:34 America/New_York: 36 test suites and 306 tests passed, along with TypeScript checking, lint, and the Next.js production build.

The production SQL migration and fixtures passed a transaction preflight that rolled back all changes. The reviewed migration was then committed successfully. The fixtures cover all seven sports, exact phrase boundaries, owner access, shared request-key collisions, and preservation of failed attempt history.

The original WNBA failure was resolved through the local acknowledgment RPC. Its failed status, original error, and all seven attempts were preserved; attempt seven was dismissed with a local resolution. Exactly one clarification acknowledgment was restored, and an idempotent replay returned the same acknowledgment. Before-and-after checks confirmed unchanged bet, event, recommendation, and criteria counts, and the latest completed WNBA analysis remained unchanged.

The web and worker deployments succeeded. A read-only Chrome inspection confirmed that the acknowledgment was visible and the failure banner was absent; the screenshot is saved at `<local operations directory>/verification/wnba-recovered-20261001.png` (outside this repository).

The first gateway cloud build caught a disabled-search fixture regression caused by unconditional source inclusion. The second build caught a missing brace in the added test patch. The patch was regenerated from the actual Go source and a temporary Git baseline. A fresh checkout at the pinned commit accepted the patch, and all three packages passed locally with Go 1.24.5 and in the cloud; the cloud binary build also passed. The final gateway deployment succeeded. Gateway, web, and worker each had one running instance and no crashed instances. Both web and worker authenticated successfully to the read-only private models endpoint (HTTP 200), without making a completion call.

No actual model, search, or completion call was made for verification or recovery, and no paid fallback was used. These checks establish the local acknowledgment and historical recovery behavior; they do not establish a post-fix live analysis failure rate.

# Sports Desk v1 design

One account owns one continuing conversation per sport. Postgres keeps every original message and imported file. Context sent to OpenAI is assembled from current adopted rules, unresolved game state, recent messages, related records, and traceable summaries. Imported MD is historical source material, never a live source.

The browser app uses Supabase Auth. Server routes validate the authenticated email against `OWNER_EMAIL`, and Postgres RLS limits rows to the owner. Import parses a reviewable draft and commits it transactionally with a file hash. Analysis requests write an idempotent job and user message, then start an OpenAI Responses background call with `web_search`. The response ID persists; the UI polls a server route that retrieves, finalizes and stores results exactly once. Closing the page does not cancel the OpenAI job. Failed jobs can be retried with a new attempt.

Recommendations and confirmed bets are separate entities. No natural-language price mention creates a bet. The owner explicitly confirms a bet with event, market, selection, and optional price/stake; missing fields stay unknown. Result checks retain cited sources and do not rewrite prior decisions. Rule edits create versions, with proposed rules separate from adopted rules.

Validation: import same file twice, refresh and switch sports, reconnect to a job, preserve corrected rules, and check recommendation versus confirmed bet behavior. Live model calls require configured credentials and incur API usage, so automated tests use fixtures.

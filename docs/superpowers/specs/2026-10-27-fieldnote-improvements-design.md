# Fieldnote continuity and analysis usability

The user approved the nine proposed improvements and explicitly authorized this task to continue past the account usage reserve threshold. That exception applies to this task only.

## Intended experience

One continuing conversation per sport remains the primary interface. The chat receives most of the viewport; the latest analysis and supporting records are accessible without permanently occupying its height. Ordinary conversation stays conversational. Analysis explains its conclusion, evidence, opposing case and reassessment trigger. Source and record-admission diagnostics remain inspectable without replacing the substantive answer.

## Analysis context and decisions

Retain original messages and source-linked summaries. Retrieve user messages independently of assistant-message volume, with explicit limits and coverage provenance. Preserve latest user corrections above older summaries without silently adopting suggested rules. Current rules, original recommendations, actual entry reports and result notes remain different kinds of evidence. Examples teach reasoning and uncertainty handling, not the winning outcome of a historical fixture. Existing official-source, provenance, temporal and unit checks stay intact.

## Durable execution

Recognize every terminal gateway state without waiting for EOF. Preserve safe quota/authentication codes, distinguish provider interruption from a saving problem, and never introduce automatic paid fallback. Checkpoint a completed provider answer before parsing/finalization using owner/attempt/lease-fenced, service-only storage. Resume a stored answer without a new provider call. Bound retries and confirm already committed finalization rather than regenerating the answer. Recovery preserves original answer/source/check times and never backdates a new pregame judgment.

## Records and performance

Fix the note form's missing idempotency key. Allow a user to review a note proposal and explicitly confirm an entry, linking each to its source message and, when applicable, its recommendation/event/bet. Missing fill price or actual stake stays unknown. A price quote or model recommendation never creates an actual bet.

Performance must use a frozen original recommendation, an explicit observed quote and settlement contract, and a sourced outcome. Do not parse a threshold into an execution price or present actual bet profit as recommendation profit. Unscored and incomplete records remain visible. Existing history is not rewritten to manufacture a complete scorecard.

## NBA

Register NBA across the application and current database allow-lists, with NBA-specific source guidance and reviewable import. Keep WNBA separate. An import retains raw source text and uncertainty; no historical tickets are inferred from recommendations or generic prose.

## Safety and delivery

Use existing single-owner Auth/RLS and service boundaries. Add migrations rather than editing applied migrations. This checkout is ignored in an unrelated parent cost-app repository: do not stage, commit, create a PR or modify that parent project. Do not print credentials. Do not call paid model APIs or create paid hosting resources. Validate with local fixtures and local SQL where available; report any production migration/release or live-analysis verification still pending accurately.

Performance corrections use append-only versions: `supersedesEvaluationId` references the current owner/sport/recommendation evaluation. The predecessor and its original frozen recommendation remain unchanged. A unique successor prevents concurrent corrections from creating two current versions; stale corrections require reloading. Current views exclude superseded evaluations from performance totals while retaining inspectable history. Quotes verified after the sourced outcome are labeled reviewed manual late verification, never presented as original execution or automatically captured pregame quotes.

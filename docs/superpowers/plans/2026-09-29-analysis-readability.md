# Analysis readability implementation plan

> **For agentic workers:** Use the current delegated workers with distinct file ownership. Preserve concurrent changes.

**Goal:** Make the latest saved analysis and continuous conversation readable without rereading long source lists.

**Architecture:** Keep saved messages and betting records unchanged. Add conservative display parsers for the appended source footer and explicit Markdown table columns. Use the same execution table renderer in the sport, overview, and expanded views.

**Tech Stack:** Next.js, React, TypeScript, react-markdown, remark-gfm, Vitest.

## Approved design

The user approved all four suggestions on September 29: collapse source lists, widen chat, standardize the execution table, and allow the pinned analysis table to collapse. Preserve the compact page header, hidden intelligence drawer, and collapsed quick requests.

- Source footer: show the material check time and unknowns; put source links in an accessible native disclosure. Leave body citations intact. Unrecognized footer formats render intact.
- Chat: remove the large assistant inset and use the central column width, retaining horizontal scrolling for wide tables.
- Execution table: show match, start time in ET, original decision, recommended units, and unknowns. Only display explicit saved values; absent fields read `미기재`. Preserve separate markets and historical/result wording. Unsupported tables keep their original rendering. This display does not create bets or alter analysis records.
- Pinned table: default expanded, remember the user's preference independently for each sport, retain title/time/actions when collapsed, and keep the expanded modal available.

## Tasks and ownership

- [x] Source worker: `src/lib/message-sources.ts`, focused parser tests, `src/components/analysis-message.tsx`. Verified absent/malformed/unsafe/fenced footer handling and intact inline citations.
- [x] Table worker: `src/lib/execution-table.ts`, focused tests, `src/components/execution-table.tsx`, latest-analysis extraction. Verified missing columns, multiple markets, conflicts, time zones, reference links, and unsupported tables. Preserved separate rows from distinct source tables; no cross-table joins because team names alone do not establish game identity.
- [x] Integration worker: `src/components/sports-desk.tsx`, `src/app/globals.css`. Integrated both components and accessible collapse preference, widened chat, styled desktop/mobile.
- [x] Coordinator: inspected changes. `npm test`: 28 files, 167 tests passed. `npm run build`: compilation, lint, type validation, and page generation passed.
- [x] Coordinator: deployed sanitized source to the existing Railway web service. Final deployment `8742ceb6-344d-4079-870c-873b874ad8e2` succeeded. Verified closed source lists and 18-link expansion, collapse/refresh/sport switching, modal with matching four rows, seven overview cards, and mobile horizontal table scrolling (390px page, 764px table, scrollLeft 390).

## Production verification adjustments

- Compact pinned rows and remove the redundant normalized-table subtitle. At 1512×806, all four MLB rows fit in the existing 242px pinned region; the conversation area does not shrink further.
- Follow the conversation bottom on viewport/pinned-area resize only when the reader was already near bottom. Verified reload and sport switching leave a 0–0.5px bottom gap; while reading history, collapse/expand preserves scrollTop 45796.
- All added display behavior preserves original messages and records. Different formats such as the latest NFL results-review table keep the original table presentation.
- No new model analysis or paid OpenAI request was made for verification.

## Acceptance

All original saved content remains available. Source lists start closed. Pinned analysis is visible by default and can be collapsed without losing its header. Sport changes and refresh preserve the selected preference. Existing saved analysis is displayed in five consistent columns where supported; missing information and separate markets remain explicit. Conversation/analysis/API job semantics and actual betting records remain unchanged.

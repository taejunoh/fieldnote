# Fieldnote notification center implementation plan

**Goal:** Replace stacked sport alert banners with one compact, accessible header bell so the analysis workspace retains its height.

**Architecture:** Reuse the existing owner-scoped job overview and read-state persistence. A client popover groups each sport's unread completed analyses, active work and unresolved failures without hiding one status behind another. No new database schema, browser push permission or model request is needed.

**Design:** Keep FIELDNOTE colors, typography and header density. The bell shows the unread/attention count capped visually at 99+, with the full count in its accessible label. Opening the panel does not mark anything read. Selecting a sport uses the existing navigation/read-on-loaded-message behavior. An explicit completed-results-only mark-all action leaves active and failed jobs untouched. Connection problems stay visible in the panel and bell; an empty state appears only when status is known and no work needs attention. Outside click and Escape close the panel; focus returns appropriately. The mobile panel remains within the viewport.

**Ownership:** improvement_ui_nba owns the two UI files and a narrow helper/regressions; root coordinates verification and existing web deployment. No changes to analysis jobs, actual entries, imported NBA records, common policy, worker or gateway. No Git actions in the ignored checkout's unrelated parent repository.

- [x] Replace sports-desk.tsx stacked banner rendering with the bell/panel; reuse useJobOverview and markSeen for exact known completed IDs. Preserve existing sidebar status, sport selection, source records, hidden rail and chat height behavior.
- [x] Add scoped globals.css responsive panel/badge/focus states. Add meaningful notification aggregation regressions for mixed statuses, stale/empty state and completed-only bulk read.
- [x] Run focused tests, full tests, lint and TypeScript. Build without overwriting a live .next directory. Independently review changes against the saved pre-change sources.
- [x] Verify desktop and narrow viewport, open/close/keyboard navigation and bulk-read persistence without launching an analysis or modifying historical records.
- [x] Deploy only the existing web service; verify the running source/version, owner access and result. Keep model/provider and hosting plans unchanged.


## Verified delivery

Full test suite: 853 tests across 59 files passed. Lint, TypeScript and production build passed. Independent review identified mobile status-chip and inherited breadcrumb-style issues; those were repaired before release. A completed-only bulk-read integration regression preserves running/failed jobs and future unread completions.

Browser verification at 1280×720 and 390×844 covered the bell/panel, visible mobile status chips, panel bounds, composer remaining in view, Escape focus return, outside-click textarea focus, and navigation to an existing failed sport without retrying or dismissing it. No browser console errors were observed. Temporary viewport settings and the responsive wrapper were reset/removed.

Production web deployment `427fd84d-70b8-4f3e-a62a-eb6a1f8df9db` reached SUCCESS. Four deployed UI/hook source hashes match the tested archive. Owner API and job overview returned HTTP 200; NBA retained its one imported rule, 41 historical entries and five notes. Verification sessions were revoked. No analysis model call, database migration, worker deployment, provider/model change or hosting-plan change occurred. Read state continues to use the existing owner-scoped browser storage.

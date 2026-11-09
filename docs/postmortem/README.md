# Evidence and reproduction guide

[한국어 가이드](README.ko.md) · [Operations postmortem](../fieldnote-postmortem.en.md)

| File | Source and preparation |
|---|---|
| [chat-confirmed-cards.csv](chat-confirmed-cards.csv) | Settled cards reconciled against the October 27, 2026 ChatGPT export, specifically `02_entries_results.txt` and `recent_records.json`. Identifiers such as `Snnn` refer to documents within that export. The entry and settlement records for the same bet were counted once. |
| [fieldnote-ticket-excerpts.csv](fieldnote-ticket-excerpts.csv) | From a read-only ledger query at 7:58 a.m. ET on November 9, 2026. Includes the date, odds, units risked, and result for six bets confirmed directly in Fieldnote. Identifiers such as `Fnn` were assigned for this release. |
| [fieldnote-import-counts.csv](fieldnote-import-counts.csv) | Counts imported ledger rows by sport from the same query. These rows were excluded from Fieldnote's directly confirmed results. |
| [fieldnote-job-counts.csv](fieldnote-job-counts.csv) | Counts final job states from the same query, grouped by sport, creation date in ET, and provider. |
| [usage-batches.csv](usage-batches.csv) | October 29 token totals from the final measurement of the results and review batch and the saved diagnostics for the separate pregame analysis batch. |
| [incident-excerpts.csv](incident-excerpts.csv) | Error messages and the limits of what was observed, drawn from job records, storage audits, and deployment receipts. |
| [billing-snapshot.csv](billing-snapshot.csv) | Usage and estimated charges recorded in the October 20 Railway snapshot. |
| [performance-summary.csv](performance-summary.csv) | Sport-by-sport results calculated from the verified subsets for each workflow. |

From the repository root, run this command with Python 3 to check the aggregates and Fieldnote ticket profit and loss.

```sh
python3 docs/postmortem/reproduce.py --check
```

With Matplotlib installed, add `--charts` to regenerate the three SVG charts. The script uses the de-identified excerpts in this repository. Card rows were manually reconciled against the original documents before inclusion. The source document counts and reported bet counts measure different things. Dates with gaps in the records remain unverified.

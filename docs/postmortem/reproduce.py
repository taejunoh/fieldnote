#!/usr/bin/env python3
"""Recompute report aggregates from the de-identified evidence bundled here."""

import argparse
import csv
import io
from collections import Counter
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SPORTS = ("mlb", "nfl", "cfb", "soccer", "tennis", "wnba", "nhl", "nba")
UNKNOWN = "미확인"
RESULTS = ("win", "loss", "push", "void")
FIELDNOTE_RESULT = {"won": "win", "lost": "loss", "push": "push", "void": "void"}


def load(name):
    with (ROOT / (name + ".csv")).open(encoding="utf-8", newline="") as source:
        return list(csv.DictReader(source))


def total_if_known(rows, key):
    if not rows or any(not row[key] for row in rows):
        return None
    return sum(Decimal(row[key]) for row in rows)


def rounded(value, digits):
    if value is None:
        return UNKNOWN
    return str(value.quantize(Decimal(1).scaleb(-digits), rounding=ROUND_HALF_UP))


def metrics(counts, stake, net, eligible):
    win, loss, push, void = (counts[k] for k in RESULTS)
    rate = Decimal(100) * win / (win + loss) if win + loss else None
    roi = Decimal(100) * net / stake if eligible and stake and net is not None else None
    return (win + loss + push + void, win, loss, push, void,
            rounded(rate, 2), rounded(stake, 3), rounded(net, 4), rounded(roi, 2))


def performance():
    chat = load("chat-confirmed-cards")
    app = load("fieldnote-ticket-excerpts")
    assert len({(r["sport"], r["coverage"]) for r in chat}) == len(chat)
    assert len({r["ref"] for r in app}) == len(app)
    for ticket in app:
        stake, price = Decimal(ticket["risk_u"]), int(ticket["american_price"])
        assert stake > 0 and abs(price) >= 100
        unit_return = Decimal(price) / 100 if price > 0 else Decimal(100) / -price
        profit = {"won": stake * unit_return, "lost": -stake,
                  "push": Decimal(0), "void": Decimal(0)}[ticket["result"]]
        assert rounded(profit, 4) == rounded(Decimal(ticket["net_u"]), 4)
    for sport in SPORTS:
        selected = [r for r in chat if r["sport"] == sport]
        counts = {k: sum(int(r[k]) for r in selected) for k in RESULTS}
        if selected:
            values = metrics(counts, total_if_known(selected, "risk_u"),
                             total_if_known(selected, "net_u"),
                             all(r["roi_eligible"] == "yes" for r in selected))
            yield (sport, "chatgpt", *values)
        else:
            yield (sport, "chatgpt", *([UNKNOWN] * 9))
        selected = [r for r in app if r["sport"] == sport]
        counts = Counter(FIELDNOTE_RESULT[r["result"]] for r in selected)
        yield (sport, "fieldnote", *metrics(counts, total_if_known(selected, "risk_u"),
                                          total_if_known(selected, "net_u"), True))


def jobs():
    counts = Counter()
    for row in load("fieldnote-job-counts"):
        counts[row["sport"], row["status"]] += int(row["jobs"])
    return counts


def summary(rows):
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(("sport", "platform", "settled_subset_count", *RESULTS, "win_pct",
                     "risk_u", "net_u", "roi_pct"))
    writer.writerows(rows)
    return buffer.getvalue()


def chart(rows):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10,
                         "axes.spines.top": False, "axes.spines.right": False,
                         "svg.fonttype": "path", "svg.hashsalt": "fieldnote-postmortem"})
    dest = ROOT / "charts"
    dest.mkdir(exist_ok=True)
    labels = ["Soccer" if s == "soccer" else "Tennis" if s == "tennis" else s.upper()
              for s in SPORTS]
    pos = list(range(len(SPORTS)))

    def save(fig, name):
        fig.tight_layout(pad=1.6)
        target = dest / (name + ".svg")
        fig.savefig(target, metadata={"Date": None})
        target.write_text("\n".join(line.rstrip() for line in target.read_text().splitlines()) + "\n")
        plt.close(fig)

    lookup = {(r[0], r[1]): r[2] for r in rows}
    fig, ax = plt.subplots(figsize=(9, 4.5))
    for side, color, delta, name in (("chatgpt", "#216b85", -.17, "ChatGPT, verified subset"),
                                     ("fieldnote", "#b1532f", .17, "Fieldnote, directly confirmed")):
        for i, sport in enumerate(SPORTS):
            count = lookup[sport, side]
            if count == UNKNOWN:
                ax.text(.12, i + delta, "unverified", va="center", color=color, fontsize=8)
            else:
                ax.barh(i + delta, count, height=.29, color=color, label=name if i == 0 else None)
                ax.text(count + .22, i + delta, str(count), va="center", color=color, fontsize=9)
    ax.set_yticks(pos, labels)
    ax.invert_yaxis()
    ax.set_title("Actual entries with recorded results — two different cohorts", loc="left", weight="bold")
    ax.set_xlabel("Settled tickets in the verified subset (coverage differs)")
    ax.legend(frameon=False, loc="lower right")
    ax.set_xlim(right=max(int(v) for v in lookup.values() if v != UNKNOWN) * 1.2 + 1)
    save(fig, "settled-tickets")

    statuses = ("completed", "failed", "interrupted")
    counts = jobs()
    fig, ax = plt.subplots(figsize=(9, 4.7))
    left = [0] * len(SPORTS)
    for status, color in zip(statuses, ("#4c7d70", "#e7a653", "#a6474d")):
        vals = [counts[s, status] for s in SPORTS]
        ax.barh(pos, vals, left=left, color=color, label=status.capitalize())
        left = [a + b for a, b in zip(left, vals)]
    for i, n in enumerate(left):
        problems = counts[SPORTS[i], "failed"] + counts[SPORTS[i], "interrupted"]
        ax.text(n + 1, i, f"{problems} / {n}", va="center", fontsize=9)
    ax.set_yticks(pos, labels)
    ax.invert_yaxis()
    ax.set_title("Fieldnote request status at the 2026-11-09 readback", loc="left", weight="bold")
    ax.set_xlabel("Requests · right labels show failed or interrupted / total")
    ax.legend(frameon=False, loc="lower right")
    ax.set_xlim(right=max(left) + 13)
    save(fig, "request-status")

    usage = load("usage-batches")
    fig, ax = plt.subplots(figsize=(9, 3.2))
    inp = [int(r["input_tokens"]) / 1e6 for r in usage]
    out = [int(r["output_tokens"]) / 1e6 for r in usage]
    ax.barh(range(len(usage)), inp, color="#216b85", label="Input")
    ax.barh(range(len(usage)), out, left=inp, color="#e7a653", label="Output")
    for i, (a, b) in enumerate(zip(inp, out)):
        label = f"{a + b:.3f}M" + (" known" if int(usage[i]["unknown_attempts"]) else "")
        ax.text(a + b + .04, i, label, va="center")
    ax.set_yticks(range(len(usage)), ["Results / review", "Pregame evaluation"])
    ax.invert_yaxis()
    ax.set_title("Two Fieldnote batches on 2026-10-29", loc="left", weight="bold")
    ax.set_xlabel("Reported tokens (millions)")
    ax.legend(frameon=False, loc="upper right")
    ax.set_xlim(right=max(a + b for a, b in zip(inp, out)) + .46)
    save(fig, "batch-usage")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Verify the bundled performance CSV")
    parser.add_argument("--charts", action="store_true", help="Regenerate the SVG charts with matplotlib")
    args = parser.parse_args()
    rows = list(performance())
    target = ROOT / "performance-summary.csv"
    output = summary(rows)
    if args.check:
        assert target.read_text(encoding="utf-8") == output, "Performance CSV differs"
    else:
        target.write_text(output, encoding="utf-8")
    job_counts = jobs()
    imported = sum(int(r["imported_rows"]) for r in load("fieldnote-import-counts"))
    status_totals = Counter()
    for (_, status), count in job_counts.items():
        status_totals[status] += count
    assert imported == 148 and len(load("fieldnote-ticket-excerpts")) == 6
    assert status_totals == {"completed": 405, "failed": 7, "interrupted": 11}
    assert all(sum(int(r[k]) for k in ("input_tokens", "output_tokens")) > 0
               for r in load("usage-batches"))
    if args.charts:
        chart(rows)
    print("Verified:", len(rows), "sport/platform rows,", imported, "imported rows,",
          sum(status_totals.values()), "Fieldnote requests.")


if __name__ == "__main__":
    main()

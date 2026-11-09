import { createElement, Fragment } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ExecutionRow } from "@/lib/execution-table";

export type { ExecutionRow } from "@/lib/execution-table";

const markdownComponents: Components = {
  a: ({ href, children, ...props }) => {
    const safeProps = { ...props };
    delete (safeProps as { node?: unknown }).node;
    return createElement("a", {
      ...safeProps,
      href,
      target: "_blank",
      rel: "noopener noreferrer",
    }, children);
  },
};

const STATUS_LABELS: Record<string, string> = {
  WATCH: "watch",
  WAIT: "wait",
  BET: "bet",
  PASS: "pass",
  PAPER: "paper",
  "EVALUATION INCOMPLETE": "incomplete",
};

function plainText(markdown: string): string {
  return markdown
    .replace(/!?\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(\*\*|__|\*|_|~~)(.*?)\1/g, "$2")
    .trim();
}

function statusKey(decision: string | null): string | null {
  if (!decision) return null;
  const value = plainText(decision).replace(/\s+/g, " ").toLocaleUpperCase();
  return Object.hasOwn(STATUS_LABELS, value) ? value : null;
}

function markdown(value: string) {
  return createElement(ReactMarkdown, { remarkPlugins: [remarkGfm], components: markdownComponents }, value);
}

function cell(value: string | null, status = false) {
  if (!value) return "미기재";
  const key = status ? statusKey(value) : null;
  if (key) {
    return createElement("div", { className: `status-badge status-${STATUS_LABELS[key]}` }, markdown(value));
  }
  return markdown(value);
}

export function ExecutionTable({ rows }: { rows: ExecutionRow[] }) {
  return createElement("div", { className: "execution-table-scroll" },
    createElement("table", { className: "execution-table" },
      createElement("thead", null,
        createElement("tr", null,
          ...["경기", "시작 시각(ET)", "판단", "권장 유닛", "미확인 항목"].map((label) =>
            createElement("th", { key: label, scope: "col" }, label),
          ),
        ),
      ),
      createElement("tbody", null,
        ...rows.map((row, index) => createElement("tr", { key: `${row.match}-${index}` },
          createElement("td", null,
            createElement(Fragment, null,
              markdown(row.match),
              row.context ? createElement("small", { className: "execution-table-context" }, markdown(row.context)) : null,
            ),
          ),
          createElement("td", null, cell(row.startTime)),
          createElement("td", null, cell(row.decision, true)),
          createElement("td", null, cell(row.units)),
          createElement("td", null, cell(row.unknowns)),
        )),
      ),
    ),
  );
}

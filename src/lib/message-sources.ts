export type MessageSource = {
  title: string;
  url: string;
};

export type SplitMessageSources = {
  body: string;
  checkedAt: string;
  sources: MessageSource[];
  unknowns: string;
};

export function messageTypeFromMetadata(metadata: unknown): "analysis" | "conversation" {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "analysis";
  return (metadata as Record<string, unknown>).type === "conversation"
    ? "conversation"
    : "analysis";
}

const FOOTER_PATTERN = /\n\n---\n자료 확인 시각: ([^\r\n]+) \(America\/New_York\)\n출처: ([^\r\n]*)\n미확인 사항: ([^\r\n]*)\s*$/;

function isInsideUnclosedFence(content: string) {
  let fence: { character: string; length: number } | null = null;

  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (!match) continue;

    const marker = match[1];
    if (!fence) {
      fence = { character: marker[0], length: marker.length };
    } else if (
      marker[0] === fence.character &&
      marker.length >= fence.length &&
      /^ {0,3}[`~]+\s*$/.test(line)
    ) {
      fence = null;
    }
  }

  return fence !== null;
}

function unescapeMarkdown(value: string) {
  return value.replace(/\\([\\`*{}\[\]()#+\-.!_>])/g, "$1");
}

function safeHttpUrl(value: string) {
  if (!value || /[\s<>]/.test(value)) return false;
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      Boolean(parsed.hostname) &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}

function parseSourceLinks(value: string): MessageSource[] | null {
  if (value === "") return [];

  const sources: MessageSource[] = [];
  let cursor = 0;

  while (cursor < value.length) {
    if (value[cursor] !== "[") return null;
    let titleEnd = cursor + 1;
    let bracketDepth = 1;

    while (titleEnd < value.length && bracketDepth > 0) {
      const character = value[titleEnd];
      if (character === "\\") {
        titleEnd += 2;
        continue;
      }
      if (character === "[") bracketDepth += 1;
      if (character === "]") bracketDepth -= 1;
      titleEnd += 1;
    }
    if (bracketDepth !== 0 || value[titleEnd] !== "(") return null;

    const title = unescapeMarkdown(value.slice(cursor + 1, titleEnd - 1));
    if (!title.trim()) return null;

    let urlEnd = titleEnd + 1;
    let parenDepth = 1;
    while (urlEnd < value.length && parenDepth > 0) {
      const character = value[urlEnd];
      if (character === "\\") {
        urlEnd += 2;
        continue;
      }
      if (character === "(") parenDepth += 1;
      if (character === ")") parenDepth -= 1;
      urlEnd += 1;
    }
    if (parenDepth !== 0) return null;

    const url = unescapeMarkdown(value.slice(titleEnd + 1, urlEnd - 1));
    if (!safeHttpUrl(url)) return null;
    sources.push({ title, url });
    cursor = urlEnd;

    if (cursor === value.length) break;
    if (!value.startsWith(" · ", cursor)) return null;
    cursor += 3;
    if (cursor === value.length) return null;
  }

  return sources;
}

/**
 * Removes only a valid, machine-appended source footer at the end of a message.
 * Any ambiguity returns null so callers can render the original Markdown intact.
 */
export function splitMessageSources(content: string, messageType: "analysis" | "conversation" = "analysis"): SplitMessageSources | null {
  if (messageType === "conversation") return null;
  const match = FOOTER_PATTERN.exec(content);
  if (!match) return null;

  const footerStart = match.index + 2;
  if (isInsideUnclosedFence(content.slice(0, footerStart))) return null;

  const sources = parseSourceLinks(match[2]);
  if (!sources) return null;

  return {
    body: content.slice(0, match.index),
    checkedAt: match[1],
    sources,
    unknowns: match[3],
  };
}

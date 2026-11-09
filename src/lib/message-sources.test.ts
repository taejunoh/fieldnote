import { describe, expect, it } from "vitest";
import { messageTypeFromMetadata, splitMessageSources } from "./message-sources";

const footer = (sources: string, unknowns = "본문에 명시한 사항 참조.") =>
  `\n\n---\n자료 확인 시각: 2026-09-29 12:34:56 (America/New_York)\n출처: ${sources}\n미확인 사항: ${unknowns}`;

describe("splitMessageSources", () => {
  it("does not parse a source footer for metadata-tagged conversation messages", () => {
    expect(splitMessageSources(`일반 답변${footer("[출처](https://example.com)")}`, "conversation")).toBeNull();
    expect(messageTypeFromMetadata({ type: "conversation" })).toBe("conversation");
    expect(messageTypeFromMetadata({ type: "other" })).toBe("analysis");
  });

  it("leaves messages without a trailing footer untouched", () => {
    expect(splitMessageSources("[출처](https://example.com) 본문 인용")).toBeNull();
  });

  it("extracts only the appended footer and preserves visible metadata", () => {
    const result = splitMessageSources(
      `본문 인라인 [인용](https://example.com)${footer("[리그 공식](https://league.example/schedule) · [통계](https://stats.example/game)")}`,
    );
    expect(result).toEqual({
      body: "본문 인라인 [인용](https://example.com)",
      checkedAt: "2026-09-29 12:34:56",
      sources: [
        { title: "리그 공식", url: "https://league.example/schedule" },
        { title: "통계", url: "https://stats.example/game" },
      ],
      unknowns: "본문에 명시한 사항 참조.",
    });
  });

  it("does not parse footer-like text inside an unclosed code fence", () => {
    expect(splitMessageSources(`\`\`\`md${footer("[출처](https://example.com)")}`)).toBeNull();
  });

  it("does not parse a footer-like block that remains inside a closed code fence", () => {
    expect(
      splitMessageSources(`\`\`\`md${footer("[출처](https://example.com)")}\n\`\`\``),
    ).toBeNull();
  });

  it.each([
    "[깨진 링크](https://example.com",
    "링크 아님",
    "[스크립트](javascript:alert(1))",
    "[사용자정보](https://user:pass@example.com)",
    "[공백 URL](https://example.com/a b)",
  ])("preserves the original message when source links are malformed or unsafe: %s", (sources) => {
    const content = `본문${footer(sources)}`;
    expect(splitMessageSources(content)).toBeNull();
  });

  it("supports empty source lists and retains unknowns", () => {
    expect(splitMessageSources(`본문${footer("", "선발 명단 미확인")}`)).toMatchObject({
      body: "본문",
      sources: [],
      unknowns: "선발 명단 미확인",
    });
  });

  it("supports escaped title brackets and URLs with parentheses without deduping", () => {
    expect(
      splitMessageSources(
        `본문${footer("[경기 \\[공식\\] 공지](https://example.com/match(2)) · [중복](https://example.com/match(2))")}`,
      )?.sources,
    ).toEqual([
      { title: "경기 [공식] 공지", url: "https://example.com/match(2)" },
      { title: "중복", url: "https://example.com/match(2)" },
    ]);
  });
});

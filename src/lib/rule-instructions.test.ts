import { describe, expect, it } from "vitest";
import { parseRuleInstruction } from "./rule-instructions";

describe("parseRuleInstruction", () => {
  it("recognizes the exact standalone settings", () => {
    expect(parseRuleInstruction("앞으로 유닛은 0.25u로 해줘")?.commandKey)
      .toBe("default_recommended_units");
    expect(parseRuleInstruction("출처는 공식 사이트 우선으로 확인해줘")?.commandKey)
      .toBe("preferred_sources");
    expect(parseRuleInstruction("앞으로 유닛은 2.5u로 해줘")?.content)
      .toContain("2.5u");
    expect(parseRuleInstruction("기본 권장 유닛은 100u로 해줘")?.acknowledgment)
      .toContain("100u");
    expect(parseRuleInstruction("앞으로 출처는 공식 사이트 우선으로 확인해줘")?.commandKey)
      .toBe("preferred_sources");
  });

  it.each([
    "혹시 시작 시간이 지나서 내가 재평가를 물어보더라도 시작하지 않았다고 생각하고 판단하도록해. 어차피 우리는 라이브 경기를 바탕으로 판단하는건 아니니까. 그래야 나중에 오답노트도 제대로 작성하지.",
    "알겠어. 그리고 혹시 시작 시간이 지나서 내가 재평가를 물어보더라도 시작하지 않았다고 생각하고 판단하도록 해. 어차피 우리는 라이브 경기를 바탕으로 판단하는건 아니니까. 그래야 나중에 오답노트도 제대로 작성하지.",
    "알겠어. 그리고 혹시 시작 시간이 지나서 내가 재평가를 물어보더라도 시작하지 않았다고 생각하고 판단하도록 해. 어차피 우리는 라이브 경기를 바탕으로 판단하는건 아니니까. 그래야 나중에 오답노트도 제대로 작성하지",
    "알겠어. 그리고 혹시 시작 시간이 지나서 내가 재평가를 물어보더라도 시작하지 않았다고 생각하고 판단하도록해. 어차피 우리는 라이브 경기를 바탕으로 판단하는건 아니니까. 그래야 나중에 오답노트도 제대로 작성하지.",
  ])("recognizes captured hypothetical request %s", (text) => {
    expect(parseRuleInstruction(text)?.commandKey)
      .toBe("pre_game_hypothetical_assessment");
  });

  it.each([
    "시작 시간이 지나서 내가 재평가를 물어보더라도 시작하지 않았다고 생각하고 판단하도록 해",
    "혹시 시작 시간이 지나서 내가 재평가를 물어보더라도 시작하지 않았다고 생각하고 판단하도록 해 어차피 우리는 라이브 경기를 바탕으로 판단하는건 아니니까",
    "알겠어 그리고 시작 시간이 지나서 내가 재평가를 물어보더라도 시작하지 않았다고 생각하고 판단하도록 해 그래야 나중에 오답노트도 제대로 작성하지",
  ])("recognizes the complete supported hypothetical structure %s", (text) => {
    expect(parseRuleInstruction(text)?.commandKey)
      .toBe("pre_game_hypothetical_assessment");
  });

  it.each([
    "오늘 MLB 경기 분석해줘",
    "앞으로 유닛은 0.25u로 해줘. 오늘 양키스 경기도 봐줘",
    "앞으로 유닛은 0.25u로 해줘?",
    "앞으로 유닛은 101u로 해줘",
    "앞으로 유닛은 -0.25u로 해줘",
    "앞으로 유닛은 0.25u로 해줘 그리고 공식 출처도 확인해줘",
    "'출처는 공식 사이트 우선으로 확인해줘'라고 질문할게",
    "출처는 공식 사이트 우선으로 확인해줘. 그리고 오늘 경기 분석해줘",
    "경기 시작 시간이 지나도 시작하지 않았다고 생각하고 판단해줘",
    "알겠어. 그리고 혹시 시작 시간이 지나서 내가 재평가를 물어보더라도 시작하지 않았다고 생각하고 판단하도록 해. 어차피 우리는 라이브 경기를 바탕으로 판단하는건 아니니까. 그래야 나중에 오답노트도 제대로 작성하지. 오늘 경기 결과도 확인해줘",
  ])("does not route mixed, quoted, negative, or game requests locally: %s", (text) => {
    expect(parseRuleInstruction(text)).toBeNull();
  });
});

export type RuleInstructionKey =
  | "default_recommended_units"
  | "preferred_sources"
  | "pre_game_hypothetical_assessment";

export interface RuleInstruction {
  commandKey: RuleInstructionKey;
  title: string;
  content: string;
  acknowledgment: string;
}

const definitions: Record<Exclude<RuleInstructionKey, "default_recommended_units">, Omit<RuleInstruction, "commandKey">> = {
  preferred_sources: {
    title: "출처 확인 우선순위",
    content:
      "정보를 확인할 때 공식 사이트를 우선 출처로 사용하고, 실제로 확인한 출처와 미확인 사항을 구분해 표시한다.",
    acknowledgment:
      "알겠습니다. 공식 사이트를 우선 확인하도록 저장했습니다. 이 메시지는 출처를 실제로 조회했다는 뜻은 아닙니다.",
  },
  pre_game_hypothetical_assessment: {
    title: "경기 시작 후 사전 정보 가상 재평가",
    content:
      "경기 시작 뒤 재평가는 경기 시작 전 정보만 사용하는 별도의 가정 평가로 작성한다. 라이브 정보와 사후 결과 정보는 가정 평가에 사용하지 않으며, 경기가 실제로 시작하지 않았다고 표현하거나 원래 판단이 과거에 내려진 것처럼 꾸미지 않는다. 저장된 starts_at, game_status, 당시 판단과 결과를 변경하지 않는다. 가정 평가를 실제 추천 또는 진입 기록에 저장하지 않는다.",
    acknowledgment:
      "기준을 저장했습니다. 시작 후 재평가는 경기 전 정보에 근거한 가정 평가로 별도 작성하고, 실제 경기 상태와 당시 판단·결과는 보존합니다. 가정 평가는 실제 추천·진입 기록에 넣지 않습니다.",
  },
};

function normalize(text: string): string {
  return text
    .normalize("NFC")
    .replace(/[\u200b\ufeff]/g, "")
    .replace(/[\t\r\n ]+/g, " ")
    .replace(/하도록 해/gu, "하도록해")
    .replace(/\.(?=\s|$)/gu, " ")
    .replace(/[\t\r\n ]+/g, " ")
    .trim()
    .replace(/[。]+$/u, "")
    .trim();
}

/**
 * Recognize only complete, standalone settings instructions. Keep this grammar
 * deliberately closed so game analysis and mixed requests stay on the sourced path.
 */
export function parseRuleInstruction(text: string): RuleInstruction | null {
  const value = normalize(text);
  const unitMatch = value.match(
    /^(?:앞으로 (?:유닛은|기본 권장 유닛은)|기본 권장 유닛은) (100(?:\.0{1,3})?|(?:[1-9]\d?)(?:\.\d{1,3})?|0(?:\.\d{1,3})?)u로 해줘$/u,
  );
  if (unitMatch) {
    const units = Number(unitMatch[1]);
    if (Number.isFinite(units) && units >= 0 && units <= 100) {
      return {
        commandKey: "default_recommended_units",
        title: "기본 권장 유닛",
        content: `앞으로 분석의 기본 권장 유닛은 ${unitMatch[1]}u로 제안한다. 이는 분석상 권장치이며 실제 베팅 금액이나 실행 확인을 뜻하지 않는다.`,
        acknowledgment: `기본 권장 유닛을 ${unitMatch[1]}u로 저장했습니다. 이는 분석상 권장치이며 실제 베팅이나 금액을 뜻하지 않습니다.`,
      };
    }
  }
  if (/^(?:앞으로 )?출처는 공식 사이트 우선으로 확인해줘$/u.test(value)) {
    return { commandKey: "preferred_sources", ...definitions.preferred_sources };
  }

  const hypothetical = value.replace(/^(?:알겠어 ?)?(?:그리고 )?(?:혹시 )?/u, "");
  const action = "시작 시간이 지나서 내가 재평가를 물어보더라도 시작하지 않았다고 생각하고 판단하도록해";
  const liveReason = "어차피 우리는 라이브 경기를 바탕으로 판단하는건 아니니까";
  const notebookReason = "그래야 나중에 오답노트도 제대로 작성하지";
  if (
    new RegExp(`^${action}(?: ${liveReason})?(?: ${notebookReason})?$`, "u").test(hypothetical)
  ) {
    return {
      commandKey: "pre_game_hypothetical_assessment",
      ...definitions.pre_game_hypothetical_assessment,
    };
  }
  return null;
}

import { z } from "zod";

const schema = z.object({
  version: z.literal(1),
  intent: z.enum(["conversation", "current_analysis", "mixed", "clarification"]),
  basis: z.enum(["general", "stored_context", "fresh_web"]),
  referenced_message_ids: z.array(z.string().min(1).max(128)).max(32),
  requires_fresh_data: z.boolean(),
}).strict();
export type ResponsePurpose = z.infer<typeof schema>;
export const CLARIFICATION_CONTENT = "요청의 의도와 답변 근거를 확인하지 못했습니다. 이전 대화에 대한 설명인지, 현재 경기 자료를 확인하는 분석인지 조금 더 구체적으로 알려주세요. 경기·추천·실제 진입 기록은 변경하지 않았습니다.";
export const CLARIFICATION_PURPOSE: ResponsePurpose = { version: 1, intent: "clarification", basis: "general", referenced_message_ids: [], requires_fresh_data: false };

export function extractResponsePurpose(text: string, contextMessageIds: Set<string>): { answer: string; purpose: ResponsePurpose | null; reason?: string } {
  const markers = text.match(/^```response-purpose\s*$/gm) || [];
  const block = /(?:^|\n)```response-purpose\s*\n([\s\S]*?)\n```\s*$/.exec(text);
  if (markers.length !== 1 || !block) return { answer: text, purpose: null, reason: "purpose_envelope_invalid" };
  let value: unknown;
  try { value = JSON.parse(block[1]); } catch { return { answer: text, purpose: null, reason: "purpose_json_invalid" }; }
  const parsed = schema.safeParse(value);
  if (!parsed.success) return { answer: text, purpose: null, reason: "purpose_schema_invalid" };
  const purpose = parsed.data;
  const fresh = purpose.intent === "current_analysis" || purpose.intent === "mixed";
  if ((fresh && (!purpose.requires_fresh_data || purpose.basis !== "fresh_web")) || (!fresh && purpose.requires_fresh_data))
    return { answer: text, purpose: null, reason: "purpose_contradictory" };
  if (new Set(purpose.referenced_message_ids).size !== purpose.referenced_message_ids.length || purpose.referenced_message_ids.some(id => !contextMessageIds.has(id)))
    return { answer: text, purpose: null, reason: "purpose_reference_invalid" };
  if (purpose.basis === "stored_context" && purpose.referenced_message_ids.length === 0)
    return { answer: text, purpose: null, reason: "purpose_reference_missing" };
  const answer = text.slice(0, block.index).trim();
  if (!answer) return { answer: text, purpose: null, reason: "purpose_answer_empty" };
  return { answer, purpose };
}

// This guard only recognizes clear commands for current sports data. Historical
// questions such as “왜 PASS였어?” or “분석 작업 왜 실패했어?” remain conversation.
export function requiresFreshRequest(request: string): boolean {
  const clauses = request.trim().replace(/"[^"]*"|“[^”]*”|「[^」]*」/g, "").split(/그리고|그런데|하지만|[.!;]/);
  return clauses.some(text => {
    if (/(?:작업|요청했|했는데|부탁했|라고).*(?:실패|중단|문제)/.test(text) && /왜|이유|문제/.test(text)) return false;
  const subject = /경기|일정|라인업|출전|배당|결과|games?|slate|schedule|lineups?|odds|results?/i;
  const current = /오늘|내일|최신|현재|지금|재확인|today|tomorrow|latest|current|recheck/i;
  const command = /해\s*줘|해주세요|봐\s*줘|봐주세요|확인|분석|알려\s*줘|보여\s*줘|check|analy[sz]e|show|review/i;
  return subject.test(text) && current.test(text) && (command.test(text) || /[?？]|어떻게|얼마|어때|됐어/.test(text));
  });
}

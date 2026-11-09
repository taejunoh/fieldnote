import { describe, expect, it } from "vitest";
import { extractResponsePurpose, requiresFreshRequest } from "./response-purpose";
const purpose = {version:1,intent:"conversation",basis:"general",referenced_message_ids:[],requires_fresh_data:false};
const wrap = (value:unknown) => `답변\n\n\`\`\`response-purpose\n${JSON.stringify(value)}\n\`\`\``;
describe("response purpose boundary", () => {
  it("accepts exactly one strict final envelope and strips only that envelope", () => {
    expect(extractResponsePurpose(wrap(purpose), new Set()).purpose).toEqual(purpose);
    expect(extractResponsePurpose(wrap(purpose), new Set()).answer).toBe("답변");
  });
  it.each(["답변",wrap({...purpose,extra:true}),wrap({...purpose,intent:"mixed"}),wrap({...purpose,referenced_message_ids:["invented"]}),wrap(purpose)+" trailing",wrap(purpose)+wrap(purpose)])("rejects malformed, contradictory, or untraceable metadata", text => {
    expect(extractResponsePurpose(text,new Set()).purpose).toBeNull();
  });
  it("accepts references only to supplied context messages", () => {
    expect(extractResponsePurpose(wrap({...purpose,basis:"stored_context",referenced_message_ids:["m1"]}),new Set(["m1"])).purpose).not.toBeNull();
  });
  it.each(["오늘 경기 분석해줘","최신 배당 확인해줘","라인업 재확인해줘","오늘 MLB 전체 일정 봐줘","Check current odds","Analyze today's games"])("requires current evidence for unmistakable fresh request %s",request => expect(requiresFreshRequest(request)).toBe(true));
  it.each(["왜 PASS였어?","분석 작업 왜 실패했어?","뭐가 문제였어?","들어갔어","방금 설명 다시 해줘","기준을 잘못 이해했어"])("does not force historical discussion into search %s",request => expect(requiresFreshRequest(request)).toBe(false));
});
it.each(["왜 PASS였고 지금 배당은?","현재 라인업은?","오늘 경기는?","최신 결과는 어떻게 됐어?"])("guards fresh sports questions without imperative verbs %s",request => expect(requiresFreshRequest(request)).toBe(true));
it.each(['"오늘 경기 분석해줘"라고 했는데 왜 실패했어?',"오늘 경기 분석 작업이 왜 실패했어?","최신 배당 확인을 요청했는데 왜 중단됐어?"])("allows discussion about a previous failed request %s",request => expect(requiresFreshRequest(request)).toBe(false));

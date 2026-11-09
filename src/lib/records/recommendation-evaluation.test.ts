import {describe,it,expect} from "vitest";
import {freezeRecommendation,evaluateRecommendation} from "./recommendation-evaluation";
const rec={id:"r",recommendation_item_key:"pick",source_message_id:"m",market:"moneyline",selection:"Home",decision:"BET",suggested_units:1,price_gate:"-120 or better"};
const message={id:"m",role:"assistant",created_at:"2026-10-27T12:00:00Z",metadata:{checked_at:"2026-10-27T11:59:00Z",analysis_record:{recommendations:[{item_key:"pick",event_key:"event",market:"moneyline",selection:"Home",decision:"BET",suggested_units:1,price_gate:"-120 or better"}],events:[{event_key:"event",starts_at:"2026-10-27T18:00:00Z"}]}}};
const input={observedPrice:-110,quoteSourceUrl:"https://book.example/quote",quoteObservedAt:"2026-10-27T12:00:00Z",settlementContract:{market:"moneyline",selection:"Home",marketType:"moneyline",period:"full_game",overtimeIncluded:true},outcome:"won",outcomeSourceUrl:"https://league.example/result",outcomeCheckedAt:"2026-10-27T22:00:00Z"};
describe("frozen recommendation evaluation",()=>{
 it("freezes original source and computes hypothetical unit return, separate from actual PnL",()=>{const frozen=freezeRecommendation(rec,message);const result=evaluateRecommendation(frozen,input);expect(result).toMatchObject({status:"scored",profit_per_unit:0.909091,roi_percent:90.9091});expect(frozen.event.starts_at).toBe("2026-10-27T18:00:00Z");expect(frozen).not.toHaveProperty("executed_price");});
 it("never turns price_gate into observed price",()=>{expect(evaluateRecommendation(freezeRecommendation(rec,message),{...input,observedPrice:null})).toMatchObject({status:"unscored",profit_per_unit:null,roi_percent:null,reasons:expect.arrayContaining(["observed_quote_incomplete"])});});
 it("excludes historical/after-start delivery and unsupported or unmatched contracts",()=>{const frozen=freezeRecommendation(rec,{...message,metadata:{...message.metadata,delivery:{delivered_at:"2026-10-27T19:00:00Z",historical_delivery:true}}});expect(evaluateRecommendation(frozen,input).reasons).toContain("historical_or_late_delivery");expect(evaluateRecommendation(freezeRecommendation(rec,message),{...input,settlementContract:{...input.settlementContract,market:"total"}}).reasons).toContain("unsupported_or_mismatched_contract");});
 it("rejects source row drift and missing original metadata",()=>{expect(()=>freezeRecommendation({...rec,selection:"Away"},message)).toThrow();expect(()=>freezeRecommendation(rec,{...message,metadata:{}})).toThrow();});
 it("never scores a quote or outcome on the wrong side of original start",()=>{const frozen=freezeRecommendation(rec,message);expect(evaluateRecommendation(frozen,{...input,quoteObservedAt:"2026-10-27T19:00:00Z"}).reasons).toContain("quote_not_pregame");expect(evaluateRecommendation(frozen,{...input,outcomeCheckedAt:"2026-10-27T17:00:00Z"}).reasons).toContain("outcome_before_start");});
});

import {presentRecommendationEvaluations} from "./recommendation-evaluation";
it("marks current versions from successor provenance even outside loaded history and labels late manual verification",()=>{
 const frozen=freezeRecommendation(rec,message);
 const rows=presentRecommendationEvaluations([{id:"old",frozen_recommendation:frozen,evaluation_input:input,successors:[{id:"outside-window"}],created_at:"2026-10-28T00:00:00Z"}]);
 expect(rows[0].is_current).toBe(false);
 expect(rows[0].evaluation.quote_provenance).toBe("reviewed_manual_late_verification");
});

it("requires the reviewed spread/total line and total direction to match the frozen selection",()=>{
 const base=freezeRecommendation(rec,message);
 const spread={...base,recommendation:{...base.recommendation,market:"spread",selection:"Home -3.5"}};
 const spreadInput={...input,settlementContract:{market:"spread",selection:"Home -3.5",marketType:"spread",line:-10.5,period:"full_game",overtimeIncluded:true}};
 expect(evaluateRecommendation(spread,spreadInput)).toMatchObject({status:"unscored",profit_per_unit:null});
 expect(evaluateRecommendation(spread,{...spreadInput,settlementContract:{...spreadInput.settlementContract,line:-3.5}}).status).toBe("scored");
 const total={...base,recommendation:{...base.recommendation,market:"total",selection:"Under7"}};
 const totalInput={...input,settlementContract:{market:"total",selection:"Under7",marketType:"total",line:7,direction:"under",period:"full_game",overtimeIncluded:false}};
 expect(evaluateRecommendation(total,totalInput).status).toBe("scored");
 expect(evaluateRecommendation(total,{...totalInput,settlementContract:{...totalInput.settlementContract,line:8}}).status).toBe("unscored");
 expect(evaluateRecommendation(total,{...totalInput,settlementContract:{...totalInput.settlementContract,direction:"over"}}).status).toBe("unscored");
 expect(evaluateRecommendation({...total,recommendation:{...total.recommendation,selection:"Under"}}, {...totalInput,settlementContract:{...totalInput.settlementContract,selection:"Under"}}).status).toBe("unscored");
});
it("uses its own original checked and delivery times despite a mixed-slate historical flag",()=>{
 const frozen={...freezeRecommendation(rec,message),historical_delivery:true};
 expect(evaluateRecommendation(frozen,input).status).toBe("scored");
 expect(evaluateRecommendation({...frozen,event:{...frozen.event,starts_at:null}},input).status).toBe("unscored");
 expect(evaluateRecommendation({...frozen,delivered_at:"2026-10-27T19:00:00Z"},input).status).toBe("unscored");
});
it("keeps PAPER observations visible without executable recommendation ROI",()=>{
 const frozen=freezeRecommendation(rec,message);
 expect(evaluateRecommendation({...frozen,recommendation:{...frozen.recommendation,decision:"PAPER"}},input)).toMatchObject({status:"unscored",profit_per_unit:null,roi_percent:null,reasons:expect.arrayContaining(["not_executable_recommendation"])});
});
it.each(["ML","full_game_ml","money_line"])("supports explicit full-game moneyline alias %s without fuzzy market matching",market=>{
 const frozen=freezeRecommendation(rec,message);
 expect(evaluateRecommendation({...frozen,recommendation:{...frozen.recommendation,market}}, {...input,settlementContract:{...input.settlementContract,market}}).status).toBe("scored");
});
it("supports explicit Game total while keeping team total unsupported",()=>{
 const frozen=freezeRecommendation(rec,message);
 const contract={market:"Game total",selection:"Under7",marketType:"total",line:7,direction:"under",period:"full_game",overtimeIncluded:true};
 expect(evaluateRecommendation({...frozen,recommendation:{...frozen.recommendation,market:"Game total",selection:"Under7"}}, {...input,settlementContract:contract}).status).toBe("scored");
 expect(evaluateRecommendation({...frozen,recommendation:{...frozen.recommendation,market:"Team total",selection:"Under7"}}, {...input,settlementContract:{...contract,market:"Team total"}}).status).toBe("unscored");
});
it.each([
 ["total","Over 2/2.5",2,"over"],
 ["total","Under2.5/3",2.5,"under"],
 ["spread","Home-3.5/-4.5",-3.5,undefined],
 ["total","Over2 or2.5",2,"over"],
 ["total","Over 2–2.5",2,"over"],
 ["spread","Home -3/-3.5",-3,undefined],
 ["spread","Home -3–3.5",-3,undefined],
] as const)("keeps unsupported split/range/alternative identity unscored (%s %s)",(market,selection,line,direction)=>{
 const frozen=freezeRecommendation(rec,message);
 expect(evaluateRecommendation({...frozen,recommendation:{...frozen.recommendation,market,selection}}, {...input,settlementContract:{market,selection,marketType:market,line,direction,period:"full_game",overtimeIncluded:true}})).toMatchObject({status:"unscored",profit_per_unit:null,roi_percent:null});
});
it("keeps numeric team names separate from a single original signed spread line",()=>{
 const frozen=freezeRecommendation(rec,message);
 const market="spread",selection="76ers -3.5";
 expect(evaluateRecommendation({...frozen,recommendation:{...frozen.recommendation,market,selection}}, {...input,settlementContract:{market,selection,marketType:"spread",line:-3.5,period:"full_game",overtimeIncluded:true}}).status).toBe("scored");
});

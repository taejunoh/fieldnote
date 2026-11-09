/** Paper performance only. No values from an actual ticket enter this calculation. */
type Row=Record<string,unknown>;
export interface FrozenRecommendation {version:1;source_message_id:string;checked_at:string|null;delivered_at:string;historical_delivery:boolean;recommendation:Row;event:Row;}
export function freezeRecommendation(row:Row,message:Row):FrozenRecommendation {
 const metadata=(message.metadata||{}) as Row;
 const record=(metadata.analysis_record||{}) as Row;
 const items=Array.isArray(record.recommendations)?record.recommendations as Row[]:[];
 const original=items.find(item=>item.item_key===row.recommendation_item_key);
 if(message.role!=="assistant" || !original || message.id!==row.source_message_id || ["market","selection","decision","price_gate"].some(key=>(original[key]??null)!==(row[key]??null)) || Number(original.suggested_units??0)!==Number(row.suggested_units??0)) throw new Error("Original recommendation source is missing or differs from the stored row");
 const events=Array.isArray(record.events)?record.events as Row[]:[];
 const event=events.find(item=>item.event_key===original.event_key);
 if(!event || typeof message.created_at!=="string") throw new Error("Original event snapshot is unavailable");
 const delivery=(metadata.delivery||{}) as Row;
 return JSON.parse(JSON.stringify({version:1,source_message_id:message.id,checked_at:metadata.checked_at||null,delivered_at:delivery.delivered_at||message.created_at,historical_delivery:delivery.historical_delivery===true,recommendation:original,event}));
}
const https=(v:unknown)=>{try{return typeof v==="string"&&new URL(v).protocol==="https:";}catch{return false;}};
const timestamp=(v:unknown)=>typeof v==="string"?Date.parse(v):NaN;
function hasAdditionalSettlementNumber(selection:string,match:RegExpMatchArray):boolean {
 const rest=selection.slice(0,match.index!)+selection.slice(match.index!+match[0].length);
 // Team identifiers such as 76ers are not another line; split/range/alternative numbers are.
 return /(?<![\p{L}\d.])\d+(?:\.\d+)?(?![\p{L}\d.])/u.test(rest) || /(?:\bor|또는)\s*[+-]?\d/i.test(rest);
}
/** Read settlement identity only from the original selection, never from a price threshold. */
function originalSettlementIdentity(selection:unknown,marketType:unknown):{line:number;direction?:string}|null {
 if(typeof selection!=="string") return null;
 if(marketType==="spread") {
  const values=[...selection.matchAll(/[+-]\d+(?:\.\d+)?(?![\w.])/g)];
  return values.length===1&&!hasAdditionalSettlementNumber(selection,values[0])?{line:Number(values[0][0])}:null;
 }
 if(marketType==="total") {
  const values=[...selection.matchAll(/(?:^|[\s:(])(under|over|u|o|언더|오버)\s*(\d+(?:\.\d+)?)(?![\w.])/gi)];
  if(values.length!==1||hasAdditionalSettlementNumber(selection,values[0])) return null;
  return {line:Number(values[0][2]),direction:["under","u","언더"].includes(values[0][1].toLowerCase())?"under":"over"};
 }
 return null;
}
export function evaluateRecommendation(frozen:FrozenRecommendation,input:Row,reviewedAt?:string) {
 const reasons:string[]=[];
 const start=timestamp(frozen.event.starts_at), checked=timestamp(frozen.checked_at), delivered=timestamp(frozen.delivered_at);
 if(!Number.isFinite(start)||!Number.isFinite(checked)||checked>=start) reasons.push("original_pregame_timing_unavailable");
 if(!Number.isFinite(delivered)||delivered>=start) reasons.push("historical_or_late_delivery");
 if(frozen.recommendation.decision!=="BET") reasons.push("not_executable_recommendation");
 const price=input.observedPrice;
 if(typeof price!=="number"||!Number.isInteger(price)||Math.abs(price)<100||!https(input.quoteSourceUrl)||!Number.isFinite(timestamp(input.quoteObservedAt))) reasons.push("observed_quote_incomplete");
 if(Number.isFinite(timestamp(input.quoteObservedAt))&&timestamp(input.quoteObservedAt)>=start) reasons.push("quote_not_pregame");
 const contract=input.settlementContract as Row|undefined;
 const market=String(frozen.recommendation.market).toLowerCase().replaceAll(" ","_");
 const supported:Record<string,string>={ml:"moneyline",full_game_ml:"moneyline",money_line:"moneyline",moneyline:"moneyline",full_game_moneyline:"moneyline",spread:"spread",full_game_spread:"spread",total:"total",game_total:"total",full_game_total:"total"};
 if(!contract||!supported[market]||contract.marketType!==supported[market]||contract.market!==frozen.recommendation.market||contract.selection!==frozen.recommendation.selection||contract.period!=="full_game"||typeof contract.overtimeIncluded!=="boolean"||(["spread","total"].includes(String(contract.marketType))&&(typeof contract.line!=="number"||!Number.isFinite(contract.line)))) reasons.push("unsupported_or_mismatched_contract");
 if(contract && ["spread","total"].includes(String(contract.marketType))) {
  const original=originalSettlementIdentity(frozen.recommendation.selection,contract.marketType);
  if(!original || original.line!==contract.line || (contract.marketType==="total" && original.direction!==contract.direction)) reasons.push("original_settlement_identity_unproven_or_mismatched");
 }
 if(!["won","lost","push","void"].includes(String(input.outcome))||!https(input.outcomeSourceUrl)||!Number.isFinite(timestamp(input.outcomeCheckedAt))) reasons.push("sourced_outcome_required");
 if(Number.isFinite(timestamp(input.outcomeCheckedAt))&&timestamp(input.outcomeCheckedAt)<start) reasons.push("outcome_before_start");
 const profit=reasons.length?null:input.outcome==="lost"?-1:input.outcome==="won"?((price as number)>0?(price as number)/100:100/Math.abs(price as number)):0;
 return {historical_delivery_warning:frozen.historical_delivery,quote_provenance:reviewedAt && timestamp(reviewedAt)>timestamp(input.outcomeCheckedAt)?"reviewed_manual_late_verification":"reviewed_manual",status:reasons.length?"unscored":"scored",reasons,profit_per_unit:profit===null?null:Math.round(profit*1e6)/1e6,roi_percent:profit===null?null:Math.round(profit*1e6)/1e4,meaning:"Hypothetical return on one risk unit at an explicitly reviewed observed quote; not actual bet profit."};
}

/** Successor IDs are queried separately from the bounded history so old versions cannot look current. */
export function presentRecommendationEvaluations(rows:Row[]) {
 const superseded=new Set(rows.map(row=>row.supersedes_evaluation_id).filter(Boolean));
 return rows.map(row=>({...row,is_current:Array.isArray(row.successors)?row.successors.length===0:!superseded.has(row.id),evaluation:evaluateRecommendation(row.frozen_recommendation as FrozenRecommendation,row.evaluation_input as Row,typeof row.created_at==="string"?row.created_at:undefined)}));
}

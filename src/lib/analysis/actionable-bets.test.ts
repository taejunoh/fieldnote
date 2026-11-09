import { describe, expect, it } from "vitest";
import { exactFixture } from "./reviewed-exact-bets.fixture";
import { entryFixture } from "../records/conditional-entry.fixture";
import { verifiedEntryCandidates, projectActionableBets } from "./actionable-bets";
import { sportSlugs } from "../sports";
const now=new Date("2026-10-27T16:00:00Z");
const key=(sport="mlb")=>`${sport}:2026-10-27:away@home:src`;
function record(sport="mlb",decision="BET",startsAt:string|null="2026-10-27T22:00:00Z") {
 return {version:1,sport,events:[{event_key:key(sport),label:"Away at Home",starts_at:startsAt,source_url:`https://unregistered.example/${sport}`,analysis_status:"WAIT"}],recommendations:[{item_key:"pick",event_key:key(sport),market:"moneyline",selection:"Away",decision,suggested_units:decision==="BET"||decision.includes("GO")?1:null,price_gate:"-110 or better"}]};
}
function input(value:unknown=record(),metadata:Record<string,unknown>={}) {
 return {sport:"mlb",jobId:"job",kind:"analyze_today",now,message:{id:"message",created_at:"2026-10-27T15:00:01Z",metadata:{checked_at:"2026-10-27T15:00:00Z",common_policy:{id:"policy"},original_model_response:`Substantive analysis\n\n\`\`\`analysis-record\n${JSON.stringify(value)}\n\`\`\``,...metadata}}};
}
describe("read-only actionable BET overview",()=>{
 it.each(sportSlugs)("shows the original priced BET for %s before source admission, even when summary status WAIT",sport=>{
  const projection=projectActionableBets({...input(record(sport)),sport});
  expect(projection).toMatchObject({actionState:"ready",needsReview:{count:0},actionableBets:[{match:"Away at Home",market:"moneyline",selection:"Away",suggestedUnits:1,priceGate:"-110 or better",checkedAt:"2026-10-27T15:00:00Z",messageId:"message",jobId:"job"}]});
  expect(projection.actionableBets[0].eventKey).toMatch(/:src-[a-f0-9]{32}$/);
 });
 it.each(["partial","incomplete"])("does not confuse %s storage with body recommendation eligibility",extraction_status=>{
  expect(projectActionableBets(input(record(),{extraction_status,analysis_record:{events:[],recommendations:[]},record_admission:{rejected_events:[{}]}})).actionableBets).toHaveLength(1);
 });
 it.each(["GO","EARLY GO"])("uses existing adopted-policy decision alias %s",decision=>{
  expect(projectActionableBets(input(record("mlb",decision))).actionableBets).toHaveLength(1);
  expect(projectActionableBets(input(record("mlb",decision),{common_policy:null})).actionState).toBe("unavailable");
 });
 it.each(["WAIT","WATCH","PASS","PAPER","LEAN","EVALUATION INCOMPLETE"])("does not promote %s to a BET",decision=>{
  expect(projectActionableBets(input(record("mlb",decision)))).toMatchObject({actionState:"ready",actionableBets:[]});
 });
 it("keeps distinct markets for the same event",()=>{
  const value=record();value.recommendations.push({...value.recommendations[0],item_key:"total",market:"total",selection:"Under7.5"});
  expect(projectActionableBets(input(value)).actionableBets.map(row=>row.market)).toEqual(["moneyline","total"]);
 });
 it.each(["2026-10-27T22:00:00Z","2026-10-28T22:00:00Z","2026-11-01T18:00:00Z"])("keeps upcoming EARLY recommendations without a today-only gate (%s)",start=>{
  expect(projectActionableBets(input(record("mlb","EARLY GO",start)))).toMatchObject({actionState:"ready",actionableBets:[{startsAt:start}]});
 });
 it("ignores expired picks without resurrecting them or blanket-dropping a future mixed-slate pick",()=>{
  const value=record();value.events.push({...value.events[0],event_key:"mlb:2026-10-27:other@clubs:src",starts_at:"2026-10-27T14:00:00Z"});
  expect(projectActionableBets(input(value,{delivery:{delivered_at:"2026-10-27T15:00:01Z",historical_delivery:true}})).actionableBets).toHaveLength(1);
  expect(projectActionableBets({...input(),now:new Date("2026-10-27T23:00:00Z")})).toMatchObject({actionState:"ready",actionableBets:[]});
 });
 it.each(["market","selection","price_gate","suggested_units"])("marks missing %s as review rather than a confirmed zero",field=>{
  const value=record();delete (value.recommendations[0] as Record<string,unknown>)[field];
  expect(projectActionableBets(input(value))).toMatchObject({actionState:"ready",actionableBets:[],needsReview:{count:1}});
 });
 it("marks missing starts and actual delivery uncertainty as review",()=>{
  expect(projectActionableBets(input(record("mlb","BET",null)))).toMatchObject({actionState:"ready",actionableBets:[],needsReview:{count:1}});
  expect(projectActionableBets({...input(),message:{...input().message,created_at:undefined}})).toMatchObject({actionState:"unavailable",actionableBets:[],needsReview:{count:1}});
  expect(projectActionableBets(input(record(),{delivery:{delivered_at:"2026-10-27T23:00:00Z"}})).actionableBets).toHaveLength(0);
 });
 it("distinguishes malformed/missing original records from a valid latest empty result",()=>{
  expect(projectActionableBets(input(undefined,{original_model_response:"broken"}))).toMatchObject({actionState:"unavailable",actionableBets:[]});
  const value=record();value.recommendations=[];
  expect(projectActionableBets(input(value))).toMatchObject({actionState:"ready",actionableBets:[],needsReview:{count:0}});
 });
 it("rejects identity collisions and foreign-sport raw records",()=>{
  const duplicate=record();duplicate.events.push({...duplicate.events[0]});
  expect(projectActionableBets(input(duplicate)).actionState).toBe("unavailable");
  expect(projectActionableBets(input(record("nba"))).actionState).toBe("unavailable");
 });
 it("does not mutate originals or create bets and excludes review/hypothetical purpose",()=>{
  const source=input();const original=JSON.stringify(source);
  expect(projectActionableBets({...source,kind:"review_results"}).actionState).toBe("not_applicable");
  expect(projectActionableBets(input(record(),{analysis_purpose:"hypothetical"})).actionState).toBe("not_applicable");
  projectActionableBets(source);expect(JSON.stringify(source)).toBe(original);
 });
});

it("preserves canonical non-entry unit/timing semantics rather than claiming a clean zero",()=>{
 const value=record("mlb","WAIT");value.recommendations[0].suggested_units=1;
 expect(projectActionableBets(input(value)).actionState).toBe("unavailable");
 const early=record("mlb","WAIT");(early.recommendations[0] as Record<string,unknown>).timing="early";
 expect(projectActionableBets(input(early)).actionState).toBe("unavailable");
});
it("uses the latest actual message/delivery evidence without hiding earlier pregame assessments",()=>{
 const source=input(record(),{delivery:{delivered_at:"2026-10-27T15:00:02Z"}});
 expect(projectActionableBets({...source,message:{...source.message,created_at:"2026-10-27T14:59:59Z"}}).actionableBets).toHaveLength(1);
 expect(projectActionableBets({...source,now:new Date("2026-10-28T00:00:00Z"),message:{...source.message,created_at:"2026-10-27T23:00:00Z"}}).actionableBets).toHaveLength(0);
});
it("reads a validated current-analysis response-purpose suffix without using Markdown judgments",()=>{
 const purpose={version:1,intent:"current_analysis",basis:"fresh_web",requires_fresh_data:true,referenced_message_ids:[]};const source=input(record(),{response_purpose:purpose,response_purpose_status:"valid"});
 source.message.metadata.original_model_response+=`\n\n\`\`\`response-purpose\n${JSON.stringify(purpose)}\n\`\`\``;
 expect(projectActionableBets({...source,kind:"message"})).toMatchObject({actionState:"ready",actionableBets:[{selection:"Away"}]});
 const waiting=record("mlb","WAIT");waiting.recommendations[0].selection="BET Away? GO is not confirmed";
 expect(projectActionableBets(input(waiting)).actionableBets).toEqual([]);
});
it("does not accept ambiguous duplicate original record blocks",()=>{
 const source=input();source.message.metadata.original_model_response+=`\n${source.message.metadata.original_model_response}`;
 expect(projectActionableBets(source).actionState).toBe("unavailable");
});
it("keeps prior-night EARLY and compares DST offsets as instants rather than local clock strings",()=>{
 const prior=input(record("mlb","EARLY GO"),{checked_at:"2026-10-26T23:30:00-04:00"});
 expect(projectActionableBets({...prior,message:{...prior.message,created_at:"2026-10-26T23:30:01-04:00"}}).actionableBets).toHaveLength(1);
 const dst=input(record("mlb","EARLY GO","2026-11-01T18:00:00Z"),{checked_at:"2026-11-01T01:30:00-04:00"});
 expect(projectActionableBets({...dst,now:new Date("2026-11-01T01:15:00-05:00"),message:{...dst.message,created_at:"2026-11-01T01:30:01-04:00"}}).actionableBets).toHaveLength(1);
});

it("requires saved matching valid current-analysis purpose for ordinary message jobs",()=>{
 const purpose={version:1,intent:"current_analysis",basis:"fresh_web",requires_fresh_data:true,referenced_message_ids:[]};
 const suffix=`\n\n\`\`\`response-purpose\n${JSON.stringify(purpose)}\n\`\`\``;
 const missing=input();missing.message.metadata.original_model_response+=suffix;
 expect(projectActionableBets({...missing,kind:"message"}).actionState).toBe("unavailable");
 const invalid=input(record(),{response_purpose:purpose,response_purpose_status:"invalid"});invalid.message.metadata.original_model_response+=suffix;
 expect(projectActionableBets({...invalid,kind:"message"}).actionState).toBe("unavailable");
 expect(projectActionableBets(invalid).actionState).toBe("unavailable");
 const mismatch=input(record(),{response_purpose:{...purpose,intent:"mixed"},response_purpose_status:"valid"});mismatch.message.metadata.original_model_response+=suffix;
 expect(projectActionableBets({...mismatch,kind:"message"}).actionState).toBe("unavailable");
});
it("accepts closed coverage blocks before or after the original canonical record like the worker",()=>{
 const coverage="\n\n```analysis-coverage\n{}\n```";
 const after=input();after.message.metadata.original_model_response+=coverage;
 expect(projectActionableBets(after).actionableBets).toHaveLength(1);
 const before=input();before.message.metadata.original_model_response=coverage+"\n"+before.message.metadata.original_model_response;
 expect(projectActionableBets(before).actionableBets).toHaveLength(1);
});
it("accepts coincident timestamp resolution while keeping both judgment and actual delivery pregame",()=>{
 const source=input();
 expect(projectActionableBets({...source,message:{...source.message,created_at:"2026-10-27T15:00:00Z"}}).actionableBets).toHaveLength(1);
});

it("keeps an explicit unknown-start GO visible as a separate nonactionable conditional candidate",()=>{
 const source=input({version:1,sport:"mlb",events:[],recommendations:[]});
 const coverage={version:1,scope:{version:1,sport:"mlb",date_et:"2026-10-27",timezone:"America/New_York",mode:"daily",competitions:["MLB"],basis:"default"},inventory:[{event_key:key(),label:"Away at Home",starts_at:null,competition:"MLB",source_url:"https://unregistered.example/mlb"}],assessments:[{event_key:key(),disposition:"evaluated",reason:"Original conditional GO"}],schedule_sources:[],inventory_complete:false,limitations:[]};
 const candidates={version:1,sport:"mlb",candidates:[{item_key:"unknown_start_pick",event_key:key(),market:"moneyline",selection:"Away",decision:"GO",suggested_units:0.5,price_gate:"-110 or better",source_url:"https://unregistered.example/mlb",schedule:{precision:"not_before",date_et:"2026-10-27",at:"2026-10-27T22:00:00Z",label:"Not before 18:00 ET"},status_at_assessment:"scheduled"}]};
 source.message.metadata.original_model_response=`Substantive analysis\n\n\`\`\`analysis-coverage\n${JSON.stringify(coverage)}\n\`\`\`\n\n\`\`\`analysis-candidates\n${JSON.stringify(candidates)}\n\`\`\`\n\n\`\`\`analysis-record\n${JSON.stringify({version:1,sport:"mlb",events:[],recommendations:[]})}\n\`\`\``;
 expect(projectActionableBets(source)).toMatchObject({actionState:"ready",actionableBets:[],conditionalBets:[{match:"Away at Home",selection:"Away",startsAt:null,displayOnly:true,suggestedUnits:0.5,schedule:{precision:"not_before",at:"2026-10-27T22:00:00Z"}}]});
});


function quarantine(eventKey: string, market: string, selection: string, line: string | null = null) {
 return { evaluation_validation: { version:1,status:"unavailable",reasons:["source_url_unknown:0"],counts:{valuation_complete:0,information_wait:0,research_incomplete:0,not_evaluated:0} }, evaluation_report:null, evaluation_quarantined_markets:[{originalIndex:0,eventKey,line,label:"Original market quotation",market,selection,originalDecision:"GO",reasons:["source_url_unknown:0"]}] };
}
it("gates the same source-quarantined conditional identity in overview and verified registration without rewriting its GO", () => {
 const fixture=entryFixture(); const original=fixture.raw(); const source=fixture.input(); source.now=new Date("2026-10-28T00:00:00Z");
 expect(projectActionableBets(source).conditionalBets).toHaveLength(1); expect(verifiedEntryCandidates(source)).toHaveLength(1);
 const metadata={...source.message.metadata,...quarantine(fixture.row.event_key,"Moneyline","Alpha")};
 const blocked={...source,message:{...source.message,metadata}};
 expect(projectActionableBets(blocked)).toMatchObject({actionState:"unavailable",actionReason:"evaluation_market_quarantined",conditionalBets:[],needsReview:{count:1,reasons:["evaluation_market_quarantined"]}});
 expect(verifiedEntryCandidates(blocked)).toEqual([]); expect(metadata.original_model_response).toBe(original); expect(fixture.row).toMatchObject({decision:"GO",price_gate:"2.04 or better",suggested_units:0.25});
 expect(projectActionableBets({...source,message:{...source.message,metadata:{...metadata,...quarantine(fixture.row.event_key,"Moneyline","Beta")}}}).conditionalBets).toHaveLength(1);
 expect(projectActionableBets({...source,message:{...source.message,metadata:{...metadata,...quarantine("tennis:2026-10-27:other@match:src","Moneyline","Alpha")}}}).conditionalBets).toHaveLength(1);
});
it("applies the same quarantine boundary to canonical GO while keeping a different market and original input intact", () => {
 const value=record(); value.recommendations.push({...value.recommendations[0],item_key:"total",market:"total",selection:"Under7.5"});
 const source=input(value,quarantine(key(),"moneyline","Away")); const before=JSON.stringify(source);
 expect(projectActionableBets(source)).toMatchObject({actionState:"ready",actionableBets:[{market:"total",selection:"Under7.5"}],needsReview:{count:1,reasons:["evaluation_market_quarantined"]}});
 expect(JSON.stringify(source)).toBe(before);
 expect(projectActionableBets(input(value))).toMatchObject({actionState:"ready",actionableBets:[{market:"moneyline"},{market:"total"}]});
});

it("retains an unrelated prior projection error while adding quarantine review", () => {
 const f=exactFixture(); f.record.events=[{event_key:f.candidate.event_key,label:"Alpha at Beta",starts_at:f.candidate.schedule.at,source_url:f.candidate.source_url,analysis_status:"GO"}];
 f.record.recommendations=[{item_key:"native",event_key:f.candidate.event_key,market:f.candidate.market,selection:f.candidate.selection,decision:"BET",suggested_units:f.candidate.suggested_units,price_gate:f.candidate.price_gate}];
 const overlay=f.overlay(); overlay.evidence[0].sha256="0".repeat(64); const source=f.input();
 const prior=projectActionableBets({...source,reviewedExactOverlays:[overlay] as never});
 expect(prior.actionState).toBe("unavailable"); expect(prior.actionReason).toBe("reviewed_exact_evidence_unavailable"); expect(prior.actionableBets).toHaveLength(1);
 const blocked=projectActionableBets({...source,reviewedExactOverlays:[overlay] as never,message:{...source.message,metadata:{...source.message.metadata,...quarantine(f.candidate.event_key,f.candidate.market,f.candidate.selection)}}});
 expect(blocked.actionState).toBe("unavailable"); expect(blocked.actionReason).toBe(prior.actionReason); expect(blocked.actionableBets).toEqual([]);
 expect(blocked.needsReview.count).toBe(prior.needsReview.count+1); expect(blocked.needsReview.reasons).toEqual([...prior.needsReview.reasons,"evaluation_market_quarantined"]);
});

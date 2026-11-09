import {beforeEach,describe,it,expect,vi} from "vitest";
const state=vi.hoisted(()=>({rows:{} as Record<string,Record<string,unknown>[]>}));
vi.mock("@/lib/supabase/server",()=>({requireOwner:async()=>({user:{id:"owner"},supabase:{from(table:string){const filters:Record<string,unknown>={};let payload:Record<string,unknown>|null=null;const result=()=>{const rows=state.rows[table]||[];if(payload){if(rows.some(r=>r.request_key===payload?.request_key))return {data:null,error:null};if(table==="recommendation_evaluations"&&rows.some(r=>r.recommendation_id===payload?.recommendation_id&&(r.supersedes_evaluation_id??null)===(payload?.supersedes_evaluation_id??null)))return {data:null,error:{code:"23505"}};const r={id:`new-${rows.length+1}`,...payload};rows.push(r);state.rows[table]=rows;return {data:r,error:null};}return {data:rows.find(r=>Object.entries(filters).every(([k,v])=>r[k]===v))||null,error:null};};const q={select:()=>q,eq:(k:string,v:unknown)=>{filters[k]=v;return q;},upsert:(p:Record<string,unknown>)=>{payload=p;return q;},maybeSingle:async()=>result(),single:async()=>result()};return q;}}}),apiError:(e:unknown)=>e instanceof Response?e:Response.json({error:String(e)},{status:500})}));
vi.mock("@/lib/import/validation",()=>({isSportSlug:(s:string)=>s==="mlb"}));
import { POST as note } from "../../app/api/records/mistake-notes/route";
import { POST as review } from "../../app/api/records/entry-review/route";
const request=(body:unknown)=>new Request("http://localhost",{method:"POST",body:JSON.stringify(body)});
beforeEach(()=>{state.rows={sports:[{id:"sport",slug:"mlb",owner_id:"owner"}],events:[{id:"event",sport_id:"sport",owner_id:"owner"}],messages:[{id:"message",sport_id:"sport",owner_id:"owner",role:"assistant",content:"recommendation"}],recommendations:[{id:"rec",event_id:"event",sport_id:"sport",owner_id:"owner",market:"moneyline",selection:"Home",suggested_units:2,price_gate:"-110"}]};});
describe("reviewed note and entry actions",()=>{
 it("stores traceable note and safely replays",async()=>{const body={sportSlug:"mlb",title:"lesson",lesson:"Recheck assumptions",sourceMessageId:"message",sourceRecommendationId:"rec",idempotencyKey:"note-key-123"};expect((await note(request(body))).status).toBe(201);expect((await note(request(body))).status).toBe(200);expect(state.rows.mistake_notes).toHaveLength(1);expect(state.rows.mistake_notes[0]).toMatchObject({event_id:"event",source_message_id:"message",source_recommendation_id:"rec",outcome:null});expect((await note(request({...body,lesson:"changed"}))).status).toBe(409);});
 it("requires key and a sourced outcome",async()=>{const body={sportSlug:"mlb",title:"lesson",lesson:"x"};expect((await note(request(body))).status).toBe(400);expect((await note(request({...body,idempotencyKey:"note-key-123",outcome:"won"}))).status).toBe(400);});
 it("prepares reviewed entry but copies no quote or recommended units and never writes a bet",async()=>{const response=await review(request({sportSlug:"mlb",sourceMessageId:"message",sourceRecommendationId:"rec"}));expect(response.status).toBe(200);expect(await response.json()).toMatchObject({requiresConfirmation:true,prefill:{eventId:"event",market:"moneyline",selection:"Home",stakeUnits:null,executedPrice:null}});expect(state.rows.bets).toBeUndefined();});
 it("leaves an acknowledgment unresolved rather than guessing the last recommendation",async()=>{const response=await review(request({sportSlug:"mlb",sourceMessageId:"message"}));expect(await response.json()).toMatchObject({prefill:{eventId:null,market:"",selection:""},missing:["eventId","market","selection"]});});
});

import { POST as evaluate } from "../../app/api/records/recommendation-evaluations/route";
it("requires reviewed evaluation, freezes original source, and replays an unscored missing quote",async()=>{
 state.rows.recommendations[0]={...state.rows.recommendations[0],source_message_id:"message",recommendation_item_key:"pick",decision:"BET",suggested_units:1,price_gate:"-110"};
 state.rows.messages[0]={...state.rows.messages[0],created_at:"2026-10-01T12:00:00Z",metadata:{checked_at:"2026-10-01T11:59:00Z",analysis_record:{recommendations:[{item_key:"pick",event_key:"event-key",market:"moneyline",selection:"Home",decision:"BET",suggested_units:1,price_gate:"-110"}],events:[{event_key:"event-key",starts_at:"2026-10-01T18:00:00Z"}]}}};
 const body={sportSlug:"mlb",recommendationId:"rec",idempotencyKey:"eval-key-123",reviewed:true,outcome:"won",outcomeSourceUrl:"https://league.example/result",outcomeCheckedAt:"2026-10-01T22:00:00Z"};
 expect((await evaluate(request({...body,reviewed:false}))).status).toBe(400);
 const response=await evaluate(request(body));expect(response.status).toBe(201);
 expect(await response.json()).toMatchObject({recommendationEvaluation:{evaluation:{status:"unscored",profit_per_unit:null}}});
 expect((await evaluate(request(body))).status).toBe(200);
 expect((await evaluate(request({...body,outcome:"lost"}))).status).toBe(409);
 expect(state.rows.recommendation_evaluations).toHaveLength(1);
 expect(state.rows.bets).toBeUndefined();
});
it("appends corrections with the same frozen source and rejects stale/cross-recommendation predecessors",async()=>{
 state.rows.recommendations[0]={...state.rows.recommendations[0],source_message_id:"message",recommendation_item_key:"pick",decision:"BET",suggested_units:1,price_gate:"-110"};
 state.rows.messages[0]={...state.rows.messages[0],created_at:"2026-10-01T12:00:00Z",metadata:{checked_at:"2026-10-01T11:59:00Z",analysis_record:{recommendations:[{item_key:"pick",event_key:"event-key",market:"moneyline",selection:"Home",decision:"BET",suggested_units:1,price_gate:"-110"}],events:[{event_key:"event-key",starts_at:"2026-10-01T18:00:00Z"}]}}};
 const body={sportSlug:"mlb",recommendationId:"rec",idempotencyKey:"first-eval-key",reviewed:true,outcome:"won",outcomeSourceUrl:"https://league.example/result",outcomeCheckedAt:"2026-10-01T22:00:00Z"};
 expect((await evaluate(request(body))).status).toBe(201);
 const first=state.rows.recommendation_evaluations[0];
 const correction={...body,idempotencyKey:"corrected-eval-key",supersedesEvaluationId:first.id,outcome:"lost"};
 expect((await evaluate(request(correction))).status).toBe(201);
 expect((await evaluate(request(correction))).status).toBe(200);
 expect(state.rows.recommendation_evaluations[1].frozen_recommendation).toEqual(first.frozen_recommendation);
 expect((await evaluate(request({...correction,idempotencyKey:"stale-correction-key"}))).status).toBe(409);
 state.rows.recommendations.push({...state.rows.recommendations[0],id:"rec2"});
 expect((await evaluate(request({...correction,recommendationId:"rec2",idempotencyKey:"cross-rec-key"}))).status).toBe(409);
 expect(state.rows.recommendation_evaluations).toHaveLength(2);
 expect(first.evaluation_input).toMatchObject({outcome:"won"});
});

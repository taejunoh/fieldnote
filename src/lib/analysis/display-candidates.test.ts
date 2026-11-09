import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sportSlugs } from "../sports";
import { projectActionableBets } from "./actionable-bets";
import { stripAnalysisCandidateBlocks } from "./display-candidates";
const source="https://example.org/original-schedule";
const key=(sport="tennis",date="2026-10-27")=>`${sport}:${date}:alpha@beta:src`;
const candidate=(sport="tennis")=>({item_key:"pick",event_key:key(sport),market:"Moneyline",selection:"Alpha",decision:"GO",suggested_units:0.25,price_gate:"2.04 or better",source_url:source,schedule:{precision:"not_before",date_et:"2026-10-27",at:"2026-10-27T22:30:00-04:00",label:"Not before 22:30 ET"},status_at_assessment:"scheduled"});
function fixture(sport="tennis") {
 const row=candidate(sport);
 const coverage={version:1,scope:{version:1,sport,date_et:"2026-10-27",timezone:"America/New_York",mode:"daily",competitions:["League"],basis:"default"},inventory:[{event_key:key(sport),label:"Alpha versus Beta",starts_at:null,competition:"League",source_url:source}],assessments:[{event_key:key(sport),disposition:"evaluated",reason:"Explicit original GO"}],schedule_sources:[],inventory_complete:false,limitations:[]};
 const record={version:1,sport,events:[] as Record<string,unknown>[],recommendations:[] as Record<string,unknown>[]};
 const envelope={version:1,sport,candidates:[row]};
 const raw=()=>`Original substantive reasoning\n\n\`\`\`analysis-coverage\n${JSON.stringify(coverage)}\n\`\`\`\n\n\`\`\`analysis-candidates\n${JSON.stringify(envelope)}\n\`\`\`\n\n\`\`\`analysis-record\n${JSON.stringify(record)}\n\`\`\``;
 const input=()=>({sport,ownerId:"owner",jobId:"job",kind:"analyze_today",now:new Date("2026-10-28T00:00:00Z"),message:{id:"message",created_at:"2026-10-27T23:50:01Z",metadata:{original_model_response:raw(),checked_at:"2026-10-27T23:50:00Z",common_policy:{id:"policy"},sources:[{url:source}]}}});
 return {row,coverage,record,envelope,raw,input};
}
describe("display-only original conditional recommendations",()=>{
 it.each(sportSlugs)("supports %s without converting nonexact bounds into actionable starts",sport=>{const f=fixture(sport);const before=f.raw();const p=projectActionableBets(f.input());expect(p).toMatchObject({actionableBets:[],conditionalBets:[{startsAt:null,displayOnly:true,priceGate:"2.04 or better",suggestedUnits:0.25}]});expect(f.raw()).toBe(before);});
 it("keeps same-day NB uncertainty after its bound, expires past ET date",()=>{const f=fixture();expect(projectActionableBets({...f.input(),now:new Date("2026-10-28T03:30:00Z")} ).conditionalBets).toHaveLength(1);expect(projectActionableBets({...f.input(),now:new Date("2026-10-28T04:00:00Z")} ).conditionalBets).toEqual([]);});
 it("allows future EARLY identity dates independently of analysis scope day",()=>{const f=fixture("nfl");f.row.event_key=key("nfl","2026-11-01");f.row.schedule={precision:"estimated",date_et:"2026-11-01",at:"2026-11-01T13:00:00-05:00",label:"Sunday estimated"};f.row.decision="EARLY GO";f.coverage.inventory[0].event_key=f.row.event_key;f.coverage.assessments[0].event_key=f.row.event_key;expect(projectActionableBets(f.input()).conditionalBets).toHaveLength(1);});
 it("requires adopted policy for GO aliases",()=>{const f=fixture();const i=f.input();i.message.metadata.common_policy=null as unknown as {id:string};expect(projectActionableBets(i).conditionalBets).toEqual([]);});
 it.each(["live","final","cancelled"])("excludes known %s",status=>{const f=fixture();f.row.status_at_assessment=status;expect(projectActionableBets(f.input()).conditionalBets).toEqual([]);});
 it("excludes coverage-excluded events",()=>{const f=fixture();f.coverage.assessments[0].disposition="excluded";expect(projectActionableBets(f.input()).conditionalBets).toEqual([]);});
 it("rejects duplicate item identity and provides review instead of clean zero",()=>{const f=fixture();f.envelope.candidates.push({...f.row});expect(projectActionableBets(f.input())).toMatchObject({conditionalBets:[],needsReview:{count:1,reasons:["conditional_candidates_invalid"]}});});
 it("supports a valid candidate-only analysis while leaving record availability honest",()=>{const f=fixture();const i=f.input();i.message.metadata.original_model_response=f.raw().replace(/```analysis-record[\s\S]*$/,"");expect(projectActionableBets(i)).toMatchObject({actionState:"unavailable",conditionalBets:[{selection:"Alpha"}]});});
 it("rejects invalid purpose and future delivery even with empty canonical record",()=>{const f=fixture();expect(projectActionableBets({...f.input(),kind:"review_results"}).conditionalBets).toEqual([]);const i=f.input();Object.assign(i.message.metadata,{response_purpose_status:"invalid"});expect(projectActionableBets(i).conditionalBets).toEqual([]);expect(projectActionableBets({...f.input(),message:{...f.input().message,created_at:"2026-10-28T02:00:00Z"}}).conditionalBets).toEqual([]);});
 it("reports canonical conflicting nonBET rather than promoting a candidate",()=>{const f=fixture();f.record.events=[{event_key:key(),label:"Alpha versus Beta",starts_at:null,source_url:source,analysis_status:"PASS"}];f.record.recommendations=[{item_key:"pass",event_key:key(),market:"Moneyline",selection:"Alpha",decision:"PASS",suggested_units:null,price_gate:"PASS"}];expect(projectActionableBets(f.input())).toMatchObject({conditionalBets:[],needsReview:{count:1,reasons:["conditional_canonical_conflict"]}});});
 it("strips only closed recognized blocks and leaves malformed tails for strict validation",()=>{expect(stripAnalysisCandidateBlocks("body\n```analysis-candidates\n{}\n```\ntail")).toBe("body\ntail");expect(stripAnalysisCandidateBlocks("body\n```analysis-candidates\n{}" )).toContain("analysis-candidates");});
});

it("restores only an exact privately reviewed owner/latest message/raw snapshot and never refreshes timestamps",()=>{
 const f=fixture();const i=f.input();
 const evidenceText="원래 근거 GO Alpha 0.25U, 2.04 or better; Not before 22:30 ET; Upcoming.";
 i.message.metadata.original_model_response=evidenceText+"\n"+f.raw().replace(/^```analysis-candidates[^\S\r\n]*\r?\n[\s\S]*?^```[^\S\r\n]*(?:\r?\n|$)/gm,"");
 const raw=i.message.metadata.original_model_response,hash=(v:string)=>createHash("sha256").update(v).digest("hex");
 const bytes=Buffer.from(raw), start=bytes.indexOf(Buffer.from(evidenceText));
 const overlay={owner_id:"owner",sport:"tennis",job_id:"job",message_id:"message",raw_sha256:hash(raw),checked_at:"2026-10-27T23:50:00Z",created_at:"2026-10-27T23:50:01Z",delivered_at:"2026-10-27T23:50:01Z",envelope:f.envelope,coverage:[{event_key:key(),label:"Alpha versus Beta",source_url:source,date_et:"2026-10-27"}],evidence:["recommendation","price","units","schedule","status"].map(role=>({role,start,end:start+Buffer.byteLength(evidenceText),text:evidenceText,sha256:hash(evidenceText)}))};
 // The private file is schema-validated before it reaches this public projector boundary.
 const run=(value:unknown)=>projectActionableBets({...i,candidateOverlays:[value] as never});
 expect(run(overlay).conditionalBets).toMatchObject([{checkedAt:"2026-10-27T23:50:00Z",startsAt:null,priceGate:"2.04 or better"}]);
 for(const field of ["owner_id","job_id","message_id","raw_sha256","checked_at","created_at","delivered_at","sport"]){expect(run({...overlay,[field]:"wrong"}).conditionalBets).toEqual([]);}
 expect(run({...overlay,evidence:overlay.evidence.map(e=>({...e,start:e.start+1}))}).conditionalBets).toEqual([]);
 expect(run({...overlay,coverage:[{...overlay.coverage[0],source_url:"https://foreign.example"}]}).conditionalBets).toEqual([]);
 expect(run({...overlay,envelope:{...f.envelope,candidates:[f.row,{...f.row,item_key:"extra"}]}}).conditionalBets).toEqual([]);
 expect(run({...overlay,evidence:overlay.evidence.filter(e=>e.role!=="status")}).conditionalBets).toEqual([]);
});

it("does not display a nonexact candidate after another market proves the canonical event already started",()=>{
 const f=fixture();f.record.events=[{event_key:key(),label:"Alpha versus Beta",starts_at:"2026-10-27T19:00:00-04:00",source_url:source,analysis_status:"PASS"}];f.record.recommendations=[{item_key:"other_market",event_key:key(),market:"Total",selection:"Under 20.5",decision:"PASS",suggested_units:null,price_gate:"PASS"}];
 expect(projectActionableBets(f.input())).toMatchObject({conditionalBets:[],needsReview:{count:1,reasons:["conditional_known_start_passed"]}});
});
it("normalizes the original URL-bound event identity before detecting a canonical PASS conflict",()=>{
 const f=fixture();const normalized=key().replace(/:src$/,":src-"+createHash("sha256").update(source).digest("hex").slice(0,32));
 f.record.events=[{event_key:normalized,label:"Alpha versus Beta",starts_at:null,source_url:source,analysis_status:"PASS"}];f.record.recommendations=[{item_key:"existing_pass",event_key:normalized,market:"Moneyline",selection:"Alpha",decision:"PASS",suggested_units:null,price_gate:"PASS"}];
 expect(projectActionableBets(f.input())).toMatchObject({conditionalBets:[],needsReview:{count:1,reasons:["conditional_canonical_conflict"]}});
});

it("enforces the candidate envelope budget in UTF-8 bytes rather than Unicode character count",()=>{
 const f=fixture();f.envelope.candidates=Array.from({length:10},(_,i)=>({...f.row,item_key:`pick_${i}`,selection:`Alpha market ${i}`,price_gate:"가".repeat(1500),schedule:{...f.row.schedule,label:"나".repeat(1500)}}));
 expect(projectActionableBets(f.input())).toMatchObject({conditionalBets:[],needsReview:{count:1,reasons:["conditional_candidates_invalid"]}});
});

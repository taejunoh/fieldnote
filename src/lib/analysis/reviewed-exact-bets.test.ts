import { exactFixture } from "./reviewed-exact-bets.fixture";
import { expect, it } from "vitest";
import { projectActionableBets } from "./actionable-bets";

it("projects a separately reviewed exact body GO without an entry source",()=>{
 const f=exactFixture(),p=projectActionableBets(f.input());
 expect(p.actionableBets).toHaveLength(1);
 expect(p.actionableBets[0]).toMatchObject({provenance:"reviewed_original_body",originalDecision:"GO",displayOnly:true,match:"Alpha at Beta",suggestedUnits:0.5,priceGate:"-133 or better",startsAt:f.candidate.schedule.at});
 expect(p.actionableBets[0]).not.toHaveProperty("entrySource");
 expect(p.conditionalBets).toEqual([]);
});
it("fails closed on missing attestation, source, proof pins, bad evidence and exact start mismatch",()=>{
 const f=exactFixture();
 expect(projectActionableBets({...f.input(),sourceAttested:false}).actionableBets).toEqual([]);
 expect(projectActionableBets({...f.input(),message:{...f.input().message,metadata:{...f.input().message.metadata,sources:[]}}}).actionableBets).toEqual([]);
 for(const field of ["owner_id","sport","job_id","message_id","raw_sha256","checked_at","created_at","delivered_at"])expect(projectActionableBets({...f.input(),reviewedExactOverlays:[{...f.overlay(),[field]:"wrong"}] as never}).actionableBets).toEqual([]);
 const overlay=f.overlay();overlay.evidence[0].sha256="0".repeat(64);expect(projectActionableBets({...f.input(),reviewedExactOverlays:[overlay] as never}).actionableBets).toEqual([]);
 f.candidate.schedule.at="2099-10-28T21:30:00-04:00";expect(projectActionableBets(f.input()).actionableBets).toEqual([]);
});
it("requires exact scheduled schema and pregame clocks",()=>{
 const f=exactFixture();
 expect(projectActionableBets({...f.input(),now:new Date(f.candidate.schedule.at)}).actionableBets).toEqual([]);
});
it("deduplicates equivalent native and reviewed rows and rejects canonical financial conflicts",()=>{
 const f=exactFixture();f.record.events=[{event_key:f.candidate.event_key,label:"Alpha at Beta",starts_at:f.candidate.schedule.at,source_url:f.candidate.source_url,analysis_status:"GO"}];f.record.recommendations=[{item_key:"native",event_key:f.candidate.event_key,market:"Moneyline",selection:"Alpha",decision:"GO",suggested_units:0.5,price_gate:"-133 or better"}];
 expect(projectActionableBets(f.input()).actionableBets).toHaveLength(1);
 for(const patch of [{decision:"PASS",suggested_units:null},{suggested_units:1},{price_gate:"-150"}]) {const original=f.record.recommendations[0];f.record.recommendations[0]={...(original as object),...patch};expect(projectActionableBets(f.input()).actionableBets).toEqual([]);f.record.recommendations[0]=original;}
});
it("rejects unsearched, uncited, unofficial and forged normalized source identities",()=>{
 const f=exactFixture();
 for(const source_url of ["https://evil.example/game","https://stats.mlssoccer.com/game","https://mlssoccer.com.evil.example/game","https://user@mlssoccer.com/game","https://mlssoccer.com:8443/game"]){
  expect(projectActionableBets(exactFixture(source_url).input()).actionableBets).toEqual([]);
 }
 expect(projectActionableBets(exactFixture(undefined,false).input()).actionableBets).toEqual([]);
 f.candidate.event_key=f.candidate.event_key.replace(/:src$/,`:src-${"0".repeat(32)}`);f.coverage.inventory[0].event_key=f.candidate.event_key;expect(projectActionableBets(f.input()).actionableBets).toEqual([]);
});
it("retains purpose, original assessment time and evidence review fences",()=>{
 const f=exactFixture();
 for(const flags of [{hypothetical:true},{analysis_purpose:"hypothetical"},{response_purpose_status:"invalid"},{response_purpose:{intent:"conversation"}}])expect(projectActionableBets({...f.input(),message:{...f.input().message,metadata:{...f.input().message.metadata,...flags}}}).actionableBets).toEqual([]);
 expect(projectActionableBets({...f.input(),kind:"review_results"}).actionableBets).toEqual([]);
 const overlay=f.overlay();overlay.evidence[0].start=1;
 const p=projectActionableBets({...f.input(),reviewedExactOverlays:[overlay] as never});expect(p.actionableBets).toEqual([]);expect(p.actionState).toBe("unavailable");expect(p.needsReview.reasons).toContain("reviewed_exact_evidence_unavailable");
 f.coverage.assessments[0].disposition="excluded";expect(projectActionableBets(f.input()).actionableBets).toEqual([]);
});
it("fails closed on conflicting native start and preserves exact as-of when displayed",()=>{
 const f=exactFixture(),original=f.input().message.metadata.checked_at;
 expect(projectActionableBets(f.input()).actionableBets[0]?.checkedAt).toBe(original);
 f.record.events=[{event_key:f.candidate.event_key,label:"Alpha at Beta",starts_at:"2099-10-28T21:30:00-04:00",source_url:f.candidate.source_url,analysis_status:"WAIT"}];
 expect(projectActionableBets(f.input()).actionableBets).toEqual([]);
 expect(projectActionableBets(f.input()).needsReview.reasons).toContain("reviewed_exact_canonical_conflict");
});

it("rejects repeated overlay identities even when their contents agree",()=>{
 const f=exactFixture(),input=f.input();
 const p=projectActionableBets({...input,reviewedExactOverlays:[f.overlay(),f.overlay()] as never});
 expect(p.actionableBets).toEqual([]);expect(p.needsReview.count).toBeGreaterThan(0);
});
it("preserves an equivalent native BET when the event summary is PASS",()=>{
 const f=exactFixture();
 f.record.events=[{event_key:f.candidate.event_key,label:"Alpha at Beta",starts_at:f.candidate.schedule.at,source_url:f.candidate.source_url,analysis_status:"PASS"}];
 f.record.recommendations=[{item_key:"native",event_key:f.candidate.event_key,market:f.candidate.market,selection:f.candidate.selection,decision:"BET",suggested_units:f.candidate.suggested_units,price_gate:f.candidate.price_gate}];
 const p=projectActionableBets(f.input());
 expect(p.actionableBets).toHaveLength(1);
 expect(p.actionableBets[0]).not.toHaveProperty("provenance");
 expect(p.needsReview.count).toBe(0);
});

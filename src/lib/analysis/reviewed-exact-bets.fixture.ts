import { createHash } from "node:crypto";
export const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
export function exactFixture(sourceUrl="https://mlssoccer.com/match/alpha-beta",cited=true) {
 const key="soccer:2099-10-28:alpha@beta:src",url=sourceUrl,at="2099-10-28T20:30:00-04:00";
 const body=`Alpha GO 0.5U -133 or better. Scheduled 20:30 ET. ${cited?url:""}`;
 const candidate={item_key:"alpha",event_key:key,market:"Moneyline",selection:"Alpha",decision:"GO",suggested_units:0.5,price_gate:"-133 or better",source_url:url,schedule:{precision:"exact",date_et:"2099-10-28",at,label:"20:30 ET"},status_at_assessment:"scheduled"};
 const coverage={version:1,scope:{sport:"soccer",date_et:"2099-10-28"},inventory:[{event_key:key,label:"Alpha at Beta",starts_at:at,source_url:url}],assessments:[{event_key:key,disposition:"evaluated"}]};
 const record={version:1,sport:"soccer",events:[] as unknown[],recommendations:[] as unknown[]};
 const raw=()=>`${body}\n\`\`\`analysis-coverage\n${JSON.stringify(coverage)}\n\`\`\`\n\`\`\`analysis-record\n${JSON.stringify(record)}\n\`\`\``;
 const checked="2099-10-28T12:00:00Z",created="2099-10-28T12:00:01Z";
 const overlay=()=>({owner_id:"owner",sport:"soccer",job_id:"job",message_id:"message",raw_sha256:sha(raw()),checked_at:checked,created_at:created,delivered_at:created,envelope:{version:1,sport:"soccer",candidates:[candidate]},coverage:[{event_key:key,label:"Alpha at Beta",source_url:url,date_et:"2099-10-28"}],evidence:["recommendation","price","units","schedule","status"].map(role=>({role,start:0,end:Buffer.byteLength(body),text:body,sha256:sha(body)}))});
 const input=()=>({sport:"soccer",ownerId:"owner",jobId:"job",kind:"analyze_today",now:new Date("2099-10-28T13:00:00Z"),sourceAttested:true,reviewedExactOverlays:[overlay()] as never,message:{id:"message",created_at:created,metadata:{original_model_response:raw(),checked_at:checked,common_policy:{id:"policy"},sources:[{url}]}}});
 return {candidate,coverage,record,raw,overlay,input};
}

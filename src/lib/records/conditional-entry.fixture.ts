export function entryFixture() {
 const key="tennis:2026-10-27:alpha@beta:src",url="https://example.org/schedule";
 const row={item_key:"pick",event_key:key,market:"Moneyline",selection:"Alpha",decision:"GO",suggested_units:0.25,price_gate:"2.04 or better",source_url:url,schedule:{precision:"not_before",date_et:"2026-10-27",at:"2026-10-27T22:30:00-04:00",label:"NB 22:30 ET"},status_at_assessment:"scheduled"};
 const coverage={version:1,scope:{sport:"tennis",date_et:"2026-10-27"},inventory:[{event_key:key,label:"Alpha versus Beta",starts_at:null,source_url:url}],assessments:[{event_key:key,disposition:"evaluated"}]};
 const record={version:1,sport:"tennis",events:[] as unknown[],recommendations:[] as unknown[]};
 const raw=()=>`Original substantive GO Alpha 0.25U at 2.04; NB 22:30 ET Upcoming.\n\`\`\`analysis-coverage\n${JSON.stringify(coverage)}\n\`\`\`\n\`\`\`analysis-candidates\n${JSON.stringify({version:1,sport:"tennis",candidates:[row]})}\n\`\`\`\n\`\`\`analysis-record\n${JSON.stringify(record)}\n\`\`\``;
 const input=()=>({sport:"tennis",ownerId:"owner",jobId:"11111111-1111-4111-8111-111111111111",kind:"analyze_today",now:new Date("2026-11-01T00:00:00Z"),message:{id:"22222222-2222-4222-8222-222222222222",owner_id:"owner",sport_id:"sport",role:"assistant",analysis_job_id:"11111111-1111-4111-8111-111111111111",created_at:"2026-10-27T23:50:01Z",metadata:{type:"analysis",verified:true,searched:true,terminalStatus:"completed",input_snapshot:{attempt_id:"33333333-3333-4333-8333-333333333333",context_sha256:"context-hash",instructions_sha256:"instructions-hash",common_policy:{id:"policy"}},original_model_response:raw(),checked_at:"2026-10-27T23:50:00Z",common_policy:{id:"policy"}}}});
 return {row,coverage,record,raw,input};
}

export function trustedEntryAttempt(input: ReturnType<ReturnType<typeof entryFixture>["input"]>) {
 const metadata=structuredClone(input.message.metadata);
 return {id:metadata.input_snapshot.attempt_id,owner_id:input.ownerId,job_id:input.jobId,status:"completed",provider_metadata:metadata,input_snapshot:{...metadata.input_snapshot,context:JSON.stringify({sport:input.sport,current_job_kind:input.kind})}};
}

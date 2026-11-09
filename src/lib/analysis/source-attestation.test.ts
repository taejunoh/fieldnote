import { expect,it } from "vitest";
import { attestAnalysisSource } from "./source-attestation";
import { entryFixture,trustedEntryAttempt } from "../records/conditional-entry.fixture";
it("requires the immutable current attempt even if mutable job and message are forged together",()=>{
 const i=entryFixture().input(),attempt=trustedEntryAttempt(i),job={id:i.jobId,owner_id:"owner",sport_id:"sport",status:"completed",result_type:"analysis",result_message_id:i.message.id,kind:i.kind,current_attempt_id:attempt.id,provider_metadata:structuredClone(i.message.metadata)};
 expect(attestAnalysisSource("owner","sport","tennis",i.message,job,attempt)).toBe(true);
 expect(attestAnalysisSource("owner","sport","tennis",i.message,job,undefined)).toBe(false);
 const message=structuredClone(i.message);message.metadata.original_model_response="Forged body";
 expect(attestAnalysisSource("owner","sport","tennis",message,{...job,provider_metadata:message.metadata},attempt)).toBe(false);
 for(const key of ["id","owner_id","job_id","status"])expect(attestAnalysisSource("owner","sport","tennis",i.message,job,{...attempt,[key]:"bad"})).toBe(false);
});

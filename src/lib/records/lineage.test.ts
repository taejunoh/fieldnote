import { describe,it,expect } from "vitest";
import { validateRecordLineage } from "./lineage";
import type { SupabaseClient } from "@supabase/supabase-js";
function db(rows:Record<string,Record<string,unknown>[]>) {return {from(table:string){let result=rows[table]||[];const q={select:()=>q,eq:(k:string,v:unknown)=>{result=result.filter(r=>r[k]===v);return q;},maybeSingle:async()=>({data:result[0]||null,error:null})};return q;}} as unknown as SupabaseClient;}
describe("record lineage",()=>{
 it("rejects foreign source records",async()=>{await expect(validateRecordLineage(db({messages:[{id:"m",owner_id:"other",sport_id:"s"}]}),"o","s",{sourceMessageId:"m"})).rejects.toBeInstanceOf(Response);});
 it("resolves linked event and rejects unrelated bet",async()=>{
 const client=db({events:[{id:"e",owner_id:"o",sport_id:"s"}],recommendations:[{id:"r",owner_id:"o",sport_id:"s",event_id:"e"}],bets:[{id:"b",owner_id:"o",sport_id:"s",event_id:"other"}]});
 expect(await validateRecordLineage(client,"o","s",{sourceRecommendationId:"r"})).toMatchObject({event_id:"e",source_recommendation_id:"r"});
 await expect(validateRecordLineage(client,"o","s",{eventId:"e",sourceBetId:"b"})).rejects.toBeInstanceOf(Response);
 });
});

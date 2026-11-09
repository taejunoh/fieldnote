import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Server-only lazy factory. Call only after authenticated owner/source resolution. */
export function createConditionalEntryServiceClient(): SupabaseClient {
  if (typeof window !== "undefined") throw new Error("Privileged client is server-only");
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key) throw new Response("Conditional entry service unavailable",{status:503});
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
}

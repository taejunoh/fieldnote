import { requireOwner } from "@/lib/supabase/server";
import { commonPolicyInputSchema, type CommonPolicyVersion } from "@/lib/common-policy";
import type { SupabaseClient } from "@supabase/supabase-js";

async function readPolicy(supabase: SupabaseClient, ownerId: string) {
  const { data, error } = await supabase.from("common_policy_versions").select("*")
    .eq("owner_id", ownerId).order("created_at", { ascending: false });
  if (error) throw error;
  const history = (data ?? []) as CommonPolicyVersion[];
  return { current: history.find((version) => version.status === "adopted") ?? null, history };
}
function safeError(error: unknown) {
  if (error instanceof Response) return error;
  return Response.json({ error: "Common policy request failed" }, { status: 500 });
}
export async function GET() {
  try {
    const { supabase, user } = await requireOwner();
    return Response.json(await readPolicy(supabase, user.id));
  } catch (error) { return safeError(error); }
}
export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireOwner();
    let raw: unknown;
    try { raw = await request.json(); } catch { return Response.json({ error: "Invalid common policy" }, { status: 400 }); }
    const input = commonPolicyInputSchema.safeParse(raw);
    if (!input.success) return Response.json({ error: "Invalid common policy" }, { status: 400 });
    const { error } = await supabase.rpc("adopt_common_policy", {
      p_title: input.data.title,
      p_version_date: input.data.versionDate,
      p_content: input.data.content,
      p_expected_version_id: input.data.expectedVersionId,
    });
    if (error) {
      if (error.code === "P0001") return Response.json({ error: "Common policy changed. Reload before saving." }, { status: 409 });
      if (error.code === "22023") return Response.json({ error: "Invalid common policy" }, { status: 400 });
      throw error;
    }
    return Response.json(await readPolicy(supabase, user.id));
  } catch (error) { return safeError(error); }
}

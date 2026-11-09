import { apiError, requireOwner } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { supabase, user } = await requireOwner();
    const found = await supabase
      .from("analysis_jobs")
      .select("*")
      .eq("id", id)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (found.error) throw found.error;
    if (!found.data)
      return Response.json({ error: "Job not found" }, { status: 404 });
    const job = found.data;
    let message = null;
    if (job.result_message_id) {
      const result = await supabase
        .from("messages")
        .select("*")
        .eq("id", job.result_message_id)
        .eq("owner_id", user.id)
        .maybeSingle();
      if (result.error) throw result.error;
      message = result.data;
    }
    return Response.json({ job, message });
  } catch (error) {
    return apiError(error);
  }
}

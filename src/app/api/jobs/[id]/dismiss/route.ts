import { apiError, requireOwner } from "@/lib/supabase/server";

export const runtime = "nodejs";

const DISMISSIBLE_STATUSES = [
  "failed",
  "interrupted",
  "waiting_quota",
  "relogin_required",
];

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { supabase, user } = await requireOwner();
    const result = await supabase
      .from("analysis_jobs")
      .select("id,status,attempt,dismissed_attempt")
      .eq("id", id)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (result.error) throw result.error;
    const job = result.data;
    if (!job) return Response.json({ error: "Job not found" }, { status: 404 });
    if (!DISMISSIBLE_STATUSES.includes(job.status))
      return Response.json({ error: "Only failed jobs can be dismissed" }, { status: 409 });

    const updated = await supabase
      .from("analysis_jobs")
      .update({ dismissed_attempt: job.attempt })
      .eq("id", id)
      .eq("owner_id", user.id)
      .eq("attempt", job.attempt)
      .in("status", DISMISSIBLE_STATUSES)
      .select("id,status,attempt,dismissed_attempt")
      .maybeSingle();
    if (updated.error) throw updated.error;
    if (!updated.data)
      return Response.json({ error: "Job changed before it could be dismissed" }, { status: 409 });
    return Response.json({ job: updated.data });
  } catch (error) {
    return apiError(error);
  }
}

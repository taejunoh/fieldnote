import { apiError, requireOwner } from "@/lib/supabase/server";
import { parseRuleInstruction } from "@/lib/rule-instructions";
import { isEntryConfirmationAcknowledgment } from "@/lib/entry-confirmation";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { supabase, user } = await requireOwner();
    const result = await supabase
      .from("analysis_jobs")
      .select("*")
      .eq("id", id)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (result.error) throw result.error;
    const job = result.data;
    if (!job) return Response.json({ error: "Job not found" }, { status: 404 });
    if (job.status === "completed") return Response.json({ job });
    if (job.provider !== "openllms")
      return Response.json({ error: "This job uses the retired provider" }, { status: 409 });
    if (
      job.kind === "message" &&
      ["failed", "interrupted", "waiting_quota", "relogin_required"].includes(job.status) &&
      job.user_message_id && job.sport_id
    ) {
      const messageResult = await supabase
        .from("messages")
        .select("id,content")
        .eq("id", job.user_message_id)
        .eq("owner_id", user.id)
        .eq("sport_id", job.sport_id)
        .eq("role", "user")
        .maybeSingle();
      if (messageResult.error) throw messageResult.error;
      const instruction = messageResult.data && parseRuleInstruction(messageResult.data.content);
      if (instruction) {
        const resolved = await supabase.rpc("apply_rule_instruction", {
          p_sport_id: job.sport_id,
          p_request_key: job.request_key,
          p_command_key: instruction.commandKey,
          p_raw_text: messageResult.data!.content,
          p_title: instruction.title,
          p_content: instruction.content,
          p_acknowledgment: instruction.acknowledgment,
          p_existing_job_id: id,
        });
        if (resolved.error) {
          if (resolved.error.code === "23505")
            return Response.json({ error: resolved.error.message }, { status: 409 });
          if (resolved.error.message.includes("not retryable"))
            return Response.json({ job }, { status: 202 });
          throw resolved.error;
        }
        return Response.json(resolved.data, { status: 200 });
      }
      if (
        job.status === "failed" &&
        messageResult.data &&
        isEntryConfirmationAcknowledgment(messageResult.data.content)
      ) {
        const resolved = await supabase.rpc("apply_entry_confirmation_ack", {
          p_sport_id: job.sport_id,
          p_request_key: job.request_key,
          p_raw_text: messageResult.data.content,
          p_existing_job_id: id,
        });
        if (resolved.error) {
          if (resolved.error.code === "23505")
            return Response.json({ error: resolved.error.message }, { status: 409 });
          if (resolved.error.message.includes("not retryable"))
            return Response.json({ job }, { status: 202 });
          throw resolved.error;
        }
        return Response.json(resolved.data, { status: 200 });
      }
    }
    const retried = await supabase.rpc("retry_gateway_job", { p_job_id: id });
    if (retried.error) {
      if (retried.error.message.includes("not retryable"))
        return Response.json({ job }, { status: 202 });
      throw retried.error;
    }
    return Response.json({ job: retried.data }, { status: 202 });
  } catch (error) {
    return apiError(error);
  }
}

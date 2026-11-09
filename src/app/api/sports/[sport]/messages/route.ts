import { z } from "zod";
import { apiError, requireOwner } from "@/lib/supabase/server";
import { findLocalConversationRequest, getOrCreateSport, isSportSlug } from "@/lib/analysis/data";
import { analysisSettings, type AnalysisKind } from "@/lib/analysis/openai";
import { parseRuleInstruction } from "@/lib/rule-instructions";

export const runtime = "nodejs";

const requestSchema = z.object({
  text: z.string().trim().max(12000).optional(),
  idempotencyKey: z.string().min(8).max(128),
  action: z
    .enum(["analyze_today", "recheck_lineup", "review_results", "check_status"])
    .optional(),
});
const actionText: Record<string, string> = {
  analyze_today:
    "오늘 경기 분석을 최신 자료로 해줘. 해당 종목의 기준과 진행 상태를 적용하고 출처와 미확인 사항을 표시해줘.",
  recheck_lineup:
    "관련 경기의 라인업과 출전 정보를 최신 자료로 재확인하고, 기존 판단을 당시 기록으로 유지한 채 현재 관점에서 재평가해줘.",
  review_results:
    "종료된 경기의 결과를 출처로 확인하고, 당시 판단과 실제 결과를 구분해 오답노트를 제안해줘. 기록을 임의로 확정하거나 손익을 추정하지 마.",
  check_status:
    "관련 경기의 라인업 게시 여부, 출전 및 배당 변동, 현재 진행 상태만 최신 자료로 확인하고 출처와 확인 시각을 표시해줘. 기존 BET/PASS 판단이나 유닛을 다시 결정하지 마. 결론에 영향을 줄 수 있는 중요한 변동이 발견되면 최종 재평가가 필요하다고 명시해줘.",
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sport: string }> },
) {
  try {
    const { sport: slug } = await params;
    if (!isSportSlug(slug))
      return Response.json({ error: "Unknown sport" }, { status: 404 });
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success)
      return Response.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 },
      );
    const input = parsed.data;
    const text = input.text || (input.action && actionText[input.action]);
    if (!text)
      return Response.json(
        { error: "Message text is required" },
        { status: 400 },
      );
    const { supabase, user } = await requireOwner();
    const sport = await getOrCreateSport(supabase, user.id, slug);
    if (!input.action) {
      const instruction = parseRuleInstruction(text);
      if (instruction) {
        const result = await supabase.rpc("apply_rule_instruction", {
          p_sport_id: sport.id,
          p_request_key: input.idempotencyKey,
          p_command_key: instruction.commandKey,
          p_raw_text: text,
          p_title: instruction.title,
          p_content: instruction.content,
          p_acknowledgment: instruction.acknowledgment,
          p_existing_job_id: null,
        });
        if (result.error) {
          if (result.error.code === "23505")
            return Response.json({ error: result.error.message }, { status: 409 });
          throw result.error;
        }
        const body = result.data as Record<string, unknown>;
        return Response.json(body, { status: body.replayed ? 200 : 201 });
      }
      const localReplay = await findLocalConversationRequest(supabase, user.id, sport.id, input.idempotencyKey);
      if (localReplay) {
        const result = await supabase.rpc("apply_entry_confirmation_ack", {
          p_sport_id: sport.id,
          p_request_key: input.idempotencyKey,
          p_raw_text: text,
          p_existing_job_id: null,
        });
        if (result.error) {
          if (result.error.code === "23505")
            return Response.json({ error: result.error.message }, { status: 409 });
          throw result.error;
        }
        const body = result.data as Record<string, unknown>;
        return Response.json(body, { status: body.replayed ? 200 : 201 });
      }
    }
    if (!process.env.OPENLLMS_BASE_URL || !process.env.OPENLLMS_API_KEY)
      return Response.json(
        { error: "openllms 게이트웨이 연결이 아직 설정되지 않았습니다." },
        { status: 503 },
      );
    const kind = (input.action || "message") as AnalysisKind;
    const settings = analysisSettings(kind);
    const inserted = await supabase
      .from("analysis_jobs")
      .upsert(
        {
          owner_id: user.id,
          sport_id: sport.id,
          request_key: input.idempotencyKey,
          kind,
          provider: "openllms",
          model: settings.model,
          effort: settings.effort,
        },
        { onConflict: "owner_id,sport_id,request_key", ignoreDuplicates: true },
      )
      .select("*")
      .maybeSingle();
    if (inserted.error) {
      if (inserted.error.code === "23505")
        return Response.json({ error: inserted.error.message }, { status: 409 });
      throw inserted.error;
    }
    let job = inserted.data;
    const existed = !job;
    if (!job) {
      const found = await supabase
        .from("analysis_jobs")
        .select("*")
        .eq("owner_id", user.id)
        .eq("sport_id", sport.id)
        .eq("request_key", input.idempotencyKey)
        .single();
      if (found.error) throw found.error;
      job = found.data;
    }
    let message;
    if (job.user_message_id) {
      const found = await supabase
        .from("messages")
        .select("*")
        .eq("id", job.user_message_id)
        .eq("owner_id", user.id)
        .single();
      if (found.error) throw found.error;
      message = found.data;
      if (message.content !== text)
        return Response.json(
          { error: "Idempotency key was already used for a different message" },
          { status: 409 },
        );
    } else {
      const result = await supabase
        .from("messages")
        .insert({
          owner_id: user.id,
          sport_id: sport.id,
          role: "user",
          content: text,
          analysis_job_id: job.id,
        })
        .select("*")
        .maybeSingle();
      if (result.error && result.error.code !== "23505") throw result.error;
      if (result.data) message = result.data;
      else {
        const found = await supabase
          .from("messages")
          .select("*")
          .eq("analysis_job_id", job.id)
          .eq("role", "user")
          .single();
        if (found.error) throw found.error;
        message = found.data;
      }
      if (message.content !== text)
        return Response.json(
          { error: "Idempotency key was already used for a different message" },
          { status: 409 },
        );
      const linked = await supabase
        .from("analysis_jobs")
        .update({
          user_message_id: message.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id)
        .eq("owner_id", user.id)
        .is("user_message_id", null);
      if (linked.error) throw linked.error;
    }
    return Response.json({ message, job }, { status: existed ? 200 : 202 });
  } catch (error) {
    return apiError(error);
  }
}

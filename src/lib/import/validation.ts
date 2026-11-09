import { createHash } from "node:crypto";
import type { ImportDraft } from "./parser";
import { isSportSlug, sportSlugs } from "../sports";

export { isSportSlug };
export const SPORT_SLUGS = sportSlugs;
export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
export function validImportInput(
  body: unknown,
): body is { sportSlug: string; filename: string; content: string } {
  if (!body || typeof body !== "object") return false;
  const input = body as Record<string, unknown>;
  return (
    isSportSlug(input.sportSlug) &&
    typeof input.filename === "string" &&
    input.filename.length > 0 &&
    input.filename.length <= 255 &&
    typeof input.content === "string" &&
    input.content.length > 0 &&
    input.content.length <= 1_000_000
  );
}
export function validDraft(value: unknown): value is ImportDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Record<string, unknown>;
  for (const name of [
    "rules",
    "events",
    "recommendations",
    "bets",
    "mistakeNotes",
  ]) {
    if (!Array.isArray(draft[name]) || (draft[name] as unknown[]).length > 500)
      return false;
  }
  if (typeof draft.summary !== "string" || draft.summary.length > 100_000)
    return false;
  const strings = (item: unknown, keys: string[]) =>
    item &&
    typeof item === "object" &&
    keys.every(
      (key) => typeof (item as Record<string, unknown>)[key] === "string",
    );
  if (
    !(draft.rules as unknown[]).every((item) =>
      strings(item, ["title", "content", "status", "sourceRef"]),
    )
  )
    return false;
  if (
    !(draft.events as unknown[]).every((item) =>
      strings(item, [
        "eventKey",
        "label",
        "analysisStatus",
        "gameStatus",
        "sourceRef",
      ]),
    )
  )
    return false;
  if (
    !(draft.recommendations as unknown[]).every((item) =>
      strings(item, [
        "eventKey",
        "market",
        "selection",
        "decision",
        "sourceRef",
      ]),
    )
  )
    return false;
  if (
    !(draft.bets as unknown[]).every((item) =>
      strings(item, ["eventKey", "market", "selection", "result", "sourceRef"]),
    )
  )
    return false;
  if (
    !(draft.mistakeNotes as unknown[]).every((item) =>
      strings(item, ["title", "lesson", "sourceRef"]),
    )
  )
    return false;
  const eventKeys = new Set(
    (draft.events as { eventKey: string }[]).map((event) => event.eventKey),
  );
  if (
    [
      ...(draft.bets as { eventKey: string }[]),
      ...(draft.recommendations as { eventKey: string }[]),
    ].some((item) => !eventKeys.has(item.eventKey))
  )
    return false;
  return true;
}

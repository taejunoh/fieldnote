import type { AnalysisRecord } from "./record";
import type { GatewaySource } from "./gateway";

export type RecommendationKeyCorrection = {
  reason: "unique_official_game_id";
  raw_sha256: string;
  item_key: string;
  from: string;
  to: string;
};
const identity = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Recover only malformed, non-actionable NHL recommendation references. */
export function recoverRecommendationKeys(
  record: AnalysisRecord, body: string, sources: GatewaySource[], rawSha: string, scopeDate?: string,
): RecommendationKeyCorrection[] {
  const corrections: RecommendationKeyCorrection[] = [];
  if (record.sport !== "nhl" || record.events.some(event => event.analysis_status === "BET") ||
      record.recommendations.some(item => item.decision === "BET" || (item.suggested_units ?? 0) > 0)) return corrections;

  for (const item of record.recommendations) {
    if (record.events.some(event => event.event_key === item.event_key)) continue;
    const match = /^nhl:(\d{4}-\d{2})-(\d{10})$/.exec(item.event_key);
    if (!match) continue;
    const targets = record.events.filter(event =>
      new RegExp(`^nhl:${match[1]}-\\d{2}:[a-z0-9-]+@[a-z0-9-]+:id-${match[2]}$`).test(event.event_key));
    if (targets.length !== 1) continue;
    const event = targets[0], date = event.event_key.split(":")[1];
    if (scopeDate && date !== scopeDate) continue;
    const url = new URL(event.source_url);
    const urlDate = url.pathname.match(/\/(\d{4}\/\d{2}\/\d{2})\//)?.[1].replaceAll("/", "-");
    if (urlDate && urlDate !== date) continue;
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
        !["nhl.com", "www.nhl.com", "frontend.d3.nhle.com"].includes(url.hostname) ||
        /^https:\/\/(?:nhl\.com|www\.nhl\.com|frontend\.d3\.nhle\.com)\/(?:[a-z]{2}\/)?gamecenter\/(?:[a-z][a-z0-9-]*\/[0-9]{4}\/[0-9]{2}\/[0-9]{2}\/)?([0-9]{10})\/?$/.exec(url.href)?.[1] !== match[2] ||
        !sources.some(source => source.url === url.href) || !body.includes(url.href) ||
        !(` ${identity(body)} `).includes(` ${identity(event.label)} `)) continue;
    corrections.push({ reason: "unique_official_game_id", raw_sha256: rawSha, item_key: item.item_key, from: item.event_key, to: event.event_key });
    item.event_key = event.event_key;
  }
  return corrections;
}

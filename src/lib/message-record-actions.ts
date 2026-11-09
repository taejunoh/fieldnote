export type MessageRecordRecommendation = {
  id?: string | null;
  source_message_id?: string | null;
  decision?: unknown;
  selection?: string | null;
};

export function actionableRecommendationsForMessage<T extends MessageRecordRecommendation>(
  recommendations: readonly T[],
  messageId: string,
): T[] {
  return recommendations.filter((item) =>
    item.source_message_id === messageId &&
    typeof item.id === "string" && item.id.length > 0 &&
    item.decision === "BET" &&
    typeof item.selection === "string" && item.selection.trim().length > 0 &&
    !/미확정|확인\s*필요|unknown/i.test(item.selection),
  );
}

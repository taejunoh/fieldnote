export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function stablePayloadSubmission(
  storage: StorageLike,
  scope: string,
  payload: unknown,
  createKey: () => string = () => crypto.randomUUID(),
) {
  const signature = JSON.stringify(payload);
  const storageKey = `${scope}:${signature}`;
  const key = storage.getItem(storageKey) || createKey();
  storage.setItem(storageKey, key);
  return { signature, storageKey, key };
}

export type MistakeNotePayload = {
  sportSlug: string;
  eventId?: string;
  title: string;
  lesson: string;
  decisionAtTime?: string;
  outcome?: string;
  outcomeSourceUrl?: string;
  sourceMessageId?: string;
};

export function mistakeNoteRequestBody(
  payload: MistakeNotePayload,
  idempotencyKey: string,
) {
  return {
    sportSlug: payload.sportSlug,
    ...(payload.eventId ? { eventId: payload.eventId } : {}),
    title: payload.title,
    lesson: payload.lesson,
    ...(payload.decisionAtTime ? { decisionAtTime: payload.decisionAtTime } : {}),
    ...(payload.outcome ? { outcome: payload.outcome } : {}),
    ...(payload.outcomeSourceUrl ? { outcomeSourceUrl: payload.outcomeSourceUrl } : {}),
    ...(payload.sourceMessageId ? { sourceMessageId: payload.sourceMessageId } : {}),
    idempotencyKey,
  };
}

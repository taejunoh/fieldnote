import { describe, expect, it } from "vitest";
import { mistakeNoteRequestBody, stablePayloadSubmission } from "./idempotency";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

describe("mistake note idempotency", () => {
  it("keeps the legacy note payload stable across retry and double submission", () => {
    const storage = memoryStorage();
    const legacyPayload = {
      sportSlug: "nba",
      eventId: "event-1",
      title: "Late rotation read",
      lesson: "Check the official injury report first.",
      decisionAtTime: "Waited for confirmation",
      outcome: "Starter was inactive",
      outcomeSourceUrl: "https://www.nba.com/news",
    };
    let calls = 0;
    const first = stablePayloadSubmission(storage, "fieldnote:mistake-note", legacyPayload, () => `key-${++calls}`);
    const retry = stablePayloadSubmission(storage, "fieldnote:mistake-note", legacyPayload, () => `key-${++calls}`);

    expect(first.key).toBe(retry.key);
    expect(calls).toBe(1);
    expect(mistakeNoteRequestBody(legacyPayload, first.key)).toEqual({ ...legacyPayload, idempotencyKey: first.key });
  });

  it("uses a new key when the submitted payload is edited", () => {
    const storage = memoryStorage();
    let calls = 0;
    const first = stablePayloadSubmission(storage, "fieldnote:mistake-note", { title: "First" }, () => `key-${++calls}`);
    const edited = stablePayloadSubmission(storage, "fieldnote:mistake-note", { title: "Edited" }, () => `key-${++calls}`);

    expect(edited.key).not.toBe(first.key);
    expect(calls).toBe(2);
  });

  it("keeps source-linked notes on the same idempotent request contract", () => {
    expect(mistakeNoteRequestBody({ sportSlug: "nba", title: "Review", lesson: "Check source", sourceMessageId: "message-1" }, "stable-key"))
      .toEqual({ sportSlug: "nba", title: "Review", lesson: "Check source", sourceMessageId: "message-1", idempotencyKey: "stable-key" });
  });
});

import { describe, expect, it } from "vitest";
import { actionableRecommendationsForMessage } from "./message-record-actions";

describe("actionable chat record shortcuts", () => {
  it("shows only source-linked BET recommendations with an exact selection", () => {
    const rows = [
      { id: "bet", source_message_id: "message-1", decision: "BET", selection: "Boston Celtics -3.5" },
      { id: "wait", source_message_id: "message-1", decision: "WAIT", selection: "Boston Celtics -3.5" },
      { id: "ei", source_message_id: "message-1", decision: "EI", selection: "Under 218.5" },
      { id: "unclear", source_message_id: "message-1", decision: "BET", selection: "방향·기준점 미확정" },
      { id: "other-message", source_message_id: "message-2", decision: "BET", selection: "Under 218.5" },
      { id: "no-selection", source_message_id: "message-1", decision: "BET", selection: " " },
    ];

    expect(actionableRecommendationsForMessage(rows, "message-1").map((row) => row.id)).toEqual(["bet"]);
  });
});

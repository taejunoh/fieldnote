import { describe, expect, it } from "vitest";
import { openGameEvents } from "./open-game-events";

describe("openGameEvents", () => {
  const now = new Date("2026-09-25T16:00:00Z");

  it("hides imported historical events regardless of analysis status and all finals", () => {
    const events = [
      {
        id: "old-imported-bet",
        source_document_id: "doc-1",
        analysis_status: "BET",
        event_key: "2026-09-24-player-a-player-b-event-1",
      },
      {
        id: "old-imported-watch",
        source_document_id: "doc-1",
        analysis_status: "WATCH",
        event_key: "2026-08-25:team-a-team-b",
      },
      {
        id: "old-imported-pass",
        source_document_id: "doc-1",
        analysis_status: "PASS",
        event_key: "2026-09-20:team-c-team-d",
      },
      { id: "final", game_status: "final" },
    ];

    expect(openGameEvents(events, now)).toEqual([]);
  });

  it("keeps undated, current-day, and future imported active events visible", () => {
    const events = [
      { id: "undated", source_document_id: "doc-1", analysis_status: "WAIT" },
      {
        id: "today",
        source_document_id: "doc-1",
        analysis_status: "PASS",
        event_key: "2026-09-25:team-a-team-b",
      },
      {
        id: "future",
        source_document_id: "doc-1",
        analysis_status: "WAIT",
        event_key: "2026-09-27:series-a",
      },
    ];

    expect(openGameEvents(events, now).map((event) => event.id)).toEqual([
      "undated",
      "today",
      "future",
    ]);
  });

  it("keeps Laver Cup WAIT and same-day unresolved matches visible", () => {
    const events = [
      {
        id: "laver-wait",
        source_document_id: "doc-1",
        analysis_status: "WAIT",
        event_key: "tennis:2026-09-25:laver-cup:event-1",
        game_status: "scheduled",
      },
      {
        id: "today-bet",
        source_document_id: "doc-1",
        analysis_status: "BET",
        event_key: "tennis:2026-09-25:player-a@player-b:event-2",
        game_status: "in_progress",
      },
      {
        id: "suspended",
        event_key: "tennis:2026-09-25:player-c@player-d:event-3",
        game_status: "suspended",
      },
    ];

    expect(openGameEvents(events, now).map((event) => event.id)).toEqual([
      "laver-wait",
      "today-bet",
      "suspended",
    ]);
  });

  it("hides imported future schedule claims only when a verified event has the same matchup", () => {
    const events = [
      {
        id: "imported-min-nyl",
        source_document_id: "doc-1",
        analysis_status: "WAIT",
        event_key: "2026-09-27-min-nyl",
      },
      {
        id: "verified-reversed-order",
        event_key: "2026-09-27-nyl-min",
      },
      {
        id: "imported-atl-was",
        source_document_id: "doc-1",
        analysis_status: "WAIT",
        event_key: "2026-09-27-atl-was",
        label: "ATL–WAS playoff series — historical schedule claim",
      },
      {
        id: "verified-different-game",
        event_key: "2026-09-27-ind-lva",
        label: "ATL–WAS playoff series — historical schedule claim",
      },
      {
        id: "same-matchup-next-day",
        source_document_id: "doc-1",
        analysis_status: "WAIT",
        event_key: "2026-09-28-min-nyl",
      },
    ];

    expect(openGameEvents(events, now).map((event) => event.id)).toEqual([
      "verified-reversed-order",
      "imported-atl-was",
      "verified-different-game",
      "same-matchup-next-day",
    ]);
  });

  it("deduplicates all four WNBA playoff rows using the event-key shape returned by the app", () => {
    const importedPairs = ["atl-was", "gsv-dal", "lva-ind", "min-nyl"];
    const currentPairs = ["was-atl", "dal-gsv", "ind-lva", "nyl-min"];
    const events = [
      ...importedPairs.map((pair) => ({
        id: `imported-${pair}`,
        source_document_id: "wnba-handoff",
        analysis_status: "WAIT",
        event_key: `2026-09-27-${pair}`,
      })),
      ...currentPairs.map((pair) => ({
        id: `verified-${pair}`,
        event_key: `2026-09-27-${pair}`,
      })),
    ];

    expect(openGameEvents(events, now).map((event) => event.id)).toEqual([
      "verified-was-atl",
      "verified-dal-gsv",
      "verified-ind-lva",
      "verified-nyl-min",
    ]);
  });

  it("keeps an imported future matchup visible until a keyed verified event exists", () => {
    const imported = {
      id: "imported-series",
      source_document_id: "doc-1",
      analysis_status: "WAIT",
      event_key: "2026-09-27-min-nyl",
      label: "MIN–NYL playoff series — historical schedule claim",
    };

    expect(openGameEvents([imported], now)).toEqual([imported]);
  });

  it("uses the America/New_York calendar date", () => {
    const event = {
      source_document_id: "doc-1",
      analysis_status: "BET",
      event_key: "tennis:2026-09-24:player-a@player-b:event-1",
    };
    // This instant is still Sep 24 in New York, despite being Sep 25 UTC.
    const justBeforeNewYorkMidnight = new Date("2026-09-25T03:30:00Z");

    expect(openGameEvents([event], justBeforeNewYorkMidnight)).toEqual([event]);
  });
});

import { describe, expect, it } from "vitest";

import { buildJobOverview, markOverviewJobsSeen } from "./job-overview";
import { buildJobNotificationGroups, notificationCounts, notificationSyncState, unreadCompletedBySport } from "./job-notifications";
import { sportSlugs } from "./sports";

const sports = sportSlugs.map((slug) => ({ slug, name: slug.toUpperCase() }));
const job = (id: string, status: string) => ({
  id,
  status,
  created_at: "2026-10-27T12:00:00Z",
  updated_at: "2026-10-27T12:01:00Z",
  result_type: "analysis" as const,
});

describe("job notification groups", () => {
  it("shows unread completions, running jobs, and failures for the same sport together", () => {
    const overview = buildJobOverview({ mlb: [job("done", "completed"), job("run", "running"), job("bad", "failed")] }, new Set());
    const groups = buildJobNotificationGroups(sports, overview);
    expect(groups).toContainEqual({
      sport: "mlb", name: "MLB", unreadCompletedIds: ["done"],
      unreadCompletedCount: 1, activeCount: 1, failureCount: 1,
    });
    expect(notificationCounts(groups)).toEqual({ unreadCompleted: 1, active: 1, failures: 1 });
  });

  it("marks only currently known unread completed IDs in bulk", () => {
    const overview = buildJobOverview({ mlb: [job("done", "completed"), job("run", "running"), job("bad", "failed")] }, new Set());
    const groups = buildJobNotificationGroups(sports, overview);
    expect(unreadCompletedBySport(groups)).toEqual([{ sport: "mlb", ids: ["done"] }]);
  });

  it("bulk marks across sports without clearing running or failed work, and leaves later completions unread", () => {
    const jobs = {
      mlb: [job("mlb-done", "completed"), job("mlb-run", "running"), job("mlb-fail", "failed")],
      nba: [job("nba-done", "completed"), job("nba-run", "running"), job("nba-fail", "interrupted")],
    };
    const before = buildJobOverview(jobs, new Set());
    const knownUnread = unreadCompletedBySport(buildJobNotificationGroups(sports, before));
    let stored = { seenIds: [] as string[], statuses: {} as Record<string, string> };
    for (const item of knownUnread) stored = markOverviewJobsSeen(stored, item.ids);

    const afterBulk = buildJobOverview(jobs, new Set(stored.seenIds));
    for (const slug of ["mlb", "nba"] as const) {
      expect(afterBulk[slug].unreadCompletedIds).toEqual([]);
      expect(afterBulk[slug].activeCount).toBe(1);
      expect(afterBulk[slug].failureCount).toBe(1);
    }

    const later = {
      ...jobs,
      mlb: [...jobs.mlb, job("mlb-later-done", "completed")],
    };
    expect(buildJobOverview(later, new Set(stored.seenIds)).mlb.unreadCompletedIds)
      .toEqual(["mlb-later-done"]);
  });

  it("returns no notification group for an empty overview", () => {
    expect(buildJobNotificationGroups(sports, buildJobOverview({}, new Set()))).toEqual([]);
    expect(notificationCounts([])).toEqual({ unreadCompleted: 0, active: 0, failures: 0 });
  });

  it("keeps a stale snapshot visible as stale instead of showing all clear", () => {
    expect(notificationSyncState({
      ownerLookupFailed: false, error: "poll failed", isStale: true,
      hasSnapshot: true, ownerId: "owner", authReady: true,
    })).toBe("stale");
    expect(notificationSyncState({
      ownerLookupFailed: false, error: null, isStale: false,
      hasSnapshot: false, ownerId: "owner", authReady: true,
    })).toBe("loading");
  });
});

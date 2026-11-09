import { describe, expect, it } from "vitest";
import {
  buildJobOverview,
  markOverviewJobsSeen,
  mergeStoredStates,
  reconcileOverviewJobs,
  type OverviewJob,
} from "./job-overview";

const pending: OverviewJob = {
  id: "job-1",
  status: "running",
  created_at: "2026-09-27T11:00:00Z",
  updated_at: "2026-09-27T11:00:00Z",
};
const completed = { ...pending, status: "completed", updated_at: "2026-09-27T11:01:00Z" };

describe("job overview read markers", () => {
  it("hides only the dismissed attempt and shows a later retry failure", () => {
    const failedAttempt = {
      ...pending,
      status: "interrupted",
      attempt: 2,
      dismissed_attempt: 2,
    };
    const retriedFailure = {
      ...failedAttempt,
      attempt: 3,
      dismissed_attempt: 2,
    };

    expect(buildJobOverview({ mlb: [failedAttempt] }, new Set()).mlb.failureCount).toBe(0);
    expect(buildJobOverview({ mlb: [retriedFailure] }, new Set()).mlb.failureCount).toBe(1);
  });

  it("keeps a completion read across an identical next poll and suppresses its notice", () => {
    const initial = reconcileOverviewJobs(null, { mlb: [pending] }).stored;
    const read = markOverviewJobsSeen(initial, [pending.id]);
    const next = reconcileOverviewJobs(read, { mlb: [completed] });

    expect(next.notices).toEqual([]);
    expect(buildJobOverview({ mlb: [completed] }, new Set(next.stored.seenIds)).mlb.unreadCompletedIds).toEqual([]);
    expect(markOverviewJobsSeen(next.stored, [pending.id])).toBe(next.stored);
  });

  it("does not surface conversation completions as unread analysis or completion notices", () => {
    const prior = {
      seenIds: [],
      statuses: { "chat-1": "running", "analysis-1": "running" },
    };
    const jobs = {
      mlb: [
        { ...completed, id: "chat-1", result_type: "conversation" as const },
        { ...completed, id: "analysis-1", result_type: "analysis" as const },
      ],
    };

    const next = reconcileOverviewJobs(prior, jobs);
    const overview = buildJobOverview(jobs, new Set(next.stored.seenIds));

    expect(next.notices).toEqual([{ sport: "mlb", jobId: "analysis-1", status: "completed" }]);
    expect(overview.mlb.unreadCompletedIds).toEqual(["analysis-1"]);
  });

  it("keeps the in-memory read marker when stored data is stale or unavailable", () => {
    const stalePersisted = { seenIds: [], statuses: { "job-1": "running" } };
    const inMemory = markOverviewJobsSeen(stalePersisted, [pending.id]);
    const merged = mergeStoredStates(stalePersisted, inMemory)!;
    const next = reconcileOverviewJobs(merged, { mlb: [completed] });

    expect(next.stored.seenIds).toContain(pending.id);
    expect(next.notices).toEqual([]);
    expect(buildJobOverview({ mlb: [completed] }, new Set(next.stored.seenIds)).mlb.unreadCompletedCount).toBe(0);
  });
});

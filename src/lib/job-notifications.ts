import type { SportSlug } from "./sports";
import type { SportJobOverview } from "./job-overview";

export type NotificationSport = { slug: SportSlug; name: string };
export type JobNotificationGroup = {
  sport: SportSlug;
  name: string;
  unreadCompletedIds: string[];
  unreadCompletedCount: number;
  activeCount: number;
  failureCount: number;
};

export type NotificationSyncState = "owner-error" | "stale" | "error" | "loading" | "ready";

export function notificationSyncState(input: {
  ownerLookupFailed: boolean;
  error: string | null;
  isStale: boolean;
  hasSnapshot: boolean;
  ownerId: string | null;
  authReady: boolean;
}): NotificationSyncState {
  if (input.ownerLookupFailed) return "owner-error";
  if (input.error) return input.isStale ? "stale" : "error";
  if (!input.hasSnapshot || (input.authReady && !input.ownerId)) return "loading";
  return "ready";
}

export function buildJobNotificationGroups(
  sports: NotificationSport[],
  overviewBySport: Record<SportSlug, SportJobOverview>,
): JobNotificationGroup[] {
  return sports.flatMap(({ slug, name }) => {
    const overview = overviewBySport[slug];
    if (
      overview.unreadCompletedCount === 0 &&
      overview.activeCount === 0 &&
      overview.failureCount === 0
    ) return [];
    return [{
      sport: slug,
      name,
      unreadCompletedIds: [...overview.unreadCompletedIds],
      unreadCompletedCount: overview.unreadCompletedCount,
      activeCount: overview.activeCount,
      failureCount: overview.failureCount,
    }];
  });
}

export function notificationCounts(groups: JobNotificationGroup[]) {
  return groups.reduce((counts, group) => ({
    unreadCompleted: counts.unreadCompleted + group.unreadCompletedCount,
    active: counts.active + group.activeCount,
    failures: counts.failures + group.failureCount,
  }), { unreadCompleted: 0, active: 0, failures: 0 });
}

export function unreadCompletedBySport(groups: JobNotificationGroup[]) {
  return groups.flatMap((group) => group.unreadCompletedIds.length
    ? [{ sport: group.sport, ids: [...group.unreadCompletedIds] }]
    : []);
}

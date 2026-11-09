"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { sportSlugs, type SportSlug } from "./sports";

const SPORT_SLUGS = sportSlugs;
export type OverviewJob = {
  id: string;
  status: string;
  created_at: string;
  updated_at: string;
  attempt?: number;
  dismissed_attempt?: number | null;
  result_type?: "analysis" | "conversation" | null;
};
export type JobNotice = {
  sport: SportSlug;
  jobId: string;
  status: string;
};
export type SportJobOverview = {
  activeCount: number;
  unreadCompletedCount: number;
  failureCount: number;
  activeJobs: OverviewJob[];
  unreadCompletedIds: string[];
  failures: OverviewJob[];
};

export type StoredState = {
  seenIds: string[];
  statuses: Record<string, string>;
};
type OverviewResponse = {
  jobs: Partial<Record<SportSlug, OverviewJob[]>>;
  activeCounts?: Partial<Record<SportSlug, number>>;
};

const POLL_INTERVAL_MS = 5_000;
const FAILURE_STATUSES = new Set([
  "failed",
  "interrupted",
  "waiting_quota",
  "relogin_required",
]);

function emptyOverview(): Record<SportSlug, SportJobOverview> {
  return Object.fromEntries(
    SPORT_SLUGS.map((sport) => [
      sport,
      {
        activeCount: 0,
        unreadCompletedCount: 0,
        failureCount: 0,
        activeJobs: [],
        unreadCompletedIds: [],
        failures: [],
      },
    ]),
  ) as unknown as Record<SportSlug, SportJobOverview>;
}

function storageKey(ownerId: string) {
  return `allinsimple:job-overview:${ownerId}`;
}

function readStoredState(ownerId: string): StoredState | null {
  try {
    const raw = localStorage.getItem(storageKey(ownerId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const value = parsed as Partial<StoredState>;
    if (!Array.isArray(value.seenIds) || !value.statuses || typeof value.statuses !== "object")
      return null;
    return { seenIds: value.seenIds.filter((id): id is string => typeof id === "string"), statuses: value.statuses };
  } catch {
    return null;
  }
}

function writeStoredState(ownerId: string, state: StoredState) {
  try {
    localStorage.setItem(storageKey(ownerId), JSON.stringify(state));
  } catch {
    // Overview remains usable for this session when browser storage is unavailable.
  }
}

export function buildJobOverview(
  jobs: Partial<Record<SportSlug, OverviewJob[]>>,
  seenIds: Set<string>,
): Record<SportSlug, SportJobOverview> {
  const overview = emptyOverview();
  for (const sport of SPORT_SLUGS) {
    const sportJobs = jobs[sport] || [];
    const activeJobs = sportJobs.filter((job) => job.status === "queued" || job.status === "running");
    const unreadCompletedIds = sportJobs
      .filter((job) =>
        job.status === "completed" && job.result_type !== "conversation" && !seenIds.has(job.id),
      )
      .map((job) => job.id);
    const failures = sportJobs.filter((job) =>
      FAILURE_STATUSES.has(job.status) &&
      !(job.dismissed_attempt != null && job.dismissed_attempt === job.attempt),
    );
    overview[sport] = {
      activeCount: activeJobs.length,
      unreadCompletedCount: unreadCompletedIds.length,
      failureCount: failures.length,
      activeJobs,
      unreadCompletedIds,
      failures,
    };
  }
  return overview;
}

export function mergeStoredStates(persisted: StoredState | null, inMemory: StoredState | null) {
  if (!persisted) return inMemory;
  if (!inMemory) return persisted;
  return {
    seenIds: [...new Set([...persisted.seenIds, ...inMemory.seenIds])],
    statuses: { ...persisted.statuses, ...inMemory.statuses },
  };
}

export function markOverviewJobsSeen(previous: StoredState, completedJobIds: string[]) {
  const seen = new Set(previous.seenIds);
  const newIds = completedJobIds.filter((id) => !seen.has(id));
  const newlyObservedCompletion = completedJobIds.some((id) => previous.statuses[id] !== "completed");
  if (!newIds.length && !newlyObservedCompletion) return previous;
  for (const id of newIds) seen.add(id);
  const statuses = { ...previous.statuses };
  for (const id of completedJobIds) statuses[id] = "completed";
  return { seenIds: [...seen], statuses };
}

export function reconcileOverviewJobs(
  previous: StoredState | null,
  jobs: Partial<Record<SportSlug, OverviewJob[]>>,
) {
  const allJobs = SPORT_SLUGS.flatMap((sport) => jobs[sport] || []);
  if (!previous) {
    return {
      stored: {
        seenIds: allJobs.filter((job) => job.status === "completed").map((job) => job.id),
        statuses: Object.fromEntries(allJobs.map((job) => [job.id, job.status])),
      } satisfies StoredState,
      notices: [] as JobNotice[],
    };
  }

  const notices: JobNotice[] = [];
  for (const sport of SPORT_SLUGS) {
    for (const job of jobs[sport] || []) {
      const previousStatus = previous.statuses[job.id];
      if (
        ((job.status === "completed" && job.result_type !== "conversation") || FAILURE_STATUSES.has(job.status)) &&
        (previousStatus === "queued" || previousStatus === "running")
      ) {
        notices.push({ sport, jobId: job.id, status: job.status });
      }
    }
  }
  return {
    stored: {
      seenIds: previous.seenIds,
      statuses: { ...previous.statuses, ...Object.fromEntries(allJobs.map((job) => [job.id, job.status])) },
    },
    notices,
  };
}

export function useJobOverview(ownerId: string | null) {
  const [bySport, setBySport] = useState(emptyOverview);
  const [notices, setNotices] = useState<JobNotice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hasSnapshot, setHasSnapshot] = useState(false);
  const storedRef = useRef<{ ownerId: string; value: StoredState | null } | null>(null);

  useEffect(() => {
    setBySport(emptyOverview());
    setNotices([]);
    setError(null);
    setHasSnapshot(false);
    if (!ownerId) return;

    let stopped = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    storedRef.current = { ownerId, value: readStoredState(ownerId) };

    const poll = async () => {
      try {
        const response = await fetch("/api/jobs/overview", { cache: "no-store" });
        if (!response.ok) throw new Error(`Job overview request failed (${response.status})`);
        const data = (await response.json()) as OverviewResponse;
        if (stopped) return;

        // A successful desk load can mark IDs while this request is in flight.
        // Merge against the latest persisted marker before applying the snapshot.
        const latest = readStoredState(ownerId);
        const refState = storedRef.current?.ownerId === ownerId ? storedRef.current.value : null;
        const previous = mergeStoredStates(latest, refState);
        const { stored, notices: noticesNow } = reconcileOverviewJobs(previous, data.jobs || {});

        writeStoredState(ownerId, stored);
        storedRef.current = { ownerId, value: stored };
        const nextOverview = buildJobOverview(data.jobs || {}, new Set(stored.seenIds));
        for (const sport of SPORT_SLUGS) {
          if (typeof data.activeCounts?.[sport] === "number") {
            nextOverview[sport].activeCount = data.activeCounts[sport]!;
          }
        }
        setBySport(nextOverview);
        setNotices(noticesNow);
        setError(null);
        setHasSnapshot(true);
      } catch (cause) {
        if (!stopped) {
          setError(cause instanceof Error ? cause.message : "Unable to load job overview");
          setNotices([]);
        }
      } finally {
        if (!stopped) timeout = setTimeout(poll, POLL_INTERVAL_MS);
      }
    };

    void poll();
    return () => {
      stopped = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [ownerId]);

  const markSeen = useCallback((sport: SportSlug, completedJobIds: string[]) => {
    if (!ownerId || !completedJobIds.length) return;
    const inMemory = storedRef.current?.ownerId === ownerId ? storedRef.current.value : null;
    const previous = mergeStoredStates(readStoredState(ownerId), inMemory) ||
      { seenIds: [], statuses: {} };
    const stored = markOverviewJobsSeen(previous, completedJobIds);
    if (stored === previous) return;
    writeStoredState(ownerId, stored);
    storedRef.current = { ownerId, value: stored };
    setBySport((current) => {
      const next = { ...current };
      const unseen = new Set(next[sport].unreadCompletedIds);
      for (const id of completedJobIds) unseen.delete(id);
      if (unseen.size === next[sport].unreadCompletedIds.length) return current;
      next[sport] = {
        ...next[sport],
        unreadCompletedIds: [...unseen],
        unreadCompletedCount: unseen.size,
      };
      return next;
    });
  }, [ownerId]);

  return { bySport, notices, markSeen, error, isStale: hasSnapshot && error !== null, hasSnapshot };
}

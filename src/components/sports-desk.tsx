"use client";
import type { EvaluationPresentationDisplay } from "@/lib/analysis/evaluation-recovery";

import { useCallback, useEffect, useRef, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { openGameEvents } from "@/lib/open-game-events";
import { createDeskRequestScope } from "@/lib/desk-request-scope";
import { useJobOverview } from "@/lib/job-overview";
import { buildJobNotificationGroups, notificationCounts, notificationSyncState, unreadCompletedBySport } from "@/lib/job-notifications";
import { shouldShowMissingMatchStartTime } from "@/lib/analysis-table-start-time";
import {
  conditionalBetsOrEmpty,
  conditionalScheduleDisplay,
  currentConditionalBets,
  conditionalEntrySourceForOverviewRow,
  isReviewedOriginalBodyBet,
  formatSuggestedUnits,
  mergeOverviewBetRows,
  overviewReasonLabel,
  overviewRecommendationCounts,
  overviewRowIdentity,
  uniqueOverviewReasonLabels,
  upcomingActionableBets,
} from "@/lib/betting-overview";
import { formatOddsDisplay } from "@/lib/odds-display";
import { compactPriceCondition, formatCheckedAtEt } from "@/lib/price-condition-display";
import { AnalysisMessage } from "./analysis-message";
import { messageTypeFromMetadata } from "@/lib/message-sources";
import { mistakeNoteRequestBody, stablePayloadSubmission } from "@/lib/idempotency";
import { actionableRecommendationsForMessage } from "@/lib/message-record-actions";
import { conditionalEntryPayload, conditionalEntryPreparationRequest, conditionalEntrySignature } from "@/lib/conditional-entry-form";
import { conditionalSourceSnapshot, entryDraftIdentity, manualConditionalEventStatus } from "@/lib/conditional-entry-provenance";
import { ExecutionTable } from "./execution-table";
import { AnalysisCoverage } from "./analysis-coverage";
import { MarketEvaluation } from "./market-evaluation";
import { evaluationDisplayFromMetadata } from "@/lib/analysis/evaluation";
import { RecordRecoveryStatus } from "./record-recovery-status";
import { CommonPolicyPanel } from "./common-policy-panel";
import type { ExecutionRow } from "@/lib/execution-table";
import type { BettingOverviewProjection, CoverageDisplay, LatestAnalysisRecovery } from "@/lib/latest-analysis-table";
import type { SportSlug } from "@/lib/sports";
import type { ConditionalEntryCandidate, ConditionalEntrySource, StoredConditionalEntrySource } from "@/lib/records/entry-types";
import {
  Activity,
  ArrowRight,
  Bell,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  CircleAlert,
  Clock3,
  FileText,
  LogOut,
  Menu,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  UploadCloud,
  X,
} from "lucide-react";

type Sport = SportSlug;
type Message = {
  id: string;
  role: string;
  content: string;
  created_at: string;
  analysis_job_id?: string | null;
  metadata?: unknown;
  evaluation?: ReturnType<typeof evaluationDisplayFromMetadata>;
  evaluationPresentation?: EvaluationPresentationDisplay | null;
  savedBodyExists?: boolean;
  recovery?: LatestAnalysisRecovery;
  conditionalEntrySources?: ConditionalEntryCandidate[];
};
type Job = {
  id: string;
  status: string;
  kind?: string;
  attempt?: number;
  dismissed_attempt?: number | null;
  error?: string | null;
};
type LatestAnalysis = {
  jobId: string;
  kind: string;
  completedAt: string;
  analysisTitle: string | null;
  tableTitle: string | null;
  tableMarkdown: string | null;
  tableContext?: "current" | "historical" | "schedule" | "unavailable";
  executionRows?: ExecutionRow[];
  coverage: CoverageDisplay | null;
  evaluation?: ReturnType<typeof evaluationDisplayFromMetadata>;
  evaluationPresentation?: EvaluationPresentationDisplay | null;
  savedBodyExists?: boolean;
  recovery?: LatestAnalysisRecovery;
  hasTable: boolean;
  unavailableReason?: string;
} & Partial<BettingOverviewProjection>;
type LatestAnalysisState = {
  sport: Sport;
  status: "loading" | "ready" | "error";
  analysis: LatestAnalysis | null;
};
type AllSportsAnalysis = { sport: Sport; analysis: LatestAnalysis | null };
type Rule = {
  id?: string;
  title?: string;
  content?: string;
  status?: string;
  source_document_id?: string | null;
  source_ref?: string | null;
};
type Event = {
  id?: string;
  label?: string;
  eventKey?: string;
  event_key?: string;
  analysisStatus?: string;
  analysis_status?: string;
  gameStatus?: string;
  game_status?: string;
  source_document_id?: string | null;
  source_ref?: string | null;
  result_checked_at?: string | null;
  result_source_url?: string | null;
};
type Bet = {
  id?: string;
  market?: string;
  selection?: string;
  executed_price?: string | null;
  stake_units?: number | null;
  source_document_id?: string | null;
  source_ref?: string | null;
  source_candidate?: StoredConditionalEntrySource | null;
  result_checked_at?: string | null;
  result_source_url?: string | null;
  result?: string | null;
};
type Recommendation = Record<string, unknown> & {
  id?: string;
  source_message_id?: string | null;
  selection?: string;
  market?: string;
};
type RecommendationEvaluation = Record<string, unknown> & {
  id?: string;
  recommendation_id?: string;
  supersedes_evaluation_id?: string | null;
  is_current?: boolean;
  frozen_recommendation?: { recommendation?: Record<string, unknown> };
  evaluation_input?: Record<string, unknown>;
  evaluation?: {
    status?: "scored" | "unscored";
    reasons?: string[];
    profit_per_unit?: number | null;
    roi_percent?: number | null;
    historical_delivery_warning?: boolean;
    quote_provenance?: string;
    meaning?: string;
  };
};
type SettlementMarketType = "moneyline" | "spread" | "total";
type ExistingEntryReviewPrefill = {
  mode?: "existing";
  eventId: string | null;
  market: string;
  selection: string;
  sourceMessageId: string;
  sourceRecommendationId: string | null;
  stakeUnits: null;
  executedPrice: null;
  notice?: string;
};
type ConditionalEntryReviewPrefill = {
  mode: "conditional";
  source: ConditionalEntrySource;
  candidate: ConditionalEntryCandidate;
  eventId: string | null;
  market: string;
  selection: string;
  sourceMessageId: string;
  sourceRecommendationId: null;
  stakeUnits: null;
  executedPrice: null;
  notice?: string;
};
type EntryReviewPrefill = ExistingEntryReviewPrefill | ConditionalEntryReviewPrefill;
type EntryReviewDraft = { sport: Sport; prefill: EntryReviewPrefill; notice?: string };
type Desk = {
  messages: Message[];
  hasMore: boolean;
  criteria: Rule[];
  events: Event[];
  recommendations: Recommendation[];
  recommendationEvaluations: RecommendationEvaluation[];
  bets: Bet[];
  mistakes: Record<string, unknown>[];
  jobs: Job[];
};
type Draft = {
  rules: Record<string, unknown>[];
  events: Record<string, unknown>[];
  recommendations: Record<string, unknown>[];
  bets: Record<string, unknown>[];
  mistakeNotes: Record<string, unknown>[];
  summary: string;
  warnings?: string[];
};
const sports: { slug: Sport; name: string; category: string }[] = [
  { slug: "mlb", name: "MLB", category: "BASEBALL" },
  { slug: "nfl", name: "NFL", category: "FOOTBALL" },
  { slug: "cfb", name: "CFB", category: "COLLEGE" },
  { slug: "soccer", name: "축구", category: "SOCCER" },
  { slug: "tennis", name: "테니스", category: "TENNIS" },
  { slug: "nba", name: "NBA", category: "BASKETBALL" },
  { slug: "wnba", name: "WNBA", category: "BASKETBALL" },
  { slug: "nhl", name: "NHL", category: "HOCKEY" },
];
const quick = [
  {
    action: "analyze_today",
    label: "오늘 경기 분석",
    desc: "일정 · 선발 · 시장",
    icon: Activity,
    text: "오늘 경기 분석해줘.",
  },
  {
    action: "recheck_lineup",
    label: "라인업 재확인",
    desc: "출전 정보 · 재평가",
    icon: RefreshCw,
    text: "라인업과 출전 정보를 재확인하고 기존 판단을 재평가해줘.",
  },
  {
    action: "check_status",
    label: "상태 확인",
    desc: "변동 조회 · 재판단 없음",
    icon: Clock3,
    text: "라인업 게시 여부와 주요 변동만 확인해줘. 기존 결론은 다시 판단하지 마.",
  },
  {
    action: "review_results",
    label: "결과와 오답노트",
    desc: "확정 결과 · 복기",
    icon: BookOpen,
    text: "종료된 경기 결과를 출처로 확인하고 오답노트를 작성해줘.",
  },
] as const;
const empty: Desk = {
  messages: [],
  hasMore: false,
  criteria: [],
  events: [],
  recommendations: [],
  recommendationEvaluations: [],
  bets: [],
  mistakes: [],
  jobs: [],
};
const active = (status: string) =>
  ["queued", "pending", "running", "in_progress"].includes(status);
export function hasImportedContext(desk: Desk) {
  return [
    ...desk.criteria,
    ...desk.events,
    ...desk.recommendations,
    ...desk.bets,
    ...desk.mistakes,
  ].some((item) => Boolean((item as { source_document_id?: unknown }).source_document_id));
}
export function formatAmericanOdds(price?: string | number | null) {
  if (price == null || price === "") return "미확인";
  const numeric = Number(price);
  if (!Number.isFinite(numeric)) return String(price);
  return numeric > 0 ? `+${numeric}` : String(numeric);
}
const fmt = (date: string, opts: Intl.DateTimeFormatOptions) => {
  const d = new Date(date);
  return Number.isNaN(d.getTime())
    ? date
    : new Intl.DateTimeFormat("ko-KR", {
        timeZone: "America/New_York",
        ...opts,
      }).format(d);
};
async function request<T>(
  url: string,
  body?: unknown,
  method = "GET",
): Promise<T> {
  const response = await fetch(url, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      (value.error || "요청 실패") + " (" + response.status + ")",
    );
  return value as T;
}
const markdownComponents: Components = {
  a: ({ href, children, ...props }) => (
    <a {...props} href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  table: ({ children, ...props }) => (
    <div className="markdown-table-scroll">
      <table {...props}>{children}</table>
    </div>
  ),
};
function dateKey(message: Message) {
  return fmt(message.created_at, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export default function SportsDesk() {
  const [sport, setSport] = useState<Sport>("mlb"),
    [desk, setDesk] = useState<Desk>(empty),
    [loading, setLoading] = useState(true);
  const [latestAnalysis, setLatestAnalysis] = useState<LatestAnalysisState>({
    sport: "mlb",
    status: "loading",
    analysis: null,
  });
  const [workspace, setWorkspace] = useState<"sport" | "overview">("overview");
  const [analysisTableExpanded, setAnalysisTableExpanded] = useState(false);
  const [analysisTablePreferenceSport, setAnalysisTablePreferenceSport] = useState<Sport | null>(null);
  const [initialSportReady, setInitialSportReady] = useState(false);
  const [allSportsAnalysis, setAllSportsAnalysis] = useState<AllSportsAnalysis[] | null>(null);
  const [overviewStatus, setOverviewStatus] = useState<"loading" | "ready" | "error">("loading");
  const [overviewNow, setOverviewNow] = useState(() => new Date());
  const [auth, setAuth] = useState<
    "checking" | "ready" | "signed-out" | "unconfigured"
  >("checking");
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [ownerLookupFailed, setOwnerLookupFailed] = useState(false);
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [loginInfo, setLoginInfo] = useState(""),
    [authSubmitting, setAuthSubmitting] = useState(false),
    [text, setText] = useState(""),
    [error, setError] = useState("");
  const [sending, setSending] = useState(false),
    [menu, setMenu] = useState(false),
    [mobileRail, setMobileRail] = useState(false),
    [analysisExpanded, setAnalysisExpanded] = useState(false),
    [quickRequestsOpen, setQuickRequestsOpen] = useState(false),
    [notificationsOpen, setNotificationsOpen] = useState(false),
    [tab, setTab] = useState<"context" | "records">("context");
  const [importOpen, setImportOpen] = useState(false),
    [betOpen, setBetOpen] = useState(false);
  const [noteSource, setNoteSource] = useState<{ messageId: string; sport: Sport } | null>(null);
  const [entryDraft, setEntryDraft] = useState<EntryReviewDraft | null>(null);
  const [entryReviewError, setEntryReviewError] = useState("");
  const [entryReviewing, setEntryReviewing] = useState<string | null>(null);
  const entryReviewRequest = useRef(0);
  const openEvents = openGameEvents(desk.events);
  const importedContext = hasImportedContext(desk);
  const submission = useRef<{ signature: string; key: string } | null>(null);
  const requestScope = useRef(createDeskRequestScope<Sport>("mlb"));
  const latestAnalysisRequest = useRef(0);
  const overviewRequest = useRef(0);
  const threadRef = useRef<HTMLDivElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);
  const notificationsButtonRef = useRef<HTMLButtonElement>(null);
  const threadNearBottom = useRef(true);
  const threadClientHeight = useRef<number | null>(null);
  const pendingInitialScroll = useRef<Sport | null>(null);
  const [loadedSport, setLoadedSport] = useState<Sport | null>(null);
  useEffect(() => {
    if (!analysisExpanded) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAnalysisExpanded(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [analysisExpanded]);
  useEffect(() => {
    if (auth !== "ready" || workspace !== "sport") return;
    const thread = threadRef.current;
    if (!thread) return;
    threadClientHeight.current = thread.clientHeight;
    const observer = new ResizeObserver(() => {
      const nextHeight = thread.clientHeight;
      const previousHeight = threadClientHeight.current;
      threadClientHeight.current = nextHeight;
      if (previousHeight !== null && nextHeight !== previousHeight && threadNearBottom.current) {
        thread.scrollTop = thread.scrollHeight;
      }
    });
    observer.observe(thread);
    return () => {
      observer.disconnect();
      threadClientHeight.current = null;
    };
  }, [auth, workspace]);
  const {
    bySport: jobOverview,
    markSeen,
    error: jobOverviewError,
    isStale: jobOverviewIsStale,
    hasSnapshot: jobOverviewHasSnapshot,
  } = useJobOverview(ownerId);
  useEffect(() => {
    if (!notificationsOpen) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!notificationsRef.current?.contains(event.target as Node)) setNotificationsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setNotificationsOpen(false);
      notificationsButtonRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [notificationsOpen]);
  const refreshLatestAnalysis = useCallback(async (slug: Sport) => {
    const token = requestScope.current.capture();
    if (token.sport !== slug) return;
    const requestId = ++latestAnalysisRequest.current;
    setLatestAnalysis((old) => ({
      sport: slug,
      status: "loading",
      analysis: old.sport === slug ? old.analysis : null,
    }));
    try {
      const result = await request<{ analysis: LatestAnalysis | null }>(
        "/api/sports/" + slug + "/latest-analysis",
      );
      if (
        !requestScope.current.isSelected(token) ||
        requestId !== latestAnalysisRequest.current
      )
        return;
      setLatestAnalysis({ sport: slug, status: "ready", analysis: result.analysis });
    } catch {
      if (
        !requestScope.current.isSelected(token) ||
        requestId !== latestAnalysisRequest.current
      )
        return;
      setLatestAnalysis((old) => ({
        sport: slug,
        status: "error",
        analysis: old.sport === slug ? old.analysis : null,
      }));
    }
  }, []);
  const refreshOverview = useCallback(async () => {
    const requestId = ++overviewRequest.current;
    setOverviewStatus("loading");
    try {
      const result = await request<{ sports: AllSportsAnalysis[] }>("/api/analysis/latest");
      if (requestId !== overviewRequest.current) return;
      setAllSportsAnalysis(result.sports);
      setOverviewStatus("ready");
    } catch {
      if (requestId !== overviewRequest.current) return;
      setOverviewStatus("error");
    }
  }, []);
  useEffect(() => {
    if (auth !== "ready" || workspace !== "overview") return;
    setOverviewNow(new Date());
    void refreshOverview();
    const timer = setInterval(() => {
      setOverviewNow(new Date());
      void refreshOverview();
    }, 15_000);
    return () => {
      clearInterval(timer);
    };
  }, [auth, workspace, refreshOverview]);
  const load = useCallback(async (slug: Sport, before?: string) => {
    const token = requestScope.current.begin(slug);
    if (!token) return;
    try {
      if (!before) setLoading(true);
      const result = await request<Desk>(
        "/api/sports/" +
          slug +
          (before ? "?before=" + encodeURIComponent(before) : ""),
      );
      if (!requestScope.current.isCurrent(token)) return;
      setDesk((old) =>
        before
          ? { ...result, messages: [...result.messages, ...old.messages] }
          : { ...empty, ...result },
      );
      if (!before) void refreshLatestAnalysis(slug);
      if (!before) setLoadedSport(slug);
      setAuth("ready");
      setError("");
    } catch (e) {
      if (!requestScope.current.isCurrent(token)) return;
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes("(401)") || message.includes("(403)")) {
        setAuth("signed-out");
        setLoginInfo(
          message.includes("(403)")
            ? "등록된 개인 계정만 접근할 수 있습니다."
            : "",
        );
      } else if (message.includes("(503)")) {
        setAuth("unconfigured");
        setLoginInfo(message);
      } else {
        setAuth("ready");
        setError(message);
      }
    } finally {
      if (requestScope.current.isCurrent(token)) setLoading(false);
    }
  }, [refreshLatestAnalysis]);
  useEffect(() => {
    if (auth !== "ready") {
      setOwnerId(null);
      setOwnerLookupFailed(false);
      return;
    }
    let disposed = false;
    setOwnerLookupFailed(false);
    void request<{ id: string }>('/api/auth/me')
      .then(({ id }) => {
        if (!disposed) setOwnerId(id);
      })
      .catch(() => {
        if (!disposed) setOwnerLookupFailed(true);
      });
    return () => {
      disposed = true;
    };
  }, [auth]);
  useEffect(() => {
    if (
      auth !== "ready" ||
      workspace !== "sport" ||
      loading ||
      loadedSport !== sport
    )
      return;
    const committedMessageJobIds = new Set(
      desk.messages
        .filter((message) => message.role !== "user" && message.analysis_job_id)
        .map((message) => message.analysis_job_id!),
    );
    const unreadCompletedIds = new Set(jobOverview[sport].unreadCompletedIds);
    const committedCompletedIds = [...committedMessageJobIds].filter((id) =>
      unreadCompletedIds.has(id),
    );
    if (committedCompletedIds.length) markSeen(sport, committedCompletedIds);
  }, [
    auth,
    desk.messages,
    jobOverview,
    loadedSport,
    loading,
    markSeen,
    sport,
    workspace,
  ]);
  useEffect(() => {
    const saved = localStorage.getItem("fieldnote:sport") as Sport | null;
    const selected = sports.some((item) => item.slug === saved)
      ? saved!
      : "mlb";
    pendingInitialScroll.current = selected;
    requestScope.current.select(selected);
    setSport(selected);
    setInitialSportReady(true);
    if (
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ) {
      setAuth("unconfigured");
      setLoading(false);
      return;
    }
    void load(selected);
  }, [load]);
  useEffect(() => {
    if (!initialSportReady) return;
    let savedOpen = false;
    try {
      // The old key was written automatically while the default was expanded,
      // so it cannot tell a deliberate preference from the old default.
      const saved = localStorage.getItem(`fieldnote:analysis-table:v2:${sport}`);
      if (saved === "true" || saved === "false") savedOpen = saved === "true";
    } catch {
      // Storage may be disabled; keep the compact in-memory default.
    }
    setAnalysisTableExpanded(savedOpen);
    setAnalysisTablePreferenceSport(sport);
  }, [initialSportReady, sport]);
  useEffect(() => {
    if (!initialSportReady || analysisTablePreferenceSport !== sport) return;
    try {
      localStorage.setItem(`fieldnote:analysis-table:v2:${sport}`, String(analysisTableExpanded));
    } catch {
      // Keep the in-memory preference when storage is unavailable.
    }
  }, [analysisTableExpanded, analysisTablePreferenceSport, initialSportReady, sport]);
  useEffect(() => {
    if (auth !== "ready" || !desk.jobs.some((job) => active(job.status)))
      return;
    let disposed = false;
    const timer = setInterval(async () => {
      const token = requestScope.current.capture();
      if (token.sport !== sport) return;
      const pending = desk.jobs.filter((job) => active(job.status));
      const results = await Promise.allSettled(
        pending.map((job) => request<{ job: Job }>("/api/jobs/" + job.id)),
      );
      if (disposed || !requestScope.current.isCurrent(token)) return;
      if (
        results.some(
          (result) =>
            result.status === "fulfilled" && !active(result.value.job.status),
        )
      ) {
        void load(sport);
        return;
      }
      setDesk((old) => ({
        ...old,
        jobs: old.jobs.map((job) => {
          const i = pending.findIndex((p) => p.id === job.id);
          const result = results[i];
          return result?.status === "fulfilled" ? result.value.job : job;
        }),
      }));
    }, 5000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [auth, desk.jobs, load, sport]);
  function choose(next: Sport) {
    entryReviewRequest.current++;
    setEntryReviewing(null);
    setEntryReviewError("");
    setWorkspace("sport");
    requestScope.current.select(next);
    latestAnalysisRequest.current++;
    submission.current = null;
    pendingInitialScroll.current = next;
    setLoadedSport(null);
    setSport(next);
    setDesk(empty);
    setLatestAnalysis({ sport: next, status: "loading", analysis: null });
    setError("");
    setMenu(false);
    setMobileRail(false);
    setQuickRequestsOpen(false);
    setTab("context");
    localStorage.setItem("fieldnote:sport", next);
    void load(next);
  }
  useEffect(() => {
    if (loading || loadedSport !== sport) return;
    const targetSport = pendingInitialScroll.current;
    if (targetSport !== sport) return;
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        if (pendingInitialScroll.current !== targetSport) return;
        const thread = threadRef.current;
        if (thread) {
          thread.scrollTop = thread.scrollHeight;
          threadNearBottom.current = true;
        }
        pendingInitialScroll.current = null;
      });
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      if (secondFrame) cancelAnimationFrame(secondFrame);
    };
  }, [desk.messages, loadedSport, loading, sport]);
  async function send(action?: (typeof quick)[number]["action"]) {
    const value = action
      ? quick.find((item) => item.action === action)!.text
      : text.trim();
    if (!value || sending) return;
    const signature = sport + ":" + (action || "message") + ":" + value;
    const storageKey = "fieldnote:submission:" + signature;
    if (submission.current?.signature !== signature) {
      const key = sessionStorage.getItem(storageKey) || crypto.randomUUID();
      submission.current = { signature, key };
      sessionStorage.setItem(storageKey, key);
    }
    const submitted = submission.current;
    const token = requestScope.current.capture();
    setSending(true);
    setError("");
    try {
      await request(
        "/api/sports/" + sport + "/messages",
        {
          text: value,
          idempotencyKey: submitted.key,
          ...(action ? { action } : {}),
        },
        "POST",
      );
      sessionStorage.removeItem(storageKey);
      if (submission.current === submitted) submission.current = null;
      if (!requestScope.current.isSelected(token)) return;
      if (!action) setText("");
      await load(sport);
    } catch (e) {
      if (requestScope.current.isSelected(token))
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }
  async function reviewEntry(
    targetSport: Sport,
    messageId: string,
    recommendationId?: string,
    conditionalSource?: ConditionalEntrySource,
  ) {
    if (entryReviewing) return;
    const token = requestScope.current.capture();
    const requestId = ++entryReviewRequest.current;
    const reviewIdentity = recommendationId || conditionalSource?.candidateSha256 || messageId;
    setEntryReviewing(reviewIdentity);
    setEntryReviewError("");
    try {
      const result = await request<{
        requiresConfirmation: true;
        prefill: EntryReviewPrefill;
        missing: string[];
        notice?: string;
      }>("/api/records/entry-review", {
        ...(conditionalSource
          ? conditionalEntryPreparationRequest(targetSport, conditionalSource)
          : { sportSlug: targetSport, sourceMessageId: messageId, ...(recommendationId ? { sourceRecommendationId: recommendationId } : {}) }),
      }, "POST");
      if (!result.requiresConfirmation) throw new Error("진입 검토 응답을 확인할 수 없습니다.");
      if (!requestScope.current.isSelected(token)) return;
      setEntryDraft({ sport: targetSport, prefill: result.prefill, notice: result.notice });
      setBetOpen(true);
    } catch (e) {
      if (requestScope.current.isSelected(token)) setEntryReviewError(e instanceof Error ? e.message : String(e));
    } finally {
      if (entryReviewRequest.current === requestId) setEntryReviewing(null);
    }
  }
  async function retry(id: string) {
    const token = requestScope.current.capture();
    try {
      await request("/api/jobs/" + id + "/retry", {}, "POST");
      if (requestScope.current.isSelected(token)) await load(sport);
    } catch (e) {
      if (requestScope.current.isSelected(token))
        setError(e instanceof Error ? e.message : String(e));
    }
  }
  async function dismiss(id: string) {
    const token = requestScope.current.capture();
    try {
      await request("/api/jobs/" + id + "/dismiss", {}, "POST");
      if (requestScope.current.isSelected(token)) await load(sport);
    } catch (e) {
      if (requestScope.current.isSelected(token))
        setError(e instanceof Error ? e.message : String(e));
    }
  }
  async function login(event: React.FormEvent) {
    event.preventDefault();
    const client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    setAuthSubmitting(true);
    setLoginInfo("");
    try {
      const { error } = await client.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      await request<{ id: string; email: string | null }>("/api/auth/me");
      setPassword("");
      await load(sport);
    } catch (e) {
      await client.auth.signOut({ scope: "local" }).catch(() => undefined);
      const message = e instanceof Error ? e.message : String(e);
      setAuth("signed-out");
      setLoginInfo(
        message.includes("(403)")
          ? "등록된 개인 계정만 접근할 수 있습니다."
          : message,
      );
    } finally {
      setAuthSubmitting(false);
    }
  }
  async function logout() {
    const client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    await client.auth.signOut();
    overviewRequest.current++;
    requestScope.current.select(sport);
    setAuth("signed-out");
    setAllSportsAnalysis(null);
    setDesk(empty);
  }
  if (auth === "checking")
    return (
      <div className="loading-page">
        <b>
          F<span>.</span>
        </b>
        <small>LOADING THE DESK</small>
      </div>
    );
  if (auth !== "ready")
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="kicker">PERSONAL SPORTS INTELLIGENCE / 001</div>
          <div className="auth-brand">
            FIELD<span>NOTE</span>
            <i>.</i>
          </div>
          <h1>
            기록이 이어지는
            <br />
            스포츠 분석 데스크
          </h1>
          <p>경기 전 판단부터 결과 복기까지 한곳에 남깁니다.</p>
          {auth === "unconfigured" ? (
            <div className="notice">
              <CircleAlert size={18} /> 서버 환경변수를 확인하면 로그인을 사용할
              수 있습니다.
            </div>
          ) : (
            <form onSubmit={login}>
              <label htmlFor="email">계정 이메일</label>
              <div className="auth-input">
                <input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <label htmlFor="password">비밀번호</label>
              <div className="auth-input">
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="비밀번호"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  aria-label={authSubmitting ? "로그인 확인 중" : "로그인"}
                  disabled={authSubmitting}
                >
                  {authSubmitting ? "확인 중…" : <ArrowRight size={20} />}
                </button>
              </div>
              <small>등록된 개인 계정으로만 접근할 수 있습니다.</small>
            </form>
          )}
          {loginInfo && (
            <div className="notice" role="status">
              {loginInfo}
            </div>
          )}
        </div>
        <div className="auth-motto">
          KEEP THE RECORD.
          <br />
          TRUST THE PROCESS.
        </div>
      </div>
    );
  const current = sports.find((item) => item.slug === sport)!;
  const analysisTableBodyId = `latest-analysis-body-${sport}`;
  const actionableOverviewBets = upcomingActionableBets(
    (allSportsAnalysis || []).flatMap(({ sport: slug, analysis }) => {
      const item = sports.find((candidate) => candidate.slug === slug);
      if (!item || analysis?.actionState !== "ready") return [];
      return (analysis.actionableBets || []).map((bet) => ({ ...bet, sport: slug, sportName: item.name }));
    }),
    overviewNow,
  );
  const conditionalOverviewBets = currentConditionalBets(
    (allSportsAnalysis || []).flatMap(({ sport: slug, analysis }) => {
      const item = sports.find((candidate) => candidate.slug === slug);
      if (!item || !analysis) return [];
      return conditionalBetsOrEmpty(analysis).map((bet) => ({ ...bet, sport: slug, sportName: item.name }));
    }),
    overviewNow,
  );
  const recommendationCounts = overviewRecommendationCounts(actionableOverviewBets, conditionalOverviewBets);
  const overviewBetRows = mergeOverviewBetRows(actionableOverviewBets, conditionalOverviewBets);
  const overviewNeedsReview = (allSportsAnalysis || []).reduce(
    (total, item) => total + (item.analysis?.needsReview?.count || 0), 0,
  );
  const overviewUnavailableCount = sports.filter((item) => {
    const analysis = allSportsAnalysis?.find((entry) => entry.sport === item.slug)?.analysis;
    return analysis !== null && analysis !== undefined && analysis.actionState !== "ready" && analysis.actionState !== "not_applicable";
  }).length;
  const overviewNotApplicableCount = sports.filter((item) =>
    allSportsAnalysis?.find((entry) => entry.sport === item.slug)?.analysis?.actionState === "not_applicable",
  ).length;
  const notificationGroups = buildJobNotificationGroups(sports, jobOverview);
  const notificationTotals = notificationCounts(notificationGroups);
  const notificationStatus = notificationSyncState({
    ownerLookupFailed, error: jobOverviewError, isStale: jobOverviewIsStale,
    hasSnapshot: jobOverviewHasSnapshot, ownerId, authReady: auth === "ready",
  });
  const notificationIssue = notificationStatus === "owner-error" || notificationStatus === "stale" || notificationStatus === "error";
  const notificationChecking = notificationStatus === "loading";
  const markAllNotificationsRead = () => {
    for (const item of unreadCompletedBySport(notificationGroups)) markSeen(item.sport, item.ids);
  };
  const rules = desk.criteria.filter((item) => item.status === "adopted"),
    proposals = desk.criteria.filter((item) => item.status === "proposed");
  const currentEvaluations = desk.recommendationEvaluations.filter((item) => item.is_current !== false);
  const currentEvaluationByRecommendation = new Map(
    currentEvaluations
      .filter((item) => typeof item.recommendation_id === "string")
      .map((item) => [item.recommendation_id!, item]),
  );
  const evaluatedBetRecommendations = currentEvaluations.filter((item) =>
    item.frozen_recommendation?.recommendation?.decision === "BET",
  );
  const scoredCurrentEvaluations = evaluatedBetRecommendations.filter((item) =>
    item.evaluation?.status === "scored" && typeof item.evaluation.roi_percent === "number",
  );
  const averageRecommendationRoi = scoredCurrentEvaluations.length
    ? scoredCurrentEvaluations.reduce((total, item) => total + Number(item.evaluation?.roi_percent), 0) / scoredCurrentEvaluations.length
    : null;
  return (
    <div className="shell">
      <aside className={"sidebar" + (menu ? " open" : "")}>
        <div className="brand">
          <span className="brand-icon">
            F<i>.</i>
          </span>
          <div>
            <b>FIELDNOTE</b>
            <small>SPORTS DESK / 001</small>
          </div>
        </div>
        <div className="nav-label">
          WORKSPACES <span>{String(sports.length + 1).padStart(2, "0")}</span>
        </div>
        <nav aria-label="스포츠 선택">
          <button
            type="button"
            className={"sport-button overview-nav" + (workspace === "overview" ? " selected" : "")}
            onClick={() => {
              setWorkspace("overview");
              setMenu(false);
              setMobileRail(false);
            }}
            aria-current={workspace === "overview" ? "page" : undefined}
          >
            <small>00</small>
            <span><b>전체 분석표</b><em>ALL SPORTS</em></span>
            <ArrowRight size={16} />
          </button>
          {sports.map((item, i) => (
            <button
              key={item.slug}
              type="button"
              className={
                "sport-button" + (workspace === "sport" && sport === item.slug ? " selected" : "")
              }
              onClick={() => choose(item.slug)}
              aria-current={workspace === "sport" && sport === item.slug ? "page" : undefined}
            >
              <small>{String(i + 1).padStart(2, "0")}</small>
              <span>
                <b>{item.name}</b>
                <em>{item.category}</em>
              </span>
              {(jobOverview[item.slug].activeCount > 0 ||
                jobOverview[item.slug].unreadCompletedCount > 0 ||
                jobOverview[item.slug].failureCount > 0) && (
                <span className="sport-statuses">
                  {jobOverview[item.slug].activeCount > 0 && (
                    <small className="sport-status active">
                      {jobOverview[item.slug].activeCount} 진행
                    </small>
                  )}
                  {jobOverview[item.slug].unreadCompletedCount > 0 && (
                    <small className="sport-status completed">
                      결과 {jobOverview[item.slug].unreadCompletedCount}
                    </small>
                  )}
                  {jobOverview[item.slug].failureCount > 0 && (
                    <small className="sport-status failed">
                      확인 {jobOverview[item.slug].failureCount}
                    </small>
                  )}
                </span>
              )}
              <ArrowRight size={16} />
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div>
            <Clock3 size={14} /> America/New_York
            <small>
              {fmt(new Date().toISOString(), {
                weekday: "short",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </small>
          </div>
          <button onClick={logout}>
            <LogOut size={15} /> 로그아웃
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <button
            className="menu-button"
            onClick={() => setMenu(!menu)}
            aria-label="메뉴"
          >
            <Menu size={20} />
          </button>
          <div>
            {workspace === "overview" ? "전체 분석표" : current.name} <span>/</span> {workspace === "overview" ? "LATEST ANALYSES" : "CONTINUOUS THREAD"}
          </div>
          <small>
            <i /> PRIVATE WORKSPACE
          </small>
          {workspace === "sport" && <button
            className="rail-toggle"
            onClick={() => setMobileRail(!mobileRail)}
            aria-expanded={mobileRail}
            aria-controls="desk-intelligence"
            aria-label={mobileRail ? "기준과 기록 패널 닫기" : "기준과 기록 패널 열기"}
          >
            <BookOpen size={16} /> 기준 · 기록 {mobileRail ? "닫기" : "열기"}
          </button>}
          <div className="notification-control" ref={notificationsRef}>
            <button
              ref={notificationsButtonRef}
              type="button"
              className="notification-trigger"
              aria-label={`알림, 완료 ${notificationTotals.unreadCompleted}건, 진행 ${notificationTotals.active}건, 확인 필요 ${notificationTotals.failures}건${notificationIssue ? ", 상태 확인 필요" : notificationChecking || !jobOverviewHasSnapshot ? ", 상태 확인 중" : ""}`}
              aria-expanded={notificationsOpen}
              aria-controls="job-notification-panel"
              onClick={() => setNotificationsOpen((open) => !open)}
            >
              <Bell size={17} aria-hidden="true" />
              {notificationTotals.unreadCompleted + notificationTotals.active + notificationTotals.failures > 0 ? (
                <span className="notification-count" aria-hidden="true">
                  {Math.min(99, notificationTotals.unreadCompleted + notificationTotals.active + notificationTotals.failures)}{notificationTotals.unreadCompleted + notificationTotals.active + notificationTotals.failures > 99 ? "+" : ""}
                </span>
              ) : null}
              {notificationIssue ? (
                <span className="notification-issue-dot" aria-hidden="true" />
              ) : notificationChecking || !jobOverviewHasSnapshot ? (
                <span className="notification-loading-dot" aria-hidden="true" />
              ) : null}
            </button>
            {notificationsOpen && (
              <section className="notification-panel" id="job-notification-panel" aria-label="작업 알림">
                <div className="notification-panel-head">
                  <div><b>작업 알림</b><small>종목별 분석 상태</small></div>
                  <button
                    type="button"
                    className="notification-mark-read"
                    onClick={markAllNotificationsRead}
                    disabled={notificationTotals.unreadCompleted === 0}
                  >
                    <CheckCheck size={14} /> 완료 결과 모두 읽음
                  </button>
                </div>
                {(notificationIssue || notificationChecking || !jobOverviewHasSnapshot) && (
                  <div className={notificationIssue ? "notification-state issue" : "notification-state"} role={notificationIssue ? "alert" : "status"}>
                    {notificationStatus === "owner-error"
                      ? "계정 상태를 확인할 수 없어 알림을 불러오지 못했습니다."
                      : notificationStatus === "stale"
                        ? "상태 목록이 오래되었습니다. 다시 연결하는 중입니다."
                        : notificationStatus === "error"
                          ? "작업 상태를 불러오지 못했습니다. 연결을 확인하는 중입니다."
                          : "작업 상태를 불러오는 중입니다."}
                  </div>
                )}
                {notificationGroups.length > 0 ? (
                  <div className="notification-groups">
                    {notificationGroups.map((group) => (
                      <button
                        type="button"
                        className="notification-row"
                        key={group.sport}
                        onClick={() => {
                          choose(group.sport);
                          setNotificationsOpen(false);
                          notificationsButtonRef.current?.focus();
                        }}
                      >
                        <span className="notification-sport">{group.name}</span>
                        <span className="notification-signals">
                          {group.unreadCompletedCount > 0 && <small className="completed">완료 {group.unreadCompletedCount}</small>}
                          {group.activeCount > 0 && <small className="running">진행 {group.activeCount}</small>}
                          {group.failureCount > 0 && <small className="failed">확인 {group.failureCount}</small>}
                        </span>
                        <ArrowRight size={14} aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                ) : notificationStatus === "ready" ? (
                  <p className="notification-empty">새 알림이 없습니다.</p>
                ) : null}
              </section>
            )}
          </div>
        </header>
        {workspace === "overview" ? (
          <section className="overview-page" aria-label="전체 분석표">
            <div className="overview-head">
              <div>
                <div className="kicker">00 / {String(sports.length).padStart(2, "0")} <span>ALL SPORTS AT A GLANCE</span></div>
                <h1>전체 분석표<i>.</i></h1>
                <p>BET와 시각·상태 확인이 필요한 조건부 추천을 모았습니다. 추천은 실제 체결 기록이 아닙니다.</p>
              </div>
              <button type="button" className="overview-refresh" onClick={() => void refreshOverview()} disabled={overviewStatus === "loading"}>
                <RefreshCw size={15} className={overviewStatus === "loading" ? "spin" : undefined} /> 새로고침
              </button>
            </div>
            {overviewStatus === "error" && (
              <div className="overview-error betting-overview-error" role="alert">
                <CircleAlert size={17} />
                <span>{allSportsAnalysis ? "갱신에 실패했습니다. 마지막으로 불러온 추천을 표시합니다. 확인된 시작 시각이 지난 BET는 제외했습니다. 조건부 항목은 시각·상태 확인이 필요합니다." : "추천 목록을 불러올 수 없습니다."}</span>
                <button type="button" onClick={() => void refreshOverview()}>다시 확인</button>
              </div>
            )}
            <div className="betting-overview-summary" aria-live="polite">
              <b>확정 시각 BET {recommendationCounts.actionable} · 조건부 {recommendationCounts.conditional}</b>
              <span>검토 필요 {overviewNeedsReview}건</span>
              {overviewUnavailableCount > 0 && <span>상태 확인 불가 {overviewUnavailableCount}종목</span>}
              {overviewNotApplicableCount > 0 && <span>복기·일반 기록 {overviewNotApplicableCount}종목</span>}
              {!allSportsAnalysis && overviewStatus === "loading" && <span>분석 상태 확인 중</span>}
              {!allSportsAnalysis && overviewStatus === "error" && <span>최신 상태를 확인할 수 없음</span>}
              {overviewStatus === "loading" && allSportsAnalysis && <span>갱신 중 · 이전 목록 표시</span>}
            </div>
            <p className="betting-overview-disclaimer">표시된 가격 조건과 권장 U는 추천 정보입니다. 실제 베팅이나 체결 가격을 뜻하지 않습니다.</p>
            {overviewBetRows.length ? (
              <div className="betting-overview-table-wrap" aria-busy={overviewStatus === "loading"}>
                <table className="betting-overview-table">
                  <thead><tr><th>종목</th><th>경기 · 시장 · 선택</th><th>시작 / 예정 ET</th><th>가격 조건 · 확인 시각</th><th>권장 U</th><th>대화 / 기록</th></tr></thead>
                  <tbody>
                    {overviewBetRows.map((row, index) => {
                      const bet = row.data;
                      const conditionalDisplay = row.kind === "conditional" ? conditionalScheduleDisplay(row.data.schedule, row.data.statusAtAssessment) : null;
                      const conditionalSource = conditionalEntrySourceForOverviewRow(row);
                      const reviewedOriginalBody = row.kind === "actionable" && isReviewedOriginalBodyBet(bet);
                      const priceCondition = compactPriceCondition(bet.priceGate, bet.market);
                      const checkedAt = formatCheckedAtEt(bet.checkedAt);
                      const checkedAtTitle = checkedAt === "시각 미확인"
                        ? checkedAt
                        : `${reviewedOriginalBody ? "원문" : "기준"} 확인 시각: ${fmt(bet.checkedAt, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })} ET`;
                      return (
                        <tr className={reviewedOriginalBody ? "actionable reviewed-original-body" : row.kind === "conditional" ? "conditional" : "actionable"} key={overviewRowIdentity(row, index)}>
                          <td data-label="종목"><b>{bet.sportName}</b></td>
                          <td data-label="경기 · 선택">
                            <strong>{bet.match}</strong>
                            {reviewedOriginalBody && <small className="reviewed-original-body-badge">원문 추천 · 검토 반영 · {bet.originalDecision}</small>}
                            <small>{bet.market} · {bet.selection}</small>
                          </td>
                          <td data-label={row.kind === "conditional" ? "예정 시각" : "시작 ET"}>
                            {row.kind === "actionable" ? (
                              <time dateTime={row.data.startsAt}>{fmt(row.data.startsAt, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ET</time>
                            ) : (
                              <>
                                <strong>{conditionalDisplay!.expression}</strong>
                                <small>{conditionalDisplay!.date}</small>
                                <small>{conditionalDisplay!.assessmentStatus}</small>
                                <small className="conditional-status">조건부 · {conditionalDisplay!.status}</small>
                              </>
                            )}
                          </td>
                          <td data-label="가격 조건">
                            <span className="betting-overview-price-summary">{priceCondition.summary}</span>
                            <small className="betting-overview-checked-at">
                              <time dateTime={checkedAt === "시각 미확인" ? undefined : bet.checkedAt} title={checkedAtTitle}>{reviewedOriginalBody ? "원문 " : ""}{checkedAt}</time>
                            </small>
                            <details className="betting-overview-price-details">
                              <summary>조건 보기</summary>
                              <p>{priceCondition.disclosure}</p>
                            </details>
                          </td>
                          <td data-label="권장 U">{formatSuggestedUnits(bet.suggestedUnits)}</td>
                          <td data-label="대화 / 기록" className="betting-overview-actions">
                            <button type="button" className="betting-overview-open" onClick={() => choose(bet.sport as Sport)}>열기 <ArrowRight size={13} /></button>
                            {row.kind === "conditional" && (
                              <button
                                type="button"
                                className="betting-overview-open conditional-entry-action"
                                disabled={entryReviewing !== null}
                                onClick={() => conditionalSource && void reviewEntry(bet.sport as Sport, bet.messageId, undefined, conditionalSource)}
                              >
                                {entryReviewing === conditionalSource?.candidateSha256 ? "확인 중…" : "실제 진입 기록"}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="betting-overview-empty">현재 표시할 수 있는 BET 추천이 없습니다.</p>
            )}
            <details className="betting-overview-statuses">
              <summary>종목별 상태 보기</summary>
              <div>
                {sports.map((item) => {
                  const analysis = allSportsAnalysis?.find((entry) => entry.sport === item.slug)?.analysis;
                  const status = !allSportsAnalysis
                    ? overviewStatus === "error" ? "확인 불가" : "확인 중"
                    : !analysis ? "최근 분석 없음"
                        : analysis.actionState === "ready" ? (() => {
                          const visibleCount = actionableOverviewBets.filter((bet) => bet.sport === item.slug).length;
                          const conditionalCount = conditionalOverviewBets.filter((bet) => bet.sport === item.slug).length;
                          return `${visibleCount}개 BET · ${conditionalCount}개 조건부`;
                        })()
                        : analysis.actionState === "not_applicable" ? "복기·일반 기록"
                          : overviewReasonLabel(analysis.actionReason || "unavailable");
                  const reviewReasons = uniqueOverviewReasonLabels(analysis?.needsReview?.reasons || []);
                  return (
                    <p key={item.slug}>
                      <b>{item.name}</b><span>{status}</span>
                      {analysis?.needsReview?.count ? <small>검토 필요 {analysis.needsReview.count}건{reviewReasons.length ? ` · ${reviewReasons.join(" · ")}` : " · 대화 확인 필요"}</small> : null}
                    </p>
                  );
                })}
              </div>
            </details>
          </section>
        ) : <div className="main-grid">
          <section className="conversation">
            <div className="conversation-head">
              <div>
                <div className="kicker">
                  {String(sports.findIndex((item) => item.slug === sport) + 1).padStart(2, "0")} / {String(sports.length).padStart(2, "0")} <span>CONTINUOUS COVERAGE</span>
                </div>
                <h1>
                  {current.name}
                  <i>.</i> <em>데스크</em>
                </h1>
                <p>하나의 대화, 이어지는 판단 기록</p>
              </div>
              <div className="sport-stamp">
                <small>ACTIVE SPORT</small>
                <b>{current.category}</b>
                <span>EST. NOW → ALWAYS</span>
              </div>
            </div>
            <section className="latest-analysis" aria-label="최근 분석표">
              <button
                type="button"
                className="latest-analysis-summary-toggle"
                aria-expanded={analysisTableExpanded}
                aria-controls={analysisTableBodyId}
                onClick={() => setAnalysisTableExpanded((expanded) => !expanded)}
              >
                <span className="latest-analysis-summary-copy">
                  <small>최근 분석</small>
                  <b>
                    {latestAnalysis.sport === sport && latestAnalysis.analysis
                      ? latestAnalysis.analysis.analysisTitle || latestAnalysis.analysis.tableTitle || "최근 완료 분석"
                      : latestAnalysis.sport !== sport || latestAnalysis.status === "loading"
                        ? "분석 결과를 확인하고 있습니다"
                        : latestAnalysis.status === "error"
                          ? "분석 결과를 불러올 수 없습니다"
                          : "완료된 분석이 없습니다"}
                  </b>
                </span>
                {latestAnalysis.sport === sport && latestAnalysis.analysis && (
                  <time dateTime={latestAnalysis.analysis.completedAt}>
                    {fmt(latestAnalysis.analysis.completedAt, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} ET
                  </time>
                )}
                <ChevronDown size={16} aria-hidden="true" />
              </button>
              <div id={analysisTableBodyId} className="latest-analysis-details" hidden={!analysisTableExpanded}>
              <div className="latest-analysis-pinned">
                <div className="latest-analysis-heading">
                  <div className="latest-analysis-title">
                    <small>최근 분석표</small>
                    <b>
                      {latestAnalysis.sport === sport && latestAnalysis.analysis
                        ? latestAnalysis.analysis.analysisTitle ||
                          latestAnalysis.analysis.tableTitle ||
                          "최근 완료 분석"
                        : latestAnalysis.sport !== sport || latestAnalysis.status === "loading"
                          ? "분석 결과를 확인하고 있습니다"
                          : latestAnalysis.status === "error"
                            ? "분석 결과를 불러올 수 없습니다"
                          : "완료된 분석이 없습니다"}
                    </b>
                    {latestAnalysis.sport === sport && latestAnalysis.analysis && (
                      <RecordRecoveryStatus recovery={latestAnalysis.analysis.recovery} />
                    )}
                    {latestAnalysis.sport === sport && latestAnalysis.analysis && (
                      <AnalysisCoverage coverage={latestAnalysis.analysis.coverage} />
                    )}
                    {latestAnalysis.sport === sport && latestAnalysis.analysis && <MarketEvaluation evaluation={latestAnalysis.analysis.evaluation ?? null} presentation={latestAnalysis.analysis.evaluationPresentation ?? (latestAnalysis.analysis.tableContext === "historical" ? { context: "historical", reason: "원문의 과거·가정 판단을 보존합니다." } : null)} savedBodyExists={latestAnalysis.analysis.savedBodyExists} />}
                  </div>
                  <div className="latest-analysis-tools">
                    {latestAnalysis.sport === sport && latestAnalysis.analysis && (
                      <div className="latest-analysis-meta">
                        <span>응답 생성 완료</span>
                        <time dateTime={latestAnalysis.analysis.completedAt}>
                          {fmt(latestAnalysis.analysis.completedAt, {
                            year: "numeric",
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })} ET
                        </time>
                        {latestAnalysis.status === "loading" && (
                          <span>새 분석 결과 확인 중</span>
                        )}
                        {latestAnalysis.status === "error" && (
                          <span>갱신 실패 · 저장된 결과 표시</span>
                        )}
                      </div>
                    )}
                  {latestAnalysis.sport === sport && latestAnalysis.analysis && (latestAnalysis.analysis.executionRows?.length || (latestAnalysis.analysis.hasTable && latestAnalysis.analysis.tableMarkdown)) && (
                    <button
                      type="button"
                      className="analysis-expand"
                      onClick={() => setAnalysisExpanded(true)}
                    >
                      분석표 크게 보기
                    </button>
                  )}
                  <div className="latest-analysis-note">
                    분석 추천은 실제 체결된 베팅 기록이 아닙니다.
                  </div>
                </div>
              </div>
              </div>
              <div>
              {analysisTableExpanded && latestAnalysis.sport === sport && latestAnalysis.analysis && (
                latestAnalysis.analysis.executionRows?.length || (latestAnalysis.analysis.hasTable && latestAnalysis.analysis.tableMarkdown) ? (
                  <>
                    {latestAnalysis.analysis.tableTitle && !latestAnalysis.analysis.executionRows?.length && (
                      <div className="latest-analysis-table-title">
                        {latestAnalysis.analysis.tableTitle}
                      </div>
                    )}
                    {latestAnalysis.analysis.executionRows?.length ? (
                      <>
                        <div className="latest-analysis-scroll">
                          <ExecutionTable rows={latestAnalysis.analysis.executionRows} />
                        </div>
                        {latestAnalysis.analysis.tableMarkdown && (
                          <details className="execution-source-disclosure">
                            <summary>원문 분석표 보기</summary>
                            <div className="latest-analysis-scroll">
                              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                                {latestAnalysis.analysis.tableMarkdown}
                              </ReactMarkdown>
                            </div>
                          </details>
                        )}
                      </>
                    ) : latestAnalysis.analysis.tableMarkdown ? (
                      <>
                        <div className="latest-analysis-scroll">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={markdownComponents}
                          >
                            {latestAnalysis.analysis.tableMarkdown}
                          </ReactMarkdown>
                        </div>
                        {shouldShowMissingMatchStartTime(
                          latestAnalysis.analysis.kind,
                          latestAnalysis.analysis.tableMarkdown,
                        ) && (
                          <p className="missing-start-time-note">
                            경기 시작 시각은 이 표에 미기재 · 대화 본문/공식 일정 확인
                          </p>
                        )}
                      </>
                    ) : null}
                  </>
                ) : latestAnalysis.analysis ? (
                  <p className="latest-analysis-empty">
                    이 분석에는 표 없음 / 본문 확인
                    {latestAnalysis.analysis.unavailableReason
                      ? ` · ${latestAnalysis.analysis.unavailableReason}`
                      : ""}
                  </p>
                ) : null
              )}
              {analysisTableExpanded && latestAnalysis.sport === sport && !latestAnalysis.analysis &&
                latestAnalysis.status === "ready" && (
                  <p className="latest-analysis-empty">완료된 분석이 없습니다.</p>
                )}
              {analysisTableExpanded && latestAnalysis.sport === sport && !latestAnalysis.analysis &&
                latestAnalysis.status === "error" && (
                  <p className="latest-analysis-empty">
                    분석 결과를 확인할 수 없습니다. 대화는 계속 사용할 수 있습니다.
                    <button
                      className="latest-analysis-retry"
                      type="button"
                      onClick={() => void refreshLatestAnalysis(sport)}
                    >
                      다시 확인
                    </button>
                  </p>
                )}
              </div>
              </div>
            </section>
            <div className="thread-bar">
              <div>
                <i /> LIVE THREAD <span>{desk.messages.length} MESSAGES</span>
              </div>
              <button onClick={() => setImportOpen(true)}>
                <FileText size={15} /> MD 가져오기
              </button>
            </div>
            <div
              className="thread"
              ref={threadRef}
              role="log"
              aria-live="polite"
              onScroll={(event) => {
                const element = event.currentTarget;
                threadNearBottom.current =
                  element.scrollHeight - element.clientHeight - element.scrollTop <= 32;
              }}
            >
              {loading && !desk.messages.length ? (
                <div className="thread-loading">
                  <RefreshCw size={17} className="spin" /> 대화를 불러오는
                  중입니다
                </div>
              ) : null}
              {desk.hasMore && desk.messages[0] && (
                <button
                  className="older"
                  onClick={() => void load(sport, desk.messages[0].created_at)}
                >
                  이전 메시지 불러오기 ↑
                </button>
              )}
              {!loading && !desk.messages.length && (
                <div className="empty-thread">
                  <small>FIELD LOG / {current.category}</small>
                  <div>
                    {current.name.slice(0, 1)}
                    <i>↗</i>
                  </div>
                  {importedContext ? (
                    <>
                      <h2>가져온 기록이 준비되었습니다.</h2>
                      <p>
                        과거 기준과 경기 기록이 연결되었습니다. 문서의 과거 사실은 현재 웹 검증을 거치지 않았습니다.
                        <br />아래 요청 버튼으로 최신 자료를 확인하며 분석을 이어가세요.
                      </p>
                      <button onClick={() => void send("analyze_today")}>
                        <Activity size={16} /> 오늘 경기 분석 요청
                      </button>
                    </>
                  ) : (
                    <>
                      <h2>첫 기록을 시작하세요.</h2>
                      <p>
                        기존 MD를 가져오거나 오늘 경기 분석을 요청할 수 있습니다.
                        <br />이 공간에 기준과 대화가 계속 유지됩니다.
                      </p>
                      <button onClick={() => setImportOpen(true)}>
                        <UploadCloud size={16} /> MD 파일 가져오기
                      </button>
                    </>
                  )}
                </div>
              )}
              {desk.messages.map((message, i) => {
                const assistantType = messageTypeFromMetadata(message.metadata);
                const messageRecommendations = message.role === "assistant"
                  ? actionableRecommendationsForMessage(desk.recommendations, message.id)
                  : [];
                const conditionalMessageSources = message.role === "assistant"
                  ? message.conditionalEntrySources || []
                  : [];
                return (
                  <div key={message.id}>
                    {(i === 0 ||
                      dateKey(desk.messages[i - 1]) !== dateKey(message)) && (
                      <div className="date-divider">
                        <span>{dateKey(message)} · ET</span>
                      </div>
                    )}
                    <article
                      className={
                        "message " +
                        (message.role === "user" ? "user" : "assistant")
                      }
                    >
                      <div className="message-meta">
                        <span>{message.role === "user" ? "YOU" : "FN"}</span>
                        <b>
                          {message.role === "user" ? "나" : assistantType === "conversation" ? "FIELDNOTE" : "FIELDNOTE ANALYSIS"}
                        </b>
                        <time>
                          {fmt(message.created_at, {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </time>
                      </div>
                      <div className="message-body">
                        {message.role === "user" ? (
                          message.content
                        ) : (
                          <AnalysisMessage
                            content={message.content}
                            type={assistantType}
                            evaluationPresentation={message.evaluationPresentation}
                            evaluation={assistantType === "analysis" ? message.evaluation ?? null : null}
                            recovery={message.recovery}
                            repairCitationSupplements={
                              message.metadata && typeof message.metadata === "object" && !Array.isArray(message.metadata)
                                ? (message.metadata as Record<string, unknown>).repair_citation_supplements
                                : undefined
                            }
                          />
                        )}
                      </div>
                      {message.role === "assistant" && assistantType === "analysis" && (
                        <div className="message-record-actions" aria-label="이 답변에서 기록 만들기">
                          <button type="button" onClick={() => setNoteSource({ messageId: message.id, sport })}>
                            오답노트 초안
                          </button>
                          {messageRecommendations.map((recommendation) => (
                            <button
                              type="button"
                              key={recommendation.id}
                              disabled={entryReviewing !== null}
                              onClick={() => void reviewEntry(sport, message.id, recommendation.id)}
                            >
                              {entryReviewing === recommendation.id ? "확인 중…" : `실제 진입 검토 · ${recommendation.selection || recommendation.market || "추천"}`}
                            </button>
                          ))}
                          {conditionalMessageSources.map((candidate) => (
                            <button
                              type="button"
                              key={candidate.source.candidateSha256}
                              disabled={entryReviewing !== null}
                              onClick={() => void reviewEntry(sport, message.id, undefined, candidate.source)}
                            >
                              {entryReviewing === candidate.source.candidateSha256 ? "확인 중…" : `실제 진입 기록 · ${candidate.selection || candidate.match}`}
                            </button>
                          ))}
                          {entryReviewError && <span role="alert">{entryReviewError}</span>}
                        </div>
                      )}
                    </article>
                  </div>
                );
              })}
              {desk.jobs
                .filter((job) => active(job.status))
                .map((job) => (
                  <div className="job running" key={job.id}>
                    <RefreshCw size={19} className="spin" />
                    <div>
                      <b>{job.kind === "message"
                        ? job.status === "queued" ? "요청 대기 중" : "요청 처리 중"
                        : job.status === "queued" ? "분석 대기 중" : "검색 · 분석 진행 중"}</b>
                      <p>{job.status === "queued"
                        ? job.kind === "message"
                          ? "요청을 처리할 수 있게 되면 응답을 준비합니다. 페이지를 닫아도 요청은 보존됩니다."
                          : "작업 프로세스가 연결되면 실행됩니다. 페이지를 닫아도 요청은 보존됩니다."
                        : job.kind === "message"
                          ? "응답을 준비하고 있습니다. 페이지를 닫아도 작업은 계속됩니다."
                          : "페이지를 닫아도 작업은 계속됩니다."}</p>
                      <small>JOB {job.id.slice(0, 8).toUpperCase()}</small>
                    </div>
                  </div>
                ))}
              {desk.jobs
                .filter((job) =>
                  ["failed", "interrupted", "waiting_quota", "relogin_required"].includes(job.status) &&
                  (job.dismissed_attempt == null || job.dismissed_attempt !== job.attempt),
                )
                .map((job) => (
                  <div className="job failed" key={job.id}>
                    <CircleAlert size={19} />
                    <div>
                      <b>{job.kind === "message" ? "요청 처리 실패" : job.status === "waiting_quota" ? "Codex 사용량 대기" :
                        job.status === "relogin_required" ? "Codex 재로그인 필요" :
                          job.status === "interrupted" ? "분석 연결 중단" : "분석 작업 실패"}</b>
                      <p>{job.error || (job.kind === "message"
                        ? "응답을 준비하지 못했습니다. 다시 시도해 주세요."
                        : job.status === "waiting_quota"
                          ? "사용량이 다시 제공된 뒤 재시도해 주세요. 유료 API로 자동 전환하지 않습니다."
                          : job.status === "relogin_required"
                            ? "openllms에서 Codex 계정을 다시 연결한 뒤 재시도해 주세요."
                            : "작업을 완료하지 못했습니다.")}</p>
                      <div className="job-actions">
                        <button onClick={() => void retry(job.id)}>
                          다시 시도 <ArrowRight size={14} />
                        </button>
                        <button
                          type="button"
                          className="job-dismiss"
                          aria-label={job.kind === "message" ? "요청 알림 닫기" : "분석 알림 닫기"}
                          onClick={() => void dismiss(job.id)}
                        >
                          닫기 <X size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
            <div className="composer-wrap">
              <div className="quick-label-row">
                <span className="quick-label">QUICK REQUESTS</span>
                <button
                  type="button"
                  className="quick-toggle"
                  aria-expanded={quickRequestsOpen}
                  aria-controls="quick-request-actions"
                  onClick={() => setQuickRequestsOpen((open) => !open)}
                >
                  {quickRequestsOpen ? "접기" : "빠른 요청 보기"}
                  <ChevronDown size={15} aria-hidden="true" />
                </button>
              </div>
              <div
                className="quick-row"
                id="quick-request-actions"
                hidden={!quickRequestsOpen}
              >
                {quick.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.action}
                      disabled={sending}
                      onClick={() => void send(item.action)}
                    >
                      <Icon size={18} />
                      <span>
                        <b>{item.label}</b>
                        <small>{item.desc}</small>
                      </span>
                      <ArrowRight size={14} />
                    </button>
                  );
                })}
              </div>
              <form
                className="composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send();
                }}
              >
                <textarea
                  aria-label="분석 요청"
                  placeholder={
                    current.name + "에 관해 질문하거나 분석을 요청하세요..."
                  }
                  rows={2}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
                <button
                  disabled={!text.trim() || sending}
                  aria-label="메시지 보내기"
                >
                  {sending ? (
                    <RefreshCw size={18} className="spin" />
                  ) : (
                    <Send size={18} />
                  )}
                </button>
              </form>
              <div className="composer-foot">
                <span>
                  <ShieldCheck size={13} /> 출처 · 확인 시각 · 미확인 사항 구분
                </span>
                <span>ENTER ↵ SEND</span>
              </div>
              {error && (
                <div className="error" role="alert">
                  <CircleAlert size={15} />
                  {error}
                  <button onClick={() => setError("")} aria-label="오류 닫기">
                    <X size={14} />
                  </button>
                </div>
              )}
            </div>
          </section>
          <aside
            className={"rail" + (mobileRail ? " mobile-open" : "")}
            id="desk-intelligence"
            aria-label="분석 기준과 기록"
            aria-hidden={!mobileRail}
            inert={!mobileRail}
          >
            <div className="rail-head">
              <b>DESK INTELLIGENCE</b>
              <span>01 / LIVE</span>
              <button
                type="button"
                className="rail-close"
                onClick={() => setMobileRail(false)}
                aria-label="기준과 기록 패널 닫기"
              >
                <X size={18} />
              </button>
            </div>
            <div className="rail-tabs">
              <button
                className={tab === "context" ? "active" : ""}
                onClick={() => setTab("context")}
              >
                현재 기준
              </button>
              <button
                className={tab === "records" ? "active" : ""}
                onClick={() => setTab("records")}
              >
                기록
              </button>
            </div>
            <div className="rail-scroll">
              <CommonPolicyPanel />
              {tab === "context" ? (
                <>
                  <RailSection title="ADOPTED RULES" count={rules.length}>
                    {rules.map((rule, i) => (
                      <div className="rule" key={rule.id || i}>
                        <small>{String(i + 1).padStart(2, "0")}</small>
                        <div>
                          <b>{rule.title || "분석 기준"}</b>
                          <p>{rule.content}</p>
                          <Provenance item={rule} />
                          <RuleForm
                            sport={sport}
                            existing={rule}
                            onSaved={() => void load(sport)}
                          />
                        </div>
                      </div>
                    ))}
                    {!rules.length && (
                      <p className="muted">채택된 분석 기준이 없습니다.</p>
                    )}
                    <RuleForm sport={sport} onSaved={() => void load(sport)} />
                  </RailSection>
                  <RailSection
                    title="PROPOSED / REVIEW"
                    count={proposals.length}
                  >
                    {proposals.map((rule, i) => (
                      <div className="record" key={rule.id || i}>
                        <b>{rule.title || "제안된 기준"}</b>
                        <p>{rule.content}</p>
                        <Provenance item={rule} />
                      </div>
                    ))}
                    {!proposals.length && (
                      <p className="muted">검토 중인 기준이 없습니다.</p>
                    )}
                  </RailSection>
                  <RailSection
                    title="OPEN GAME STATE"
                    count={openEvents.length}
                  >
                    {openEvents.map((event, i) => (
                      <div className="event" key={event.id || i}>
                        {manualConditionalEventStatus(event.source_ref, event.analysisStatus || event.analysis_status) ? (
                          <>
                            <span>수동 경기 등록 · 자료 미완료</span>
                            <small>{manualConditionalEventStatus(event.source_ref, event.analysisStatus || event.analysis_status)!.detail}</small>
                          </>
                        ) : (
                          <span>{event.analysisStatus || event.analysis_status || "OPEN"}</span>
                        )}
                        <b>
                          {event.label || event.eventKey || event.event_key}
                        </b>
                        <small>
                          {event.gameStatus || event.game_status || "미확인"}
                        </small>
                        <Provenance item={event} />
                        {event.id && (
                          <ResultForm
                            kind="event"
                            id={event.id}
                            onSaved={() => void load(sport)}
                          />
                        )}
                      </div>
                    ))}
                    {!openEvents.length && (
                      <p className="muted">저장된 경기 상태가 없습니다.</p>
                    )}
                  </RailSection>
                </>
              ) : (
                <>
                  <RailSection title="CONFIRMED BETS" count={desk.bets.length}>
                    <p className="rail-note">
                      추천과 실제 진입은 별도로 기록됩니다.
                    </p>
                    <button
                      className="rail-action"
                      disabled={entryReviewing !== null}
                      onClick={() => setBetOpen(true)}
                    >
                      <Plus size={15} /> 실제 진입 기록
                    </button>
                    {desk.bets.map((bet, i) => (
                      <div className="record" key={bet.id || i}>
                        <b>{bet.selection || "선택 미확인"}</b>
                        <p>{bet.market || "시장 미확인"}</p>
                        <small>
                          가격 {formatAmericanOdds(bet.executed_price)} · 유닛{" "}
                          {bet.stake_units ?? "미확인"}
                        </small>
                        <Provenance item={bet} />
                        {bet.id && (
                          <ResultForm
                            kind="bet"
                            id={bet.id}
                            onSaved={() => void load(sport)}
                          />
                        )}
                      </div>
                    ))}
                    {!desk.bets.length && (
                      <p className="muted">확인된 실제 진입이 없습니다.</p>
                    )}
                  </RailSection>
                  <RailSection
                    title="RECOMMENDATION PERFORMANCE"
                    count={desk.recommendations.length}
                  >
                    <div className="performance-summary">
                      <span>{evaluatedBetRecommendations.length} BET 평가</span>
                      <span>{scoredCurrentEvaluations.length} 검토·채점됨</span>
                      <b>{averageRecommendationRoi === null ? "평균 ROI 미산출" : `평균 1U 가정 ROI ${averageRecommendationRoi.toFixed(1)}%`}</b>
                    </div>
                    <p className="rail-note">평가 집계는 최근 최대 200건, 추천 목록은 최근 최대 30건 기준</p>
                    <p className="rail-note">
                      검토한 가격과 출처가 있는 추천의 가정 성과입니다. 실제 베팅 손익과 분리하며, 미확인 자료는 채점하지 않습니다.
                    </p>
                    {desk.recommendations.map((item, i) => (
                      (() => {
                        const recommendationId = String(item.id || "");
                        const evaluationHistory = desk.recommendationEvaluations.filter((row) => row.recommendation_id === recommendationId);
                        const currentEvaluation = currentEvaluationByRecommendation.get(recommendationId) || null;
                        const decision = String(item.decision || "");
                        return (
                          <div className="record performance-record" key={recommendationId || i}>
                            <b>{String(item.selection || item.label || "추천")}</b>
                            <p>{String(item.market || decision || item.status || "")}</p>
                            {decision === "PAPER" ? (
                              <div className="performance-status paper">PAPER 관찰 · 가정 성과 집계에서 제외</div>
                            ) : decision === "BET" ? (
                              <div className={`performance-status ${currentEvaluation?.evaluation?.status || "unreviewed"}`}>
                                {currentEvaluation?.evaluation?.status === "scored"
                                  ? `출처 검토 완료 · ${Number(currentEvaluation.evaluation.roi_percent).toFixed(1)}% 가정 ROI`
                                  : currentEvaluation
                                    ? `미채점 · ${evaluationReasonLabel(currentEvaluation.evaluation?.reasons || [])}`
                                    : "미검토 · 가격과 결과 출처 확인 필요"}
                              </div>
                            ) : null}
                            {currentEvaluation?.evaluation?.quote_provenance === "reviewed_manual_late_verification" && (
                              <small className="performance-warning">경기/결과 시각 뒤 수동 확인 · 늦은 검증 기준</small>
                            )}
                            {currentEvaluation?.evaluation?.historical_delivery_warning && (
                              <small className="performance-warning">원래 생성된 시각과 늦게 전달된 시각을 별도로 보존합니다. 경기별 시각을 기준으로 채점했습니다.</small>
                            )}
                            {decision === "BET" && typeof item.id === "string" && typeof item.source_message_id === "string" && (
                              <RecommendationEvaluationForm
                                sport={sport}
                                recommendation={item}
                                existing={currentEvaluation}
                                onSaved={() => void load(sport)}
                              />
                            )}
                            {decision === "BET" && typeof item.source_message_id !== "string" && (
                              <small className="performance-warning">원본 분석 출처가 없어 채점할 수 없습니다. 이 기록은 미채점으로 유지됩니다.</small>
                            )}
                            {evaluationHistory.length > 1 && (
                              <details className="evaluation-history">
                                <summary>검토 이력 {evaluationHistory.length}개</summary>
                                {evaluationHistory.filter((row) => row.is_current === false).map((row, historyIndex) => (
                                  <div className="evaluation-history-row" key={String(row.id || historyIndex)}>
                                    <b>{row.evaluation?.status === "scored" ? `이전 ${Number(row.evaluation.roi_percent).toFixed(1)}%` : "이전 미채점"}</b>
                                    <small>{row.evaluation?.quote_provenance === "reviewed_manual_late_verification" ? "결과 후 수동 확인" : "기존 검토"}</small>
                                  </div>
                                ))}
                              </details>
                            )}
                            <Provenance item={item} />
                          </div>
                        );
                      })()
                    ))}
                    {!desk.recommendations.length && (
                      <p className="muted">저장된 추천이 없습니다.</p>
                    )}
                  </RailSection>
                  <RailSection
                    title="LESSONS LEARNED"
                    count={desk.mistakes.length}
                  >
                    {desk.mistakes.map((item, i) => (
                      <div className="record" key={String(item.id || i)}>
                        <b>{String(item.title || "오답노트")}</b>
                        <p>{String(item.lesson || item.outcome || "")}</p>
                        <Provenance item={item} />
                      </div>
                    ))}
                    {!desk.mistakes.length && (
                      <p className="muted">오답노트가 없습니다.</p>
                    )}
                    <MistakeForm
                      sport={sport}
                      events={desk.events}
                      onSaved={() => void load(sport)}
                    />
                  </RailSection>
                </>
              )}
            </div>
            <div className="rail-foot">
              <FileText size={14} /> 원문과 변경 이력은 서버에 보존됩니다.
            </div>
          </aside>
        </div>}
      </main>
      {(menu || mobileRail) && (
        <button
          className="menu-scrim"
          onClick={() => {
            setMenu(false);
            setMobileRail(false);
          }}
          aria-label="패널 닫기"
        />
      )}
      {analysisExpanded && latestAnalysis.sport === sport && latestAnalysis.analysis && (latestAnalysis.analysis.executionRows?.length || (latestAnalysis.analysis.hasTable && latestAnalysis.analysis.tableMarkdown)) && (
        <div
          className="analysis-modal-scrim"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setAnalysisExpanded(false);
          }}
        >
          <section
            className="analysis-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="analysis-modal-title"
          >
            <header className="analysis-modal-head">
              <div>
                <small>최근 분석표 · {current.name}</small>
                <h2 id="analysis-modal-title">
                  {latestAnalysis.analysis.analysisTitle || latestAnalysis.analysis.tableTitle || "최근 완료 분석"}
                </h2>
              </div>
              <button autoFocus type="button" onClick={() => setAnalysisExpanded(false)} aria-label="분석표 닫기">
                <X size={19} />
              </button>
            </header>
            <AnalysisCoverage coverage={latestAnalysis.analysis.coverage} />
            <MarketEvaluation evaluation={latestAnalysis.analysis.evaluation ?? null} presentation={latestAnalysis.analysis.evaluationPresentation ?? (latestAnalysis.analysis.tableContext === "historical" ? { context: "historical", reason: "원문의 과거·가정 판단을 보존합니다." } : null)} savedBodyExists={latestAnalysis.analysis.savedBodyExists} />
            <RecordRecoveryStatus recovery={latestAnalysis.analysis.recovery} />
            {latestAnalysis.analysis.tableTitle && (
              <div className="analysis-modal-table-title">{latestAnalysis.analysis.tableTitle}</div>
            )}
            {latestAnalysis.analysis.executionRows?.length ? (
              <>
                <div className="analysis-modal-scroll">
                  <ExecutionTable rows={latestAnalysis.analysis.executionRows} />
                </div>
                {latestAnalysis.analysis.tableMarkdown && (
                  <details className="execution-source-disclosure">
                    <summary>원문 분석표 보기</summary>
                    <div className="analysis-modal-scroll">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                        {latestAnalysis.analysis.tableMarkdown}
                      </ReactMarkdown>
                    </div>
                  </details>
                )}
              </>
            ) : latestAnalysis.analysis.tableMarkdown ? (
              <>
                <div className="analysis-modal-scroll">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {latestAnalysis.analysis.tableMarkdown}
                  </ReactMarkdown>
                </div>
                {shouldShowMissingMatchStartTime(latestAnalysis.analysis.kind, latestAnalysis.analysis.tableMarkdown) && (
                  <p className="missing-start-time-note">경기 시작 시각은 이 표에 미기재 · 대화 본문/공식 일정 확인</p>
                )}
              </>
            ) : null}
          </section>
        </div>
      )}
      {importOpen && (
        <ImportModal
          sport={sport}
          close={() => setImportOpen(false)}
          done={() => {
            setImportOpen(false);
            void load(sport);
          }}
        />
      )}
      {betOpen && (
        <BetModal
          key={entryDraftIdentity(entryDraft)}
          sport={entryDraft?.sport || sport}
          events={desk.events}
          initial={entryDraft}
          close={() => {
            setBetOpen(false);
            setEntryDraft(null);
          }}
          done={() => {
            setBetOpen(false);
            setEntryDraft(null);
            void load(sport);
          }}
        />
      )}
      {noteSource && (
        <MessageNoteModal
          sport={noteSource.sport}
          sourceMessageId={noteSource.messageId}
          close={() => setNoteSource(null)}
          done={() => {
            setNoteSource(null);
            void load(noteSource.sport);
          }}
        />
      )}
    </div>
  );
}
function Provenance({ item }: { item: object }) {
  const data = item as Record<string, unknown>;
  const imported = Boolean(data.source_document_id),
    hasResult = Boolean(data.result_checked_at);
  const conditionalSnapshot = conditionalSourceSnapshot(data.source_ref, data.source_candidate);
  const source = typeof data.source_ref === "string" ? data.source_ref : "";
  const analysisSourceUrl = (() => {
    if (imported || typeof data.source_ref !== "string") return "";
    try {
      return new URL(data.source_ref).protocol === "https:" ? data.source_ref : "";
    } catch {
      return "";
    }
  })();
  const legacySource = analysisSourceUrl ? "" : source;
  const url =
    typeof data.result_source_url === "string" ? data.result_source_url : "";
  if (conditionalSnapshot) {
    const historicalUrl = (() => {
      try { return new URL(conditionalSnapshot.sourceUrl).protocol === "https:" ? conditionalSnapshot.sourceUrl : ""; }
      catch { return ""; }
    })();
    return (
      <div className="provenance conditional-bet-provenance">
        <b>실제 진입 · 수동 경기 등록</b>
        <span>원문 당시 판단 {conditionalSnapshot.originalDecision} · 조건부 후보</span>
        <span>원문 가격 기준 {formatOddsDisplay(conditionalSnapshot.priceGate, conditionalSnapshot.market)} · 권장 {formatSuggestedUnits(conditionalSnapshot.suggestedUnits)}</span>
        <small>참고 시각 {fmt(conditionalSnapshot.checkedAt, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ET · 과거 원문 인용, 당시 검증 한계 유지</small>
        {historicalUrl && <a href={historicalUrl} target="_blank" rel="noreferrer">과거 원문 인용 ↗</a>}
        {hasResult && url && <a href={url} target="_blank" rel="noreferrer">결과 출처 ↗</a>}
      </div>
    );
  }
  return imported || hasResult || analysisSourceUrl ? (
    <div className="provenance">
      {hasResult
        ? "결과 출처 링크 등록됨 · 앱은 내용 검증 안 함"
        : imported
          ? "가져온 과거 기록 · 웹 미검증"
          : "분석 출처 링크 인용 · 내용 검증 안 함"}
      {legacySource ? " · " + legacySource : ""}
      {analysisSourceUrl ? (
        <a href={analysisSourceUrl} target="_blank" rel="noreferrer">
          분석 출처 ↗
        </a>
      ) : null}
      {hasResult && url ? (
        <a href={url} target="_blank" rel="noreferrer">
          출처 ↗
        </a>
      ) : null}
    </div>
  ) : null;
}
function RailSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="rail-section">
      <div className="section-head">
        <span>{title}</span>
        <b>{String(count).padStart(2, "0")}</b>
      </div>
      {children}
    </section>
  );
}
function RuleForm({
  sport,
  existing,
  onSaved,
}: {
  sport: Sport;
  existing?: Rule;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false),
    [title, setTitle] = useState(existing?.title || ""),
    [content, setContent] = useState(existing?.content || ""),
    [error, setError] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      await request(
        "/api/rules",
        {
          sportSlug: sport,
          title,
          content,
          status: "adopted",
          ...(existing?.id ? { supersedesId: existing.id } : {}),
        },
        "POST",
      );
      setTitle("");
      setContent("");
      setOpen(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }
  return open ? (
    <form className="rule-form" onSubmit={save}>
      <input
        placeholder="기준 제목"
        aria-label="기준 제목"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
      />
      <textarea
        placeholder="분석 기준"
        aria-label="분석 기준"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        required
      />
      <div>
        <button type="button" onClick={() => setOpen(false)}>
          취소
        </button>
        <button type="submit">채택하여 저장</button>
      </div>
      {error && <small role="alert">{error}</small>}
    </form>
  ) : (
    <button
      className={"rail-action quiet" + (existing ? " correction" : "")}
      onClick={() => setOpen(true)}
    >
      {existing ? (
        "정정하기"
      ) : (
        <>
          <Plus size={15} /> 기준 추가
        </>
      )}
    </button>
  );
}

function ResultForm({
  kind,
  id,
  onSaved,
}: {
  kind: "event" | "bet";
  id: string;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false),
    [choice, setChoice] = useState(""),
    [url, setUrl] = useState(""),
    [sourceConfirmed, setSourceConfirmed] = useState(false),
    [notes, setNotes] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await request(
        "/api/records/" +
          (kind === "event" ? "events" : "bets") +
          "/" +
          id +
          "/result",
        kind === "event"
          ? { gameStatus: choice, sourceUrl: url, sourceConfirmed, notes }
          : { result: choice, sourceUrl: url, sourceConfirmed },
        "POST",
      );
      setOpen(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }
  if (!open)
    return (
      <button className="record-link" onClick={() => setOpen(true)}>
        출처로 결과 기록 ↗
      </button>
    );
  return (
    <form className="result-form" onSubmit={save}>
      <select
        aria-label="결과"
        value={choice}
        onChange={(e) => setChoice(e.target.value)}
        required
      >
        <option value="">결과 선택</option>
        {(kind === "event"
          ? ["final", "postponed"]
          : ["won", "lost", "push", "void"]
        ).map((value) => (
          <option value={value} key={value}>
            {value}
          </option>
        ))}
      </select>
      <input
        type="url"
        aria-label="결과 출처 URL"
        placeholder="결과 출처 URL (필수)"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        required
      />
      <label className="source-confirmation">
        <input
          type="checkbox"
          checked={sourceConfirmed}
          onChange={(e) => setSourceConfirmed(e.target.checked)}
          required
        />
        링크를 열어 결과 내용을 직접 확인했습니다
      </label>
      {kind === "event" && (
        <input
          aria-label="결과 메모"
          placeholder="메모 (선택)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      )}
      <div>
        <button type="button" onClick={() => setOpen(false)}>
          취소
        </button>
        <button type="submit" disabled={busy || !sourceConfirmed}>
          확인한 결과 저장
        </button>
      </div>
      {error && <small role="alert">{error}</small>}
    </form>
  );
}
function MistakeForm({
  sport,
  events,
  onSaved,
}: {
  sport: Sport;
  events: Event[];
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false),
    [eventId, setEventId] = useState(""),
    [title, setTitle] = useState(""),
    [decision, setDecision] = useState(""),
    [outcome, setOutcome] = useState(""),
    [lesson, setLesson] = useState(""),
    [url, setUrl] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const saving = useRef(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      const payload = {
        sportSlug: sport,
        ...(eventId ? { eventId } : {}),
        title: title.trim(),
        lesson: lesson.trim(),
        ...(decision.trim() ? { decisionAtTime: decision.trim() } : {}),
        ...(outcome.trim() ? { outcome: outcome.trim() } : {}),
        ...(url.trim() ? { outcomeSourceUrl: url.trim() } : {}),
      };
      const submission = stablePayloadSubmission(sessionStorage, "fieldnote:mistake-note", payload);
      await request("/api/records/mistake-notes", mistakeNoteRequestBody(payload, submission.key), "POST");
      sessionStorage.removeItem(submission.storageKey);
      setOpen(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  if (!open)
    return (
      <button className="rail-action quiet" onClick={() => setOpen(true)}>
        <Plus size={15} /> 오답노트 추가
      </button>
    );
  return (
    <form className="result-form" onSubmit={save}>
      <select
        aria-label="관련 경기"
        value={eventId}
        onChange={(e) => setEventId(e.target.value)}
      >
        <option value="">관련 경기 없음</option>
        {events
          .filter((item) => item.id)
          .map((item) => (
            <option value={item.id} key={item.id}>
              {item.label || item.eventKey || item.event_key || item.id}
            </option>
          ))}
      </select>
      <input
        placeholder="제목"
        aria-label="오답노트 제목"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
      />
      <textarea
        placeholder="당시 판단"
        aria-label="당시 판단"
        value={decision}
        onChange={(e) => setDecision(e.target.value)}
      />
      <textarea
        placeholder="사후 결과"
        aria-label="사후 결과"
        value={outcome}
        onChange={(e) => setOutcome(e.target.value)}
      />
      <textarea
        placeholder="교훈"
        aria-label="교훈"
        value={lesson}
        onChange={(e) => setLesson(e.target.value)}
        required
      />
      <input
        type="url"
        placeholder="결과 출처 URL (확인한 경우)"
        aria-label="결과 출처 URL"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />
      <div>
        <button type="button" onClick={() => setOpen(false)}>
          취소
        </button>
        <button type="submit" disabled={busy}>
          오답노트 저장
        </button>
      </div>
      {error && <small role="alert">{error}</small>}
    </form>
  );
}

function MessageNoteModal({
  sport,
  sourceMessageId,
  close,
  done,
}: {
  sport: Sport;
  sourceMessageId: string;
  close: () => void;
  done: () => void;
}) {
  const [title, setTitle] = useState("");
  const [lesson, setLesson] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      const payload = {
        sportSlug: sport,
        sourceMessageId,
        title: title.trim(),
        lesson: lesson.trim(),
      };
      const submission = stablePayloadSubmission(sessionStorage, "fieldnote:message-note", payload);
      await request("/api/records/mistake-notes", mistakeNoteRequestBody(payload, submission.key), "POST");
      sessionStorage.removeItem(submission.storageKey);
      done();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  return (
    <Modal title="답변에서 오답노트 만들기" kicker="REVIEW NOTE · LINKED TO THIS MESSAGE" close={close}>
      <form className="message-note-form" onSubmit={save}>
        <p>이 답변을 출처로 연결합니다. 과거 판단이나 결과는 직접 적은 내용만 저장됩니다.</p>
        <label>
          제목
          <input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={200} />
        </label>
        <label>
          검토 메모
          <textarea value={lesson} onChange={(event) => setLesson(event.target.value)} required maxLength={5000} />
        </label>
        {error && <div className="error" role="alert">{error}</div>}
        <div className="message-note-actions">
          <button type="button" onClick={close}>취소</button>
          <button type="submit" disabled={busy || !title.trim() || !lesson.trim()}>
            {busy ? "저장 중…" : "출처와 함께 저장"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function evaluationReasonLabel(reasons: string[]) {
  const labels: Record<string, string> = {
    original_pregame_timing_unavailable: "원래 경기 전 확인 시각 없음",
    historical_or_late_delivery: "경기 후 전달",
    not_executable_recommendation: "실행 추천 아님",
    observed_quote_incomplete: "검토한 가격 근거 부족",
    quote_not_pregame: "경기 시작 뒤 확인한 가격",
    unsupported_or_mismatched_contract: "정산 기준 미확인 또는 불일치",
    original_settlement_identity_unproven_or_mismatched: "원래 선택의 라인/방향 미확인",
    sourced_outcome_required: "결과 출처 미확인",
    outcome_before_start: "경기 시작 전 결과 시각",
  };
  return reasons.map((reason) => labels[reason] || "추가 근거 필요").join(" · ") || "근거 확인 필요";
}

function asLocalDateTime(value: unknown) {
  if (typeof value !== "string") return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function RecommendationEvaluationForm({
  sport,
  recommendation,
  existing,
  onSaved,
}: {
  sport: Sport;
  recommendation: Recommendation;
  existing: RecommendationEvaluation | null;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [observedPrice, setObservedPrice] = useState(String(existing?.evaluation_input?.observedPrice ?? ""));
  const [quoteSourceUrl, setQuoteSourceUrl] = useState(String(existing?.evaluation_input?.quoteSourceUrl ?? ""));
  const [quoteObservedAt, setQuoteObservedAt] = useState(asLocalDateTime(existing?.evaluation_input?.quoteObservedAt));
  const savedContract = existing?.evaluation_input?.settlementContract as Record<string, unknown> | null | undefined;
  const [marketType, setMarketType] = useState<SettlementMarketType | "">((savedContract?.marketType as SettlementMarketType) || "");
  const [line, setLine] = useState(String(savedContract?.line ?? ""));
  const [direction, setDirection] = useState(String(savedContract?.direction ?? ""));
  const [periodConfirmed, setPeriodConfirmed] = useState(false);
  const [overtime, setOvertime] = useState(savedContract?.overtimeIncluded === true ? "included" : savedContract?.overtimeIncluded === false ? "excluded" : "");
  const [outcome, setOutcome] = useState(String(existing?.evaluation_input?.outcome ?? ""));
  const [outcomeSourceUrl, setOutcomeSourceUrl] = useState(String(existing?.evaluation_input?.outcomeSourceUrl ?? ""));
  const [outcomeCheckedAt, setOutcomeCheckedAt] = useState(asLocalDateTime(existing?.evaluation_input?.outcomeCheckedAt));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const requestKey = useRef<{ signature: string; key: string } | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !reviewed || !recommendation.id) return;
    const observed = observedPrice.trim() ? Number(observedPrice) : null;
    const contract = periodConfirmed && marketType && overtime
      ? {
          market: String(recommendation.market || ""),
          selection: String(recommendation.selection || ""),
          marketType,
          period: "full_game" as const,
          overtimeIncluded: overtime === "included",
          ...(marketType === "total" && direction ? { direction } : {}),
          ...(["spread", "total"].includes(marketType) ? { line: line.trim() ? Number(line) : null } : {}),
        }
      : null;
    const payload = {
      sportSlug: sport,
      recommendationId: recommendation.id,
      reviewed: true as const,
      ...(existing?.id ? { supersedesEvaluationId: existing.id } : {}),
      observedPrice: observed,
      quoteSourceUrl: quoteSourceUrl.trim() || null,
      quoteObservedAt: quoteObservedAt ? new Date(quoteObservedAt).toISOString() : null,
      settlementContract: contract,
      outcome,
      outcomeSourceUrl: outcomeSourceUrl.trim(),
      outcomeCheckedAt: outcomeCheckedAt ? new Date(outcomeCheckedAt).toISOString() : "",
    };
    if (!outcome || !payload.outcomeSourceUrl || !outcomeCheckedAt || !/^https:\/\//i.test(payload.outcomeSourceUrl)) {
      setError("결과, 결과 출처 URL, 확인 시각을 입력하세요.");
      return;
    }
    const signature = JSON.stringify(payload);
    if (requestKey.current?.signature !== signature) requestKey.current = { signature, key: crypto.randomUUID() };
    setBusy(true);
    setError("");
    try {
      await request("/api/records/recommendation-evaluations", {
        ...payload,
        idempotencyKey: requestKey.current.key,
      }, "POST");
      requestKey.current = null;
      setOpen(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="rail-action quiet evaluation-open" onClick={() => setOpen(true)}>
        {existing ? "검토 수정 기록" : "가격·결과 검토"}
      </button>
    );
  }

  return (
    <form className="evaluation-form" onSubmit={save}>
      <p className="evaluation-form-intro">
        추천 원문은 고정됩니다. 실제 베팅이 아니라 1U 가정 평가이며, 추천 가격 기준을 체결 가격으로 대신하지 않습니다.
      </p>
      {existing && <p className="evaluation-correction-note">새 버전으로 추가 저장됩니다. 이전 검토 기록은 보존됩니다.</p>}
      <div className="evaluation-frozen-pick">
        <b>{String(recommendation.selection || "선택 미확인")}</b>
        <small>{String(recommendation.market || "시장 미확인")} · BET</small>
      </div>
      <label>확인한 실제 시장 가격 (American odds, 선택 사항)
        <input type="number" step="1" value={observedPrice} onChange={(event) => setObservedPrice(event.target.value)} placeholder="비워 두면 미확인" />
      </label>
      <label>가격 출처 URL (확인한 경우)
        <input type="url" value={quoteSourceUrl} onChange={(event) => setQuoteSourceUrl(event.target.value)} placeholder="https://" />
      </label>
      <label>가격 확인 시각 (기기 시간대)
        <input type="datetime-local" value={quoteObservedAt} onChange={(event) => setQuoteObservedAt(event.target.value)} />
      </label>
      <label className="evaluation-check">
        <input type="checkbox" checked={periodConfirmed} onChange={(event) => setPeriodConfirmed(event.target.checked)} />
        전체 경기 정산 기준을 확인했습니다
      </label>
      <label>시장 유형
        <select value={marketType} onChange={(event) => setMarketType(event.target.value as SettlementMarketType | "")}>
          <option value="">정산 기준 미확인</option>
          <option value="moneyline">승패</option>
          <option value="spread">핸디캡</option>
          <option value="total">전체 득점</option>
        </select>
      </label>
      {marketType === "total" && (
        <label>방향
          <select value={direction} onChange={(event) => setDirection(event.target.value)}>
            <option value="">선택</option>
            <option value="over">오버</option>
            <option value="under">언더</option>
          </select>
        </label>
      )}
      {(marketType === "spread" || marketType === "total") && (
        <label>정산 라인 (원래 추천과 일치해야 채점)
          <input type="number" step="any" value={line} onChange={(event) => setLine(event.target.value)} />
        </label>
      )}
      {marketType && <label>연장전 포함 여부
        <select value={overtime} onChange={(event) => setOvertime(event.target.value)}>
          <option value="">선택</option>
          <option value="included">포함</option>
          <option value="excluded">미포함</option>
        </select>
      </label>}
      <label>공식 결과
        <select value={outcome} onChange={(event) => setOutcome(event.target.value)} required>
          <option value="">선택</option>
          <option value="won">적중</option>
          <option value="lost">미적중</option>
          <option value="push">푸시</option>
          <option value="void">무효</option>
        </select>
      </label>
      <label>결과 출처 URL
        <input type="url" value={outcomeSourceUrl} onChange={(event) => setOutcomeSourceUrl(event.target.value)} required placeholder="https://" />
      </label>
      <label>결과 확인 시각 (기기 시간대)
        <input type="datetime-local" value={outcomeCheckedAt} onChange={(event) => setOutcomeCheckedAt(event.target.value)} required />
      </label>
      <label className="evaluation-check">
        <input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />
        표시한 가격·정산 기준·결과 출처를 직접 검토했습니다
      </label>
      {error && <small role="alert" className="evaluation-error">{error}</small>}
      <div className="evaluation-form-actions">
        <button type="button" onClick={() => setOpen(false)}>취소</button>
        <button type="submit" disabled={busy || !reviewed || !outcome || !outcomeSourceUrl || !outcomeCheckedAt}>
          {busy ? "저장 중…" : existing ? "새 검토 버전 저장" : "검토 결과 저장"}
        </button>
      </div>
    </form>
  );
}

function Modal({
  title,
  kicker,
  close,
  children,
  footer,
}: {
  title: string;
  kicker: string;
  close: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div
      className="modal-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <div>
            <small>{kicker}</small>
            <h2>{title}</h2>
          </div>
          <button onClick={close} aria-label="닫기">
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-actions">{footer}</div>}
      </div>
    </div>
  );
}
function ImportModal({
  sport,
  close,
  done,
}: {
  sport: Sport;
  close: () => void;
  done: () => void;
}) {
  const [filename, setFilename] = useState(""),
    [content, setContent] = useState(""),
    [draft, setDraft] = useState<Draft | null>(null),
    [hash, setHash] = useState(""),
    [exists, setExists] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function preview() {
    setBusy(true);
    setError("");
    try {
      const value = await request<{
        hash: string;
        draft: Draft;
        alreadyImported: boolean;
      }>(
        "/api/import/preview",
        {
          sportSlug: sport,
          filename: filename || sport + "-import.md",
          content,
        },
        "POST",
      );
      setDraft(value.draft);
      setHash(value.hash);
      setExists(value.alreadyImported);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function commit() {
    setBusy(true);
    setError("");
    try {
      await request(
        "/api/import/commit",
        {
          sportSlug: sport,
          filename: filename || sport + "-import.md",
          content,
          draft,
        },
        "POST",
      );
      done();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  function edit(
    section: keyof Draft,
    index: number,
    field: string,
    value: string,
  ) {
    setDraft((old) => {
      if (!old) return old;
      const list = [...(old[section] as Record<string, unknown>[])];
      const parsed = ["stakeUnits", "executedPrice"].includes(field)
        ? value.trim() === ""
          ? null
          : Number(value)
        : value;
      list[index] = { ...list[index], [field]: parsed };
      return { ...old, [section]: list };
    });
  }
  function remove(section: keyof Draft, index: number) {
    setDraft((old) =>
      old
        ? {
            ...old,
            [section]: (old[section] as Record<string, unknown>[]).filter(
              (_, i) => i !== index,
            ),
          }
        : old,
    );
  }
  const sections: {
    key: "rules" | "events" | "recommendations" | "bets" | "mistakeNotes";
    title: string;
    fields: string[];
  }[] = [
    {
      key: "rules",
      title: "분석 기준과 유닛 규칙",
      fields: ["title", "content", "status"],
    },
    {
      key: "events",
      title: "진행 중인 경기",
      fields: ["label", "analysisStatus", "gameStatus", "notes"],
    },
    {
      key: "recommendations",
      title: "과거 추천",
      fields: ["market", "selection", "decision"],
    },
    {
      key: "bets",
      title: "가져온 실제 진입",
      fields: ["market", "selection", "executedPrice", "stakeUnits", "result"],
    },
    {
      key: "mistakeNotes",
      title: "오답노트",
      fields: ["title", "decisionAtTime", "outcome", "lesson"],
    },
  ];
  return (
    <Modal
      title="MD 기록 가져오기"
      kicker="ARCHIVE / INTAKE"
      close={close}
      footer={
        <>
          <button className="button-quiet" onClick={close}>
            취소
          </button>
          <button
            className="button-primary"
            disabled={busy || !content.trim()}
            onClick={() => void (draft ? commit() : preview())}
          >
            {busy ? "처리 중…" : draft ? "검토 내용 저장" : "추출 결과 확인"}{" "}
            <ArrowRight size={16} />
          </button>
        </>
      }
    >
      <p className="modal-intro">
        원문을 보관하고 추출 내용을 검토한 뒤 저장합니다. 가져온 사실은 최신 웹
        검증 정보로 표시되지 않습니다.
      </p>
      <label className="upload-zone">
        <UploadCloud size={23} />
        <b>{filename || "MD 파일 선택"}</b>
        <span>파일을 선택하거나 아래에 원문을 붙여넣으세요.</span>
        <input
          type="file"
          accept=".md,.markdown,text/markdown,text/plain"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) {
              setFilename(file.name);
              setContent(await file.text());
              setDraft(null);
            }
          }}
        />
      </label>
      <textarea
        className="raw-editor"
        aria-label="MD 원문"
        placeholder="MD 원문"
        value={content}
        onChange={(e) => {
          setContent(e.target.value);
          setDraft(null);
        }}
        rows={5}
      />
      {draft && (
        <div className="draft">
          <div className="draft-heading">
            <b>추출 결과 검토</b>
            <small>SHA {hash.slice(0, 12).toUpperCase()}</small>
          </div>
          {exists && (
            <div className="notice">
              <Check size={15} /> 동일 파일을 이미 가져왔습니다. 재저장해도 중복
              기록을 만들지 않습니다.
            </div>
          )}
          {draft.warnings?.map((warning, i) => (
            <div className="notice" key={i}>
              <CircleAlert size={15} />
              {warning}
            </div>
          ))}
          <section>
            <h3>장기 맥락 요약</h3>
            <textarea
              value={draft.summary || ""}
              onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
              rows={4}
            />
          </section>
          {sections.map((section) => (
            <section key={section.key}>
              <h3>
                {section.title} <span>{draft[section.key]?.length || 0}</span>
              </h3>
              {draft[section.key]?.map((entry, i) => (
                <div className="draft-card" key={i}>
                  <div>
                    <small>
                      #{String(i + 1).padStart(2, "0")} ·{" "}
                      {String(entry.sourceRef || "원문 참조")}
                    </small>
                    <button
                      onClick={() => remove(section.key, i)}
                      aria-label="항목 제외"
                    >
                      <X size={15} />
                    </button>
                  </div>
                  {section.fields.map((field) => (
                    <label key={field}>
                      <span>{field}</span>
                      {field === "status" ? (
                        <select
                          value={String(entry[field] ?? "proposed")}
                          onChange={(e) =>
                            edit(section.key, i, field, e.target.value)
                          }
                        >
                          <option value="adopted">채택</option>
                          <option value="proposed">제안</option>
                        </select>
                      ) : (
                        <input
                          type={
                            ["stakeUnits", "executedPrice"].includes(field)
                              ? "number"
                              : "text"
                          }
                          step={field === "stakeUnits" ? "any" : "1"}
                          value={String(entry[field] ?? "")}
                          onChange={(e) =>
                            edit(section.key, i, field, e.target.value)
                          }
                        />
                      )}
                    </label>
                  ))}
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
    </Modal>
  );
}
function BetModal({
  sport,
  events,
  initial,
  close,
  done,
}: {
  sport: Sport;
  events: Event[];
  initial: EntryReviewDraft | null;
  close: () => void;
  done: () => void;
}) {
  const prefill = initial?.prefill || null;
  const conditional = prefill?.mode === "conditional" ? prefill : null;
  const [eventId, setEventId] = useState(prefill?.eventId || ""),
    [market, setMarket] = useState(prefill?.market || ""),
    [selection, setSelection] = useState(prefill?.selection || ""),
    [price, setPrice] = useState(""),
    [stake, setStake] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const requestKey = useRef<{ signature: string; key: string } | null>(null);
  const formSport = initial?.sport || sport;
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (conditional && !confirmed) throw new Error("실제 진입 확인 체크 후 저장할 수 있습니다.");
      const payload = conditional
        ? conditionalEntryPayload(formSport, conditional.candidate, stake, price, "")
        : null;
      const signature = conditional
        ? conditionalEntrySignature(formSport, conditional.source, payload!.stakeUnits, payload!.executedPrice)
        : JSON.stringify([formSport, eventId, market, selection, price, stake]);
      const storageKey = "fieldnote:bet:" + signature;
      if (requestKey.current?.signature !== signature) {
        const key = sessionStorage.getItem(storageKey) || crypto.randomUUID();
        requestKey.current = { signature, key };
        sessionStorage.setItem(storageKey, key);
      }
      const conditionalPayload = conditional
        ? conditionalEntryPayload(formSport, conditional.candidate, stake, price, requestKey.current.key)
        : null;
      await request("/api/records/bets", conditionalPayload || {
        sportSlug: formSport,
        eventId,
        market,
        selection,
        ...(price ? { executedPrice: Number(price) } : {}),
        ...(stake ? { stakeUnits: Number(stake) } : {}),
        confirmed: true,
        idempotencyKey: requestKey.current.key,
        ...(prefill?.sourceMessageId ? { sourceMessageId: prefill.sourceMessageId } : {}),
        ...(prefill?.sourceRecommendationId ? { sourceRecommendationId: prefill.sourceRecommendationId } : {}),
      }, "POST");
      sessionStorage.removeItem(storageKey);
      requestKey.current = null;
      done();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="실제 진입 기록"
      kicker="TRANSACTION / CONFIRMED"
      close={close}
    >
      <form className="bet-form" onSubmit={save}>
        <p className="modal-intro">
          직접 진입한 베팅만 저장합니다. 추천 유닛과 전달된 가격은 실제 진입으로
          간주하지 않습니다.
        </p>
        {initial && (
          <p className="entry-review-notice" role="status">
          {initial.notice || "추천에서 초안을 불러왔습니다. 실제 진입 정보인지 확인하고, 직접 저장을 눌러야 기록됩니다."}
          </p>
        )}
        {conditional ? (
          <section className="conditional-entry-source" aria-label="조건부 원본 정보">
            <p><b>대상 경기</b><span>{conditional.candidate.match}</span></p>
            <p><b>시장 · 선택</b><span>{conditional.candidate.market} · {conditional.candidate.selection}</span></p>
            <p><b>예정 정보</b><span>{conditional.candidate.schedule.dateEt || "날짜 미확인"} · {conditional.candidate.schedule.label || conditional.candidate.schedule.precision}</span></p>
            <p><b>시작 시각</b><span>정확한 시작 시각 미확인</span></p>
            <p><b>원래 판단</b><span>{conditional.candidate.originalDecision} · 원문 당시 조건부 기록</span></p>
            <p><b>원문 가격 조건</b><span>{formatOddsDisplay(conditional.candidate.priceGate, conditional.candidate.market)} · 권장 {formatSuggestedUnits(conditional.candidate.suggestedUnits)}</span></p>
            <small>이 저장은 사용자의 수동 경기 등록과 실제 진입 기록입니다. 원래 GO 판단을 새 판단으로 바꾸지 않습니다.</small>
          </section>
        ) : <>
        <label>
          대상 경기 <span>필수</span>
          <select
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            required
          >
            <option value="">경기 선택</option>
            {events
              .filter((item) => item.id)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label || item.eventKey || item.event_key || item.id}
                </option>
              ))}
          </select>
        </label>
        {!events.some((item) => item.id) && (
          <div className="notice">
            <CircleAlert size={15} /> 기록된 경기가 없습니다. 먼저 경기를
            가져오거나 분석하세요.
          </div>
        )}
        </>}
        <label>
          시장 <span>필수</span>
          <input
            value={market}
            onChange={(e) => setMarket(e.target.value)}
            placeholder="예: Moneyline"
            required
            readOnly={!!conditional}
          />
        </label>
        <label>
          선택 <span>필수</span>
          <input
            value={selection}
            onChange={(e) => setSelection(e.target.value)}
            placeholder="예: NYY 승"
            required
            readOnly={!!conditional}
          />
        </label>
        <div className="form-grid">
          <label>
            실제 가격 <span>미확인 가능</span>
            <input
              type="number"
              step="1"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="예: -110"
            />
          </label>
          <label>
            실제 유닛 <span>미확인 가능</span>
            <input
              type="number"
              min="0"
              step="any"
              value={stake}
              onChange={(e) => setStake(e.target.value)}
              placeholder="미확인"
            />
          </label>
        </div>
        {conditional && (
          <label className="conditional-entry-confirm">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>이 경기와 선택에 실제로 진입했음을 확인합니다.</span>
          </label>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="button-quiet" onClick={close}>
            취소
          </button>
          <button
            type="submit"
            className="button-primary"
            disabled={busy || (conditional ? !confirmed : !eventId)}
          >
            {busy ? "저장 중…" : "실제 진입 확인 및 저장"} <Check size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}

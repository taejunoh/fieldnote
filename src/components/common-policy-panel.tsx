import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { CommonPolicyInput, CommonPolicyResponse, CommonPolicyVersion } from "../lib/common-policy";

type Draft = Pick<CommonPolicyInput, "title" | "versionDate" | "content">;
type PanelStatus = "loading" | "ready" | "error";
type SaveError = "conflict" | "error" | null;
type Fetcher = typeof fetch;

export class CommonPolicyConflictError extends Error {
  constructor() {
    super("Common policy changed. Reload before saving.");
    this.name = "CommonPolicyConflictError";
  }
}

async function readResponse(response: Response): Promise<CommonPolicyResponse> {
  if (!response.ok) {
    if (response.status === 409) throw new CommonPolicyConflictError();
    throw new Error("공통 기준을 저장하지 못했습니다. 다시 시도해 주세요.");
  }
  return response.json() as Promise<CommonPolicyResponse>;
}

export async function saveCommonPolicy(input: CommonPolicyInput, fetcher: Fetcher = fetch) {
  const response = await fetcher("/api/common-policy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return readResponse(response);
}

async function loadCommonPolicy(fetcher: Fetcher = fetch, signal?: AbortSignal) {
  const response = await fetcher("/api/common-policy", { signal });
  return readResponse(response);
}

function blankDraft(): Draft {
  return { title: "", versionDate: "", content: "" };
}

function shortHash(hash: string) {
  return hash.slice(0, 12);
}

type ViewProps = {
  status: PanelStatus;
  current: CommonPolicyVersion | null;
  history: CommonPolicyVersion[];
  draft: Draft;
  saving: boolean;
  saveError: SaveError;
  onDraftChange: (field: keyof Draft, value: string) => void;
  onSave: () => void;
  onReload: () => void;
  onRetry?: () => void;
};

export function CommonPolicyPanelView({
  status,
  current,
  history,
  draft,
  saving,
  saveError,
  onDraftChange,
  onSave,
  onReload,
  onRetry,
}: ViewProps) {
  const latest = history[0] ?? current;
  const isMissing = current === null;
  const isValid = Boolean(draft.title.trim() && draft.versionDate && draft.content.trim());
  const updateDraft = (field: keyof Draft) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    onDraftChange(field, event.currentTarget.value);
  };

  return (
    <section className="rail-section common-policy-panel" aria-labelledby="common-policy-title">
      <div className="section-head">
        <strong id="common-policy-title">공통 운영 기준 · 모든 종목</strong>
        <span>GLOBAL</span>
      </div>
      <p className="common-policy-scope">모든 종목에 한 번만 적용합니다. 공통 기준이 종목별 기존 규칙보다 우선하며, 종목별 분석 보충 기준과 실제 기록은 유지합니다. 추천은 실제 진입이 아닙니다.</p>

      {status === "loading" && <p className="muted" role="status">공통 기준을 불러오는 중입니다…</p>}
      {status === "error" && (
        <div className="common-policy-error" role="alert">
          <p>공통 기준을 불러오지 못했습니다. 작성 중인 초안은 유지됩니다.</p>
          {onRetry && <button type="button" className="rail-action" onClick={onRetry}>다시 불러오기</button>}
        </div>
      )}

      {status !== "loading" && (
        <>
          {isMissing ? (
            <p className="muted common-policy-missing">아직 등록된 공통 기준이 없습니다. 내용을 입력한 뒤 최초 버전을 등록해 주세요.</p>
          ) : current && (
            <div className="common-policy-current">
              <div className="common-policy-meta">
                <b>현재 적용 중 · {current.version_date} · rev {current.id.slice(0, 8)}</b>
                <small>{current.title} · {history.length}개 버전 · SHA-256 {shortHash(current.content_hash)}…</small>
              </div>
              <b className="common-policy-raw-label">현재 기준 원문</b>
              <pre className="common-policy-raw">{current.content}</pre>
            </div>
          )}

          <div className="common-policy-editor">
            <label>
              버전 제목
              <input value={draft.title} onChange={updateDraft("title")} maxLength={200} disabled={saving} />
            </label>
            <label>
              기준 날짜
              <input type="date" value={draft.versionDate} onChange={updateDraft("versionDate")} disabled={saving} />
            </label>
            <label>
              공통 기준 원문
              <textarea value={draft.content} onChange={updateDraft("content")} rows={9} disabled={saving} />
            </label>
            {saveError === "conflict" && (
              <div className="common-policy-conflict" role="alert">
                <p>최신 공통 기준이 먼저 저장되었습니다. 다시 불러온 뒤 초안을 검토하고 저장하세요.</p>
                <button type="button" className="rail-action" onClick={onReload}>최신 기준 불러오기 · 초안 유지</button>
              </div>
            )}
            {saveError === "error" && (
              <div className="common-policy-error" role="alert">
                <p>저장 결과를 확인하지 못했습니다. 최신 기준을 불러와 확인해 주세요. 초안은 유지됩니다.</p>
                <button type="button" className="rail-action" onClick={onReload}>최신 기준 확인 · 초안 유지</button>
              </div>
            )}
            <button type="button" className="rail-action common-policy-save" onClick={onSave} disabled={!isValid || saving || status !== "ready" || saveError !== null}>
              {saving ? "저장 중…" : isMissing ? "최초 버전 등록" : "새 버전으로 저장"}
            </button>
          </div>

          {latest && history.length > 1 && (
            <details className="common-policy-history">
              <summary>이전 버전 원문 · {history.length - 1}</summary>
              {history.filter((version) => version.id !== current?.id).map((version) => (
                <article className="common-policy-version" key={version.id}>
                  <div className="common-policy-meta">
                    <b>{version.version_date} · {version.title}</b>
                    <small>SHA-256 {shortHash(version.content_hash)}…</small>
                  </div>
                  <pre className="common-policy-raw">{version.content}</pre>
                </article>
              ))}
            </details>
          )}
        </>
      )}
    </section>
  );
}

export function CommonPolicyPanel() {
  const [status, setStatus] = useState<PanelStatus>("loading");
  const [current, setCurrent] = useState<CommonPolicyVersion | null>(null);
  const [history, setHistory] = useState<CommonPolicyVersion[]>([]);
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [expectedVersionId, setExpectedVersionId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<SaveError>(null);
  const [preserveDraftOnRetry, setPreserveDraftOnRetry] = useState(false);
  const activeLoad = useRef<AbortController | null>(null);

  const refresh = useCallback(async (preserveDraft: boolean) => {
    activeLoad.current?.abort();
    const controller = new AbortController();
    activeLoad.current = controller;
    setPreserveDraftOnRetry(preserveDraft);
    setStatus("loading");
    try {
      const result = await loadCommonPolicy(fetch, controller.signal);
      if (controller.signal.aborted) return;
      setCurrent(result.current);
      setHistory(result.history);
      setExpectedVersionId(result.current?.id ?? null);
      if (!preserveDraft) {
        setDraft(result.current
          ? { title: result.current.title, versionDate: result.current.version_date, content: result.current.content }
          : blankDraft());
      }
      setSaveError(null);
      setPreserveDraftOnRetry(false);
      setStatus("ready");
    } catch {
      if (controller.signal.aborted) return;
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    activeLoad.current = controller;
    void loadCommonPolicy(fetch, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setCurrent(result.current);
      setHistory(result.history);
      setExpectedVersionId(result.current?.id ?? null);
      setDraft(result.current
        ? { title: result.current.title, versionDate: result.current.version_date, content: result.current.content }
        : blankDraft());
      setPreserveDraftOnRetry(false);
      setStatus("ready");
    }).catch(() => {
      if (!controller.signal.aborted) setStatus("error");
    });
    return () => {
      activeLoad.current?.abort();
    };
  }, []);

  const changeDraft = (field: keyof Draft, value: string) => {
    setDraft((old) => ({ ...old, [field]: value }));
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const result = await saveCommonPolicy({ ...draft, expectedVersionId });
      setCurrent(result.current);
      setHistory(result.history);
      setExpectedVersionId(result.current?.id ?? null);
      setDraft(result.current
        ? { title: result.current.title, versionDate: result.current.version_date, content: result.current.content }
        : blankDraft());
    } catch (error) {
      setSaveError(error instanceof CommonPolicyConflictError ? "conflict" : "error");
    } finally {
      setSaving(false);
    }
  };

  return <CommonPolicyPanelView
    status={status}
    current={current}
    history={history}
    draft={draft}
    saving={saving}
    saveError={saveError}
    onDraftChange={changeDraft}
    onSave={() => void save()}
    onReload={() => void refresh(true)}
    onRetry={() => void refresh(preserveDraftOnRetry)}
  />;
}

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CommonPolicyVersion } from "../lib/common-policy";
import { CommonPolicyPanelView, saveCommonPolicy } from "./common-policy-panel";

const latest: CommonPolicyVersion = {
  id: "11111111-1111-4111-8111-111111111111",
  owner_id: "22222222-2222-4222-8222-222222222222",
  title: "2026 시즌 공통 기준",
  version_date: "2026-10-06",
  content: "첫 문단\n\n  들여쓰기와 공백을 보존합니다.\n",
  content_hash: "a".repeat(64),
  status: "adopted",
  supersedes_id: null,
  created_at: "2026-10-06T12:00:00.000Z",
};
const older: CommonPolicyVersion = {
  ...latest,
  id: "33333333-3333-4333-8333-333333333333",
  title: "이전 기준",
  version_date: "2026-09-01",
  content: "이전 버전 원문",
  content_hash: "b".repeat(64),
  status: "superseded",
  created_at: "2026-09-01T12:00:00.000Z",
};

describe("CommonPolicyPanel", () => {
  it("shows a distinct loading state instead of implying an unconfirmed policy is current", () => {
    const html = renderToStaticMarkup(createElement(CommonPolicyPanelView, {
      status: "loading",
      current: null,
      history: [],
      draft: { title: "", versionDate: "", content: "" },
      saving: false,
      saveError: null,
      onDraftChange: () => undefined,
      onSave: () => undefined,
      onReload: () => undefined,
    }));

    expect(html).toContain("공통 기준을 불러오는 중입니다");
    expect(html).not.toContain("아직 등록된 공통 기준이 없습니다");
    expect(html).not.toContain("현재 적용 중");
  });

  it("renders the global adopted revision and complete readable history with scope guidance", () => {
    const html = renderToStaticMarkup(createElement(CommonPolicyPanelView, {
      status: "ready",
      current: latest,
      history: [latest, older],
      draft: { title: latest.title, versionDate: latest.version_date, content: latest.content },
      saving: false,
      saveError: null,
      onDraftChange: () => undefined,
      onSave: () => undefined,
      onReload: () => undefined,
    }));

    expect(html).toContain("공통 운영 기준 · 모든 종목");
    expect(html).toContain("모든 종목에 한 번만 적용");
    expect(html).toContain("현재 기준 원문");
    expect(html).toContain("2026-10-06");
    expect(html).toContain("a".repeat(12));
    expect(html).toContain("이전 버전 원문");
    expect(html).toContain("공통 기준이 종목별 기존 규칙보다 우선");
    expect(html).toContain("종목별 분석 보충 기준과 실제 기록은 유지");
    expect(html).toContain("추천은 실제 진입이 아닙니다");
  });

  it("sends an update against the exact revision and returns the adopted server response", async () => {
    const updated = { ...latest, title: "새 제목", content: "  보존할 원문\n\n" };
    let capturedInit: RequestInit | undefined;
    const fetcher: typeof fetch = async (input, init) => {
      expect(String(input)).toBe("/api/common-policy");
      capturedInit = init;
      return Response.json({ current: updated, history: [updated, older] });
    };
    const result = await saveCommonPolicy({
      title: "새 제목",
      versionDate: "2026-10-06",
      content: "  보존할 원문\n\n",
      expectedVersionId: latest.id,
    }, fetcher);

    expect(capturedInit?.method).toBe("POST");
    expect(JSON.parse(String(capturedInit?.body))).toEqual({
      title: "새 제목",
      versionDate: "2026-10-06",
      content: "  보존할 원문\n\n",
      expectedVersionId: latest.id,
    });
    expect(result.current?.content).toBe("  보존할 원문\n\n");
  });

  it("distinguishes stale edits so the panel can preserve the draft and request a reload", async () => {
    const fetcher: typeof fetch = async () => Response.json({ error: "Common policy changed. Reload before saving." }, { status: 409 });

    await expect(saveCommonPolicy({
      title: "사용자 초안",
      versionDate: "2026-10-06",
      content: "작성 중인 본문",
      expectedVersionId: latest.id,
    }, fetcher)).rejects.toMatchObject({ name: "CommonPolicyConflictError" });

    const html = renderToStaticMarkup(createElement(CommonPolicyPanelView, {
      status: "ready",
      current: latest,
      history: [latest],
      draft: { title: "사용자 초안", versionDate: "2026-10-06", content: "작성 중인 본문" },
      saving: false,
      saveError: "conflict",
      onDraftChange: () => undefined,
      onSave: () => undefined,
      onReload: () => undefined,
    }));
    expect(html).toContain("최신 공통 기준이 먼저 저장되었습니다");
    expect(html).toContain("최신 기준 불러오기 · 초안 유지");
    expect(html).toContain("사용자 초안");
    expect(html).toContain("작성 중인 본문");
  });

  it("renders missing policy as explicit registration rather than inventing content", () => {
    const html = renderToStaticMarkup(createElement(CommonPolicyPanelView, {
      status: "ready",
      current: null,
      history: [],
      draft: { title: "", versionDate: "", content: "" },
      saving: false,
      saveError: null,
      onDraftChange: () => undefined,
      onSave: () => undefined,
      onReload: () => undefined,
    }));

    expect(html).toContain("아직 등록된 공통 기준이 없습니다");
    expect(html).toContain("최초 버전 등록");
    expect(html).toContain("value=\"\"");
  });

  it("locks the submitted draft while saving and reports an uncertain write without claiming adoption", () => {
    const html = renderToStaticMarkup(createElement(CommonPolicyPanelView, {
      status: "ready",
      current: latest,
      history: [latest],
      draft: { title: "저장 중", versionDate: "2026-10-06", content: "제출한 원문" },
      saving: true,
      saveError: "error",
      onDraftChange: () => undefined,
      onSave: () => undefined,
      onReload: () => undefined,
    }));

    expect(html).toContain("disabled=\"\"");
    expect(html).toContain("저장 결과를 확인하지 못했습니다");
    expect(html).toContain("최신 기준 확인 · 초안 유지");
    expect(html).not.toContain("현재 적용 기준은 바뀌지 않았습니다");
  });
});

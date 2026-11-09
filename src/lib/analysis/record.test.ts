import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { extractAnalysisRecord } from "./record";

const source = { title: "League", url: "https://example.com/game" };
const valid = {
  version: 1, sport: "mlb",
  events: [{ event_key: "mlb:2026-09-25:bos@nyy:id-123456", label: "Boston at New York", starts_at: null, source_url: source.url, analysis_status: "WAIT" }],
  recommendations: [{ item_key: "main", event_key: "mlb:2026-09-25:bos@nyy:id-123456", market: "Moneyline", selection: "Boston", decision: "WAIT", suggested_units: null, price_gate: null }],
};
const wrap = (value: unknown) => `본문 분석\n\n\`\`\`analysis-record\n${JSON.stringify(value)}\n\`\`\``;
const wrapCited = (value: unknown, url: string) => `본문 분석: [공식 출처](${url})\n\n\`\`\`analysis-record\n${JSON.stringify(value)}\n\`\`\``;

describe("structured analysis extraction", () => {
  it("extracts a bounded, sourced record and preserves the answer", () => {
    expect(extractAnalysisRecord(wrap(valid), "mlb", [source])).toEqual({
      answer: "본문 분석", status: "complete", record: valid,
    });
  });

  it("derives a stable key from a cited official source when the game ID is unknown", () => {
    const official = { title: "WNBA", url: "https://www.wnba.com/playoffs/2026/matchups" };
    const proposed = "wnba:2026-09-25:atl@lv:src";
    const derived = `wnba:2026-09-25:atl@lv:src-${createHash("sha256").update(official.url).digest("hex").slice(0, 32)}`;
    const record = {
      version: 1, sport: "wnba",
      events: [{ event_key: proposed, label: "Atlanta at Las Vegas", starts_at: null, source_url: official.url, analysis_status: "WATCH" }],
      recommendations: [{ item_key: "main", event_key: proposed, market: "Spread", selection: "Atlanta", decision: "PASS", suggested_units: 0, price_gate: null }],
    };
    const extracted = extractAnalysisRecord(wrapCited(record, official.url), "wnba", [official]);
    expect(extracted.record?.events[0].event_key).toBe(derived);
    expect(extracted.record?.recommendations[0]).toMatchObject({ event_key: derived, decision: "PASS", suggested_units: 0 });
    const replay = { ...record, events: [{ ...record.events[0], event_key: derived }], recommendations: [{ ...record.recommendations[0], event_key: derived }] };
    expect(extractAnalysisRecord(wrapCited(replay, official.url), "wnba", [official]).record?.events[0].event_key).toBe(derived);
  });

  it("hashes and persists the cited gateway URL after canonicalizing host and default port", () => {
    const canonical = "https://www.wnba.com/playoffs/2026/matchups";
    const cited = "https://WWW.WNBA.COM:443/playoffs/2026/matchups";
    const proposed = "wnba:2026-09-25:atl@lv:src";
    const derived = `${proposed}-${createHash("sha256").update(canonical).digest("hex").slice(0, 32)}`;
    const record = { version: 1, sport: "wnba", events: [{ event_key: proposed, label: "Atlanta at Las Vegas", starts_at: null, source_url: cited, analysis_status: "WATCH" }], recommendations: [] };
    expect(extractAnalysisRecord(wrapCited(record, cited), "wnba", [{ title: "WNBA", url: canonical }]).record?.events[0])
      .toMatchObject({ event_key: derived, source_url: canonical });
    const rawHash = `${proposed}-${createHash("sha256").update(cited).digest("hex").slice(0, 32)}`;
    expect(extractAnalysisRecord(wrapCited({ ...record, events: [{ ...record.events[0], event_key: rawHash }] }, cited), "wnba", [{ title: "WNBA", url: canonical }]))
      .toMatchObject({ failure: { code: "source_key_mismatch" } });
    expect(extractAnalysisRecord(wrapCited(record, cited), "wnba", [{ title: "WNBA", url: "https://www.wnba.com/playoffs/2026/other" }]))
      .toMatchObject({ failure: { code: "unverified_source" } });
    expect(extractAnalysisRecord(wrap(record), "wnba", [{ title: "WNBA", url: canonical }]))
      .toMatchObject({ failure: { code: "uncited_source" } });
  });

  it("rejects a missing citation, unofficial URL, and model supplied mismatched hash", () => {
    const official = { title: "WNBA", url: "https://www.wnba.com/playoffs/2026/matchups" };
    const event = { event_key: "wnba:2026-09-25:atl@lv:src", label: "Atlanta at Las Vegas", starts_at: null, source_url: official.url, analysis_status: "WATCH" };
    const record = { version: 1, sport: "wnba", events: [event], recommendations: [] };
    expect(extractAnalysisRecord(wrap(record), "wnba", [official])).toMatchObject({ failure: { code: "uncited_source" } });
    const unofficial = { title: "News", url: "https://wnba.com.evil.example/game" };
    expect(extractAnalysisRecord(wrapCited({ ...record, events: [{ ...event, source_url: unofficial.url }] }, unofficial.url), "wnba", [unofficial]))
      .toMatchObject({ failure: { code: "unofficial_source" } });
    expect(extractAnalysisRecord(wrapCited({ ...record, events: [{ ...event, event_key: "wnba:2026-09-25:atl@lv:src-00000000000000000000000000000000" }] }, official.url), "wnba", [official]))
      .toMatchObject({ failure: { code: "source_key_mismatch" } });
    expect(extractAnalysisRecord(wrapCited(record, official.url), "wnba", [{ title: "Other", url: "https://www.wnba.com/other" }]))
      .toMatchObject({ failure: { code: "unverified_source" } });
  });

  it.each([
    ["nhl", "https://frontend.d3.nhle.com/api/v1/gamecenter/fixture/landing", "bos@nyr"],
    ["tennis", "https://wtafiles.wtatennis.com/pdf/draws/2026/fixture.pdf", "gauff@swIATEK"],
    ["cfb", "https://dsuhornets.com/sports/football/schedule", "du@army"],
  ])("accepts the exact official %s event-source host and preserves its URL hash", (sport, url, matchup) => {
    const [away, home] = matchup.toLowerCase().split("@");
    const official = { title: "Official source", url };
    const proposed = `${sport}:2026-10-20:${away}@${home}:src`;
    const derived = `${proposed}-${createHash("sha256").update(url).digest("hex").slice(0, 32)}`;
    const record = {
      version: 1, sport,
      events: [{ event_key: proposed, label: "Fixture matchup", starts_at: null, source_url: url, analysis_status: "WAIT" }],
      recommendations: [{ item_key: "main", event_key: proposed, market: "Moneyline", selection: away, decision: "WAIT", suggested_units: null, price_gate: null }],
    };

    const extracted = extractAnalysisRecord(wrapCited(record, url), sport, [official]);
    expect(extracted).toMatchObject({ status: "complete" });
    expect(extracted.record?.events[0]).toMatchObject({ event_key: derived, source_url: url });
    expect(extracted.record?.recommendations[0]).toMatchObject({ event_key: derived, decision: "WAIT", suggested_units: null });
  });

  it("accepts NBA.com only for NBA records and keeps WNBA on its own host", () => {
    const nbaUrl = "https://www.nba.com/schedule?date=2026-10-27";
    const nbaKey = "nba:2026-10-27:bos@nyk:src";
    const nbaRecord = {
      version: 1,
      sport: "nba",
      events: [{ event_key: nbaKey, label: "Boston at New York", starts_at: null, source_url: nbaUrl, analysis_status: "WAIT" }],
      recommendations: [],
    };
    expect(extractAnalysisRecord(wrapCited(nbaRecord, nbaUrl), "nba", [{ title: "NBA Schedule", url: nbaUrl }]).status).toBe("complete");

    const wnbaUrl = "https://www.wnba.com/schedule";
    const crossSport = { ...nbaRecord, events: [{ ...nbaRecord.events[0], source_url: wnbaUrl }] };
    expect(extractAnalysisRecord(wrapCited(crossSport, wnbaUrl), "nba", [{ title: "WNBA Schedule", url: wnbaUrl }]))
      .toMatchObject({ status: "incomplete", failure: { code: "unofficial_source" } });
  });

  it("accepts the exact NBA injury-report host without allowing arbitrary subdomains", () => {
    const url = "https://ak-static.cms.nba.com/referee/injury/fixture.pdf";
    const proposed = "nba:2026-10-27:bos@nyk:src";
    const record = {
      version: 1,
      sport: "nba",
      events: [{ event_key: proposed, label: "Boston at New York", starts_at: null, source_url: url, analysis_status: "WAIT" }],
      recommendations: [],
    };
    expect(extractAnalysisRecord(wrapCited(record, url), "nba", [{ title: "NBA Injury Report", url }]).status).toBe("complete");

    const unsafe = "https://sub.ak-static.cms.nba.com/referee/injury/fixture.pdf";
    expect(extractAnalysisRecord(wrapCited({ ...record, events: [{ ...record.events[0], source_url: unsafe }] }, unsafe), "nba", [{ title: "Unlisted host", url: unsafe }]))
      .toMatchObject({ status: "incomplete", failure: { code: "unofficial_source" } });
  });

  it.each([
    "dsuhornets.com", "virginiasports.com", "uconnhuskies.com", "pennathletics.com",
    "tulsahurricane.com", "goairforcefalcons.com", "gostanford.com",
  ].flatMap((host) => [host, `www.${host}`]))("accepts the searched, cited CFB official host %s and preserves URL/key", (host) => {
    const url = `https://${host}/sports/football/schedule`;
    const official = { title: "Official school athletics", url };
    const proposed = "cfb:2026-10-23:du@army:src";
    const derived = `${proposed}-${createHash("sha256").update(url).digest("hex").slice(0, 32)}`;
    const record = {
      version: 1, sport: "cfb",
      events: [{ event_key: proposed, label: "Duke at Army", starts_at: null, source_url: url, analysis_status: "WAIT" }],
      recommendations: [{ item_key: "main", event_key: proposed, market: "Moneyline", selection: "Duke", decision: "WAIT", suggested_units: null, price_gate: null }],
    };

    const extracted = extractAnalysisRecord(wrapCited(record, url), "cfb", [official]);
    expect(extracted).toMatchObject({ status: "complete" });
    expect(extracted.record?.events[0]).toMatchObject({ event_key: derived, source_url: url });
    expect(extracted.record?.recommendations[0].event_key).toBe(derived);
  });

  it.each([
    "http://www.dsuhornets.com/sports/football/schedule",
    "https://user@www.dsuhornets.com/sports/football/schedule",
    "https://www.dsuhornets.com:444/sports/football/schedule",
    "https://sub.dsuhornets.com/sports/football/schedule",
    "https://dsuhornets.com.evil.example/sports/football/schedule",
  ])("rejects unsafe or unregistered CFB URL %s", (url) => {
    const record = {
      version: 1, sport: "cfb",
      events: [{ event_key: "cfb:2026-10-23:du@army:src", label: "Duke at Army", starts_at: null, source_url: url, analysis_status: "WAIT" }],
      recommendations: [],
    };
    expect(extractAnalysisRecord(wrapCited(record, url), "cfb", [{ title: "Search result", url }]))
      .toMatchObject({ status: "incomplete", record: null, failure: { code: "unofficial_source" } });
  });

  it("keeps CFB school URLs searched and cited and admits valid rows around a source-only failure", () => {
    const officialUrl = "https://www.virginiasports.com/sports/football/schedule";
    const unsearched = { ...valid.events[0], event_key: "cfb:2026-10-23:uva@unc:src", source_url: officialUrl };
    const unsearchedRecord = { version: 1, sport: "cfb", events: [unsearched], recommendations: [] };
    expect(extractAnalysisRecord(wrapCited(unsearchedRecord, officialUrl), "cfb", []))
      .toMatchObject({ record: null, failure: { code: "unverified_source" } });
    expect(extractAnalysisRecord(wrap(unsearchedRecord), "cfb", [{ title: "Official", url: officialUrl }]))
      .toMatchObject({ record: null, failure: { code: "uncited_source" } });

    const searched = { title: "Official", url: officialUrl };
    const second = { ...unsearched, event_key: "cfb:2026-10-23:uconn@penn:src", source_url: "https://sub.uconnhuskies.com/football" };
    const mixed = { version: 1, sport: "cfb", events: [unsearched, second], recommendations: [] };
    expect(extractAnalysisRecord(wrapCited(mixed, `${officialUrl} ${second.source_url}`), "cfb", [searched, { title: "Search", url: second.source_url }]))
      .toMatchObject({
        status: "partial",
        record: { events: [expect.objectContaining({ source_url: officialUrl })], recommendations: [] },
        record_admission: {
          input_event_count: 2,
          input_recommendation_count: 0,
          accepted_event_keys: [expect.stringMatching(/^cfb:2026-10-23:uva@unc:src-[a-f0-9]{32}$/)],
          accepted_recommendation_item_keys: [],
          rejected_events: [{ index: 1, event_key: second.event_key, code: "unofficial_source", path: "events.1.source_url" }],
          rejected_recommendations: [],
        },
      });
  });

  it("admits only events with valid official provenance and marks their linked recommendations as dependent rejections", () => {
    const officialUrl = "https://www.mlb.com/game/123";
    const unofficialUrl = "https://mlb.com.evil.example/game/456";
    const firstKey = "mlb:2026-09-25:bos@nyy:src";
    const secondKey = "mlb:2026-09-25:aaa@bbb:src";
    const record = {
      version: 1,
      sport: "mlb",
      events: [
        { event_key: firstKey, label: "Boston at New York", starts_at: "2026-09-27T17:00:00-04:00", source_url: officialUrl, analysis_status: "WAIT" },
        { event_key: secondKey, label: "Away at Home", starts_at: "2026-09-27T18:00:00-04:00", source_url: unofficialUrl, analysis_status: "WAIT" },
      ],
      recommendations: [
        { item_key: "main", event_key: firstKey, market: "Moneyline", selection: "Boston", decision: "WAIT", suggested_units: null, price_gate: null },
        { item_key: "total", event_key: secondKey, market: "Total", selection: "Under", decision: "WAIT", suggested_units: null, price_gate: null },
      ],
    };
    const raw = wrapCited(record, `${officialUrl} ${unofficialUrl}`);
    const extracted = extractAnalysisRecord(raw, "mlb", [{ title: "MLB", url: officialUrl }, { title: "Search result", url: unofficialUrl }], new Date("2026-09-25T12:00:00Z"));

    const acceptedKey = `${firstKey}-${createHash("sha256").update(officialUrl).digest("hex").slice(0, 32)}`;
    expect(extracted).toMatchObject({
      status: "partial",
      answer: `본문 분석: [공식 출처](${officialUrl} ${unofficialUrl})`,
      record: {
        events: [{ event_key: acceptedKey, source_url: officialUrl }],
        recommendations: [{ item_key: "main", event_key: acceptedKey }],
      },
      record_admission: {
        version: 1,
        raw_sha256: createHash("sha256").update(raw).digest("hex"),
        input_event_count: 2,
        input_recommendation_count: 2,
        accepted_event_keys: [acceptedKey],
        accepted_recommendation_item_keys: ["main"],
        rejected_events: [{ index: 1, event_key: secondKey, code: "unofficial_source", path: "events.1.source_url" }],
        rejected_recommendations: [{ index: 1, item_key: "total", event_key: secondKey, code: "rejected_event_dependency", path: "recommendations.1.event_key" }],
      },
    });
  });

  it("keeps semantic and source-key validation fatal before source admission", () => {
    const officialUrl = "https://www.mlb.com/game/123";
    const unavailableUrl = "https://mlb.com.evil.example/game/456";
    const unavailableKey = "mlb:2026-09-25:aaa@bbb:src";
    const record = {
      version: 1,
      sport: "mlb",
      events: [{ event_key: unavailableKey, label: "Away at Home", starts_at: null, source_url: unavailableUrl, analysis_status: "WAIT" }],
      recommendations: [{ item_key: "main", event_key: unavailableKey, market: "Moneyline", selection: "Away", decision: "BET", suggested_units: 0.5, price_gate: null }],
    };
    expect(extractAnalysisRecord(wrapCited(record, unavailableUrl), "mlb", [{ title: "Search result", url: unavailableUrl }], new Date("2026-09-25T12:00:00Z")))
      .toMatchObject({ status: "incomplete", record: null, failure: { code: "invalid_bet_timing", path: "recommendations.0.decision" } });

    const mismatched = {
      ...record,
      events: [{ ...record.events[0], event_key: "mlb:2026-09-25:aaa@bbb:src-00000000000000000000000000000000", source_url: officialUrl }],
      recommendations: [],
    };
    expect(extractAnalysisRecord(wrapCited(mismatched, officialUrl), "mlb", [], new Date("2026-09-25T12:00:00Z")))
      .toMatchObject({ status: "incomplete", record: null, failure: { code: "source_key_mismatch", path: "events.0.event_key" } });
  });

  it("does not report a zero-event source-only subset as successful extraction", () => {
    const url = "https://mlb.com.evil.example/game/456";
    const record = {
      version: 1,
      sport: "mlb",
      events: [{ event_key: "mlb:2026-09-25:aaa@bbb:src", label: "Away at Home", starts_at: null, source_url: url, analysis_status: "WAIT" }],
      recommendations: [],
    };
    expect(extractAnalysisRecord(wrapCited(record, url), "mlb", [{ title: "Search result", url }], new Date("2026-09-25T12:00:00Z")))
      .toMatchObject({ status: "incomplete", record: null, failure: { code: "unofficial_source", path: "events.0.source_url" }, record_admission: { accepted_event_keys: [], rejected_events: [{ code: "unofficial_source" }] } });
  });

  it.each([
    ["soccer", "https://federacaopr.com.br/campeonato/profissional/2026/fixture/"],
    ["soccer", "https://www.atletico.com.br/partidas/fixture/"],
    ["nfl", "https://www.philadelphiaeagles.com/schedule/2026/"],
    ["tennis", "https://www.toray-ppo.com/result/fixture.pdf"],
  ])("accepts a searched and cited observed official %s host %s", (sport, url) => {
    const proposed = `${sport}:2026-10-20:away@home:src`;
    const record = {
      version: 1, sport,
      events: [{ event_key: proposed, label: "Fixture matchup", starts_at: null, source_url: url, analysis_status: "WAIT" }],
      recommendations: [],
    };

    expect(extractAnalysisRecord(wrapCited(record, url), sport, [{ title: "Official source", url }]))
      .toMatchObject({ status: "complete", record: { events: [{ source_url: url }] } });
  });

  it("accepts the exact FIFA-listed CBF website for soccer source admission", () => {
    const url = "https://www.cbf.com.br/football/fixtures/test-match";
    const proposed = "soccer:2026-10-29:athletico-pr@gremio:src";
    const record = {
      version: 1, sport: "soccer",
      events: [{ event_key: proposed, label: "Athletico Paranaense at Grêmio", starts_at: null, source_url: url, analysis_status: "WAIT" }],
      recommendations: [],
    };

    expect(extractAnalysisRecord(wrapCited(record, url), "soccer", [{ title: "CBF", url }]))
      .toMatchObject({ status: "complete", record: { events: [{ source_url: url }] } });
  });

  it.each([
    ["soccer", "https://cbf.com.br/futebol-brasileiro/jogos/fixture"],
    ["soccer", "https://sub.www.cbf.com.br/futebol-brasileiro/jogos/fixture"],
    ["soccer", "https://www.cbf.com.br.evil.example/futebol-brasileiro/jogos/fixture"],
    ["soccer", "https://www.cbf.com.br@evil.example/futebol-brasileiro/jogos/fixture"],
    ["soccer", "https://www.cbf.com.br:444/futebol-brasileiro/jogos/fixture"],
    ["soccer", "http://www.cbf.com.br/futebol-brasileiro/jogos/fixture"],
    ["mlb", "https://www.cbf.com.br/futebol-brasileiro/jogos/fixture"],
  ])("rejects non-exact, unsafe, or cross-sport CBF host %s %s", (sport, url) => {
    const proposed = `${sport}:2026-10-29:away@home:src`;
    const record = {
      version: 1, sport,
      events: [{ event_key: proposed, label: "Fixture matchup", starts_at: null, source_url: url, analysis_status: "WAIT" }],
      recommendations: [],
    };

    expect(extractAnalysisRecord(wrapCited(record, url), sport, [{ title: "CBF", url }]))
      .toMatchObject({ status: "incomplete", record: null, failure: { code: "unofficial_source" } });
  });

  it.each([
    ["soccer", "https://sub.federacaopr.com.br/fixture/"],
    ["soccer", "https://federacaopr.com.br.evil.example/fixture/"],
    ["soccer", "https://www.atletico.com.br.evil.example/fixture/"],
    ["nfl", "https://sub.philadelphiaeagles.com/schedule/"],
    ["nfl", "https://philadelphiaeagles.com.evil.example/schedule/"],
    ["tennis", "https://sub.toray-ppo.com/result/fixture.pdf"],
    ["tennis", "https://toray-ppo.com.evil.example/result/fixture.pdf"],
    ["mlb", "https://federacaopr.com.br/fixture/"],
    ["soccer", "https://philadelphiaeagles.com/schedule/"],
    ["soccer", "https://toray-ppo.com/result/fixture.pdf"],
  ])("rejects unsafe or cross-sport official host %s %s", (sport, url) => {
    const proposed = `${sport}:2026-10-20:away@home:src`;
    const record = {
      version: 1, sport,
      events: [{ event_key: proposed, label: "Fixture matchup", starts_at: null, source_url: url, analysis_status: "WAIT" }],
      recommendations: [],
    };

    expect(extractAnalysisRecord(wrapCited(record, url), sport, [{ title: "Search result", url }]))
      .toMatchObject({ status: "incomplete", failure: { code: "unofficial_source" } });
  });

  it("does not allow CFB school hosts for another sport", () => {
    const url = "https://www.gostanford.com/sports/football/schedule";
    const record = { version: 1, sport: "mlb", events: [{ ...valid.events[0], event_key: "mlb:2026-09-25:bos@nyy:src", source_url: url }], recommendations: [] };
    expect(extractAnalysisRecord(wrapCited(record, url), "mlb", [{ title: "Search result", url }]))
      .toMatchObject({ status: "incomplete", record: null, failure: { code: "unofficial_source" } });
  });

  it("accepts searched, cited official Conference USA sources only for CFB", () => {
    for (const url of [
      "https://conferenceusa.com/news/2026/10/26/football-fb-weekday-cusa-wraps-up-in-week-nine.aspx",
      "https://www.conferenceusa.com/schedule.aspx?schedule=4520",
    ]) {
      const proposed = "cfb:2026-10-27:sam-houston@missouri-state:src";
      const derived = `${proposed}-${createHash("sha256").update(url).digest("hex").slice(0, 32)}`;
      const record = {
        version: 1, sport: "cfb",
        events: [{ event_key: proposed, label: "Sam Houston at Missouri State", starts_at: null, source_url: url, analysis_status: "PASS" }],
        recommendations: [],
      };

      expect(extractAnalysisRecord(wrapCited(record, url), "cfb", [{ title: "Conference USA", url }]))
        .toMatchObject({ status: "complete", record: { events: [{ event_key: derived, source_url: url }] } });
    }
  });

  it.each([
    ["cfb", "https://sub.conferenceusa.com/news/fixture"],
    ["cfb", "https://conferenceusa.com.evil.example/news/fixture"],
    ["cfb", "http://conferenceusa.com/news/fixture"],
    ["cfb", "https://user@conferenceusa.com/news/fixture"],
    ["mlb", "https://conferenceusa.com/news/fixture"],
  ])("rejects Conference USA source lookalikes and cross-sport host %s %s", (sport, url) => {
    const record = {
      version: 1, sport,
      events: [{ event_key: `${sport}:2026-10-27:away@home:src`, label: "Fixture matchup", starts_at: null, source_url: url, analysis_status: "WAIT" }],
      recommendations: [],
    };

    expect(extractAnalysisRecord(wrapCited(record, url), sport, [{ title: "Search result", url }]))
      .toMatchObject({ status: "incomplete", failure: { code: "unofficial_source" } });
  });

  it("canonicalizes an official CFB default HTTPS port before hashing the exact cited URL", () => {
    const cited = "https://WWW.DSUHORNETS.COM:443/sports/football/schedule";
    const canonical = "https://www.dsuhornets.com/sports/football/schedule";
    const proposed = "cfb:2026-10-23:du@army:src";
    const derived = `${proposed}-${createHash("sha256").update(canonical).digest("hex").slice(0, 32)}`;
    const record = { version: 1, sport: "cfb", events: [{ event_key: proposed, label: "Duke at Army", starts_at: null, source_url: cited, analysis_status: "WAIT" }], recommendations: [] };
    const extracted = extractAnalysisRecord(wrapCited(record, cited), "cfb", [{ title: "Official", url: canonical }]);
    expect(extracted.record?.events[0]).toMatchObject({ source_url: canonical, event_key: derived });
  });

  it.each([
    "http://www.bundesliga.com/match/fixture",
    "https://user@www.laliga.com/match/fixture",
    "https://www.acmonza.com:444/match/fixture",
    "https://sub.ogcnice.com/match/fixture",
    "https://chicagostars.com.evil.example/match/fixture",
  ])("rejects unsafe or unregistered new soccer source URL %s", (url) => {
    const record = {
      version: 1, sport: "soccer",
      events: [{ event_key: "soccer:2026-10-23:home@away:src", label: "Home at Away", starts_at: null, source_url: url, analysis_status: "WAIT" }],
      recommendations: [],
    };
    expect(extractAnalysisRecord(wrapCited(record, url), "soccer", [{ title: "Search result", url }]))
      .toMatchObject({ status: "incomplete", record: null, failure: { code: "unofficial_source" } });
  });

  it("requires searched and cited new soccer hosts while admitting other eligible events", () => {
    const firstUrl = "https://www.bundesliga.com/match/fixture";
    const first = { event_key: "soccer:2026-10-23:home@away:src", label: "Home at Away", starts_at: null, source_url: firstUrl, analysis_status: "WAIT" };
    const single = { version: 1, sport: "soccer", events: [first], recommendations: [] };
    expect(extractAnalysisRecord(wrapCited(single, firstUrl), "soccer", []))
      .toMatchObject({ record: null, failure: { code: "unverified_source" } });
    expect(extractAnalysisRecord(wrap(single), "soccer", [{ title: "Official", url: firstUrl }]))
      .toMatchObject({ record: null, failure: { code: "uncited_source" } });

    const secondUrl = "https://sub.reignfc.com/match/fixture";
    const mixed = { version: 1, sport: "soccer", events: [first, { ...first, event_key: "soccer:2026-10-23:club@rival:src", source_url: secondUrl }], recommendations: [] };
    expect(extractAnalysisRecord(wrapCited(mixed, `${firstUrl} ${secondUrl}`), "soccer", [{ title: "Official", url: firstUrl }, { title: "Search result", url: secondUrl }]))
      .toMatchObject({ status: "partial", record: { events: [expect.objectContaining({ source_url: firstUrl })], recommendations: [] }, record_admission: { rejected_events: [{ code: "unofficial_source", index: 1 }] } });
  });

  it("does not allow new soccer league or club hosts for another sport", () => {
    const url = "https://www.thorns.com/match/fixture";
    const record = { version: 1, sport: "mlb", events: [{ ...valid.events[0], event_key: "mlb:2026-09-25:bos@nyy:src", source_url: url }], recommendations: [] };
    expect(extractAnalysisRecord(wrapCited(record, url), "mlb", [{ title: "Search result", url }]))
      .toMatchObject({ status: "incomplete", record: null, failure: { code: "unofficial_source" } });
  });

  it("admits a searched and cited Nashville SC source for an exact-time early GO without an official numeric ID", () => {
    const url = "https://www.nashvillesc.com/news/fixture-preview";
    const proposed = "soccer:2026-10-30:nashville@rival:src";
    const record = {
      version: 1, sport: "soccer",
      events: [{ event_key: proposed, label: "Nashville SC at Rival", starts_at: "2026-10-30T20:30:00-04:00", source_url: url, analysis_status: "BET" }],
      recommendations: [{ item_key: "nashville-early", event_key: proposed, market: "Moneyline", selection: "Nashville SC", decision: "EARLY GO", timing: "early", suggested_units: 0.5, price_gate: "-133 or better" }],
    };
    const extracted = extractAnalysisRecord(wrapCited(record, url), "soccer", [{ title: "Nashville SC", url }], new Date("2026-10-28T12:00:00Z"), { commonPolicyAdopted: true });

    expect(extracted).toMatchObject({
      status: "complete",
      record: {
        events: [{ event_key: expect.stringMatching(/:src-[a-f0-9]{32}$/), starts_at: "2026-10-30T20:30:00-04:00", analysis_status: "BET" }],
        recommendations: [{ decision: "BET", timing: "early", suggested_units: 0.5, price_gate: "-133 or better" }],
      },
    });
  });

  it.each([
    "https://nashvillesc.com.evil.example/fixture",
    "https://sub.nashvillesc.com/fixture",
    "https://user@nashvillesc.com/fixture",
    "https://nashvillesc.com:444/fixture",
  ])("rejects Nashville SC lookalike or unsafe source URL %s", (url) => {
    const record = {
      version: 1, sport: "soccer",
      events: [{ event_key: "soccer:2026-10-30:nashville@rival:src", label: "Nashville SC at Rival", starts_at: null, source_url: url, analysis_status: "WAIT" }],
      recommendations: [],
    };
    expect(extractAnalysisRecord(wrapCited(record, url), "soccer", [{ title: "Search result", url }]))
      .toMatchObject({ status: "incomplete", failure: { code: "unofficial_source" } });
  });

  it("requires Nashville SC sources to be searched and cited", () => {
    const url = "https://nashvillesc.com/news/fixture-preview";
    const record = {
      version: 1, sport: "soccer",
      events: [{ event_key: "soccer:2026-10-30:nashville@rival:src", label: "Nashville SC at Rival", starts_at: null, source_url: url, analysis_status: "WAIT" }],
      recommendations: [],
    };
    expect(extractAnalysisRecord(wrapCited(record, url), "soccer", []))
      .toMatchObject({ status: "incomplete", failure: { code: "unverified_source" } });
    expect(extractAnalysisRecord(wrap(record), "soccer", [{ title: "Official", url }]))
      .toMatchObject({ status: "incomplete", failure: { code: "uncited_source" } });
  });

  it.each([
    "https://www.dcunited.com/match/fixture",
    "https://www.atlasfc.com.mx/partidos/fixture",
    "https://www.clubpuebla.com/partidos/fixture",
    "https://tuzos.com.mx/partidos/fixture",
    "https://www.clubsantos.mx/partidos/fixture",
  ])("accepts a searched and cited official soccer club source %s", (url) => {
    const official = { title: "Official club source", url };
    const proposed = "soccer:2026-10-21:atlas@pachuca:src";
    const derived = `${proposed}-${createHash("sha256").update(url).digest("hex").slice(0, 32)}`;
    const record = {
      version: 1, sport: "soccer",
      events: [{ event_key: proposed, label: "Atlas at Pachuca", starts_at: null, source_url: url, analysis_status: "WAIT" }],
      recommendations: [],
    };

    const extracted = extractAnalysisRecord(wrapCited(record, url), "soccer", [official]);
    expect(extracted).toMatchObject({ status: "complete" });
    expect(extracted.record?.events[0]).toMatchObject({ event_key: derived, source_url: url });
  });

  it("uses the cited club URL for a deterministic soccer source key and permits its domain apex", () => {
    const url = "https://dcunited.com/match/fixture";
    const official = { title: "Official club source", url };
    const proposed = "soccer:2026-10-21:dc@ny:src";
    const derived = `${proposed}-${createHash("sha256").update(url).digest("hex").slice(0, 32)}`;
    const record = {
      version: 1, sport: "soccer",
      events: [{ event_key: proposed, label: "D.C. United at New York", starts_at: null, source_url: url, analysis_status: "WAIT" }],
      recommendations: [],
    };

    expect(extractAnalysisRecord(wrapCited(record, url), "soccer", [official]).record?.events[0])
      .toMatchObject({ event_key: derived, source_url: url });
  });

  it.each([
    "https://sub.dcunited.com/match/fixture",
    "https://dcunited.com.evil.example/match/fixture",
    "https://user@www.dcunited.com/match/fixture",
    "https://www.dcunited.com:444/match/fixture",
    "http://www.dcunited.com/match/fixture",
  ])("rejects unsafe or unlisted soccer club source URL %s", (url) => {
    const proposed = "soccer:2026-10-21:atlas@pachuca:src";
    const record = {
      version: 1, sport: "soccer",
      events: [{ event_key: proposed, label: "Atlas at Pachuca", starts_at: null, source_url: url, analysis_status: "WAIT" }],
      recommendations: [],
    };

    expect(extractAnalysisRecord(wrapCited(record, url), "soccer", [{ title: "Search result", url }]))
      .toMatchObject({ status: "incomplete", failure: { code: "unofficial_source" } });
  });

  it.each([
    "bundesliga.com", "laliga.com", "acmonza.com", "ogcnice.com",
    "chicagostars.com", "reignfc.com", "thorns.com",
  ].flatMap((host) => [
    `https://${host}/match/fixture`,
    `https://www.${host}/match/fixture`,
    `https://${host}:443/match/fixture`,
    `https://www.${host}:443/match/fixture`,
  ]))("accepts a searched and cited official soccer league or club source %s", (cited) => {
    const canonical = new URL(cited).href;
    const official = { title: "Official league or club source", url: canonical };
    const proposed = "soccer:2026-10-23:home@away:src";
    const derived = `${proposed}-${createHash("sha256").update(canonical).digest("hex").slice(0, 32)}`;
    const record = {
      version: 1, sport: "soccer",
      events: [{ event_key: proposed, label: "Home at Away", starts_at: null, source_url: cited, analysis_status: "WAIT" }],
      recommendations: [],
    };
    const extracted = extractAnalysisRecord(wrapCited(record, cited), "soccer", [official]);
    expect(extracted).toMatchObject({ status: "complete" });
    expect(extracted.record?.events[0]).toMatchObject({ source_url: canonical, event_key: derived });
  });

  it("does not allow official soccer club sources for another sport", () => {
    const url = "https://www.dcunited.com/match/fixture";
    const record = {
      version: 1, sport: "mlb",
      events: [{ ...valid.events[0], event_key: "mlb:2026-09-25:bos@nyy:src", source_url: url }],
      recommendations: [],
    };

    expect(extractAnalysisRecord(wrapCited(record, url), "mlb", [{ title: "Search result", url }]))
      .toMatchObject({ status: "incomplete", failure: { code: "unofficial_source" } });
  });

  it("still requires an official club URL to be in searched sources and cited in the answer", () => {
    const url = "https://www.dcunited.com/match/fixture";
    const proposed = "soccer:2026-10-21:dc@ny:src";
    const record = {
      version: 1, sport: "soccer",
      events: [{ event_key: proposed, label: "D.C. United at New York", starts_at: null, source_url: url, analysis_status: "WAIT" }],
      recommendations: [],
    };

    expect(extractAnalysisRecord(wrapCited(record, url), "soccer", []))
      .toMatchObject({ status: "incomplete", failure: { code: "unverified_source" } });
    expect(extractAnalysisRecord(wrap(record), "soccer", [{ title: "Official club source", url }]))
      .toMatchObject({ status: "incomplete", failure: { code: "uncited_source" } });
  });

  it.each([
    ["nhl", "https://www.nhle.com/game/fixture", "bos@nyr"],
    ["nhl", "https://www.frontend.d3.nhle.com/game", "bos@nyr"],
    ["nhl", "https://frontend.d3.nhle.com.evil.example/game", "bos@nyr"],
    ["nhl", "https://user@frontend.d3.nhle.com/game", "bos@nyr"],
    ["nhl", "https://frontend.d3.nhle.com:444/game", "bos@nyr"],
    ["tennis", "https://sub.wtafiles.wtatennis.com/draw.pdf", "gauff@swIATEK"],
    ["tennis", "https://www.wtafiles.wtatennis.com/draw.pdf", "gauff@swIATEK"],
    ["tennis", "http://wtafiles.wtatennis.com/draw.pdf", "gauff@swIATEK"],
    ["tennis", "https://frontend.d3.nhle.com/game", "gauff@swIATEK"],
  ])("rejects non-exact or cross-sport official source host for %s", (sport, url, matchup) => {
    const [away, home] = matchup.toLowerCase().split("@");
    const proposed = `${sport}:2026-10-20:${away}@${home}:src`;
    const record = {
      version: 1, sport,
      events: [{ event_key: proposed, label: "Fixture matchup", starts_at: null, source_url: url, analysis_status: "WAIT" }],
      recommendations: [],
    };
    expect(extractAnalysisRecord(wrapCited(record, url), sport, [{ title: "Search result", url }]))
      .toMatchObject({ status: "incomplete", failure: { code: "unofficial_source" } });
  });

  it("keeps the prose when the envelope is malformed or absent", () => {
    const malformed = "본문 분석\n\n\`\`\`analysis-record\n{bad}\n\`\`\`";
    expect(extractAnalysisRecord(malformed, "mlb", [source]))
      .toEqual({ answer: malformed, status: "incomplete", record: null, failure: { code: "invalid_json", path: "analysis-record", message: expect.any(String) } });
    expect(extractAnalysisRecord("본문 분석", "mlb", [source]))
      .toEqual({ answer: "본문 분석", status: "incomplete", record: null, failure: { code: "missing_block", path: "analysis-record", message: expect.any(String) } });
  });

  it("reports the exact schema field and business validation path without dropping the raw block", () => {
    const missingField = wrap({ ...valid, events: [{ ...valid.events[0], source_url: undefined }] });
    expect(extractAnalysisRecord(missingField, "mlb", [source])).toMatchObject({
      answer: missingField, failure: { code: "schema_invalid", path: "events.0.source_url" },
    });
    const unknownSource = wrap(valid);
    expect(extractAnalysisRecord(unknownSource, "mlb", [{ title: "Other", url: "https://example.com/other" }])).toMatchObject({
      answer: unknownSource, failure: { code: "unverified_source", path: "events.0.source_url" },
    });
  });

  it("rejects cross-sport, ambiguous, or unverified event keys and citations", () => {
    expect(extractAnalysisRecord(wrap(valid), "nfl", [source]).record).toBeNull();
    expect(extractAnalysisRecord(wrap({ ...valid, events: [{ ...valid.events[0], event_key: "today-game" }] }), "mlb", [source]).record).toBeNull();
    expect(extractAnalysisRecord(wrap({ ...valid, events: [{ ...valid.events[0], event_key: "mlb:2026-09-25:bos@nyy" }] }), "mlb", [source]).record).toBeNull();
    expect(extractAnalysisRecord(wrap(valid), "mlb", [{ title: "Other", url: "https://example.com/other" }]).record).toBeNull();
  });

  it("rejects duplicate item keys, unlinked recommendations, and excess items", () => {
    expect(extractAnalysisRecord(wrap({ ...valid, recommendations: [valid.recommendations[0], valid.recommendations[0]] }), "mlb", [source]).record).toBeNull();
    expect(extractAnalysisRecord(wrap({ ...valid, recommendations: [{ ...valid.recommendations[0], event_key: "mlb:2026-09-25:aaa@bbb:id-789" }] }), "mlb", [source]).record).toBeNull();
    expect(extractAnalysisRecord(wrap({ ...valid, events: Array(21).fill(valid.events[0]) }), "mlb", [source]).record).toBeNull();
  });

  it("allows market decisions to differ from the explicit event display status", () => {
    const mixed = { ...valid, recommendations: [valid.recommendations[0], { ...valid.recommendations[0], item_key: "total", market: "Total", selection: "Under", decision: "PAPER" }] };
    expect(extractAnalysisRecord(wrap(mixed), "mlb", [source]).record).toEqual(mixed);
  });

  it("rejects a BET record without a confirmed future start", () => {
    const bet = { ...valid.recommendations[0], decision: "BET" };
    expect(extractAnalysisRecord(wrap({ ...valid, recommendations: [bet] }), "mlb", [source], new Date("2026-09-25T12:00:00Z")).record).toBeNull();
    expect(extractAnalysisRecord(wrap({ ...valid, events: [{ ...valid.events[0], starts_at: "2026-09-25T11:00:00Z" }], recommendations: [bet] }), "mlb", [source], new Date("2026-09-25T12:00:00Z")).record).toBeNull();
    expect(extractAnalysisRecord(wrap({ ...valid, events: [{ ...valid.events[0], analysis_status: "BET" }] }), "mlb", [source], new Date("2026-09-25T12:00:00Z")).record).toBeNull();
  });

  it("rejects EVALUATION INCOMPLETE until the event's start is confirmed to have passed", () => {
    const checkedAt = new Date("2026-09-25T12:00:00Z");
    const future = "2026-09-27T17:00:00-04:00";
    const incompleteEvent = { ...valid.events[0], starts_at: future, analysis_status: "EVALUATION INCOMPLETE" };
    expect(extractAnalysisRecord(wrap({ ...valid, events: [incompleteEvent] }), "mlb", [source], checkedAt).record).toBeNull();

    const futureRecommendation = { ...valid.recommendations[0], decision: "EVALUATION INCOMPLETE" };
    expect(extractAnalysisRecord(wrap({ ...valid, events: [{ ...valid.events[0], starts_at: future }], recommendations: [futureRecommendation] }), "mlb", [source], checkedAt).record).toBeNull();

    const unknownStart = { ...valid.events[0], starts_at: null, analysis_status: "EVALUATION INCOMPLETE" };
    expect(extractAnalysisRecord(wrap({ ...valid, events: [unknownStart] }), "mlb", [source], checkedAt).record).toBeNull();

    const started = { ...valid.events[0], starts_at: "2026-09-25T11:00:00Z", analysis_status: "EVALUATION INCOMPLETE" };
    expect(extractAnalysisRecord(wrap({ ...valid, events: [started] }), "mlb", [source], checkedAt).record?.events[0].analysis_status).toBe("EVALUATION INCOMPLETE");
  });
});

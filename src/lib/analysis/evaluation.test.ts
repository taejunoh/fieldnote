import { describe, expect, it } from 'vitest';
import { extractEvaluationReport, evaluationDisplayFromMetadata } from './evaluation';
import type { CoverageReport } from './coverage';
const url = 'https://example.com/game';
const key = 'nba:2026-10-28:away@home:src';
const coverage = { inventory: [{ event_key: key, label: 'Away at Home' }] } as CoverageReport;
function fixture() { return { version: 1, sport: 'nba', date_et: '2026-10-28', scope: 'selected_markets', scope_note: 'Only this assessed moneyline', truncated: false, markets: [{ event_key: key, label: 'Away at Home', market: 'moneyline', selection: 'Home', line: null, original_decision: 'PASS', state: 'valuation_complete', observed_price: { value: '-130', source_url: url, checked_at: '2026-10-28T16:00:00Z' }, price_condition: '-110 or better', suggested_units: null, thesis: 'Home has matchup advantage, insufficient at -130', countercase: 'Away can win through transition', critical_checks: ['participants', 'matchup', 'workload', 'dependencies'].map(category => ({ category, status: 'confirmed', evidence: 'Captured report with current rotation, matchup, rest and injury evidence', source_urls: [url], checked_at: '2026-10-28T16:00:00Z' })), uncertainty: { impact: 'Bench health may affect rotation', scenario: 'If starter unavailable fair price worsens', reopen_trigger: 'Official availability update or price -110' } }] }; }
const options = { sport: 'nba', dateEt: '2026-10-28', coverageReport: coverage, sources: [{ url }] };
const wrap = (report: unknown) => `Body\n\`\`\`analysis-evaluation\n${JSON.stringify(report)}\n\`\`\``;
describe('diagnostic market evaluation', () => {
  it('counts an actual priced PASS while keeping quote and entry threshold distinct', () => {
    const result = extractEvaluationReport(wrap(fixture()), options);
    expect(result.answer).toBe('Body'); expect(result.validation.status).toBe('valid');
    expect(result.validation.counts.valuation_complete).toBe(1);
    expect(result.report?.markets[0]).toMatchObject({ observed_price: { value: '-130' }, price_condition: '-110 or better' });
  });
  it('distinguishes information WAIT from unperformed research without rewriting original decisions', () => {
    const report = fixture(); report.markets[0].state = 'information_wait'; report.markets[0].original_decision = 'WAIT';
    expect(extractEvaluationReport(wrap(report), options).validation.counts.information_wait).toBe(1);
    report.markets[0].state = 'research_incomplete'; report.markets[0].original_decision = 'WATCH';
    expect(extractEvaluationReport(wrap(report), options).report?.markets[0].original_decision).toBe('WATCH');
    report.markets[0].uncertainty.reopen_trigger = '';
    expect(extractEvaluationReport(wrap(report), options).validation.status).toBe('invalid');
  });
  it('rejects a claimed completion omitting critical participant evidence', () => {
    const report = fixture(); report.markets[0].critical_checks.shift();
    expect(extractEvaluationReport(wrap(report), options).validation.reasons).toContain('critical_check_missing:0:participants');
  });
  it.each(['sport', 'date', 'event', 'source', 'duplicate', 'oversized'])('rejects %s without losing prose', kind => {
    const report = fixture();
    if (kind === 'sport') report.sport = 'mlb'; if (kind === 'date') report.date_et = '2026-10-29';
    if (kind === 'event') report.markets[0].event_key += '-unknown';
    if (kind === 'source') report.markets[0].observed_price.source_url += '/invented';
    if (kind === 'duplicate') report.markets.push(report.markets[0]);
    if (kind === 'oversized') report.markets = Array(21).fill(report.markets[0]);
    const result = extractEvaluationReport(wrap(report), options);
    expect(result.validation.status).toBe(kind === 'duplicate' ? 'partial' : 'invalid');
    if (kind === 'duplicate') expect(result.report?.markets).toHaveLength(1);
    else expect(result.report).toBeNull();
    expect(result.answer).toBe('Body');
  });
  it('strips malformed and unclosed blocks and leaves legacy metadata absent', () => {
    for (const block of ['```analysis-evaluation\n{bad}\n```', '```analysis-evaluation\n{bad}']) {
      expect(extractEvaluationReport(`Body\n${block}`, options)).toMatchObject({ answer: 'Body', report: null, validation: { status: 'invalid' } });
    }
    expect(evaluationDisplayFromMetadata({})).toBeNull();
  });
  it('reports canonical conflicts but never mutates or promotes recommendations', () => {
    const record = { events: [{ event_key: 'nba:2026-10-28:away@home:src-hash', label: 'Away at Home', source_url: url }], recommendations: [{ event_key: 'nba:2026-10-28:away@home:src-hash', market: 'moneyline', selection: 'Home', decision: 'BET', suggested_units: 1, price_gate: '-105' }] };
    const before = JSON.stringify(record);
    const canonicalEventKeys = { [key]: record.events[0].event_key };
    const result = extractEvaluationReport(wrap(fixture()), { ...options, record, canonicalEventKeys });
    expect(result.validation.status).toBe('valid'); expect(result.validation.reasons).toContain('canonical_decision_conflict:0');
    expect(JSON.stringify(record)).toBe(before);
    const report = fixture(); report.markets[0].original_decision = 'GO';
    expect(extractEvaluationReport(wrap(report), options).validation.status).toBe('valid');
  });
  it('does not expose arbitrary metadata through the bounded display helper', () => {
    const parsed = extractEvaluationReport(wrap(fixture()), options);
    const dto = evaluationDisplayFromMetadata({ evaluation_report: parsed.report, evaluation_validation: parsed.validation, original_model_response: 'private' });
    expect(dto?.report?.markets).toHaveLength(1); expect(JSON.stringify(dto)).not.toContain('private');
    expect(evaluationDisplayFromMetadata({ evaluation_report: fixture(), evaluation_validation: { ...parsed.validation, counts: { valuation_complete: 99 } } })?.report).toBeNull();
  });
  it.each([235.5, 7.5, -3.5, 6.5, 0.25])('normalizes only a finite numeric line %s to its exact string form', line => {
    const report = fixture(); Object.assign(report.markets[0], { line });
    const result = extractEvaluationReport(wrap(report), options);
    expect(result.validation.status).toBe('valid');
    expect(result.report?.markets[0].line).toBe(String(line));
    expect(result.validation.normalizations).toEqual([{ path: 'markets.0.line', type: 'number' }]);
  });
  it.each([true, {}, []])('does not coerce unsupported line types %j', line => {
    const report = fixture(); Object.assign(report.markets[0], { line });
    const result = extractEvaluationReport(wrap(report), options);
    expect(result.validation.status).toBe('invalid');
    expect(result.report).toBeNull();
  });
  it('rejects non-finite JSON numbers and invalid strings without unit or price coercion', () => {
    const nonFinite = extractEvaluationReport(wrap(fixture()).replace('"line":null', '"line":1e999'), options);
    expect(nonFinite.validation.status).toBe('invalid');
    expect(nonFinite.validation.normalizations).toEqual([]);
    for (const line of ['', 'x'.repeat(201)]) {
      const report = fixture(); Object.assign(report.markets[0], { line });
      expect(extractEvaluationReport(wrap(report), options).validation.status).toBe('invalid');
    }
    const report = fixture(); Object.assign(report.markets[0], { suggested_units: '1' });
    expect(extractEvaluationReport(wrap(report), options).validation.status).toBe('invalid');
  });
  it('continues to reject unknown market fields', () => {
    const report = fixture(); Object.assign(report.markets[0], { private_payload: 'do not expose' });
    const result = extractEvaluationReport(wrap(report), options);
    expect(result.validation.status).toBe('invalid');
    expect(JSON.stringify(result.validation.details)).not.toContain('private_payload');
    expect(JSON.stringify(result.validation.details)).not.toContain('do not expose');
  });
  it('keeps a supported sibling and quarantines a market that cites an unknown source', () => {
    const report = fixture();
    const rejected = structuredClone(report.markets[0]);
    rejected.selection = 'Away'; Object.assign(rejected, { line: -3.5 }); rejected.critical_checks[0].source_urls = ['https://private.example/not-retained'];
    report.markets.push(rejected);
    const result = extractEvaluationReport(wrap(report), { ...options, canonicalEventKeys: { [key]: 'nba:canonical-alias' } });
    expect(result.validation.status).toBe('partial');
    expect(result.report?.markets.map(row => row.selection)).toEqual(['Home']);
    expect(result.validation.counts.valuation_complete).toBe(1);
    expect(result.quarantinedMarkets).toEqual([{
      originalIndex: 1, eventKey: key, label: 'Away at Home', market: 'moneyline', selection: 'Away', line: '-3.5', originalDecision: 'PASS',
      reasons: ['evaluation_unknown_source:1'],
    }]);
    expect(evaluationDisplayFromMetadata({ evaluation_report: result.report, evaluation_validation: result.validation, evaluation_quarantined_markets: result.quarantinedMarkets })?.quarantinedMarkets[0]).toMatchObject({ eventKey: key, line: '-3.5' });
    expect(JSON.stringify(result)).not.toContain('private.example');
  });
  it('accepts a partial DTO only when accepted and quarantined original indexes agree', () => {
    const report = fixture();
    const rejected = structuredClone(report.markets[0]);
    rejected.critical_checks[0].source_urls = ['https://private.example/not-retained'];
    const accepted = structuredClone(report.markets[0]); accepted.selection = 'Away'; accepted.critical_checks.shift();
    report.markets = [rejected, accepted];
    const result = extractEvaluationReport(wrap(report), options);
    const metadata = { evaluation_report: result.report, evaluation_validation: result.validation, evaluation_quarantined_markets: result.quarantinedMarkets };
    expect(result.validation.acceptedMarketIndexes).toEqual([1]);
    expect(evaluationDisplayFromMetadata(metadata)).toMatchObject({ validation: { status: 'partial' }, summary: { clean_complete: 0, challenged_complete: 1, rows_with_diagnostics: 1 } });
    for (const acceptedMarketIndexes of [[], [1, 1], [0]]) {
      expect(evaluationDisplayFromMetadata({ ...metadata, evaluation_validation: { ...result.validation, acceptedMarketIndexes } })?.validation.status).toBe('invalid');
    }
    expect(evaluationDisplayFromMetadata({ ...metadata, evaluation_quarantined_markets: [{ ...result.quarantinedMarkets[0], originalIndex: 1 }] })?.validation.status).toBe('invalid');
    expect(evaluationDisplayFromMetadata({ ...metadata, evaluation_quarantined_markets: [result.quarantinedMarkets[0], result.quarantinedMarkets[0]] })?.validation.status).toBe('invalid');
    expect(evaluationDisplayFromMetadata({ ...metadata, evaluation_validation: { ...result.validation, status: 'valid' } })?.validation.status).toBe('invalid');
    expect(evaluationDisplayFromMetadata({ ...metadata, evaluation_quarantined_markets: [] })?.validation.status).toBe('invalid');
  });
  it('rejects duplicate accepted index mappings even when their length matches the report', () => {
    const report = fixture();
    const sibling = structuredClone(report.markets[0]); sibling.selection = 'Away';
    report.markets.push(sibling);
    const result = extractEvaluationReport(wrap(report), options);
    const metadata = { evaluation_report: result.report, evaluation_validation: result.validation };
    expect(evaluationDisplayFromMetadata(metadata)?.validation.status).toBe('valid');
    expect(evaluationDisplayFromMetadata({ ...metadata, evaluation_validation: { ...result.validation, acceptedMarketIndexes: [0, 0] } })?.validation.status).toBe('invalid');
    expect(evaluationDisplayFromMetadata({ ...metadata, evaluation_validation: { ...result.validation, acceptedMarketIndexes: [1, 0] } })?.validation.status).toBe('invalid');
  });
  it('retains bounded validation issues and source-safe diagnostics in the display DTO', () => {
    const report = fixture(); Object.assign(report.markets[0], { line: { private: 'value' } });
    const result = extractEvaluationReport(wrap(report), options);
    expect(result.validation.details?.[0]).toMatchObject({ code: 'invalid_type', path: 'markets.0.line' });
    expect(JSON.stringify(result.validation.details)).not.toContain('private');
    expect(evaluationDisplayFromMetadata({ evaluation_validation: result.validation, evaluation_report: result.report, evaluation_quarantined_markets: result.quarantinedMarkets })?.validation.details).toEqual(result.validation.details);
  });
  it('uses null safe identity fields when a quarantined market identity has invalid types', () => {
    const report = fixture();
    Object.assign(report.markets[0], { event_key: { private: 'identity-canary' }, line: { private: 'line-canary' } });
    const result = extractEvaluationReport(wrap(report), options);
    expect(result.quarantinedMarkets[0]).toMatchObject({ eventKey: null, line: null });
    const dto = evaluationDisplayFromMetadata({ evaluation_validation: result.validation, evaluation_quarantined_markets: result.quarantinedMarkets });
    expect(dto?.quarantinedMarkets[0]).toMatchObject({ eventKey: null, line: null });
    expect(JSON.stringify(dto)).not.toContain('identity-canary');
    expect(JSON.stringify(dto)).not.toContain('line-canary');
  });
  it('does not expose a rejected private enum value in validation diagnostics', () => {
    const report = fixture(); Object.assign(report.markets[0], { original_decision: 'private-enum-canary-927' });
    const result = extractEvaluationReport(wrap(report), options);
    expect(result.validation.status).toBe('invalid');
    expect(JSON.stringify(result.validation)).not.toContain('private-enum-canary-927');
    expect(JSON.stringify(result.validation.details)).not.toContain('private-enum-canary-927');
  });
  it('rejects unknown root envelope fields without exposing their values', () => {
    const report = { ...fixture(), private_payload: 'do not expose' };
    const result = extractEvaluationReport(wrap(report), options);
    expect(result.validation.status).toBe('invalid');
    expect(JSON.stringify(result.validation.details)).not.toContain('private_payload');
    expect(JSON.stringify(result.validation.details)).not.toContain('do not expose');
  });
});

describe('evaluation fence boundaries and sport scope', () => {
  it('does not swallow a subsequent record/coverage when an evaluation fence is unclosed', () => {
    const record = '```analysis-record\n{"version":1,"sport":"nba","events":[],"recommendations":[]}\n```';
    const coverageBlock = '```analysis-coverage\n{}\n```';
    for (const payload of ['{bad}', JSON.stringify(fixture())]) {
      const result = extractEvaluationReport(`Body\n\`\`\`analysis-evaluation\n${payload}\n${coverageBlock}\n${record}`, options);
      expect(result.answer).toContain(record); expect(result.answer).toContain(coverageBlock);
      expect(result.validation.status).toBe('invalid');
    }
  });
  it.each(['mlb', 'nfl', 'cfb', 'nba', 'wnba', 'nhl', 'soccer', 'tennis'])('accepts bounded diagnostic evidence for %s independently of native admission', sport => {
    const report = fixture(); report.sport = sport; report.markets[0].event_key = key.replace('nba:', `${sport}:`);
    const coverageReport = { inventory: [{ event_key: report.markets[0].event_key, label: 'Away at Home' }] } as CoverageReport;
    expect(extractEvaluationReport(wrap(report), { ...options, sport, coverageReport, record: { events: [], recommendations: [] } }).validation.status).toBe('valid');
  });
});

it.each(['```analysis-evaluation', '```analysis-evaluation {bad}'])('strips malformed EOF opener %s and marks unavailable contract invalid', block => {
  const result = extractEvaluationReport(`Body\n${block}`, options);
  expect(result.answer).toBe('Body'); expect(result.validation.status).toBe('invalid');
});
it('keeps complete self-report counts separate from challenged completions in safe DTO', () => {
  const report = fixture(); report.markets[0].critical_checks.shift();
  const result = extractEvaluationReport(wrap(report), options);
  expect(evaluationDisplayFromMetadata({ evaluation_report: result.report, evaluation_validation: result.validation })).toMatchObject({ summary: { clean_complete: 0, challenged_complete: 1, rows_with_diagnostics: 1 } });
});

it('normalizes diagnostic LEAN to canonical WATCH without inventing a decision conflict', () => {
  const report = fixture(); report.markets[0].original_decision = 'LEAN'; report.markets[0].state = 'research_incomplete';
  const result = extractEvaluationReport(wrap(report), { ...options, record: { events: [], recommendations: [{ event_key: key, market: 'moneyline', selection: 'Home', decision: 'WATCH', suggested_units: null, price_gate: '-110 or better' }] } });
  expect(result.report?.markets[0].original_decision).toBe('LEAN');
  expect(result.validation.reasons).not.toContain('canonical_decision_conflict:0');
});

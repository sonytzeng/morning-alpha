import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { getSubscriberReportProjection } from '../src/lib/subscriberReportContract.ts';
import { buildCanonicalNarrative } from '../src/lib/canonicalNarrative.ts';
import { buildDecisionPresentation } from '../src/lib/decisionPresentation.ts';
import { buildRuntimeDecisionTimeline } from '../src/lib/runtimeDecisionTimeline.ts';
import { subscriberProjectionFixture } from './fixtures/subscriber-projection-v1.mjs';

// Synthetic local contract shapes only; no market evaluation, provider call,
// entitlement fixture, publication receipt creation or Production operation.
const ready = () => subscriberProjectionFixture('READY');
const rowFor = ai => ({ report_date: ai.report_date, revision_id: ai.revision_id,
  generated_at: ai.generated_at, today_date: ai.report_date, ai_strategy_json: ai });
function present(row, nested = row.ai_strategy_json) {
  const displayState = { rawRow: row, rawAI: nested, is_trading_day: true,
    market_status: 'OPEN', reportDate: 'synthetic-untrusted-display-date', currentDate: nested.report_date,
    marketBias: 'synthetic-untrusted-radar-bias', dataStatus: 'sufficient', confidenceScore: 100,
    confidenceLabel: 'synthetic-untrusted-confidence-label' };
  const narrative = buildCanonicalNarrative({ displayState });
  return buildDecisionPresentation({ displayState, narrative,
    opportunitySource: [{ symbol: '2330', name: 'synthetic-opportunity', reason: 'synthetic-only' }] });
}
const timeline = source => buildRuntimeDecisionTimeline({ ...source, hasReport: true,
  isTradingDay: true, taipeiMinutes: 16 * 60 });

for (const [name, change] of [
  ['different revision', row => { row.revision_id = 'synthetic-other-revision'; }],
  ['different date', row => { row.report_date = '2026-09-08'; }],
  ['different generated time', row => { row.generated_at = '2026-09-09T07:31:00+08:00'; }],
  ['outer PARTIAL', row => { row.subscriber_state = { ...row.ai_strategy_json.subscriber_state,
    publication: 'UNPUBLISHED', analysis: 'PARTIAL', recommendation: 'BLOCKED',
    confidence: { status: 'UNAVAILABLE', value: null } }; }],
  ['invalid outer state version', row => { row.subscriber_state = { ...row.ai_strategy_json.subscriber_state,
    schema_version: 'synthetic-unknown-version' }; }],
]) {
  test(`full-envelope rejection survives formatter and timeline: ${name}`, () => {
    const ai = ready(), row = rowFor(ai); change(row);
    const projection = getSubscriberReportProjection(row);
    assert.equal(projection.analysisAvailable, false);
    const output = present(row);
    assert.equal(output.primaryDecision.state, 'INSUFFICIENT_DATA');
    assert.equal(output.primaryDecision.headline, projection.title);
    assert.equal(output.confidence, undefined);
    assert.equal(output.marketBiasLabel, undefined);
    assert.deepEqual(output.opportunities, []);
    assert.equal(output.dateLabel, projection.identity.reportDate);
    for (const source of [{ projection, ai }, { report: row, ai }]) {
      assert.equal(timeline(source).some(node => node.status === 'completed'), false,
        'nested READY must not replace the already-rejected envelope');
    }
  });
}

test('published presentation uses projected confidence and bias, never display/radar aliases', () => {
  const ai = ready(), row = rowFor(ai), projection = getSubscriberReportProjection(row);
  const output = present(row);
  assert.equal(output.primaryDecision.state, 'WAIT');
  assert.equal(output.confidence.score, projection.confidence.value);
  assert.equal(output.confidence.label, projection.confidence.label);
  assert.equal(output.marketBiasLabel, projection.marketDecision.bias);
  assert.equal(output.dateLabel, projection.identity.reportDate);
});

test('a selected published row outranks a different nested caller draft', () => {
  const row = rowFor(ready());
  const draft = subscriberProjectionFixture('PARTIAL');
  const output = present(row, draft);
  assert.equal(output.primaryDecision.state, 'WAIT');
  assert.equal(output.confidence.score, 73);
});

test('full-row and supplied-projection timelines preserve verified checkpoint and NOT_DUE semantics', () => {
  const ai = ready();
  ai.intraday_sync_status.windows['0930'] = { status: 'COMPLETED', report_date: ai.report_date,
    revision_id: ai.revision_id, completed_at: `${ai.report_date}T09:31:00+08:00`,
    evidence: { synthetic: true } };
  const row = rowFor(ai), projection = getSubscriberReportProjection(row);
  const expected = timeline({ ai });
  for (const source of [{ projection }, { report: row }]) {
    const nodes = timeline(source);
    assert.deepEqual(nodes, expected);
    assert.equal(nodes.find(node => node.time === '09:30').status, 'completed');
    assert.equal(nodes.at(-1).status, 'pending');
  }
  assert.equal(timeline({ report: null, ai }).some(node => node.status === 'completed'), false,
    'explicitly missing full row cannot fall back to detached READY AI');
});

test('active subscriber timeline callers pass their canonical projection', () => {
  for (const path of ['src/pages/home/page.tsx', 'src/pages/report/TodayReport.tsx',
    'src/pages/verification/page.tsx', 'src/pages/member-note/page.tsx', 'src/pages/opportunities/page.tsx']) {
    const code = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    const source = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let calls = 0;
    const visit = node => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
        && node.expression.text === 'buildRuntimeDecisionTimeline') {
        calls++;
        const input = node.arguments[0];
        assert.ok(ts.isObjectLiteralExpression(input), `${path}: explicit projection input`);
        const keys = input.properties.map(property => property.name?.getText(source));
        assert.ok(keys.includes('projection'), `${path}: missing canonical projection`);
        for (const raw of ['ai', 'reportRevisionId', 'reportGeneratedAt']) {
          assert.equal(keys.includes(raw), false, `${path}: obsolete detached ${raw}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    assert.equal(calls, 1, `${path}: exactly one shared timeline`);
  }
});

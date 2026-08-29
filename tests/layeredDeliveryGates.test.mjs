import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateCoreDataGate,
  projectLayeredDelivery,
} from '../supabase/functions/_shared/layered-delivery-gates.mjs';
import { buildLineDeliveryIdempotencyKey } from '../supabase/functions/_shared/line-delivery-contract.mjs';
import { readFileSync } from 'node:fs';

const CORE_ROWS = {
  spx: ['5280.10', '-0.20', '2026-08-27T20:00:00Z'],
  nasdaq: ['21400.25', '0.15', '2026-08-27T20:00:00Z'],
  sox: ['5880.42', '0.30', '2026-08-27T20:00:00Z'],
  nvda: ['188.12', '0.80', '2026-08-27T20:00:00Z'],
  tsm_adr: ['241.55', '0.42', '2026-08-27T20:00:00Z'],
  vix: ['14.88', '-1.20', '2026-08-27T20:00:00Z'],
  dxy: ['97.80', '0.10', '2026-08-27T20:00:00Z'],
  us10y: ['4.23', '0.02', '2026-08-27T20:00:00Z'],
  taiex: ['24519.90', '0.45', '2026-08-27T05:30:00Z'],
  '2330': ['1205', '0.84', '2026-08-27T05:30:00Z'],
  txf: ['24388', '-0.15', '2026-08-27T21:00:00Z'],
};

function marketSnapshot() {
  return Object.fromEntries(Object.entries(CORE_ROWS).map(([key, [value, change, capturedAt]]) => [
    key,
    { value, change_percent: change, captured_at: capturedAt },
  ]));
}

function baseAi() {
  return {
    report_date: '2026-08-28',
    today_date: '2026-08-28',
    tw_core_date: '2026-08-27',
    us_global_date: '2026-08-27',
    content_evidence_quality: { verified_news_count: 1, all_news_traceable: true },
    v10_analysis_debug: { evidence_pack: { market_snapshot: marketSnapshot() } },
    v8_daily_sentence: {
      sentence: '美股科技指標分歧，台股盤前先驗證權值與期貨是否同向。',
      logic_source: ['market_snapshot.sox', 'market_snapshot.txf'],
      decision_mode: 'no_trade',
    },
    sector_rotation_status: { status: 'unavailable', source: 'unavailable', row_count: 0 },
  };
}

function project(overrides = {}) {
  const ai = { ...baseAi(), ...(overrides.ai || {}) };
  return projectLayeredDelivery({
    ai,
    report_date: '2026-08-28',
    report_mode: 'normal_overnight',
    is_trading_day: true,
    market_bias: '盤整觀察',
    important_news_count: 1,
    premium_gate: { eligible: true, reason_codes: [], content_score: 93 },
    ...overrides,
    ai,
  });
}

test('sector rotation missing does not block Core or Public delivery', () => {
  const result = project();
  assert.equal(result.core_gate.status, 'PASS');
  assert.equal(result.public_gate.status, 'PASS');
  assert.equal(result.ai.sector_rotation_status.status, 'unavailable');
  assert.deepEqual(result.ai.public_delivery_projection.preferred_sectors, []);
});

test('provider degradation uses verified remaining news without blocking Public', () => {
  const result = project({ important_news_count: 1 });
  assert.equal(result.public_gate.status, 'PASS');
  assert.equal(result.public_gate.news_provider_quorum, 'PASS');
});

test('OpenAI or news timeout falls back to evidence-bound data-only Public copy', () => {
  const ai = baseAi();
  ai.content_evidence_quality = { verified_news_count: 0, all_news_traceable: false };
  ai.v8_daily_sentence = {};
  const result = project({ ai, important_news_count: 0 });
  assert.equal(result.public_gate.status, 'PASS');
  assert.equal(result.public_gate.mode, 'data_only');
  assert.equal(result.public_gate.published_claim_evidence_coverage, 100);
  assert.match(result.ai.today_quote, /市場價格與風險指標/);
});

test('Premium evidence can block while Public remains eligible', () => {
  const result = project({
    premium_gate: { eligible: false, reason_codes: ['member_research_structure_incomplete'], content_score: 88 },
  });
  assert.equal(result.public_gate.status, 'PASS');
  assert.equal(result.premium_gate.status, 'BLOCKED');
});

test('unsupported published claim blocks Public delivery', () => {
  const result = project({
    public_published_claims: [{ claim_id: 'unsupported', text: '未綁定證據的公開判斷', evidence_refs: [] }],
  });
  assert.equal(result.public_gate.status, 'BLOCKED');
  assert.deepEqual(result.public_gate.unsupported_published_claims, ['unsupported']);
});

test('missing required Core symbol blocks Public delivery', () => {
  const ai = baseAi();
  delete ai.v10_analysis_debug.evidence_pack.market_snapshot.txf;
  const result = project({ ai });
  assert.equal(result.core_gate.status, 'BLOCKED');
  assert.equal(result.public_gate.status, 'BLOCKED');
  assert.ok(result.core_gate.reason_codes.includes('core_missing:TXF'));
});

test('previous US close is fresh for the next Taiwan morning report', () => {
  const result = evaluateCoreDataGate({
    ai: baseAi(), report_date: '2026-08-28', report_mode: 'normal_overnight', is_trading_day: true,
  });
  assert.equal(result.status, 'PASS');
  assert.equal(result.freshness_policy.find((row) => row.instrument === 'SOX').freshness_status, 'PASS');
});

test('weekend and holiday reports mark Core as not applicable', () => {
  for (const reportMode of ['weekend_digest', 'holiday_digest']) {
    const result = evaluateCoreDataGate({ ai: {}, report_date: '2026-08-29', report_mode: reportMode, is_trading_day: false });
    assert.equal(result.status, 'NOT_APPLICABLE');
    assert.equal(result.eligible, true);
  }
});

test('LINE subscriber idempotency is stable and rejects incomplete identity', () => {
  const input = { report_date: '2026-08-28', push_type: 'daily_report', subscriber_id: 'subscriber-1' };
  assert.equal(buildLineDeliveryIdempotencyKey(input), buildLineDeliveryIdempotencyKey(input));
  assert.notEqual(buildLineDeliveryIdempotencyKey(input), buildLineDeliveryIdempotencyKey({ ...input, subscriber_id: 'subscriber-2' }));
  assert.throws(() => buildLineDeliveryIdempotencyKey({ ...input, subscriber_id: '' }), /subscriber_id_required/);
});

test('LINE safe test is subscriber-bounded and cannot advance production delivery state', () => {
  const source = readFileSync(new URL('../supabase/functions/line-daily-push/index.ts', import.meta.url), 'utf8');
  assert.match(source, /if \(!safeTestSubscriberId && delivery\.failedCount === 0/);
  assert.match(source, /query = query\.eq\('id', targetSubscriberId\)/);
  assert.match(source, /production_state_advanced: !safeTestSubscriberId/);
});

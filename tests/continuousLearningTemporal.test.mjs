import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isolatedFunction } from './helpers/isolatedEdgeLoader.mjs';
import { temporalLearningCandidate, finiteNumber, safeAverage, buildPatternDimensions, buildPatternKey, buildReview } from '../supabase/functions/_shared/continuous-learning-core.mjs';

const now = '2026-10-20T15:40:00+08:00';
const sample = (i, correct = false) => {
  const date = new Date(Date.UTC(2026, 7, 1 + i)).toISOString().slice(0, 10), id = `prediction-${i}`;
  return { prediction: { id, model_version: 'SYNTHETIC_MODEL_V1', report_date: date, prediction_at: `${date}T07:00:00+08:00`, record_status: 'valid', data_quality_status: 'complete' },
    review: { prediction_id: id, learning_eligible: true, review_result: correct ? 'correct' : 'incorrect' },
    outcome: { prediction_id: id, horizon: 'close', target_date: date, status: 'completed', data_quality_status: 'complete', evaluated_at: `${date}T14:40:00+08:00` } };
};
const rows = () => Array.from({ length: 40 }, (_, i) => sample(i, i >= 28));

test('a price-direction label never proves the original catalyst, surprise or price-in claim', () => {
  for (const directionCorrect of [true, false]) {
    const review = buildReview({ dataQuality: 'complete', outcomeStatus: 'completed', directionCorrect,
      timingCorrect: directionCorrect, modelConfidence: 85, scope: 'symbol', abnormalReturn: directionCorrect ? 2 : -2,
      catalystScore: 90, surpriseScore: 90, priceInScore: 90, mappingScore: 90 });
    assert.equal(review.direction_accuracy, directionCorrect ? 'correct' : 'incorrect');
    for (const field of ['catalyst_accuracy', 'surprise_accuracy', 'price_in_accuracy']) assert.equal(review[field], 'unverified');
    assert.equal(review.learning_eligible, true, 'trusted direction can still be measured independently');
  }
});

test('candidate direction uses training only; held-out labels cannot choose the adjustment', () => {
  const a = temporalLearningCandidate(rows(), now);
  const b = temporalLearningCandidate(rows().map((r, i) => i < 28 ? r : sample(i, false)), now);
  assert.equal(a.adjustment, -8); assert.equal(b.adjustment, -8);
  assert.equal(a.training_rate, 0); assert.equal(a.training.length, 28); assert.equal(a.outOfSample.length, 12);
  assert.equal(a.enough, true); assert.equal(a.version, 'CLE_TEMPORAL_REVIEW_V2');
});
test('an OOS result cannot create a candidate when training is in the original neutral band', () => {
  const input = rows().map((r, i) => sample(i, i < 17 || i >= 28));
  const result = temporalLearningCandidate(input, now);
  assert.equal(result.adjustment, null); assert.equal(result.training_rate, 17 / 28);
});
test('different or unknown model versions cannot pool labels into one candidate', () => {
  for (const model of ['SYNTHETIC_MODEL_V2', 'unknown', undefined]) {
    const input = rows(); input[10].prediction.model_version = model;
    const result = temporalLearningCandidate(input, now);
    assert.equal(result.enough, false); assert.equal(result.adjustment, null);
    assert.equal(result.excluded.MODEL_VERSION_SCOPE_UNVERIFIED, 40);
  }
});
test('one report-date cohort never straddles training and OOS', () => {
  const input = rows();
  for (let i = 26; i < 31; i++) {
    const r = sample(26, false), id = `same-day-${i}`;
    r.prediction.id = id; r.review.prediction_id = id; r.outcome.prediction_id = id; input[i] = r;
  }
  const r = temporalLearningCandidate(input, now);
  assert.equal(r.training.length, 26); assert.equal(r.outOfSample.length, 14);
  assert.ok(r.training.at(-1).prediction.report_date < r.outOfSample[0].prediction.report_date);
});
test('late training labels are purged, not backdated from the report date', () => {
  const input = rows();
  for (let i = 0; i < 12; i++) input[i].outcome.evaluated_at = input[28].prediction.prediction_at;
  const r = temporalLearningCandidate(input, now);
  assert.equal(r.training.length, 16); assert.equal(r.enough, false);
  assert.equal(r.excluded.TRAINING_LABEL_NOT_AVAILABLE, 12);
});
test('duplicate identities, wrong lineage, unverified/future labels cannot become samples', () => {
  const input = rows(); input.push(structuredClone(input[0]));
  input[1].review.prediction_id = 'other'; input[2].outcome.status = 'pending';
  input[3].review.learning_eligible = false; input[4].outcome.evaluated_at = '2027-01-01T00:00:00Z';
  const r = temporalLearningCandidate(input, now);
  assert.equal(r.training.some(x => ['prediction-0', 'prediction-1', 'prediction-2', 'prediction-3', 'prediction-4'].includes(x.prediction.id)), false);
  assert.equal(r.excluded.DUPLICATE_PREDICTION_ID, 2);
  assert.equal(r.excluded.SAMPLE_NOT_VERIFIED, 4);
});
test('empty, all-one-day, invalid clock and future prediction never claim OOS readiness', () => {
  assert.equal(temporalLearningCandidate([], now).enough, false);
  const same = rows().map((r, i) => { const x = sample(0); x.prediction.id = `same-${i}`; x.review.prediction_id = x.outcome.prediction_id = x.prediction.id; return x; });
  assert.equal(temporalLearningCandidate(same, now).training.length, 0);
  assert.equal(temporalLearningCandidate(same, now).enough, false);
  assert.throws(() => temporalLearningCandidate(rows(), 'bad'), /LEARNING_REVIEW_TIME_INVALID/);
});

test('actual Learning candidate path uses temporal audit/version and never production promotion', async () => {
  const source = readFileSync(new URL('../supabase/functions/continuous-learning-engine/index.ts', import.meta.url), 'utf8');
  const asObject = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  const deps = { asObject, finiteNumber, safeAverage, temporalLearningCandidate };
  deps.brierScore = isolatedFunction(source, 'brierScore', deps);
  deps.pairedBrierImprovement = isolatedFunction(source, 'pairedBrierImprovement', deps);
  const evaluate = isolatedFunction(source, 'evaluateRuleCandidates', deps), writes = [];
  const db = { from(table) {
    const chain = { select() { return this; }, eq() { return this; },
      async maybeSingle() { return { data: null, error: null }; },
      insert(row) { writes.push({ table, row }); this.inserted = row; return this; },
      async single() { return { data: { id: 'rule-control', ...this.inserted }, error: null }; },
      async upsert(row) { writes.push({ table, row }); return { error: null }; },
      update(row) { writes.push({ table, row }); return this; },
      then(resolve) { return Promise.resolve({ error: null }).then(resolve); } };
    assert.ok(['learning_rules', 'rule_backtests'].includes(table)); return chain;
  } };
  const input = rows().map((r, i) => ({ ...r, prediction: { ...r.prediction, model_confidence: 80 },
    review: { ...r.review, review_result: i < 28 ? 'incorrect' : 'correct' } }));
  // Deliberately contradictory full-window summary: it must not select +4.
  const result = await evaluate(db, '2026-10-20', [{ pattern_key: 'fixed', follow_through_rate: 0.99, sample_size: 40, dimensions: {} }], new Map([['fixed', input]]));
  assert.equal(result, 1);
  assert.equal(writes[0].row.action_json.points, -8);
  assert.equal(writes[0].row.version, 2); assert.match(writes[0].row.rule_key, /temporal-v2$/);
  const backtest = writes.find(x => x.table === 'rule_backtests').row;
  assert.equal(backtest.backtest_version, 'CLE_BACKTEST_TEMPORAL_V2');
  assert.equal(backtest.result_json.selection_scope, 'TRAINING_ONLY');
  assert.equal(backtest.status, 'failed');
  assert.equal(writes.some(x => x.row.status === 'production' || x.row.status === 'eligible_shadow'), false);
});

test('actual persisted review loader joins a cross-day window before pattern/model evaluation', async () => {
  const source = readFileSync(new URL('../supabase/functions/continuous-learning-engine/index.ts', import.meta.url), 'utf8');
  const input = rows(), predictions = input.map(x => x.prediction);
  const retained = input.map(x => ({ ...x.review, review_date: x.prediction.report_date,
    review_version: 'CLE_REVIEW_V1', idempotency_key: `${x.prediction.id}:close:CLE_REVIEW_V1` }));
  const reads = [], writes = [];
  const db = { from(table) {
    assert.equal(table, 'prediction_reviews'); let chunk;
    return { select(fields) { assert.doesNotMatch(fields, /\*|lesson|root_cause/); return this; },
      in(k, ids) { assert.equal(k, 'prediction_id'); chunk = ids; return this; },
      eq(k, value) { assert.equal(k, 'review_version'); assert.equal(value, 'CLE_REVIEW_V1'); return this; },
      gte() { return this; }, lte() { return this; }, order() { return this; },
      async limit(n) { assert.equal(n, chunk.length + 1); reads.push(chunk); return { data: retained.filter(r => chunk.includes(r.prediction_id)), error: null }; } };
  } };
  const shiftDate = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  const load = isolatedFunction(source, 'loadLearningReviewWindow', { shiftDate });
  const reviews = await load(db, '2026-10-20', predictions);
  assert.equal(reads.length, 1); assert.equal(reviews.length, 40);
  const aggregate = isolatedFunction(source, 'aggregatePatterns', { buildPatternDimensions, buildPatternKey, safeAverage, firstText: (...v) => v.find(x => typeof x === 'string' && x) || '',
    asObject: v => v && typeof v === 'object' ? v : {} });
  const patternDb = { from(table) { assert.equal(table, 'market_patterns'); return { upsert(values) { writes.push(...values); return this; }, async select() { return { data: writes, error: null }; } }; } };
  const result = await aggregate(patternDb, '2026-10-20', predictions, input.map(x => x.outcome), reviews);
  assert.equal(result.groups.size, 1);
  const candidate = temporalLearningCandidate([...result.groups.values()][0], now);
  assert.equal(candidate.training.length, 28); assert.equal(candidate.outOfSample.length, 12);
  const mixed = predictions.map((p,i) => ({...p,model_version:i<20?'SYNTHETIC_MODEL_V1':'SYNTHETIC_MODEL_V2'}));
  const separate = await aggregate(patternDb, '2026-10-20', mixed, input.map(x=>x.outcome), reviews);
  assert.equal(separate.groups.size,2,'the real aggregate must not pool different model versions');
  for(const group of separate.groups.values())assert.equal(new Set(group.map(x=>x.prediction.model_version)).size,1);
  // The real daily caller must use the loaded history for BOTH paths; today's
  // createReviewsAndCases remains restricted to today and is never backfill.
  assert.match(source, /historicalReviews = await loadLearningReviewWindow\(client, targetDate, window.predictions\)/);
  assert.match(source, /await evaluateModels\(client, targetDate, window.predictions, outcomes, historicalReviews\)/);
  assert.match(source, /outcomes,\s+historicalReviews,\s+\)/);
  await assert.rejects(() => load(db, '2026-10-20', [predictions[0], predictions[0]]), /DUPLICATE/);
});

test('historical review loader refuses wrong identity, duplicates and overflow without historical writes', async () => {
  const source = readFileSync(new URL('../supabase/functions/continuous-learning-engine/index.ts', import.meta.url), 'utf8');
  const load = isolatedFunction(source, 'loadLearningReviewWindow', { shiftDate: () => '2026-06-22' });
  const prediction = sample(0).prediction;
  const review = { prediction_id: prediction.id, review_date: prediction.report_date, review_version: 'CLE_REVIEW_V1', idempotency_key: `${prediction.id}:close:CLE_REVIEW_V1` };
  for (const returned of [[{ ...review, review_date: '2026-10-20' }], [review, review], [{ ...review, prediction_id: 'other' }]]) {
    const db = { from() { const q = { select() { return q; }, in() { return q; }, eq() { return q; }, gte() { return q; }, lte() { return q; }, order() { return q; }, async limit() { return { data: returned, error: null }; } }; return q; } };
    await assert.rejects(() => load(db, '2026-10-20', [prediction]), /INVALID|OVERFLOW/);
  }
});

test('actual Shadow only counts predictions from after its Taipei start day, not a UTC-day loophole', async () => {
  const source = readFileSync(new URL('../supabase/functions/continuous-learning-engine/index.ts', import.meta.url), 'utf8'), updates = [];
  const firstText = (...values) => values.find(v => typeof v === 'string' && v) || '';
  const fn = isolatedFunction(source, 'updateShadowRules', { getTaipeiDateString: () => '2026-10-20', firstText,
    asObject: v => v && typeof v === 'object' ? v : {}, buildPatternKey: () => 'fixed' });
  const db = { from() { const q = { select() { return q; }, in() { return q; },
    async limit() { return { data: [{ id: 'shadow', status: 'shadow', shadow_started_at: '2026-10-18T23:15:00Z', condition_json: {model_version: 'SYNTHETIC_MODEL_V1'} }, { id: 'legacy-unversioned', status: 'eligible_shadow', condition_json: {} }], error: null }; },
    update(v) { updates.push(v); return q; }, eq() { return q; }, then(resolve) { return Promise.resolve({ error: null }).then(resolve); } }; return q; } };
  const sameDay = { prediction: { model_version: 'SYNTHETIC_MODEL_V1', report_date: '2026-10-19', prediction_at: '2026-10-18T23:00:00Z' }, review: { learning_eligible: true, review_result: 'correct' } };
  const nextDay = { prediction: { model_version: 'SYNTHETIC_MODEL_V1', report_date: '2026-10-20', prediction_at: '2026-10-19T23:00:00Z' }, review: { learning_eligible: true, review_result: 'incorrect' } };
  await fn(db, '2026-10-20', new Map([['fixed|model_version=SYNTHETIC_MODEL_V1', [sameDay, nextDay]]]));
  assert.equal(updates[0].shadow_sample_size, 1); assert.equal(updates[0].shadow_accuracy, 0);
  assert.equal(updates[0].shadow_completed_at, undefined);
  assert.equal(updates.length, 1, 'do not auto-start a legacy candidate lacking model scope');
});

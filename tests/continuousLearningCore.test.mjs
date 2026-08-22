import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyProductionLearningConfidence,
  buildPatternDimensions,
  buildPatternKey,
  buildReview,
  calibrateConfidence,
  classifyOutcomeDirection,
  confidenceBucket,
  isDirectionCorrect,
  learningRuleMatches,
  normalizePredictionDirection,
  percentReturn,
  selectTargetTradingDate,
} from '../supabase/functions/_shared/continuous-learning-core.mjs';

test('normalizes Morning Alpha market language without inventing a directional call', () => {
  assert.equal(normalizePredictionDirection('偏多觀察'), 'bullish');
  assert.equal(normalizePredictionDirection('偏弱觀察'), 'bearish');
  assert.equal(normalizePredictionDirection('震盪觀察'), 'neutral');
  assert.equal(classifyOutcomeDirection(0.29), 'flat');
  assert.equal(classifyOutcomeDirection(0.3), 'up');
  assert.equal(isDirectionCorrect('neutral', -0.2), true);
  assert.equal(isDirectionCorrect('bullish', -0.4), false);
});

test('keeps data failure out of the learning dataset', () => {
  const review = buildReview({
    dataQuality: 'provider_failure',
    outcomeStatus: 'provider_failure',
    directionCorrect: false,
    timingCorrect: false,
    modelConfidence: 90,
    scope: 'market',
  });
  assert.equal(review.review_result, 'inconclusive');
  assert.equal(review.error_type, 'provider_failure');
  assert.equal(review.learning_eligible, false);
  assert.match(review.lesson, /不可把 Data Failure 當成 Prediction Failure/);
});

test('separates price-in error from catalyst correctness', () => {
  const review = buildReview({
    dataQuality: 'complete',
    outcomeStatus: 'completed',
    directionCorrect: false,
    timingCorrect: false,
    modelConfidence: 86,
    priceInScore: 82,
    catalystScore: 90,
    surpriseScore: 75,
    mappingScore: 80,
    scope: 'symbol',
    abnormalReturn: -2.3,
  });
  assert.equal(review.review_result, 'incorrect');
  assert.equal(review.error_type, 'price_in_misjudged');
  assert.equal(review.learning_eligible, true);
  assert.match(review.lesson, /Catalyst Correct 不等於 Trade Correct/);
  assert.equal(review.rule_candidate.adjustment, -8);
});

test('calibration requires a minimum sample and caps adjustment', () => {
  assert.deepEqual(calibrateConfidence(85, { sample_size: 19, accuracy: 0.55 }), {
    calibrated: 85,
    adjustment: 0,
    applied: false,
  });
  assert.deepEqual(calibrateConfidence(85, { sample_size: 40, accuracy: 0.58 }), {
    calibrated: 75,
    adjustment: -10,
    applied: true,
  });
  assert.equal(confidenceBucket(85), '80_90');
});

test('only matching production rules can affect the next decision', () => {
  const dimensions = buildPatternDimensions({
    prediction_scope: 'market',
    market_regime: '中性偏多',
    direction: '中性偏多',
    model_confidence: 82,
    data_quality_status: 'complete',
  });
  const condition = { ...dimensions };
  assert.equal(learningRuleMatches(condition, dimensions), true);
  const result = applyProductionLearningConfidence(82, { sample_size: 40, accuracy: 0.75 }, [
    { id: 'candidate', status: 'candidate', condition_json: condition, action_json: { type: 'confidence_adjustment', points: 10 } },
    { id: 'wrong-regime', status: 'production', condition_json: { ...condition, market_regime: '偏弱觀察' }, action_json: { type: 'confidence_adjustment', points: 10 } },
    { id: 'production', status: 'production', condition_json: condition, action_json: { type: 'confidence_adjustment', points: -4 } },
  ], dimensions);
  assert.equal(result.calibrated_confidence, 75);
  assert.equal(result.production_rule_adjustment, -4);
  assert.equal(result.final_confidence, 71);
  assert.deepEqual(result.applied_rule_ids, ['production']);
});

test('production rule adjustment is capped independently from calibration', () => {
  const dimensions = { scope: 'market' };
  const rules = Array.from({ length: 3 }, (_, index) => ({
    id: `rule-${index}`,
    status: 'production',
    condition_json: dimensions,
    action_json: { type: 'confidence_adjustment', points: 8 },
  }));
  const result = applyProductionLearningConfidence(50, { sample_size: 10, accuracy: 0.9 }, rules, dimensions);
  assert.equal(result.calibration_applied, false);
  assert.equal(result.production_rule_adjustment, 10);
  assert.equal(result.final_confidence, 60);
});

test('pattern fingerprint is stable and only uses structured dimensions', () => {
  const dimensions = buildPatternDimensions({
    prediction_scope: 'market',
    data_snapshot: { market_regime: 'risk_off' },
    direction: 'bearish',
    model_confidence: 82,
    catalyst_score: 75,
    surprise_score: 40,
    price_in_score: 85,
    taiwan_mapping_score: 70,
    data_quality_status: 'complete',
  });
  const key = buildPatternKey(dimensions);
  assert.match(key, /market_regime=risk_off/);
  assert.match(key, /price_in_bucket=price_in_high/);
  assert.equal(key, buildPatternKey(dimensions));
});

test('outcome helpers use trading sessions rather than calendar days', () => {
  const dates = ['2026-08-21', '2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28'];
  assert.equal(selectTargetTradingDate(dates, '2026-08-21', 1), '2026-08-24');
  assert.equal(selectTargetTradingDate(dates, '2026-08-21', 5), '2026-08-28');
  assert.equal(selectTargetTradingDate(dates, '2026-08-21', 6), null);
  assert.equal(percentReturn(100, 103), 3);
  assert.equal(percentReturn(null, 103), null);
});

export const CLE_ENGINE_VERSION = 'CLE_V1.0.0';
export const LEARNING_DATA_QUALITY = new Set(['complete', 'degraded']);

export function clamp(value, min = 0, max = 100) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(min, Math.min(max, numeric));
}

export function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function normalizePredictionDirection(value) {
  const text = String(value || '').trim().toLowerCase();
  if (
    text === 'bullish' || text === 'up' || text.includes('偏多') ||
    text.includes('看多') || text.includes('強勢') || text.includes('轉強')
  ) return 'bullish';
  if (
    text === 'bearish' || text === 'down' || text.includes('偏空') ||
    text.includes('偏弱') || text.includes('看空') || text.includes('轉弱')
  ) return 'bearish';
  return 'neutral';
}

export function classifyOutcomeDirection(returnPercent, flatThreshold = 0.3) {
  const value = finiteNumber(returnPercent);
  if (value === null) return null;
  if (value >= flatThreshold) return 'up';
  if (value <= -flatThreshold) return 'down';
  return 'flat';
}

export function isDirectionCorrect(predictedDirection, returnPercent, flatThreshold = 0.3) {
  const actual = classifyOutcomeDirection(returnPercent, flatThreshold);
  if (!actual) return null;
  const predicted = normalizePredictionDirection(predictedDirection);
  return (
    (predicted === 'bullish' && actual === 'up') ||
    (predicted === 'bearish' && actual === 'down') ||
    (predicted === 'neutral' && actual === 'flat')
  );
}

export function confidenceBucket(value) {
  const confidence = clamp(value);
  if (confidence === null) return 'unknown';
  if (confidence < 50) return 'below_50';
  if (confidence < 60) return '50_60';
  if (confidence < 70) return '60_70';
  if (confidence < 80) return '70_80';
  if (confidence < 90) return '80_90';
  return '90_plus';
}

export function scoreBucket(value, prefix) {
  const score = clamp(value);
  if (score === null) return `${prefix}_unknown`;
  if (score < 35) return `${prefix}_low`;
  if (score < 70) return `${prefix}_medium`;
  return `${prefix}_high`;
}

export function calibrateConfidence(modelConfidence, evaluation) {
  const model = clamp(modelConfidence);
  if (model === null) return { calibrated: null, adjustment: 0, applied: false };
  const sampleSize = finiteNumber(evaluation?.sample_size) || 0;
  const accuracy = finiteNumber(evaluation?.accuracy);
  if (sampleSize < 20 || accuracy === null) {
    return { calibrated: model, adjustment: 0, applied: false };
  }
  const empirical = accuracy <= 1 ? accuracy * 100 : accuracy;
  const rawAdjustment = empirical - model;
  const adjustment = Math.max(-10, Math.min(10, Math.round(rawAdjustment * 100) / 100));
  return {
    calibrated: Math.round(Math.max(0, Math.min(100, model + adjustment)) * 100) / 100,
    adjustment,
    applied: true,
  };
}

export function learningRuleMatches(condition, dimensions) {
  if (!condition || typeof condition !== 'object' || Array.isArray(condition)) return false;
  if (!dimensions || typeof dimensions !== 'object' || Array.isArray(dimensions)) return false;
  const entries = Object.entries(condition);
  if (entries.length === 0) return false;
  return entries.every(([key, expected]) => (
    Object.prototype.hasOwnProperty.call(dimensions, key) &&
    String(dimensions[key] ?? 'unknown') === String(expected ?? 'unknown')
  ));
}

export function applyProductionLearningConfidence(modelConfidence, evaluation, rules, dimensions) {
  const calibration = calibrateConfidence(modelConfidence, evaluation);
  if (calibration.calibrated === null) {
    return {
      model_confidence: null,
      calibrated_confidence: null,
      final_confidence: null,
      calibration_adjustment: 0,
      production_rule_adjustment: 0,
      calibration_applied: false,
      applied_rule_ids: [],
    };
  }
  const matched = (Array.isArray(rules) ? rules : []).filter((rule) => {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return false;
    const action = rule.action_json;
    return String(rule.status || '') === 'production' &&
      action && typeof action === 'object' && !Array.isArray(action) &&
      String(action.type || '') === 'confidence_adjustment' &&
      finiteNumber(action.points) !== null &&
      learningRuleMatches(rule.condition_json, dimensions);
  });
  const rawRuleAdjustment = matched.reduce((sum, rule) => (
    sum + (finiteNumber(rule.action_json?.points) || 0)
  ), 0);
  const productionRuleAdjustment = Math.max(-10, Math.min(10, rawRuleAdjustment));
  return {
    model_confidence: clamp(modelConfidence),
    calibrated_confidence: calibration.calibrated,
    final_confidence: Math.round(clamp(calibration.calibrated + productionRuleAdjustment) * 100) / 100,
    calibration_adjustment: calibration.adjustment,
    production_rule_adjustment: productionRuleAdjustment,
    calibration_applied: calibration.applied,
    applied_rule_ids: matched.map((rule) => String(rule.id || rule.rule_key || '')).filter(Boolean),
  };
}

export function percentReturn(basePrice, targetPrice) {
  const base = finiteNumber(basePrice);
  const target = finiteNumber(targetPrice);
  if (base === null || target === null || base === 0) return null;
  return Math.round((((target - base) / base) * 100) * 10000) / 10000;
}

export function buildPatternDimensions(prediction) {
  return {
    scope: String(prediction.prediction_scope || 'market'),
    market_regime: String(prediction.market_regime || prediction.data_snapshot?.market_regime || 'unknown'),
    direction: normalizePredictionDirection(prediction.direction),
    confidence_bucket: confidenceBucket(prediction.model_confidence),
    catalyst_bucket: scoreBucket(prediction.catalyst_score, 'catalyst'),
    surprise_bucket: scoreBucket(prediction.surprise_score, 'surprise'),
    price_in_bucket: scoreBucket(prediction.price_in_score, 'price_in'),
    mapping_bucket: scoreBucket(prediction.taiwan_mapping_score, 'mapping'),
    data_quality: String(prediction.data_quality_status || 'insufficient_data'),
  };
}

export function buildPatternKey(dimensions) {
  const keys = [
    'scope', 'market_regime', 'direction', 'confidence_bucket',
    'catalyst_bucket', 'surprise_bucket', 'price_in_bucket',
    'mapping_bucket', 'data_quality',
  ];
  return keys.map((key) => `${key}=${String(dimensions?.[key] ?? 'unknown')}`).join('|');
}

export function buildReview(input) {
  const dataQuality = String(input.dataQuality || 'insufficient_data');
  const learningEligible = LEARNING_DATA_QUALITY.has(dataQuality) && input.outcomeStatus === 'completed';
  const directionCorrect = input.directionCorrect;
  const confidence = finiteNumber(input.modelConfidence);
  const confidenceError = confidence === null || directionCorrect === null
    ? null
    : Math.round((confidence - (directionCorrect ? 100 : 0)) * 100) / 100;

  if (!learningEligible || directionCorrect === null) {
    return {
      review_result: 'inconclusive',
      direction_accuracy: 'inconclusive',
      timing_accuracy: 'inconclusive',
      catalyst_accuracy: 'unverified',
      surprise_accuracy: 'unverified',
      taiwan_mapping_accuracy: input.scope === 'symbol' ? 'unverified' : 'not_applicable',
      price_in_accuracy: 'unverified',
      error_type: dataQuality === 'provider_failure' ? 'provider_failure' : 'data_quality_issue',
      root_cause: '市場資料不足或時段不完整，這筆結果不得進入學習樣本。',
      missed_signal: null,
      false_signal: null,
      confidence_error: confidenceError,
      lesson: '先修復資料完整性；不可把 Data Failure 當成 Prediction Failure。',
      rule_candidate: {},
      learning_eligible: false,
    };
  }

  const abnormal = finiteNumber(input.abnormalReturn);
  const priceInScore = finiteNumber(input.priceInScore);
  const catalystScore = finiteNumber(input.catalystScore);
  const surpriseScore = finiteNumber(input.surpriseScore);
  const mappingScore = finiteNumber(input.mappingScore);
  const timingCorrect = input.timingCorrect;
  const mappingCorrect = input.scope === 'symbol' && abnormal !== null ? abnormal >= 0 : null;

  if (directionCorrect) {
    return {
      review_result: timingCorrect === false ? 'partial' : 'correct',
      direction_accuracy: 'correct',
      timing_accuracy: timingCorrect === false ? 'incorrect' : timingCorrect === true ? 'correct' : 'inconclusive',
      catalyst_accuracy: catalystScore === null ? 'unverified' : 'correct',
      surprise_accuracy: surpriseScore === null ? 'unverified' : 'correct',
      taiwan_mapping_accuracy: input.scope === 'symbol'
        ? mappingCorrect === null ? 'unverified' : mappingCorrect ? 'correct' : 'incorrect'
        : 'not_applicable',
      price_in_accuracy: priceInScore === null ? 'unverified' : 'correct',
      error_type: null,
      root_cause: '主要方向獲得市場結果確認。',
      missed_signal: null,
      false_signal: null,
      confidence_error: confidenceError,
      lesson: mappingCorrect === false
        ? '大盤方向正確不代表受惠股映射正確；個股仍必須用相對報酬驗證。'
        : '保留被市場確認的證據鏈，並繼續檢查跨日延續性。',
      rule_candidate: {},
      learning_eligible: true,
    };
  }

  let errorType = 'direction_error';
  let rootCause = '市場實際方向與盤前假設不一致。';
  let lesson = '下一次遇到相似條件時，降低單日方向結論的權重。';
  let missedSignal = '盤中反向訊號或市場 Regime 變化未被充分吸收。';
  let falseSignal = '盤前方向訊號未延續至有效收盤。';
  let ruleCandidate = { action: 'reduce_confidence', adjustment: -5 };

  if (confidence !== null && confidence >= 80) {
    errorType = 'overconfidence';
    rootCause = '高 Confidence 判斷沒有被收盤方向確認。';
    lesson = '高信心區間必須依歷史命中率校準，不可由 LLM 單獨決定。';
  }
  if (priceInScore !== null && priceInScore >= 70) {
    errorType = 'price_in_misjudged';
    rootCause = 'Catalyst 可能正確，但市場已提前反映，交易方向沒有延續。';
    lesson = 'Catalyst Correct 不等於 Trade Correct；高 Price-in 必須降低追價信心。';
    falseSignal = '把已被定價的 Catalyst 誤判為新的可交易 Surprise。';
    ruleCandidate = { action: 'reduce_confidence_when_high_price_in', adjustment: -8 };
  } else if (input.scope === 'symbol' && mappingCorrect === false && mappingScore !== null && mappingScore >= 70) {
    errorType = 'taiwan_mapping_error';
    rootCause = '事件方向未有效傳導到指定台股，受惠鏈映射過強。';
    lesson = '台灣映射需同時驗證個股相對大盤與族群表現。';
    falseSignal = '供應鏈敘事存在，但資金沒有進入指定個股。';
    ruleCandidate = { action: 'downgrade_mapping_without_relative_strength', adjustment: -7 };
  } else if (surpriseScore !== null && surpriseScore >= 70) {
    errorType = 'surprise_misread';
    rootCause = '事件被評為高 Surprise，但市場價格沒有依預期方向反應。';
    lesson = 'Surprise 必須以價格與量能確認，不可只看新聞語意。';
  }

  return {
    review_result: 'incorrect',
    direction_accuracy: 'incorrect',
    timing_accuracy: timingCorrect === true ? 'correct' : 'incorrect',
    catalyst_accuracy: catalystScore === null ? 'unverified' : 'incorrect',
    surprise_accuracy: surpriseScore === null ? 'unverified' : 'incorrect',
    taiwan_mapping_accuracy: input.scope === 'symbol'
      ? mappingCorrect === null ? 'unverified' : mappingCorrect ? 'correct' : 'incorrect'
      : 'not_applicable',
    price_in_accuracy: priceInScore === null ? 'unverified' : priceInScore >= 70 ? 'incorrect' : 'unverified',
    error_type: errorType,
    root_cause: rootCause,
    missed_signal: missedSignal,
    false_signal: falseSignal,
    confidence_error: confidenceError,
    lesson,
    rule_candidate: ruleCandidate,
    learning_eligible: true,
  };
}

export function selectTargetTradingDate(tradingDates, reportDate, targetSession) {
  const sorted = [...new Set((tradingDates || []).filter(Boolean))].sort();
  const startIndex = sorted.indexOf(reportDate);
  if (startIndex < 0) return null;
  return sorted[startIndex + Number(targetSession || 0)] || null;
}

export function safeAverage(values) {
  const valid = (values || []).map(finiteNumber).filter((value) => value !== null);
  if (valid.length === 0) return null;
  return Math.round((valid.reduce((sum, value) => sum + value, 0) / valid.length) * 10000) / 10000;
}

export function stableCaseSignature(review, dimensions) {
  return [
    review.error_type || review.review_result || 'unknown',
    dimensions.market_regime || 'unknown',
    dimensions.direction || 'neutral',
    dimensions.confidence_bucket || 'unknown',
    dimensions.price_in_bucket || 'price_in_unknown',
    dimensions.mapping_bucket || 'mapping_unknown',
  ].join('|');
}

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import {
  CLE_ENGINE_VERSION,
  buildPatternDimensions,
  buildPatternKey,
  buildReview,
  calibrateConfidence,
  classifyOutcomeDirection,
  confidenceBucket,
  finiteNumber,
  isDirectionCorrect,
  normalizePredictionDirection,
  percentReturn,
  safeAverage,
  selectTargetTradingDate,
  stableCaseSignature,
} from '../_shared/continuous-learning-core.mjs';
import { resolveMarketStatus } from '../_shared/market-status.ts';
import { authorizeInternalRequest, internalCredentialsFromEnv } from '../_shared/internal-function-auth.mjs';
import type { RuntimeDatabase } from '../_shared/runtime-database-contract.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-cron-secret',
};

type JsonRecord = Record<string, unknown>;
type RuntimeClient = ReturnType<typeof createClient<RuntimeDatabase>>;

type SnapshotRow = {
  symbol: string;
  name: string | null;
  value: number | null;
  change_percent: number | null;
  captured_at: string | null;
  source: string | null;
  phase: string | null;
  trading_date: string | null;
  raw?: unknown;
};

type PredictionRow = JsonRecord & {
  id: string;
  report_date: string;
  prediction_at: string;
  prediction_scope: string;
  symbol: string;
  direction: string;
  model_confidence: number | null;
  data_quality_status: string;
  record_status: string;
};

type OutcomeRow = JsonRecord & {
  id?: string;
  prediction_id: string;
  horizon: string;
  status: string;
  data_quality_status: string;
  return_percent: number | null;
  abnormal_return_percent: number | null;
  direction_correct: boolean | null;
  timing_correct: boolean | null;
};

function asObject(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function asRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item === 'object' && !Array.isArray(item)) as JsonRecord[]
    : [];
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const numeric = finiteNumber(value);
    if (numeric !== null) return numeric;
  }
  return null;
}

function jsonResponse(body: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function getTaipeiDateString(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  return `${parts.find((part) => part.type === 'year')?.value || ''}-${parts.find((part) => part.type === 'month')?.value || ''}-${parts.find((part) => part.type === 'day')?.value || ''}`;
}

function isDateString(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function shiftDate(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

async function readRequestBody(req: Request): Promise<JsonRecord> {
  try {
    return asObject(await req.json());
  } catch {
    return {};
  }
}

function resolveDataQuality(snapshot: JsonRecord | null, ai: JsonRecord): string {
  const sourceFreshness = asObject(snapshot?.source_freshness);
  const missing = [
    ...asStrings(sourceFreshness.missing_sources),
    ...asStrings(ai.missing_sources),
  ];
  const decisionMode = firstText(snapshot?.decision_mode, ai.premium_decision_mode, ai.decision_mode);
  const raw = firstText(
    sourceFreshness.status,
    sourceFreshness.data_quality,
    ai.v10_data_quality_status,
    ai.data_quality,
  ).toLowerCase();
  if (decisionMode === 'blocked') return 'invalid_prediction';
  if (raw.includes('provider')) return 'provider_failure';
  if (raw.includes('stale')) return 'stale_data';
  if (raw.includes('insufficient') || raw.includes('missing')) return 'insufficient_data';
  if (missing.length > 0) return 'degraded';
  if (['complete', 'sufficient', 'fresh', 'verified'].some((word) => raw.includes(word))) return 'complete';
  return snapshot ? 'degraded' : 'insufficient_data';
}

function extractRecommendations(snapshot: JsonRecord | null, ai: JsonRecord): JsonRecord[] {
  const generated = asObject(snapshot?.generated_text);
  const candidates = [
    generated.recommendations,
    ai.premium_recommendations,
    ai.recommendations,
    ai.v10_beneficiary_recommendations,
    ai.beneficiary_recommendations,
  ];
  for (const candidate of candidates) {
    const records = asRecords(candidate);
    if (records.length > 0) return records.slice(0, 10);
  }
  return [];
}

function normalizeSymbol(value: unknown): string {
  return String(value || '').trim().toUpperCase();
}

function snapshotKey(symbol: string, date: string, phase: string): string {
  return `${normalizeSymbol(symbol)}|${date}|${phase}`;
}

function latestSnapshot(rows: SnapshotRow[], symbol: string, date: string, phase: string): SnapshotRow | null {
  const matches = rows.filter((row) =>
    normalizeSymbol(row.symbol) === normalizeSymbol(symbol) &&
    row.trading_date === date && row.phase === phase
  );
  matches.sort((a, b) => String(b.captured_at || '').localeCompare(String(a.captured_at || '')));
  return matches[0] || null;
}

async function fetchCalibrationMap(client: RuntimeClient): Promise<Map<string, JsonRecord>> {
  const { data, error } = await client
    .from('model_evaluations')
    .select('model_version,confidence_bucket,sample_size,accuracy,period_end,evaluated_at')
    .eq('window_days', 90)
    .gte('sample_size', 20)
    .order('period_end', { ascending: false })
    .limit(200);
  if (error) throw error;
  const map = new Map<string, JsonRecord>();
  for (const row of (data || []) as JsonRecord[]) {
    const key = `${String(row.model_version || 'unknown')}|${String(row.confidence_bucket || 'unknown')}`;
    if (!map.has(key)) map.set(key, row);
  }
  return map;
}

async function capturePredictions(
  client: RuntimeClient,
  targetDate: string,
  report: JsonRecord,
  decisionSnapshot: JsonRecord | null,
  premarketRows: SnapshotRow[],
): Promise<PredictionRow[]> {
  const ai = asObject(report.ai_strategy_json);
  const generated = asObject(decisionSnapshot?.generated_text);
  const sourceFreshness = asObject(decisionSnapshot?.source_freshness);
  const sourceRefs = Array.isArray(decisionSnapshot?.source_refs)
    ? decisionSnapshot?.source_refs
    : Array.isArray(ai.important_news_json) ? ai.important_news_json : [];
  const modelVersion = firstText(decisionSnapshot?.engine_version, ai.version, ai.engine_version, 'unknown');
  const factorScores = asObject(decisionSnapshot?.factor_scores);
  const decisionLearning = asObject(factorScores.learning_confidence);
  const modelConfidence = firstNumber(
    decisionLearning.model_confidence,
    generated.confidence_score,
    decisionSnapshot?.confidence_score,
    report.confidence_score,
    ai.confidence_score,
  );
  const calibrationMap = await fetchCalibrationMap(client);
  const decisionFinalConfidence = firstNumber(decisionLearning.final_confidence);
  const offlineCalibration = calibrateConfidence(
      modelConfidence,
      calibrationMap.get(`${modelVersion}|${confidenceBucket(modelConfidence)}`),
    );
  const calibration = decisionFinalConfidence === null ? offlineCalibration : {
    calibrated: decisionFinalConfidence,
    adjustment: modelConfidence === null ? 0 : Math.round((decisionFinalConfidence - modelConfidence) * 100) / 100,
    applied: decisionLearning.calibration_applied === true || (firstNumber(decisionLearning.production_rule_adjustment) || 0) !== 0,
  };
  const predictionAt = firstText(decisionSnapshot?.valid_from, report.created_at, ai.generated_at, new Date().toISOString());
  const dataQuality = resolveDataQuality(decisionSnapshot, ai);
  const decisionMode = firstText(decisionSnapshot?.decision_mode, ai.premium_decision_mode, ai.decision_mode, 'blocked');
  const marketRegime = firstText(decisionSnapshot?.market_regime, ai.market_regime, report.market_bias, 'unknown');
  const researchMaster = asObject(ai.research_master_v2);
  const marketThesis = asObject(researchMaster.market_thesis);
  const common = {
    decision_snapshot_id: decisionSnapshot?.id || null,
    report_id: report.id || null,
    report_date: targetDate,
    prediction_at: predictionAt,
    analysis_window: 'PREMARKET',
    market: 'TW',
    model_confidence: modelConfidence,
    calibrated_confidence: calibration.calibrated,
    calibration_adjustment: calibration.adjustment,
    evidence_score: firstNumber(factorScores.evidence_score, ai.evidence_score, researchMaster.evidence_quality_score),
    catalyst_score: firstNumber(factorScores.catalyst_score, ai.catalyst_score, marketThesis.catalyst_score),
    surprise_score: firstNumber(factorScores.surprise_score, ai.surprise_score, marketThesis.surprise_score),
    taiwan_mapping_score: firstNumber(factorScores.taiwan_mapping_score, ai.taiwan_mapping_score),
    price_in_score: firstNumber(factorScores.price_in_score, ai.price_in_score, marketThesis.price_in_score),
    risk_score: firstNumber(factorScores.risk_score, ai.risk_score),
    expected_horizon: 'close',
    source_refs: sourceRefs,
    benchmark_symbol: 'TAIEX',
    model_version: modelVersion,
    prompt_version: firstText(ai.prompt_version, researchMaster.prompt_version) || null,
    rule_version: firstText(ai.rule_version, researchMaster.rule_version) || null,
    scoring_version: firstText(ai.scoring_version, ai.content_scoring_version) || null,
    data_version: firstText(ai.data_version, ai.market_data_version) || null,
    data_quality_status: dataQuality,
    record_status: dataQuality === 'invalid_prediction' ? 'invalid' : 'valid',
  };

  const marketSnapshot = latestSnapshot(premarketRows, 'TAIEX', targetDate, 'premarket');
  const drafts: JsonRecord[] = [{
    ...common,
    prediction_scope: 'market',
    symbol: 'TAIEX',
    asset_name: '台灣加權指數',
    sector: null,
    event_id: firstText(ai.primary_event_id, marketThesis.event_id) || null,
    thesis: firstText(
      asStrings(generated.reasons)[0],
      marketThesis.thesis,
      marketThesis.summary,
      report.summary,
      `盤前市場方向：${firstText(report.market_bias, ai.market_bias, '震盪觀察')}`,
    ),
    direction: normalizePredictionDirection(firstText(report.market_bias, ai.market_bias, marketRegime)),
    price_at_prediction: finiteNumber(marketSnapshot?.value),
    benchmark_price_at_prediction: finiteNumber(marketSnapshot?.value),
    data_snapshot: {
      market_regime: marketRegime,
      decision_mode: decisionMode,
      content_score: finiteNumber(decisionSnapshot?.content_score ?? ai.content_score),
      source_freshness: sourceFreshness,
      calibration_applied: calibration.applied,
      evaluation_key: firstText(decisionLearning.evaluation_key) || null,
      production_rule_adjustment: firstNumber(decisionLearning.production_rule_adjustment) || 0,
      applied_rule_ids: asStrings(decisionLearning.applied_rule_ids),
    },
  }];

  if (decisionMode === 'recommendations' && dataQuality !== 'invalid_prediction') {
    for (const recommendation of extractRecommendations(decisionSnapshot, ai)) {
      const symbol = normalizeSymbol(recommendation.symbol || recommendation.stock_symbol || recommendation.code);
      if (!symbol) continue;
      const priceRow = latestSnapshot(premarketRows, symbol, targetDate, 'premarket');
      drafts.push({
        ...common,
        prediction_scope: 'symbol',
        symbol,
        asset_name: firstText(recommendation.name, recommendation.company_name) || null,
        sector: firstText(recommendation.sector, recommendation.industry_name, recommendation.industry) || null,
        event_id: firstText(recommendation.event_id, recommendation.catalyst_id) || null,
        thesis: firstText(
          recommendation.reason,
          recommendation.why_this_stock,
          recommendation.trigger_event,
          recommendation.observation_reason,
          `${symbol} 為盤前受惠股候選`,
        ),
        direction: normalizePredictionDirection(firstText(recommendation.direction, recommendation.net_evidence_direction, 'bullish')),
        evidence_score: firstNumber(recommendation.evidence_score, common.evidence_score),
        catalyst_score: firstNumber(recommendation.catalyst_score, recommendation.event_relevance, common.catalyst_score),
        surprise_score: firstNumber(recommendation.surprise_score, common.surprise_score),
        taiwan_mapping_score: firstNumber(recommendation.taiwan_mapping_score, recommendation.mapping_score, recommendation.total_score),
        price_in_score: firstNumber(recommendation.price_in_score, common.price_in_score),
        risk_score: firstNumber(recommendation.risk_score, common.risk_score),
        price_at_prediction: finiteNumber(priceRow?.value),
        benchmark_price_at_prediction: finiteNumber(marketSnapshot?.value),
        data_snapshot: {
          market_regime: marketRegime,
          decision_mode: decisionMode,
          recommendation_role: firstText(recommendation.role, recommendation.role_label) || null,
          source_freshness: sourceFreshness,
          calibration_applied: calibration.applied,
          evaluation_key: firstText(decisionLearning.evaluation_key) || null,
          production_rule_adjustment: firstNumber(decisionLearning.production_rule_adjustment) || 0,
          applied_rule_ids: asStrings(decisionLearning.applied_rule_ids),
        },
      });
    }
  }

  const captured: PredictionRow[] = [];
  for (const draft of drafts) {
    const sourceIdentity = String(decisionSnapshot?.id || report.id || targetDate);
    const idempotencyKey = `${sourceIdentity}:${String(draft.analysis_window)}:${String(draft.symbol)}:${String(draft.expected_horizon)}:${CLE_ENGINE_VERSION}`;
    const { data: existingExact, error: exactError } = await client
      .from('learning_predictions')
      .select('*')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();
    if (exactError) throw exactError;
    if (existingExact) {
      captured.push(existingExact as PredictionRow);
      continue;
    }

    const { data: previous, error: previousError } = await client
      .from('learning_predictions')
      .select('id,root_prediction_id,revision')
      .eq('report_date', targetDate)
      .eq('analysis_window', String(draft.analysis_window))
      .eq('symbol', String(draft.symbol))
      .order('revision', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (previousError) throw previousError;
    const revision = previous ? Number(previous.revision || 1) + 1 : 1;
    const row = {
      ...draft,
      root_prediction_id: previous ? previous.root_prediction_id || previous.id : null,
      supersedes_prediction_id: previous?.id || null,
      revision,
      idempotency_key: idempotencyKey,
    };
    const { data: inserted, error: insertError } = await client
      .from('learning_predictions')
      .insert(row)
      .select('*')
      .single();
    if (insertError) throw insertError;
    captured.push(inserted as PredictionRow);
  }
  return captured;
}

function reconstructPredictionPrice(prediction: PredictionRow, reportClose: SnapshotRow | null): number | null {
  const direct = finiteNumber(prediction.price_at_prediction);
  if (direct !== null) return direct;
  const closeValue = finiteNumber(reportClose?.value);
  const closeChange = finiteNumber(reportClose?.change_percent);
  if (closeValue === null || closeChange === null || closeChange <= -100) return null;
  return closeValue / (1 + closeChange / 100);
}

function excursionForDirection(direction: string, returns: number[]): { favorable: number | null; adverse: number | null } {
  if (returns.length === 0) return { favorable: null, adverse: null };
  const highest = Math.max(...returns);
  const lowest = Math.min(...returns);
  if (normalizePredictionDirection(direction) === 'bearish') {
    return { favorable: Math.max(0, -lowest), adverse: Math.min(0, -highest) };
  }
  if (normalizePredictionDirection(direction) === 'neutral') {
    const largestMove = returns.reduce((chosen, value) => Math.abs(value) > Math.abs(chosen) ? value : chosen, 0);
    return { favorable: Math.max(0, 0.3 - Math.abs(largestMove)), adverse: -Math.abs(largestMove) };
  }
  return { favorable: Math.max(0, highest), adverse: Math.min(0, lowest) };
}

function boundedSemanticText(value: unknown, fallback: unknown): string | null {
  if (typeof value !== 'string') return typeof fallback === 'string' ? fallback : null;
  const sanitized = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
  return sanitized.length >= 8 ? sanitized : typeof fallback === 'string' ? fallback : null;
}

async function enrichReviewsWithSemanticAnalysis(
  reviewRows: JsonRecord[],
  predictions: PredictionRow[],
  outcomes: OutcomeRow[],
  targetDate: string,
): Promise<JsonRecord[]> {
  const apiKey = Deno.env.get('OPENAI_API_KEY') || '';
  if (!apiKey) return reviewRows;
  const predictionMap = new Map(predictions.map((prediction) => [prediction.id, prediction]));
  const outcomeMap = new Map(outcomes.filter((outcome) => outcome.horizon === 'close').map((outcome) => [outcome.prediction_id, outcome]));
  const eligible = reviewRows.filter((review) => {
    const prediction = predictionMap.get(String(review.prediction_id));
    return prediction?.report_date === targetDate &&
      review.learning_eligible === true &&
      review.review_result === 'incorrect';
  }).slice(0, 12);
  if (eligible.length === 0) return reviewRows;

  const input = eligible.map((review) => {
    const prediction = predictionMap.get(String(review.prediction_id));
    const outcome = outcomeMap.get(String(review.prediction_id));
    return {
      prediction_id: review.prediction_id,
      scope: prediction?.prediction_scope,
      direction: prediction?.direction,
      model_confidence: prediction?.model_confidence,
      evidence_score: prediction?.evidence_score,
      catalyst_score: prediction?.catalyst_score,
      surprise_score: prediction?.surprise_score,
      taiwan_mapping_score: prediction?.taiwan_mapping_score,
      price_in_score: prediction?.price_in_score,
      risk_score: prediction?.risk_score,
      return_percent: outcome?.return_percent,
      abnormal_return_percent: outcome?.abnormal_return_percent,
      direction_correct: outcome?.direction_correct,
      timing_correct: outcome?.timing_correct,
      deterministic_error_type: review.error_type,
    };
  });
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: Deno.env.get('CLE_REVIEW_MODEL') || 'gpt-4o-mini',
        temperature: 0.1,
        max_tokens: 1800,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: '你是 Morning Alpha 內部模型評估器。輸入只含已驗證的結構化數值，不得加入外部事實、股票建議或交易指令，也不得改變 correctness、error_type 或 learning eligibility。只輸出 JSON：{"reviews":[{"prediction_id":"uuid","root_cause":"...","missed_signal":"...","false_signal":"...","lesson":"...","rule_candidate":{"action":"reduce_confidence|reduce_confidence_when_high_price_in|downgrade_mapping_without_relative_strength","adjustment":-10到0}}]}。每段最多 120 個中文字；無證據時維持保守措辭。',
          },
          { role: 'user', content: JSON.stringify({ review_date: targetDate, predictions: input }) },
        ],
      }),
    });
    if (!response.ok) return reviewRows;
    const payload = asObject(await response.json());
    const content = asRecords(payload.choices)[0];
    const message = asObject(content?.message);
    if (typeof message.content !== 'string') return reviewRows;
    const parsed = asObject(JSON.parse(message.content));
    const enrichments = new Map(asRecords(parsed.reviews).map((row) => [String(row.prediction_id || ''), row]));
    const allowedActions = new Set([
      'reduce_confidence',
      'reduce_confidence_when_high_price_in',
      'downgrade_mapping_without_relative_strength',
    ]);
    return reviewRows.map((review) => {
      const semantic = enrichments.get(String(review.prediction_id || ''));
      if (!semantic) return review;
      const candidate = asObject(semantic.rule_candidate);
      const action = String(candidate.action || '');
      const adjustment = finiteNumber(candidate.adjustment);
      return {
        ...review,
        root_cause: boundedSemanticText(semantic.root_cause, review.root_cause),
        missed_signal: boundedSemanticText(semantic.missed_signal, review.missed_signal),
        false_signal: boundedSemanticText(semantic.false_signal, review.false_signal),
        lesson: boundedSemanticText(semantic.lesson, review.lesson) || String(review.lesson || ''),
        rule_candidate: allowedActions.has(action) && adjustment !== null
          ? { action, adjustment: Math.max(-10, Math.min(0, adjustment)) }
          : review.rule_candidate,
        review_evidence: {
          ...asObject(review.review_evidence),
          semantic_review: { status: 'completed', model: Deno.env.get('CLE_REVIEW_MODEL') || 'gpt-4o-mini' },
        },
      };
    });
  } catch {
    return reviewRows;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function updateOutcomes(
  client: RuntimeClient,
  targetDate: string,
  predictions: PredictionRow[],
  snapshots: SnapshotRow[],
): Promise<{ outcomes: OutcomeRow[]; created: number; updated: number; unchanged: number }> {
  const tradingDates = [...new Set(
    snapshots
      .filter((row) => normalizeSymbol(row.symbol) === 'TAIEX' && row.phase === 'close' && row.trading_date)
      .map((row) => String(row.trading_date)),
  )].sort();
  const horizons = [
    { horizon: 'intraday', targetSession: 0, phase: 'intraday' },
    { horizon: 'close', targetSession: 0, phase: 'close' },
    { horizon: '1D', targetSession: 1, phase: 'close' },
    { horizon: '3D', targetSession: 3, phase: 'close' },
    { horizon: '5D', targetSession: 5, phase: 'close' },
  ];
  const rows: JsonRecord[] = [];

  for (const prediction of predictions) {
    const reportClose = latestSnapshot(snapshots, prediction.symbol, prediction.report_date, 'close');
    const benchmarkReportClose = latestSnapshot(snapshots, 'TAIEX', prediction.report_date, 'close');
    const basePrice = reconstructPredictionPrice(prediction, reportClose);
    const benchmarkBase = finiteNumber(prediction.benchmark_price_at_prediction) ??
      reconstructPredictionPrice({ ...prediction, price_at_prediction: null } as PredictionRow, benchmarkReportClose);

    for (const definition of horizons) {
      const horizonDate = definition.targetSession === 0
        ? prediction.report_date
        : selectTargetTradingDate(tradingDates, prediction.report_date, definition.targetSession);
      const invalidPrediction = prediction.record_status !== 'valid' ||
        !['complete', 'degraded'].includes(prediction.data_quality_status);
      if (invalidPrediction) {
        rows.push({
          prediction_id: prediction.id,
          horizon: definition.horizon,
          target_session: definition.targetSession,
          target_date: horizonDate,
          evaluated_at: new Date().toISOString(),
          price_at_prediction: basePrice,
          status: 'inconclusive',
          data_quality_status: prediction.data_quality_status,
          source_refs: [],
          failure_reason: 'PREDICTION_DATA_QUALITY_GATE_FAILED',
          outcome_version: 'CLE_OUTCOME_V1',
        });
        continue;
      }
      if (!horizonDate || horizonDate > targetDate) {
        rows.push({
          prediction_id: prediction.id,
          horizon: definition.horizon,
          target_session: definition.targetSession,
          target_date: horizonDate,
          price_at_prediction: basePrice,
          status: 'pending',
          data_quality_status: 'insufficient_data',
          source_refs: [],
          failure_reason: null,
          outcome_version: 'CLE_OUTCOME_V1',
        });
        continue;
      }

      const target = latestSnapshot(snapshots, prediction.symbol, horizonDate, definition.phase);
      const benchmarkTarget = latestSnapshot(snapshots, 'TAIEX', horizonDate, definition.phase);
      const directReturn = definition.targetSession === 0 ? finiteNumber(target?.change_percent) : null;
      const actualReturn = directReturn ?? percentReturn(basePrice, target?.value);
      const benchmarkDirect = definition.targetSession === 0 ? finiteNumber(benchmarkTarget?.change_percent) : null;
      const benchmarkReturn = benchmarkDirect ?? percentReturn(benchmarkBase, benchmarkTarget?.value);
      const directionCorrect = isDirectionCorrect(prediction.direction, actualReturn);
      const actualDirection = classifyOutcomeDirection(actualReturn);
      const observationReturns = snapshots
        .filter((row) =>
          normalizeSymbol(row.symbol) === normalizeSymbol(prediction.symbol) &&
          row.trading_date && row.trading_date >= prediction.report_date && row.trading_date <= horizonDate &&
          ['intraday', 'close'].includes(String(row.phase || ''))
        )
        .map((row) => row.trading_date === prediction.report_date && finiteNumber(row.change_percent) !== null
          ? finiteNumber(row.change_percent)
          : percentReturn(basePrice, row.value))
        .filter((value): value is number => value !== null);
      const excursion = excursionForDirection(prediction.direction, observationReturns);
      const completed = actualReturn !== null;
      rows.push({
        prediction_id: prediction.id,
        horizon: definition.horizon,
        target_session: definition.targetSession,
        target_date: horizonDate,
        evaluated_at: new Date().toISOString(),
        price_at_prediction: basePrice,
        outcome_price: finiteNumber(target?.value),
        close_price: finiteNumber(target?.value),
        max_favorable_excursion: excursion.favorable,
        max_adverse_excursion: excursion.adverse,
        return_percent: actualReturn,
        benchmark_return_percent: benchmarkReturn,
        sector_return_percent: null,
        abnormal_return_percent: actualReturn !== null && benchmarkReturn !== null
          ? Math.round((actualReturn - benchmarkReturn) * 10000) / 10000
          : null,
        volume_change_percent: null,
        thesis_confirmed: prediction.prediction_scope === 'market'
          ? directionCorrect
          : directionCorrect === null || benchmarkReturn === null ? null : directionCorrect && actualReturn! >= benchmarkReturn,
        direction_correct: directionCorrect,
        timing_correct: definition.horizon === 'close' ? directionCorrect : null,
        outcome_direction: actualDirection,
        status: completed ? 'completed' : 'insufficient_data',
        data_quality_status: completed
          ? prediction.prediction_scope === 'symbol' && benchmarkReturn === null ? 'degraded' : 'complete'
          : 'insufficient_data',
        source_refs: target ? [{
          table: 'market_data_snapshots',
          symbol: target.symbol,
          phase: target.phase,
          trading_date: target.trading_date,
          captured_at: target.captured_at,
          source: target.source,
        }] : [],
        failure_reason: completed ? null : 'TARGET_MARKET_SNAPSHOT_MISSING',
        outcome_version: 'CLE_OUTCOME_V1',
      });
    }
  }

  if (rows.length === 0) return { outcomes: [], created: 0, updated: 0, unchanged: 0 };
  const predictionIds = [...new Set(rows.map((row) => String(row.prediction_id)))];
  const { data: beforeRows, error: beforeError } = await client
    .from('prediction_outcomes').select('*').in('prediction_id', predictionIds);
  if (beforeError) throw beforeError;
  const beforeMap = new Map(((beforeRows || []) as JsonRecord[]).map((row) => [`${row.prediction_id}:${row.horizon}`, row]));
  const stable = (row: JsonRecord): string => {
    const { id: _id, created_at: _created, updated_at: _updated, evaluated_at: _evaluated, ...value } = row;
    return JSON.stringify(value, Object.keys(value).sort());
  };
  const changedRows = rows.filter((row) => {
    const existing = beforeMap.get(`${row.prediction_id}:${row.horizon}`);
    return !existing || stable(existing) !== stable(row);
  });
  const created = changedRows.filter((row) => !beforeMap.has(`${row.prediction_id}:${row.horizon}`)).length;
  const updated = changedRows.length - created;
  const unchanged = rows.length - changedRows.length;
  if (changedRows.length > 0) {
    const { error } = await client.from('prediction_outcomes')
      .upsert(changedRows, { onConflict: 'prediction_id,horizon' });
    if (error) throw error;
  }
  const { data, error } = await client.from('prediction_outcomes').select('*').in('prediction_id', predictionIds);
  if (error) throw error;
  return { outcomes: (data || []) as OutcomeRow[], created, updated, unchanged };
}

async function createReviewsAndCases(
  client: RuntimeClient,
  runId: string,
  targetDate: string,
  predictions: PredictionRow[],
  outcomes: OutcomeRow[],
): Promise<{ reviews: JsonRecord[]; reviewsCreated: number; reviewsUnchanged: number; casesCreated: number; casesUnchanged: number }> {
  const predictionMap = new Map(predictions.map((prediction) => [prediction.id, prediction]));
  const closeOutcomes = outcomes.filter((outcome) =>
    outcome.horizon === 'close' && predictionMap.get(outcome.prediction_id)?.report_date === targetDate
  );
  const reviewRows: JsonRecord[] = [];
  for (const outcome of closeOutcomes) {
    const prediction = predictionMap.get(outcome.prediction_id);
    if (!prediction) continue;
    const review = buildReview({
      dataQuality: outcome.data_quality_status,
      outcomeStatus: outcome.status,
      directionCorrect: outcome.direction_correct,
      timingCorrect: outcome.timing_correct,
      modelConfidence: prediction.model_confidence,
      abnormalReturn: outcome.abnormal_return_percent,
      priceInScore: prediction.price_in_score,
      catalystScore: prediction.catalyst_score,
      surpriseScore: prediction.surprise_score,
      mappingScore: prediction.taiwan_mapping_score,
      scope: prediction.prediction_scope,
    });
    reviewRows.push({
      prediction_id: prediction.id,
      outcome_id: outcome.id || null,
      review_date: prediction.report_date,
      review_version: 'CLE_REVIEW_V1',
      idempotency_key: `${prediction.id}:close:CLE_REVIEW_V1`,
      ...review,
      review_evidence: {
        horizon: 'close',
        return_percent: outcome.return_percent,
        abnormal_return_percent: outcome.abnormal_return_percent,
        direction_correct: outcome.direction_correct,
        timing_correct: outcome.timing_correct,
        data_quality_status: outcome.data_quality_status,
      },
    });
  }
  if (reviewRows.length === 0) return { reviews: [], reviewsCreated: 0, reviewsUnchanged: 0, casesCreated: 0, casesUnchanged: 0 };
  const enrichedReviewRows = await enrichReviewsWithSemanticAnalysis(reviewRows, predictions, outcomes, targetDate);
  const reviewKeys = enrichedReviewRows.map((row) => String(row.idempotency_key));
  const { data: existingReviews, error: existingReviewError } = await client
    .from('prediction_reviews').select('*').in('idempotency_key', reviewKeys);
  if (existingReviewError) throw existingReviewError;
  const existingReviewKeys = new Set(((existingReviews || []) as JsonRecord[]).map((row) => String(row.idempotency_key)));
  const newReviewRows = enrichedReviewRows.filter((row) => !existingReviewKeys.has(String(row.idempotency_key)));
  if (newReviewRows.length > 0) {
    const { error: reviewInsertError } = await client.from('prediction_reviews').insert(newReviewRows);
    if (reviewInsertError) throw reviewInsertError;
  }
  const { data: reviews, error: reviewError } = await client
    .from('prediction_reviews').select('*').in('idempotency_key', reviewKeys);
  if (reviewError) throw reviewError;

  const caseRows: JsonRecord[] = [];
  for (const reviewRow of (reviews || []) as JsonRecord[]) {
    if (reviewRow.learning_eligible !== true) continue;
    if (!['correct', 'incorrect'].includes(String(reviewRow.review_result))) continue;
    const prediction = predictionMap.get(String(reviewRow.prediction_id));
    if (!prediction) continue;
    const dimensions = buildPatternDimensions(prediction);
    const caseType = reviewRow.review_result === 'incorrect' ? 'error' : 'success';
    caseRows.push({
      prediction_id: prediction.id,
      prediction_review_id: reviewRow.id,
      case_type: caseType,
      case_signature: stableCaseSignature(reviewRow, dimensions),
      title: caseType === 'error'
        ? `${prediction.symbol}｜${String(reviewRow.error_type || '判斷誤差')}`
        : `${prediction.symbol}｜方向與證據鏈獲得確認`,
      root_cause: reviewRow.root_cause || null,
      lesson: reviewRow.lesson,
      effective_evidence: caseType === 'success' && prediction.thesis ? [String(prediction.thesis)] : [],
      missed_signals: reviewRow.missed_signal ? [reviewRow.missed_signal] : [],
      false_signals: reviewRow.false_signal ? [reviewRow.false_signal] : [],
      pattern_dimensions: dimensions,
      market_regime: dimensions.market_regime,
      confidence_bucket: dimensions.confidence_bucket,
      status: 'active',
    });
  }
  let casesCreated = 0;
  let casesUnchanged = 0;
  if (caseRows.length > 0) {
    const reviewIds = caseRows.map((row) => String(row.prediction_review_id));
    const { data: existingCases, error: existingCaseError } = await client
      .from('learning_cases').select('prediction_review_id,case_type').in('prediction_review_id', reviewIds);
    if (existingCaseError) throw existingCaseError;
    const existingKeys = new Set(((existingCases || []) as JsonRecord[]).map((row) => `${row.prediction_review_id}:${row.case_type}`));
    const newCaseRows = caseRows.filter((row) => !existingKeys.has(`${row.prediction_review_id}:${row.case_type}`));
    casesCreated = newCaseRows.length;
    casesUnchanged = caseRows.length - newCaseRows.length;
    if (newCaseRows.length > 0) {
      const { error: caseError } = await client.from('learning_cases').insert(newCaseRows);
      if (caseError) throw caseError;
    }
  }

  await client.from('learning_audit_logs').upsert({
    learning_run_id: runId,
    idempotency_key: `${runId}:reviews`,
    entity_type: 'learning_run',
    entity_id: runId,
    action: 'reviews_generated',
    actor_type: 'system',
    before_json: {},
    after_json: { reviews_created: newReviewRows.length, reviews_unchanged: enrichedReviewRows.length - newReviewRows.length, cases_created: casesCreated, cases_unchanged: casesUnchanged },
    reason: 'Deterministic Prediction vs Reality review completed.',
  }, { onConflict: 'idempotency_key', ignoreDuplicates: true });
  return { reviews: (reviews || []) as JsonRecord[], reviewsCreated: newReviewRows.length, reviewsUnchanged: enrichedReviewRows.length - newReviewRows.length, casesCreated, casesUnchanged };
}

async function aggregatePatterns(
  client: RuntimeClient,
  targetDate: string,
  predictions: PredictionRow[],
  outcomes: OutcomeRow[],
  reviews: JsonRecord[],
): Promise<{ patterns: JsonRecord[]; groups: Map<string, JsonRecord[]> }> {
  const predictionMap = new Map(predictions.map((prediction) => [prediction.id, prediction]));
  const outcomeMap = new Map(
    outcomes.filter((outcome) => outcome.horizon === 'close').map((outcome) => [outcome.prediction_id, outcome]),
  );
  const groups = new Map<string, JsonRecord[]>();
  for (const review of reviews) {
    if (review.learning_eligible !== true) continue;
    const prediction = predictionMap.get(String(review.prediction_id));
    const outcome = outcomeMap.get(String(review.prediction_id));
    if (!prediction || !outcome) continue;
    const dimensions = buildPatternDimensions(prediction);
    const key = buildPatternKey(dimensions);
    const group = groups.get(key) || [];
    group.push({ prediction, outcome, review, dimensions });
    groups.set(key, group);
  }

  const patternRows: JsonRecord[] = [];
  for (const [patternKey, group] of groups) {
    const success = group.filter((item) => asObject(item.review).review_result === 'correct').length;
    const failure = group.filter((item) => asObject(item.review).review_result === 'incorrect').length;
    const inconclusive = group.length - success - failure;
    const sampleSize = success + failure;
    const confidences = group.map((item) => asObject(item.prediction).model_confidence);
    const returns = group.map((item) => asObject(item.outcome).return_percent);
    const abnormalReturns = group.map((item) => asObject(item.outcome).abnormal_return_percent);
    const averageConfidence = safeAverage(confidences);
    const accuracy = sampleSize > 0 ? success / sampleSize : null;
    patternRows.push({
      pattern_key: patternKey,
      pattern_version: 'CLE_PATTERN_V1',
      dimensions: group[0]?.dimensions || {},
      sample_size: sampleSize,
      success_count: success,
      failure_count: failure,
      inconclusive_count: inconclusive,
      follow_through_rate: accuracy,
      average_return: safeAverage(returns),
      average_abnormal_return: safeAverage(abnormalReturns),
      average_confidence: averageConfidence,
      calibration_gap: accuracy === null || averageConfidence === null ? null : averageConfidence - accuracy * 100,
      first_seen_date: group.map((item) => String(asObject(item.prediction).report_date)).sort()[0] || targetDate,
      last_seen_date: group.map((item) => String(asObject(item.prediction).report_date)).sort().at(-1) || targetDate,
      last_evaluated_at: new Date().toISOString(),
      statistics: { review_count: group.length, learning_sample_size: sampleSize },
      status: sampleSize >= 20 ? 'active' : 'insufficient_sample',
    });
  }
  if (patternRows.length === 0) return { patterns: [], groups };
  const { data, error } = await client
    .from('market_patterns')
    .upsert(patternRows, { onConflict: 'pattern_key' })
    .select('*');
  if (error) throw error;
  return { patterns: (data || []) as JsonRecord[], groups };
}

function brierScore(items: JsonRecord[], confidenceAdjustment = 0): number | null {
  const values = items.map((item) => {
    const prediction = asObject(item.prediction);
    const review = asObject(item.review);
    const confidence = finiteNumber(prediction.model_confidence);
    if (confidence === null || !['correct', 'incorrect'].includes(String(review.review_result))) return null;
    const probability = Math.max(0, Math.min(1, (confidence + confidenceAdjustment) / 100));
    const actual = review.review_result === 'correct' ? 1 : 0;
    return (probability - actual) ** 2;
  }).filter((value): value is number => value !== null);
  return safeAverage(values);
}

function pairedBrierImprovement(items: JsonRecord[], confidenceAdjustment: number): {
  mean_improvement: number | null;
  standard_error: number | null;
  lower_90_bound: number | null;
} {
  const improvements = items.map((item) => {
    const prediction = asObject(item.prediction);
    const review = asObject(item.review);
    const confidence = finiteNumber(prediction.model_confidence);
    if (confidence === null || !['correct', 'incorrect'].includes(String(review.review_result))) return null;
    const actual = review.review_result === 'correct' ? 1 : 0;
    const baseline = Math.max(0, Math.min(1, confidence / 100));
    const candidate = Math.max(0, Math.min(1, (confidence + confidenceAdjustment) / 100));
    return (baseline - actual) ** 2 - (candidate - actual) ** 2;
  }).filter((value): value is number => value !== null);
  const mean = safeAverage(improvements);
  if (mean === null || improvements.length < 2) {
    return { mean_improvement: mean, standard_error: null, lower_90_bound: null };
  }
  const variance = improvements.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (improvements.length - 1);
  const standardError = Math.sqrt(variance / improvements.length);
  return {
    mean_improvement: mean,
    standard_error: Math.round(standardError * 1_000_000) / 1_000_000,
    lower_90_bound: Math.round((mean - 1.645 * standardError) * 1_000_000) / 1_000_000,
  };
}

async function evaluateModels(
  client: RuntimeClient,
  targetDate: string,
  predictions: PredictionRow[],
  outcomes: OutcomeRow[],
  reviews: JsonRecord[],
): Promise<number> {
  const predictionMap = new Map(predictions.map((prediction) => [prediction.id, prediction]));
  const outcomeMap = new Map(
    outcomes.filter((outcome) => outcome.horizon === 'close').map((outcome) => [outcome.prediction_id, outcome]),
  );
  const items = reviews.map((review) => ({
    review,
    prediction: predictionMap.get(String(review.prediction_id)),
    outcome: outcomeMap.get(String(review.prediction_id)),
  })).filter((item) => item.prediction && item.outcome) as JsonRecord[];
  const evaluationRows: JsonRecord[] = [];

  for (const windowDays of [30, 90]) {
    const periodStart = shiftDate(targetDate, -(windowDays - 1));
    const inWindow = items.filter((item) => {
      const prediction = asObject(item.prediction);
      return String(prediction.report_date) >= periodStart && String(prediction.report_date) <= targetDate;
    });
    const groups = new Map<string, JsonRecord[]>();
    for (const item of inWindow) {
      const prediction = asObject(item.prediction);
      const key = `${String(prediction.model_version || 'unknown')}|${confidenceBucket(prediction.model_confidence)}`;
      const group = groups.get(key) || [];
      group.push(item);
      groups.set(key, group);
    }
    for (const [key, group] of groups) {
      const [modelVersion, bucket] = key.split('|');
      const eligible = group.filter((item) => asObject(item.review).learning_eligible === true);
      const correct = eligible.filter((item) => asObject(item.review).review_result === 'correct').length;
      const sampleSize = eligible.filter((item) => ['correct', 'incorrect'].includes(String(asObject(item.review).review_result))).length;
      const accuracy = sampleSize > 0 ? correct / sampleSize : null;
      const bullish = eligible.filter((item) => asObject(item.prediction).direction === 'bullish');
      const bullishCorrect = bullish.filter((item) => asObject(item.review).review_result === 'correct').length;
      const mapping = eligible.filter((item) => asObject(item.prediction).prediction_scope === 'symbol');
      const mappingCorrect = mapping.filter((item) => {
        const abnormal = finiteNumber(asObject(item.outcome).abnormal_return_percent);
        return abnormal !== null && abnormal >= 0;
      }).length;
      const priceInHigh = eligible.filter((item) => (finiteNumber(asObject(item.prediction).price_in_score) || 0) >= 70);
      const priceInErrors = priceInHigh.filter((item) => asObject(item.review).review_result === 'incorrect').length;
      const complete = group.filter((item) => ['complete', 'degraded'].includes(String(asObject(item.outcome).data_quality_status))).length;
      const averageConfidence = safeAverage(eligible.map((item) => asObject(item.prediction).model_confidence));
      evaluationRows.push({
        evaluation_key: `${targetDate}:${windowDays}:${modelVersion}:${bucket}:CLE_EVALUATION_V1`,
        evaluation_version: 'CLE_EVALUATION_V1',
        model_version: modelVersion,
        prompt_version: firstText(asObject(eligible[0]?.prediction).prompt_version) || null,
        rule_version: firstText(asObject(eligible[0]?.prediction).rule_version) || null,
        period_start: periodStart,
        period_end: targetDate,
        window_days: windowDays,
        confidence_bucket: bucket,
        sample_size: sampleSize,
        accuracy,
        precision_score: bullish.length > 0 ? bullishCorrect / bullish.length : null,
        brier_score: brierScore(eligible),
        calibration_gap: accuracy === null || averageConfidence === null ? null : averageConfidence / 100 - accuracy,
        taiwan_mapping_accuracy: mapping.length > 0 ? mappingCorrect / mapping.length : null,
        price_in_error_rate: priceInHigh.length > 0 ? priceInErrors / priceInHigh.length : null,
        false_positive_rate: bullish.length > 0 ? (bullish.length - bullishCorrect) / bullish.length : null,
        data_completeness_rate: group.length > 0 ? complete / group.length : null,
        metrics: { average_confidence: averageConfidence, total_records: group.length },
        evaluated_at: new Date().toISOString(),
      });
    }
  }
  if (evaluationRows.length === 0) return 0;
  const { error } = await client
    .from('model_evaluations')
    .upsert(evaluationRows, { onConflict: 'evaluation_key' });
  if (error) throw error;
  return evaluationRows.length;
}

async function evaluateRuleCandidates(
  client: RuntimeClient,
  targetDate: string,
  patterns: JsonRecord[],
  groups: Map<string, JsonRecord[]>,
): Promise<number> {
  let evaluated = 0;
  for (const pattern of patterns) {
    const sampleSize = Number(pattern.sample_size || 0);
    const rate = finiteNumber(pattern.follow_through_rate);
    if (sampleSize < 20 || rate === null || (rate >= 0.55 && rate < 0.75)) continue;
    const patternKey = String(pattern.pattern_key);
    const isWeak = rate < 0.55;
    const adjustment = isWeak ? -8 : 4;
    const ruleKey = `pattern:${patternKey}:${isWeak ? 'downgrade' : 'reinforce'}:v1`;
    const { data: existingRule, error: existingRuleError } = await client
      .from('learning_rules')
      .select('*')
      .eq('rule_key', ruleKey)
      .maybeSingle();
    if (existingRuleError) throw existingRuleError;
    let rule = existingRule as JsonRecord | null;
    if (!rule) {
      const { data: insertedRule, error: ruleError } = await client
        .from('learning_rules')
        .insert({
          rule_key: ruleKey,
          name: isWeak ? '相似 Pattern 信心降權' : '相似 Pattern 證據加權',
          hypothesis: isWeak
            ? `此 Pattern 在 ${sampleSize} 筆可信樣本中的方向成立率僅 ${(rate * 100).toFixed(1)}%。`
            : `此 Pattern 在 ${sampleSize} 筆可信樣本中的方向成立率達 ${(rate * 100).toFixed(1)}%。`,
          condition_json: pattern.dimensions,
          action_json: { type: 'confidence_adjustment', points: adjustment, production_effect: false },
          source_pattern_id: pattern.id,
          minimum_sample_size: 20,
          status: 'candidate',
          version: 1,
        })
        .select('*')
        .single();
      if (ruleError) throw ruleError;
      rule = insertedRule as JsonRecord;
    }
    if (!rule?.id) throw new Error('LEARNING_RULE_INSERT_FAILED');
    const group = (groups.get(patternKey) || []).sort((a, b) =>
      String(asObject(a.prediction).report_date).localeCompare(String(asObject(b.prediction).report_date))
    );
    const splitIndex = Math.floor(group.length * 0.7);
    const training = group.slice(0, splitIndex);
    const outOfSample = group.slice(splitIndex);
    const baselineCalibration = brierScore(outOfSample);
    const candidateCalibration = brierScore(outOfSample, adjustment);
    const statisticalEvidence = pairedBrierImprovement(outOfSample, adjustment);
    const enough = training.length >= 20 && outOfSample.length >= 10;
    const statisticallySupported = statisticalEvidence.lower_90_bound !== null && statisticalEvidence.lower_90_bound > 0;
    const passed = enough && statisticallySupported && baselineCalibration !== null && candidateCalibration !== null && candidateCalibration < baselineCalibration;
    const status = enough ? passed ? 'passed' : 'failed' : 'insufficient_sample';
    const outOfSampleCorrect = outOfSample.filter((item) => asObject(item.review).review_result === 'correct').length;
    const outOfSampleAccuracy = outOfSample.length > 0 ? outOfSampleCorrect / outOfSample.length : null;
    const averageAbnormalReturn = safeAverage(outOfSample.map((item) => asObject(item.outcome).abnormal_return_percent));
    const averageAdverseExcursion = safeAverage(outOfSample.map((item) => asObject(item.outcome).max_adverse_excursion));
    const regressionFailures: string[] = [];
    if (!enough) regressionFailures.push('minimum_sample_not_met');
    if (enough && !statisticallySupported) regressionFailures.push('paired_brier_improvement_not_statistically_supported');
    if (enough && baselineCalibration !== null && candidateCalibration !== null && candidateCalibration >= baselineCalibration) {
      regressionFailures.push('out_of_sample_calibration_not_improved');
    }
    const { error: backtestError } = await client.from('rule_backtests').upsert({
      rule_id: rule.id,
      backtest_version: 'CLE_BACKTEST_V1',
      idempotency_key: `${rule.id}:${targetDate}:CLE_BACKTEST_V1`,
      training_start: training.length ? String(asObject(training[0].prediction).report_date) : null,
      training_end: training.length ? String(asObject(training.at(-1)?.prediction).report_date) : null,
      out_of_sample_start: outOfSample.length ? String(asObject(outOfSample[0].prediction).report_date) : null,
      out_of_sample_end: outOfSample.length ? String(asObject(outOfSample.at(-1)?.prediction).report_date) : null,
      in_sample_size: training.length,
      out_of_sample_size: outOfSample.length,
      baseline_accuracy: outOfSampleAccuracy,
      candidate_accuracy: outOfSampleAccuracy,
      baseline_calibration_error: baselineCalibration,
      candidate_calibration_error: candidateCalibration,
      regression_failures: regressionFailures,
      market_regime_results: {
        [String(asObject(pattern.dimensions).market_regime || 'unknown')]: {
          sample_size: outOfSample.length,
          accuracy: outOfSampleAccuracy,
          average_abnormal_return: averageAbnormalReturn,
          average_adverse_excursion: averageAdverseExcursion,
        },
      },
      status,
      result_json: {
        confidence_adjustment: adjustment,
        production_effect: false,
        exact_pattern_scope: true,
        paired_brier: statisticalEvidence,
        benchmark_comparison: { average_abnormal_return: averageAbnormalReturn },
        drawdown_tradeoff: { average_max_adverse_excursion: averageAdverseExcursion },
        existing_rule_regression_scope: 'exact_pattern_only',
      },
      completed_at: new Date().toISOString(),
    }, { onConflict: 'idempotency_key', ignoreDuplicates: true });
    if (backtestError) throw backtestError;
    if (passed && rule.status === 'candidate') {
      const { error: statusError } = await client
        .from('learning_rules')
        .update({ status: 'eligible_shadow' })
        .eq('id', rule.id)
        .eq('status', 'candidate');
      if (statusError) throw statusError;
    }
    evaluated += 1;
  }
  return evaluated;
}

async function updateShadowRules(
  client: RuntimeClient,
  targetDate: string,
  groups: Map<string, JsonRecord[]>,
): Promise<number> {
  if (targetDate !== getTaipeiDateString()) return 0;
  const { data, error } = await client
    .from('learning_rules')
    .select('id,status,condition_json,shadow_started_at,shadow_completed_at')
    .in('status', ['eligible_shadow', 'shadow'])
    .limit(200);
  if (error) throw error;
  let evaluated = 0;
  for (const row of (data || []) as JsonRecord[]) {
    const ruleId = String(row.id || '');
    if (!ruleId) continue;
    if (row.status === 'eligible_shadow') {
      const { error: startError } = await client
        .from('learning_rules')
        .update({
          status: 'shadow',
          shadow_started_at: new Date().toISOString(),
          shadow_sample_size: 0,
          shadow_accuracy: null,
        })
        .eq('id', ruleId)
        .eq('status', 'eligible_shadow');
      if (startError) throw startError;
      evaluated += 1;
      continue;
    }
    const startedDate = firstText(row.shadow_started_at).slice(0, 10);
    if (!startedDate || row.shadow_completed_at) {
      evaluated += 1;
      continue;
    }
    const patternKey = buildPatternKey(asObject(row.condition_json));
    const samples = (groups.get(patternKey) || []).filter((item) => {
      const predictionDate = firstText(asObject(item.prediction).report_date);
      const review = asObject(item.review);
      return predictionDate > startedDate &&
        review.learning_eligible === true &&
        ['correct', 'incorrect'].includes(String(review.review_result));
    });
    const correct = samples.filter((item) => asObject(item.review).review_result === 'correct').length;
    const sampleSize = samples.length;
    const updates: JsonRecord = {
      shadow_sample_size: sampleSize,
      shadow_accuracy: sampleSize > 0 ? correct / sampleSize : null,
    };
    if (sampleSize >= 10) updates.shadow_completed_at = new Date().toISOString();
    const { error: updateError } = await client
      .from('learning_rules')
      .update(updates)
      .eq('id', ruleId)
      .eq('status', 'shadow');
    if (updateError) throw updateError;
    evaluated += 1;
  }
  return evaluated;
}

async function loadPredictionAndMarketWindow(
  client: RuntimeClient,
  targetDate: string,
): Promise<{ predictions: PredictionRow[]; snapshots: SnapshotRow[] }> {
  const earliest = shiftDate(targetDate, -120);
  const { data: predictions, error: predictionError } = await client
    .from('learning_predictions')
    .select('*')
    .gte('report_date', earliest)
    .lte('report_date', targetDate)
    .order('report_date', { ascending: true })
    .limit(2000);
  if (predictionError) throw predictionError;
  const predictionRows = (predictions || []) as PredictionRow[];
  const symbols = [...new Set(['TAIEX', ...predictionRows.map((row) => normalizeSymbol(row.symbol)).filter(Boolean)])];
  const { data: snapshots, error: snapshotError } = await client
    .from('market_data_snapshots')
    .select('symbol,name,value,change_percent,captured_at,source,phase,trading_date,raw')
    .gte('trading_date', earliest)
    .lte('trading_date', targetDate)
    .in('symbol', symbols)
    .in('phase', ['premarket', 'intraday', 'close'])
    .order('captured_at', { ascending: true })
    .limit(10000);
  if (snapshotError) throw snapshotError;
  return { predictions: predictionRows, snapshots: (snapshots || []) as SnapshotRow[] };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Only POST allowed' }, 405);

  const auth = await authorizeInternalRequest(req.headers, internalCredentialsFromEnv());
  if (!auth.ok) return jsonResponse({ success: false, error: auth.error_code, error_code: auth.error_code }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ success: false, error: 'Supabase credentials missing' }, 500);
  }

  const body = await readRequestBody(req);
  const today = getTaipeiDateString();
  const backfill = body.backfill === true;
  const requestedDate = body.target_date;
  if (requestedDate && (!backfill || !isDateString(requestedDate))) {
    return jsonResponse({
      success: false,
      error: 'TARGET_DATE_REQUIRES_EXPLICIT_BACKFILL',
      today_date: today,
    }, 400);
  }
  const targetDate = backfill && isDateString(requestedDate) ? requestedDate : today;
  if (targetDate > today) {
    return jsonResponse({ success: false, error: 'TARGET_DATE_IN_FUTURE', target_date: targetDate }, 400);
  }

  const marketStatus = resolveMarketStatus(targetDate);
  if (!marketStatus.is_trading_day) {
    return jsonResponse({
      success: true,
      skipped: true,
      reason: 'MARKET_STATUS_NOT_OPEN',
      target_date: targetDate,
      engine_version: CLE_ENGINE_VERSION,
    });
  }

  const client = createClient<RuntimeDatabase>(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const runType = backfill ? 'backfill' : 'daily';
  const runKey = `${targetDate}:${runType}:${CLE_ENGINE_VERSION}`;

  if (!backfill) {
    const { data: tradingDayState, error: tradingDayStateError } = await client
      .from('trading_day_state')
      .select('current_state,state_rank,checkpoint_status')
      .eq('trading_date', targetDate)
      .maybeSingle();
    if (tradingDayStateError) {
      return jsonResponse({
        success: false,
        error: 'TRADING_DAY_STATE_LOOKUP_FAILED',
        detail: tradingDayStateError.message,
        target_date: targetDate,
        engine_version: CLE_ENGINE_VERSION,
        failure_isolated: true,
      }, 500);
    }
    const closingStatus = asObject(asObject(tradingDayState?.checkpoint_status).closing_verification);
    const closingComplete = Number(tradingDayState?.state_rank || 0) >= 110
      && String(closingStatus.status || '') === 'SUCCEEDED';
    if (!closingComplete) {
      return jsonResponse({
        success: true,
        skipped: true,
        reason: 'CLOSING_VERIFICATION_INCOMPLETE',
        target_date: targetDate,
        engine_version: CLE_ENGINE_VERSION,
        closing_state: tradingDayState?.current_state || null,
      });
    }
  }

  let runId: string | null = null;
  const counters = {
    predictions_processed: 0,
    outcomes_created: 0,
    outcomes_updated: 0,
    outcomes_unchanged: 0,
    reviews_created: 0,
    reviews_updated: 0,
    reviews_unchanged: 0,
    cases_created: 0,
    cases_unchanged: 0,
    skipped_count: 0,
    failed_count: 0,
    patterns_updated: 0,
    rules_evaluated: 0,
  };

  try {
    const { data: existingRun, error: existingRunError } = await client
      .from('learning_runs')
      .select('*')
      .eq('idempotency_key', runKey)
      .maybeSingle();
    if (existingRunError) throw existingRunError;
    if (existingRun && String(existingRun.status) === 'succeeded') {
      return jsonResponse({
        success: true,
        reused: true,
        run_id: existingRun.id,
        target_date: targetDate,
        engine_version: CLE_ENGINE_VERSION,
      });
    }
    if (existingRun) {
      runId = String(existingRun.id);
      const { error } = await client.from('learning_runs').update({
        status: 'running',
        started_at: new Date().toISOString(),
        completed_at: null,
        retry_count: Number(existingRun.retry_count || 0) + 1,
        errors: [],
      }).eq('id', runId);
      if (error) throw error;
    } else {
      const { data: insertedRun, error } = await client.from('learning_runs').insert({
        run_date: targetDate,
        run_type: runType,
        idempotency_key: runKey,
        engine_version: CLE_ENGINE_VERSION,
        status: 'running',
        metadata: { failure_isolation: true, production_rule_mutation: false },
      }).select('id').single();
      if (error) throw error;
      runId = String(insertedRun.id);
    }

    const { data: report, error: reportError } = await client
      .from('reports')
      .select('id,report_date,summary,market_bias,confidence_score,ai_strategy_json,created_at,updated_at')
      .eq('report_date', targetDate)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (reportError) throw reportError;

    if (!report) {
      const { error: skipError } = await client.from('learning_runs').update({
        status: 'skipped',
        completed_at: new Date().toISOString(),
        errors: [{ code: 'CANONICAL_REPORT_MISSING', message: 'No canonical report exists for the requested trading date.' }],
        ...counters,
      }).eq('id', runId);
      if (skipError) throw skipError;
      return jsonResponse({
        success: true,
        skipped: true,
        run_id: runId,
        target_date: targetDate,
        reason: 'CANONICAL_REPORT_MISSING',
        engine_version: CLE_ENGINE_VERSION,
      });
    }

    if (report) {
      const { data: decisionSnapshot, error: decisionError } = await client
        .from('decision_snapshots')
        .select('*')
        .eq('report_date', targetDate)
        .eq('session_type', 'PREMARKET')
        .eq('is_current', true)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (decisionError) throw decisionError;
      if (!decisionSnapshot) {
        const { error: degradeError } = await client.from('learning_runs').update({
          status: 'degraded',
          completed_at: new Date().toISOString(),
          errors: [{ code: 'CANONICAL_DECISION_SNAPSHOT_MISSING', message: 'A report exists but no current PREMARKET decision snapshot is available; the date is not trusted for learning.' }],
          ...counters,
        }).eq('id', runId);
        if (degradeError) throw degradeError;
        return jsonResponse({
          success: true,
          degraded: true,
          run_id: runId,
          target_date: targetDate,
          reason: 'CANONICAL_DECISION_SNAPSHOT_MISSING',
          engine_version: CLE_ENGINE_VERSION,
        });
      }
      const { data: premarketRows, error: premarketError } = await client
        .from('market_data_snapshots')
        .select('symbol,name,value,change_percent,captured_at,source,phase,trading_date,raw')
        .eq('trading_date', targetDate)
        .eq('phase', 'premarket')
        .order('captured_at', { ascending: false })
        .limit(1000);
      if (premarketError) throw premarketError;
      const captured = await capturePredictions(
        client,
        targetDate,
        report as JsonRecord,
        decisionSnapshot as JsonRecord | null,
        (premarketRows || []) as SnapshotRow[],
      );
      counters.predictions_processed = captured.length;
    }

    const window = await loadPredictionAndMarketWindow(client, targetDate);
    if (window.predictions.length === 0) {
      const { error } = await client.from('learning_runs').update({
        status: 'degraded',
        completed_at: new Date().toISOString(),
        errors: [{ code: 'NO_TRUSTED_PREDICTIONS', message: 'No eligible prediction snapshot was available.' }],
        ...counters,
      }).eq('id', runId);
      if (error) throw error;
      return jsonResponse({
        success: true,
        degraded: true,
        run_id: runId,
        target_date: targetDate,
        reason: 'NO_TRUSTED_PREDICTIONS',
        engine_version: CLE_ENGINE_VERSION,
      });
    }

    const outcomeResult = await updateOutcomes(client, targetDate, window.predictions, window.snapshots);
    const outcomes = outcomeResult.outcomes;
    counters.outcomes_created = outcomeResult.created;
    counters.outcomes_updated = outcomeResult.updated;
    counters.outcomes_unchanged = outcomeResult.unchanged;
    const reviewResult = await createReviewsAndCases(client, runId!, targetDate, window.predictions, outcomes);
    counters.reviews_created = reviewResult.reviewsCreated;
    counters.reviews_unchanged = reviewResult.reviewsUnchanged;
    counters.cases_created = reviewResult.casesCreated;
    counters.cases_unchanged = reviewResult.casesUnchanged;
    const patternResult = await aggregatePatterns(
      client,
      targetDate,
      window.predictions,
      outcomes,
      reviewResult.reviews,
    );
    counters.patterns_updated = patternResult.patterns.length;
    await evaluateModels(client, targetDate, window.predictions, outcomes, reviewResult.reviews);
    counters.rules_evaluated = await evaluateRuleCandidates(
      client,
      targetDate,
      patternResult.patterns,
      patternResult.groups,
    );
    counters.rules_evaluated += await updateShadowRules(
      client,
      targetDate,
      patternResult.groups,
    );

    const { error: auditError } = await client.from('learning_audit_logs').upsert({
      learning_run_id: runId,
      idempotency_key: `${runId}:completed`,
      entity_type: 'learning_run',
      entity_id: runId,
      action: 'completed',
      actor_type: 'system',
      before_json: {},
      after_json: counters,
      reason: 'Continuous learning pipeline completed without changing production rules.',
    }, { onConflict: 'idempotency_key', ignoreDuplicates: true });
    if (auditError) throw auditError;

    const { error: completeError } = await client.from('learning_runs').update({
      status: 'succeeded',
      completed_at: new Date().toISOString(),
      ...counters,
      errors: [],
    }).eq('id', runId);
    if (completeError) throw completeError;

    const { error: feedbackStateError } = await client.rpc('advance_trading_day_state_v1', {
      p_trading_date: targetDate, p_state: 'FEEDBACK_COMPLETED', p_checkpoint: 'feedback', p_status: 'SUCCEEDED',
      p_correlation_id: crypto.randomUUID(), p_metadata: { run_id: runId, review_count: reviewResult.reviews.length },
    });
    if (feedbackStateError) throw new Error('FEEDBACK_STATE_ADVANCE_FAILED');
    const { error: tradingDayStateError } = await client.rpc(
      'advance_trading_day_state_v1',
      {
        p_trading_date: targetDate,
        p_state: 'LEARNING_COMPLETED',
        p_checkpoint: 'continuous_learning',
        p_status: 'SUCCEEDED',
        p_correlation_id: crypto.randomUUID(),
        p_metadata: { run_id: runId, engine_version: CLE_ENGINE_VERSION, ...counters },
      },
    );
    if (tradingDayStateError) throw new Error('LEARNING_STATE_ADVANCE_FAILED');

    return jsonResponse({
      success: true,
      run_id: runId,
      target_date: targetDate,
      engine_version: CLE_ENGINE_VERSION,
      production_rule_mutated: false,
      ...counters,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (runId) {
      await client.from('learning_runs').update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        ...counters,
        errors: [{ code: 'CLE_RUN_FAILED', message: message.slice(0, 1000) }],
      }).eq('id', runId);
    }
    console.error('CONTINUOUS_LEARNING_ENGINE_FAILED', message);
    return jsonResponse({
      success: false,
      error: 'CONTINUOUS_LEARNING_ENGINE_FAILED',
      detail: message,
      run_id: runId,
      target_date: targetDate,
      engine_version: CLE_ENGINE_VERSION,
      failure_isolated: true,
    }, 500);
  }
});

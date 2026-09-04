import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import {
  RUNTIME_QUALITY_POLICY,
  computeHistoricalSimilarity,
  simulateFullTradingDay,
  simulateHistoricalFailureMatrix,
} from '../_shared/production-architecture-core.mjs';
import { evaluateContentIntelligence } from '../_shared/content-intelligence.ts';

const VERSION = 'MA_STRATEGY_REPLAY_V2';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-cron-secret, x-correlation-id',
};
type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function jsonResponse(body: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
}

function dateString(value: unknown, fallback: string): string {
  const text = String(value || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
}

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function uniqueByKey<T>(rows: T[], key: (row: T) => string): T[] {
  return Array.from(new Map(rows.map((row) => [key(row), row])).values());
}

async function inspectRuntimeSchema(supabase: ReturnType<typeof createClient>): Promise<JsonRecord> {
  const checks = await Promise.all([
    supabase.from('market_data_snapshots').select('checkpoint').limit(1),
    supabase.from('data_provider_health').select('checkpoint').limit(1),
    supabase.from('trading_day_state').select('trading_date,current_state,state_rank,checkpoint_status').limit(1),
  ]);
  const names = ['immutable_checkpoint_snapshots', 'provider_checkpoint_health', 'trading_day_state'];
  const results = checks.map((result, index) => ({
    check: names[index],
    ready: !result.error,
    error_code: result.error?.code || null,
    error: result.error?.message || null,
  }));
  return {
    contract_version: 'MA_RUNTIME_SCHEMA_V1',
    ready: results.every((result) => result.ready),
    checks: results,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'METHOD_NOT_ALLOWED' }, 405);
  const expectedSecret = Deno.env.get('CRON_SECRET') || '';
  if (!expectedSecret) return jsonResponse({ success: false, error: 'CRON_SECRET_NOT_CONFIGURED' }, 500);
  if ((req.headers.get('x-cron-secret') || '') !== expectedSecret) return jsonResponse({ success: false, error: 'UNAUTHORIZED' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ success: false, error: 'SUPABASE_CREDENTIALS_MISSING' }, 500);
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const body = asRecord(await req.json().catch(() => ({})));
  const rawCorrelation = req.headers.get('x-correlation-id') || String(body.correlation_id || '');
  const correlationId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawCorrelation) ? rawCorrelation : crypto.randomUUID();
  if (body.simulation_mode === 'full_day') {
    if (body.dry_run === false) {
      return jsonResponse({ success: false, error: 'FULL_DAY_SIMULATION_MUST_BE_DRY_RUN', correlation_id: correlationId }, 400);
    }
    const simulation = simulateFullTradingDay({
      trading_date: dateString(body.simulation_date, '2026-08-24'),
      source_status: asRecord(body.source_status),
      content_scores: Array.isArray(body.content_scores) ? body.content_scores : undefined,
      max_repair_attempts: body.max_repair_attempts,
    });
    const runtimeSchema = await inspectRuntimeSchema(supabase);
    const ready = simulation.result === 'GO' && runtimeSchema.ready === true;
    return jsonResponse({
      success: ready,
      simulation_mode: 'full_day',
      version: VERSION,
      correlation_id: correlationId,
      runtime_schema: runtimeSchema,
      simulation,
    }, ready ? 200 : 422);
  }
  if (body.simulation_mode === 'historical_scenarios') {
    if (body.dry_run === false) {
      return jsonResponse({ success: false, error: 'HISTORICAL_SCENARIOS_MUST_BE_DRY_RUN', correlation_id: correlationId }, 400);
    }
    const matrix = simulateHistoricalFailureMatrix();
    return jsonResponse({
      success: matrix.result === 'PASS',
      dry_run: true,
      simulation_mode: 'historical_scenarios',
      version: VERSION,
      correlation_id: correlationId,
      matrix,
    }, matrix.result === 'PASS' ? 200 : 422);
  }
  if (body.simulation_mode === 'content_quality') {
    if (body.dry_run === false) {
      return jsonResponse({ success: false, error: 'CONTENT_QUALITY_REPLAY_MUST_BE_DRY_RUN', correlation_id: correlationId }, 400);
    }
    const targetDate = dateString(body.target_date, '');
    const requestedLimit = Math.max(5, Math.min(20, Math.trunc(Number(body.limit) || 5)));
    const requiredMinimumScore = Math.max(
      RUNTIME_QUALITY_POLICY.premium_publish_min,
      Math.min(100, Math.trunc(Number(body.minimum_score) || RUNTIME_QUALITY_POLICY.premium_publish_min)),
    );
    let reportsQuery = supabase
      .from('reports')
      .select('report_date,ai_strategy_json,important_news_json')
      .order('report_date', { ascending: false });
    reportsQuery = targetDate
      ? reportsQuery.eq('report_date', targetDate).limit(1)
      : reportsQuery.limit(requestedLimit);
    const { data: reports, error: reportsError } = await reportsQuery;
    if (reportsError) {
      return jsonResponse({ success: false, error: 'CONTENT_QUALITY_REPORT_QUERY_FAILED', details: reportsError.message, correlation_id: correlationId }, 500);
    }
    const scoreRows = (reports || []).map((report) => {
      const importantNewsCount = Array.isArray(report.important_news_json) ? report.important_news_json.length : 0;
      const evaluation = evaluateContentIntelligence(asRecord(report.ai_strategy_json), importantNewsCount);
      return {
        report_date: report.report_date,
        score: evaluation.score,
        grade: evaluation.grade,
        reason_codes: evaluation.reason_codes,
        breakdown: evaluation.breakdown,
      };
    });
    const dimensionMaximums: JsonRecord = { evidence: 20, freshness: 15, taiwan_relevance: 15, specificity: 10, actionability: 15, risk: 10, originality: 5, readability: 10 };
    const dimensionLosses = Object.keys(dimensionMaximums).map((dimension) => ({
      dimension,
      total_points_lost: scoreRows.reduce((sum, row) => sum + Math.max(0, Number(dimensionMaximums[dimension]) - Number(row.breakdown[dimension as keyof typeof row.breakdown] || 0)), 0),
    })).sort((left, right) => right.total_points_lost - left.total_points_lost);
    const average = scoreRows.length === 0 ? null : Math.round(scoreRows.reduce((sum, row) => sum + row.score, 0) / scoreRows.length * 100) / 100;
    const minimum = scoreRows.length === 0 ? null : Math.min(...scoreRows.map((row) => row.score));
    const requiredReportCount = targetDate ? 1 : 5;
    const eligibleReportCount = scoreRows.filter((row) => row.score >= requiredMinimumScore).length;
    const blockedReportCount = scoreRows.length - eligibleReportCount;
    const qualityGatePassed = scoreRows.length >= requiredReportCount && blockedReportCount === 0;
    return jsonResponse({
      success: qualityGatePassed,
      dry_run: true,
      simulation_mode: 'content_quality',
      version: VERSION,
      correlation_id: correlationId,
      target_date: targetDate || null,
      required_minimum_score: requiredMinimumScore,
      quality_gate_passed: qualityGatePassed,
      report_count: scoreRows.length,
      eligible_report_count: eligibleReportCount,
      blocked_report_count: blockedReportCount,
      average_score: average,
      minimum_score: minimum,
      most_common_loss_dimensions: dimensionLosses.slice(0, 3),
      reports: scoreRows,
      writes_performed: 0,
      notifications_sent: 0,
    }, qualityGatePassed ? 200 : 422);
  }
  const today = new Date().toISOString().slice(0, 10);
  const toDate = dateString(body.to_date, today);
  const fromDate = dateString(body.from_date, shiftDate(toDate, -90));
  if (toDate < fromDate) return jsonResponse({ success: false, error: 'INVALID_DATE_RANGE' }, 400);
  const dryRun = body.dry_run !== false;

  const strategyQuery = body.strategy_id
    ? supabase.from('strategy_registry').select('*').eq('id', String(body.strategy_id)).maybeSingle()
    : supabase.from('strategy_registry').select('*').eq('strategy_key', 'morning-alpha-premarket').eq('lifecycle', 'production').maybeSingle();
  const { data: strategy, error: strategyError } = await strategyQuery;
  if (strategyError || !strategy) return jsonResponse({ success: false, error: 'PRODUCTION_STRATEGY_NOT_FOUND', details: strategyError?.message, correlation_id: correlationId }, 404);

  const { data: predictions, error: predictionError } = await supabase
    .from('learning_predictions')
    .select('id,decision_snapshot_id,report_date,direction,model_confidence,calibrated_confidence,data_quality_status,record_status')
    .gte('report_date', fromDate)
    .lte('report_date', toDate)
    .eq('record_status', 'valid')
    .order('report_date', { ascending: true })
    .limit(1000);
  if (predictionError) return jsonResponse({ success: false, error: 'PREDICTION_QUERY_FAILED', details: predictionError.message, correlation_id: correlationId }, 500);

  const predictionRows = predictions || [];
  const predictionIds = predictionRows.map((row) => String(row.id));
  const outcomes: JsonRecord[] = [];
  for (let offset = 0; offset < predictionIds.length; offset += 200) {
    const ids = predictionIds.slice(offset, offset + 200);
    if (ids.length === 0) continue;
    const { data, error } = await supabase
      .from('prediction_outcomes')
      .select('prediction_id,horizon,status,direction_correct,outcome_direction,return_percent,data_quality_status')
      .in('prediction_id', ids)
      .eq('status', 'completed')
      .not('direction_correct', 'is', null);
    if (error) return jsonResponse({ success: false, error: 'OUTCOME_QUERY_FAILED', details: error.message, correlation_id: correlationId }, 500);
    outcomes.push(...(data || []));
  }
  const outcomeByPrediction = new Map(outcomes.map((row) => [String(row.prediction_id), row]));
  const evaluated = predictionRows.filter((row) => outcomeByPrediction.has(String(row.id)));
  const resultRows = uniqueByKey(evaluated.map((prediction) => {
    const outcome = outcomeByPrediction.get(String(prediction.id)) || {};
    const confidence = Math.max(0, Math.min(100, Number(prediction.calibrated_confidence ?? prediction.model_confidence) || 0));
    const correct = outcome.direction_correct === true;
    const probability = confidence / 100;
    return {
      decision_snapshot_id: prediction.decision_snapshot_id || null,
      prediction_id: prediction.id,
      report_date: prediction.report_date,
      predicted_direction: prediction.direction,
      actual_direction: outcome.outcome_direction || null,
      confidence_score: confidence,
      outcome_score: Number(outcome.return_percent) || 0,
      correct,
      brier_component: Math.round((probability - (correct ? 1 : 0)) ** 2 * 10000) / 10000,
      reason_codes: [String(prediction.data_quality_status || 'unknown'), String(outcome.data_quality_status || 'unknown')],
    };
  }), (row) => String(row.prediction_id));
  const accuracy = resultRows.length === 0 ? null : Math.round(resultRows.filter((row) => row.correct).length / resultRows.length * 10000) / 100;
  const brierScore = resultRows.length === 0 ? null : Math.round(resultRows.reduce((sum, row) => sum + row.brier_component, 0) / resultRows.length * 10000) / 10000;

  const { data: snapshots, error: snapshotError } = await supabase
    .from('decision_snapshots')
    .select('id,report_date,market_regime,confidence_score,market_score,preferred_sectors,watch_sectors,risk_flags')
    .gte('report_date', fromDate)
    .lte('report_date', toDate)
    .eq('is_current', true)
    .order('report_date', { ascending: true })
    .limit(500);
  if (snapshotError) return jsonResponse({ success: false, error: 'SNAPSHOT_QUERY_FAILED', details: snapshotError.message, correlation_id: correlationId }, 500);

  const snapshotRows = snapshots || [];
  const similarityRows: JsonRecord[] = [];
  for (let targetIndex = 1; targetIndex < snapshotRows.length; targetIndex += 1) {
    const target = snapshotRows[targetIndex];
    const targetShape = {
      ...target,
      sectors: [...asStringArray(target.preferred_sectors), ...asStringArray(target.watch_sectors)],
      risk_flags: asStringArray(target.risk_flags),
    };
    const candidates = snapshotRows.slice(0, targetIndex).map((candidate) => ({
      candidate,
      score: computeHistoricalSimilarity(targetShape, {
        ...candidate,
        sectors: [...asStringArray(candidate.preferred_sectors), ...asStringArray(candidate.watch_sectors)],
        risk_flags: asStringArray(candidate.risk_flags),
      }),
    })).sort((left, right) => right.score - left.score).slice(0, 5);
    for (const item of candidates) {
      similarityRows.push({
        target_snapshot_id: target.id,
        similar_snapshot_id: item.candidate.id,
        algorithm_version: VERSION,
        similarity_score: item.score,
        feature_breakdown: { market_regime: target.market_regime, candidate_market_regime: item.candidate.market_regime },
        outcome_summary: { candidate_report_date: item.candidate.report_date },
      });
    }
  }

  if (dryRun) {
    return jsonResponse({ success: true, dry_run: true, version: VERSION, correlation_id: correlationId, strategy_id: strategy.id, from_date: fromDate, to_date: toDate, total_predictions: predictionRows.length, evaluated_cases: resultRows.length, accuracy, brier_score: brierScore, similarity_pairs: similarityRows.length });
  }

  const idempotencyKey = `${VERSION}:${strategy.id}:${fromDate}:${toDate}`;
  const { data: replayRun, error: replayError } = await supabase
    .from('historical_replay_runs')
    .upsert({
      strategy_id: strategy.id,
      from_date: fromDate,
      to_date: toDate,
      status: 'running',
      dry_run: false,
      idempotency_key: idempotencyKey,
      correlation_id: correlationId,
      total_cases: predictionRows.length,
      evaluated_cases: resultRows.length,
      started_at: new Date().toISOString(),
      completed_at: null,
    }, { onConflict: 'idempotency_key' })
    .select('id')
    .single();
  if (replayError) return jsonResponse({ success: false, error: 'REPLAY_RUN_WRITE_FAILED', details: replayError.message, correlation_id: correlationId }, 500);

  if (resultRows.length > 0) {
    const { error } = await supabase.from('historical_replay_results').upsert(
      resultRows.map((row) => ({ ...row, replay_run_id: replayRun.id })),
      { onConflict: 'replay_run_id,prediction_id' },
    );
    if (error) {
      await supabase.from('historical_replay_runs').update({ status: 'failed', completed_at: new Date().toISOString() }).eq('id', replayRun.id);
      return jsonResponse({ success: false, error: 'REPLAY_RESULTS_WRITE_FAILED', details: error.message, correlation_id: correlationId }, 500);
    }
  }
  if (similarityRows.length > 0) {
    const { error } = await supabase.from('historical_similarity_results').upsert(similarityRows, { onConflict: 'target_snapshot_id,similar_snapshot_id,algorithm_version' });
    if (error) {
      await supabase.from('historical_replay_runs').update({ status: 'failed', completed_at: new Date().toISOString() }).eq('id', replayRun.id);
      return jsonResponse({ success: false, error: 'SIMILARITY_RESULTS_WRITE_FAILED', details: error.message, correlation_id: correlationId }, 500);
    }
  }
  await supabase.from('historical_replay_runs').update({ status: 'succeeded', accuracy, brier_score: brierScore, completed_at: new Date().toISOString() }).eq('id', replayRun.id);
  return jsonResponse({ success: true, dry_run: false, version: VERSION, correlation_id: correlationId, replay_run_id: replayRun.id, strategy_id: strategy.id, from_date: fromDate, to_date: toDate, total_predictions: predictionRows.length, evaluated_cases: resultRows.length, accuracy, brier_score: brierScore, similarity_pairs: similarityRows.length });
});

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const VERSION = 'LEARNING_CENTER_API_V1';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
};

type JsonRecord = Record<string, unknown>;

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

function shiftDate(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function round(value: number | null, digits = 4): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function weightedAverage(rows: JsonRecord[], field: string): number | null {
  let weighted = 0;
  let samples = 0;
  for (const row of rows) {
    const value = finiteNumber(row[field]);
    const sample = finiteNumber(row.sample_size) || 0;
    if (value === null || sample <= 0) continue;
    weighted += value * sample;
    samples += sample;
  }
  return samples > 0 ? round(weighted / samples) : null;
}

function latestBy<T extends JsonRecord>(rows: T[], key: string): T[] {
  const selected = new Map<string, T>();
  for (const row of rows) {
    const value = String(row[key] || 'unknown');
    if (!selected.has(value)) selected.set(value, row);
  }
  return [...selected.values()];
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (!['GET', 'POST'].includes(req.method)) return jsonResponse({ success: false, error: 'METHOD_NOT_ALLOWED' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ success: false, error: 'SUPABASE_CREDENTIALS_MISSING' }, 500);
  }

  const authorization = req.headers.get('Authorization') || '';
  const accessToken = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!accessToken) return jsonResponse({ success: false, error: 'AUTHENTICATION_REQUIRED' }, 401);

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await authClient.auth.getUser(accessToken);
  if (userError || !userData.user) return jsonResponse({ success: false, error: 'INVALID_SESSION' }, 401);

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: profile, error: profileError } = await adminClient
    .from('profiles')
    .select('id,role')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (profileError) return jsonResponse({ success: false, error: 'ADMIN_LOOKUP_FAILED' }, 500);
  if (String(profile?.role || '').toLowerCase() !== 'admin') {
    return jsonResponse({ success: false, error: 'ADMIN_REQUIRED' }, 403);
  }

  if (req.method === 'POST') {
    let requestBody: JsonRecord = {};
    try {
      requestBody = await req.json() as JsonRecord;
    } catch {
      requestBody = {};
    }
    if (requestBody.action === 'promote_rule') {
      const ruleId = String(requestBody.rule_id || '');
      const reason = String(requestBody.reason || '').trim();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ruleId)) {
        return jsonResponse({ success: false, error: 'INVALID_RULE_ID' }, 400);
      }
      if (reason.length < 20) return jsonResponse({ success: false, error: 'PROMOTION_REASON_TOO_SHORT' }, 400);
      const { data: promotedRule, error: promotionError } = await adminClient.rpc('promote_learning_rule_v1', {
        p_rule_id: ruleId,
        p_admin_id: userData.user.id,
        p_reason: reason,
      });
      if (promotionError) {
        console.error('LEARNING_RULE_PROMOTION_FAILED', promotionError.message);
        return jsonResponse({ success: false, error: 'LEARNING_RULE_PROMOTION_FAILED' }, 409);
      }
      return jsonResponse({ success: true, action: 'promote_rule', rule: promotedRule });
    }
  }

  const today = getTaipeiDateString();
  const start90 = shiftDate(today, -89);
  const start30 = shiftDate(today, -29);

  try {
    const [
      runResult,
      predictionResult,
      outcomeResult,
      reviewResult,
      caseResult,
      ruleResult,
      patternResult,
      evaluationResult,
      backtestResult,
    ] = await Promise.all([
      adminClient.from('learning_runs').select('*').order('started_at', { ascending: false }).limit(40),
      adminClient.from('learning_predictions').select('id,report_date,symbol,prediction_scope,direction,model_confidence,calibrated_confidence,data_quality_status,model_version').gte('report_date', start90).lte('report_date', today).order('report_date', { ascending: false }).limit(3000),
      adminClient.from('prediction_outcomes').select('id,prediction_id,horizon,status,data_quality_status,direction_correct,timing_correct,return_percent,abnormal_return_percent,target_date,evaluated_at').in('horizon', ['close', '1D', '3D', '5D']).gte('target_date', start90).lte('target_date', today).limit(8000),
      adminClient.from('prediction_reviews').select('id,prediction_id,review_date,review_result,error_type,root_cause,lesson,learning_eligible,confidence_error,created_at').gte('review_date', start90).lte('review_date', today).order('review_date', { ascending: false }).limit(4000),
      adminClient.from('learning_cases').select('id,case_type,title,root_cause,lesson,market_regime,confidence_bucket,created_at').gte('created_at', `${start90}T00:00:00Z`).order('created_at', { ascending: false }).limit(1000),
      adminClient.from('learning_rules').select('id,name,hypothesis,status,minimum_sample_size,shadow_sample_size,shadow_accuracy,shadow_completed_at,promoted_at,updated_at').order('updated_at', { ascending: false }).limit(500),
      adminClient.from('market_patterns').select('id,pattern_key,dimensions,sample_size,follow_through_rate,calibration_gap,status,last_seen_date,last_evaluated_at').order('sample_size', { ascending: false }).limit(100),
      adminClient.from('model_evaluations').select('*').gte('period_end', start90).lte('period_end', today).order('period_end', { ascending: false }).limit(3000),
      adminClient.from('rule_backtests').select('id,rule_id,status,in_sample_size,out_of_sample_size,baseline_calibration_error,candidate_calibration_error,completed_at').order('created_at', { ascending: false }).limit(500),
    ]);
    const results = [runResult, predictionResult, outcomeResult, reviewResult, caseResult, ruleResult, patternResult, evaluationResult, backtestResult];
    const failed = results.find((result) => result.error);
    if (failed?.error) throw failed.error;

    const runs = (runResult.data || []) as JsonRecord[];
    const predictions = (predictionResult.data || []) as JsonRecord[];
    const outcomes = (outcomeResult.data || []) as JsonRecord[];
    const reviews = (reviewResult.data || []) as JsonRecord[];
    const cases = (caseResult.data || []) as JsonRecord[];
    const rules = (ruleResult.data || []) as JsonRecord[];
    const patterns = (patternResult.data || []) as JsonRecord[];
    const evaluations = (evaluationResult.data || []) as JsonRecord[];
    const backtests = (backtestResult.data || []) as JsonRecord[];
    const predictionMap = new Map(predictions.map((row) => [String(row.id), row]));
    const todayPredictions = predictions.filter((row) => row.report_date === today);
    const todayReviews = reviews.filter((row) => row.review_date === today);
    const todayCases = cases.filter((row) => String(row.created_at || '').slice(0, 10) === today);
    const todayPredictionIds = new Set(todayPredictions.map((row) => String(row.id)));
    const todayOutcomes = outcomes.filter((row) => todayPredictionIds.has(String(row.prediction_id)));
    const qualityProblems = todayPredictions.filter((row) => !['complete', 'degraded'].includes(String(row.data_quality_status))).length +
      todayOutcomes.filter((row) => !['complete', 'degraded'].includes(String(row.data_quality_status))).length;

    const latest90 = latestBy(evaluations.filter((row) => Number(row.window_days) === 90), 'confidence_bucket');
    const latest30 = latestBy(evaluations.filter((row) => Number(row.window_days) === 30), 'confidence_bucket');
    const highConfidenceRows = latest90.filter((row) => ['80_90', '90_plus'].includes(String(row.confidence_bucket)));
    const completedClose = outcomes.filter((row) => row.horizon === 'close' && row.status === 'completed');
    const completeCloseCount = completedClose.filter((row) => ['complete', 'degraded'].includes(String(row.data_quality_status))).length;

    const trendGroups = new Map<string, JsonRecord[]>();
    for (const evaluation of evaluations.filter((row) => Number(row.window_days) === 30)) {
      const date = String(evaluation.period_end || '');
      const group = trendGroups.get(date) || [];
      group.push(evaluation);
      trendGroups.set(date, group);
    }
    const trend = [...trendGroups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-30)
      .map(([date, rows]) => ({
        date,
        accuracy: weightedAverage(rows, 'accuracy'),
        calibration_gap: weightedAverage(rows, 'calibration_gap'),
        sample_size: rows.reduce((sum, row) => sum + Number(row.sample_size || 0), 0),
      }));

    const recentErrorCases = cases.filter((row) => row.case_type === 'error').slice(0, 8);
    const recentSuccessCases = cases.filter((row) => row.case_type === 'success').slice(0, 8);
    const recentReviews = reviews.slice(0, 12).map((row) => ({
      ...row,
      symbol: predictionMap.get(String(row.prediction_id))?.symbol || null,
      scope: predictionMap.get(String(row.prediction_id))?.prediction_scope || null,
    }));

    return jsonResponse({
      success: true,
      version: VERSION,
      generated_at: new Date().toISOString(),
      today_date: today,
      today: {
        predictions: todayPredictions.length,
        completed_outcomes: todayOutcomes.filter((row) => row.status === 'completed').length,
        correct: todayReviews.filter((row) => row.review_result === 'correct').length,
        incorrect: todayReviews.filter((row) => row.review_result === 'incorrect').length,
        inconclusive: todayReviews.filter((row) => row.review_result === 'inconclusive').length,
        new_error_cases: todayCases.filter((row) => row.case_type === 'error').length,
        new_success_cases: todayCases.filter((row) => row.case_type === 'success').length,
        rule_candidates: rules.filter((row) => row.status === 'candidate').length,
        backtests_running: backtests.filter((row) => row.status === 'running').length,
        shadow_rules: rules.filter((row) => ['eligible_shadow', 'shadow'].includes(String(row.status))).length,
        data_quality_problems: qualityProblems,
      },
      metrics: {
        accuracy_30d: weightedAverage(latest30, 'accuracy'),
        accuracy_90d: weightedAverage(latest90, 'accuracy'),
        confidence_calibration_gap_90d: weightedAverage(latest90, 'calibration_gap'),
        taiwan_mapping_accuracy_90d: weightedAverage(latest90, 'taiwan_mapping_accuracy'),
        price_in_error_rate_90d: weightedAverage(latest90, 'price_in_error_rate'),
        direction_accuracy_90d: weightedAverage(latest90, 'accuracy'),
        high_confidence_accuracy_90d: weightedAverage(highConfidenceRows, 'accuracy'),
        data_completeness_rate: completedClose.length > 0 ? round(completeCloseCount / completedClose.length) : null,
      },
      calibration: latest90.map((row) => ({
        bucket: row.confidence_bucket,
        sample_size: row.sample_size,
        accuracy: row.accuracy,
        calibration_gap: row.calibration_gap,
      })),
      trend,
      latest_run: runs[0] || null,
      recent_runs: runs.slice(0, 12),
      recent_reviews: recentReviews,
      recent_error_cases: recentErrorCases,
      recent_success_cases: recentSuccessCases,
      top_patterns: patterns.slice(0, 10),
      rules: rules.slice(0, 20),
      backtests: backtests.slice(0, 20),
      internal_only: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('LEARNING_CENTER_API_FAILED', message);
    return jsonResponse({ success: false, error: 'LEARNING_CENTER_API_FAILED' }, 500);
  }
});

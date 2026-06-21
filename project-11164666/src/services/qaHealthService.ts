import { supabase } from '@/lib/supabase';
import type {
  LatestReportHealthStatus,
  PredictionAccuracyLog,
  QAHealthDashboardData,
  SystemHealthLog,
} from '@/types/qaHealth';

const V8_BLOCKING_ISSUES = new Set([
  'MISSING_REPORT',
  'DATE_MISMATCH',
  'MISSING_MEMBER_RESEARCH_NOTE_V2',
]);

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toSystemHealthLog(row: Record<string, unknown>): SystemHealthLog {
  return {
    id: String(row.id || ''),
    check_date: String(row.check_date || ''),
    report_exists: row.report_exists === true,
    report_date_correct: row.report_date_correct === true,
    has_market_bias: row.has_market_bias === true,
    has_confidence: row.has_confidence === true,
    has_member_note_v2: row.has_member_note_v2 === true,
    has_opening_radar: row.has_opening_radar === true,
    has_sector_rotation: row.has_sector_rotation === true,
    has_closing_verification: row.has_closing_verification === true,
    health_score: Number(row.health_score || 0),
    issues: asStringArray(row.issues),
    raw_snapshot: asObject(row.raw_snapshot),
    created_at: String(row.created_at || ''),
  };
}

function toPredictionAccuracyLog(row: Record<string, unknown>): PredictionAccuracyLog {
  return {
    id: String(row.id || ''),
    report_date: String(row.report_date || ''),
    predicted_bias: row.predicted_bias ? String(row.predicted_bias) : null,
    confidence: finiteNumber(row.confidence),
    actual_taiex_change: finiteNumber(row.actual_taiex_change),
    actual_direction: row.actual_direction ? String(row.actual_direction) : null,
    prediction_result: row.prediction_result ? String(row.prediction_result) : null,
    accuracy_score: finiteNumber(row.accuracy_score),
    reason: asObject(row.reason),
    created_at: String(row.created_at || ''),
  };
}

function toLatestReportHealthStatus(row: Record<string, unknown> | null): LatestReportHealthStatus | null {
  if (!row) return null;
  const ai = asObject(row.ai_strategy_json);
  const memberNoteV2 = asObject(ai.member_research_note_v2);

  return {
    report_date: row.report_date ? String(row.report_date) : null,
    market_bias: row.market_bias ? String(row.market_bias) : null,
    confidence_score: finiteNumber(row.confidence_score),
    has_member_research_note_v2: Object.keys(memberNoteV2).length > 0,
    member_research_note_v2_data_status: memberNoteV2.data_status ? String(memberNoteV2.data_status) : null,
    has_v8_beneficiary_chain: !!ai.v8_beneficiary_chain,
    has_v8_overnight_causal_chain: !!ai.v8_overnight_causal_chain,
    has_v8_daily_sentence: !!ai.v8_daily_sentence,
    created_at: row.created_at ? String(row.created_at) : null,
  };
}

export function computeCanEnterV8(log: SystemHealthLog | null): boolean {
  if (!log) return false;
  if (log.health_score < 90) return false;
  if (!log.report_date_correct) return false;
  if (!log.has_member_note_v2) return false;
  return !log.issues.some((issue) => V8_BLOCKING_ISSUES.has(issue));
}

export async function fetchQAHealthDashboardData(): Promise<QAHealthDashboardData> {
  const [healthResult, predictionResult, reportResult] = await Promise.all([
    supabase
      .from('system_health_logs')
      .select('id,check_date,report_exists,report_date_correct,has_market_bias,has_confidence,has_member_note_v2,has_opening_radar,has_sector_rotation,has_closing_verification,health_score,issues,raw_snapshot,created_at')
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('prediction_accuracy_logs')
      .select('id,report_date,predicted_bias,confidence,actual_taiex_change,actual_direction,prediction_result,accuracy_score,reason,created_at')
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('reports')
      .select('report_date,market_bias,confidence_score,ai_strategy_json,created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (healthResult.error) throw new Error(healthResult.error.message);
  if (predictionResult.error) throw new Error(predictionResult.error.message);
  if (reportResult.error) throw new Error(reportResult.error.message);

  const healthLogs = ((healthResult.data || []) as Record<string, unknown>[]).map(toSystemHealthLog);
  const predictionLogs = ((predictionResult.data || []) as Record<string, unknown>[]).map(toPredictionAccuracyLog);
  const latestHealthLog = healthLogs[0] || null;

  return {
    latestHealthLog,
    healthLogs,
    predictionLogs,
    latestReport: toLatestReportHealthStatus(reportResult.data as Record<string, unknown> | null),
    canEnterV8: computeCanEnterV8(latestHealthLog),
  };
}

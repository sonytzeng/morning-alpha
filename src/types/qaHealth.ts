export interface SystemHealthLog {
  id: string;
  check_date: string;
  report_exists: boolean;
  report_date_correct: boolean;
  has_market_bias: boolean;
  has_confidence: boolean;
  has_member_note_v2: boolean;
  has_opening_radar: boolean;
  has_sector_rotation: boolean;
  has_closing_verification: boolean;
  health_score: number;
  issues: string[];
  raw_snapshot: Record<string, unknown>;
  created_at: string;
}

export interface PredictionAccuracyLog {
  id: string;
  report_date: string;
  predicted_bias: string | null;
  confidence: number | null;
  actual_taiex_change: number | null;
  actual_direction: string | null;
  prediction_result: string | null;
  accuracy_score: number | null;
  reason: Record<string, unknown>;
  created_at: string;
}

export interface LatestReportHealthStatus {
  report_date: string | null;
  market_bias: string | null;
  confidence_score: number | null;
  has_member_research_note_v2: boolean;
  member_research_note_v2_data_status: string | null;
  has_v8_beneficiary_chain: boolean;
  has_v8_overnight_causal_chain: boolean;
  has_v8_daily_sentence: boolean;
  created_at: string | null;
}

export interface QAHealthDashboardData {
  latestHealthLog: SystemHealthLog | null;
  healthLogs: SystemHealthLog[];
  predictionLogs: PredictionAccuracyLog[];
  latestReport: LatestReportHealthStatus | null;
  canEnterV8: boolean;
}

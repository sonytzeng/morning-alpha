import { supabase } from '@/lib/supabase';

export interface GenerateReportResult {
  success: boolean;
  report_date?: string;
  market_bias?: string;
  confidence_score?: number;
  summary?: string;
  duration_ms?: number;
  logs?: string[];
  error?: string;
  detail?: string;
  reason?: string;
  // V4/V5 fields
  market_regime?: string;
  latest_market_data_time?: string;
  latest_news_time?: string;
  market_data_count?: number;
  market_news_count?: number;
  market_data_fresh?: boolean;
  market_news_fresh?: boolean;
  // V6 fields
  news_grounding_passed?: boolean;
  must_mention_keywords?: string[];
  matched_keywords?: string[];
  top_news_titles?: string[];
  attempt1_fail_reasons?: string[];
  attempt2_fail_reasons?: string[];
  // V7 Market Intelligence Engine fields
  sentiment_score?: number;
  sentiment_label?: string;
  sentiment_reason?: string;
  risk_reason?: string;
  market_data_score_base?: number;
  market_data_score_details?: Record<string, number>;
}

export interface GenerationStatus {
  status: 'idle' | 'generating' | 'success' | 'error';
  message: string;
  result?: GenerateReportResult;
}

/**
 * Deprecated: frontends must not call cron-protected Edge Functions directly.
 * Report generation should be triggered by trusted server-side cron/admin tooling only.
 */
export async function generateReportManually(force = false): Promise<GenerateReportResult> {
  void force;
  return {
    success: false,
    error: 'DEPRECATED_CLIENT_TRIGGER_DISABLED',
    detail: 'Frontends cannot call cron-protected report generation functions. Use trusted server-side cron/admin tooling.',
  };
}

/**
 * 查詢今日報告是否已存在（快速檢查）
 */
export async function checkTodayReportExists(): Promise<boolean> {
  try {
    const now = new Date();
    const twNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
    const today = `${twNow.getFullYear()}-${String(twNow.getMonth() + 1).padStart(2, '0')}-${String(twNow.getDate()).padStart(2, '0')}`;
    const { data, error } = await supabase
      .from('reports')
      .select('id')
      .eq('report_date', today)
      .maybeSingle();

    if (error) {
      console.error('checkTodayReportExists error:', error.message);
      return false;
    }

    return !!data;
  } catch (err) {
    console.error('checkTodayReportExists exception:', err);
    return false;
  }
}

/**
 * 取得最近的生成紀錄（從 reports table 直接讀取）
 */
export async function fetchRecentGeneratedReports(limit = 5): Promise<
  Array<{
    report_date: string;
    market_bias: string | null;
    confidence_score: number | null;
    summary: string | null;
    created_at: string;
  }>
> {
  try {
    const { data, error } = await supabase
      .from('reports')
      .select('report_date, market_bias, confidence_score, summary, created_at')
      .order('report_date', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('fetchRecentGeneratedReports error:', error.message);
      return [];
    }

    return (data || []).map((row) => ({
      report_date: String(row.report_date || ''),
      market_bias: row.market_bias ? String(row.market_bias) : null,
      confidence_score: row.confidence_score ? Number(row.confidence_score) : null,
      summary: row.summary ? String(row.summary) : null,
      created_at: String(row.created_at || ''),
    }));
  } catch (err) {
    console.error('fetchRecentGeneratedReports exception:', err);
    return [];
  }
}

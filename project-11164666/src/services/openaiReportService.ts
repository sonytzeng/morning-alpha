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

const FUNCTION_URL = 'https://cttfzgvhiewfckydcrci.supabase.co/functions/v1/cron-generate-report';

/**
 * 手動觸發 AI 生成今日報告
 * 走 cron-generate-report（正式主線），內部會驗證 x-cron-secret 後呼叫 generate-daily-report-v7
 * 支援 force: true 強制重新產生
 */
export async function generateReportManually(force = false): Promise<GenerateReportResult> {
  try {
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cron-secret': 'abc123456',
      },
      body: JSON.stringify({ force }),
    });

    // Try to parse JSON body regardless of status code
    let data: GenerateReportResult | null = null;
    try {
      data = await response.json() as GenerateReportResult;
    } catch {
      // Not JSON — will fall through to text-based error handling
    }

    if (!response.ok) {
      const errorText = data ? JSON.stringify(data) : await response.text().catch(() => `HTTP ${response.status}`);
      console.error(`Edge Function HTTP ${response.status}:`, errorText);

      // If we parsed JSON and it has structured error info, return it directly
      if (data && data.error) {
        return data;
      }

      // 根據 status code 給明確錯誤訊息
      let errorMessage: string;
      switch (response.status) {
        case 401:
          errorMessage = '401 Unauthorized：認證失敗，請確認 x-cron-secret 正確';
          break;
        case 403:
          errorMessage = '403 Forbidden：沒有權限呼叫此功能';
          break;
        case 404:
          errorMessage = '404 Not Found：Edge Function 不存在或 URL 錯誤';
          break;
        case 500:
          errorMessage = '500 Function Error：Edge Function 內部錯誤，請查看 Console';
          break;
        case 502:
        case 503:
        case 504:
          errorMessage = `${response.status} Gateway Error：Supabase 服務暫時不可用，請稍後再試`;
          break;
        default:
          errorMessage = `Edge Function 回傳錯誤 (${response.status})`;
      }

      return {
        success: false,
        error: errorMessage,
        detail: errorText.slice(0, 500),
      };
    }

    if (data) {
      return data;
    }

    return {
      success: false,
      error: '無法解析 Edge Function 回傳資料',
      detail: 'Response body was empty or not valid JSON',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('generateReportManually exception:', msg);

    // 區分網路錯誤類型
    let errorMessage = '手動生成失敗';
    if (msg.includes('fetch') || msg.includes('network') || msg.includes('Failed to fetch')) {
      errorMessage = 'Network Failed：無法連線到 Edge Function，可能是 CORS 被封鎖或網路問題';
    } else if (msg.includes('CORS') || msg.includes('cors')) {
      errorMessage = 'CORS 錯誤：瀏覽器封鎖跨域請求，請確認 Edge Function CORS 設定';
    } else if (msg.includes('timeout') || msg.includes('Timeout')) {
      errorMessage = 'Timeout：請求超時，Edge Function 可能執行過久';
    }

    return {
      success: false,
      error: errorMessage,
      detail: msg,
    };
  }
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
import { supabase } from '@/lib/supabase';

export interface PushStats {
  subscribers: {
    total: number;
    lineEnabled: number;
  };
  today: {
    success: number;
    failed: number;
    total: number;
  };
  recent7Days: {
    success: number;
    failed: number;
    total: number;
  };
  recentLogs: Array<{
    id: string;
    status: string;
    sent_at: string;
    error_message: string | null;
    report_id: string | null;
    report_date?: string;
    summary?: string;
  }>;
}

export interface LinePreviewMessage {
  emoji: string;
  sentiment: string;
  confidence: number;
  summary: string;
  dos: string[];
  donts: string[];
  tomorrowWatch: string[];
  reportUrl: string;
}

export async function fetchPushStats(): Promise<PushStats | null> {
  try {
    const { data, error } = await supabase.functions.invoke('push-stats');
    if (error) throw error;
    return data as PushStats | null;
  } catch (err) {
    console.error('Fetch push stats failed:', err);
    return null;
  }
}

export async function fetchSubscriberCount(): Promise<number> {
  try {
    const { count, error } = await supabase
      .from('subscribers')
      .select('*', { count: 'exact', head: true })
      .eq('line_push_enabled', true)
      .eq('status', 'active');

    if (error) throw error;
    return count || 0;
  } catch (err) {
    console.error('Fetch subscriber count failed:', err);
    return 0;
  }
}

export async function fetchRecentPushLogs(limit = 10) {
  try {
    const { data, error } = await supabase
      .from('push_logs')
      .select('id, status, sent_at, error_message, report_id, channel')
      .order('sent_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('Fetch push logs failed:', err);
    return [];
  }
}

export async function sendBroadcastPush() {
  try {
    const { data, error } = await supabase.functions.invoke('line-daily-push');
    if (error) throw error;
    return {
      success: true,
      sentCount: data?.sent || 0,
      failedCount: data?.failed || 0,
      message: `推播完成：成功 ${data?.sent || 0} 人，失敗 ${data?.failed || 0} 人`,
    };
  } catch (err) {
    return {
      success: false,
      sentCount: 0,
      failedCount: 0,
      message: err instanceof Error ? err.message : '推播失敗',
    };
  }
}

export function generateLinePreview(
  report: {
    market_sentiment?: string;
    confidence_score?: number;
    summary?: string;
    full_report?: Record<string, unknown> | string | null;
  } | null,
  baseUrl: string
): LinePreviewMessage {
  if (!report) {
    return {
      emoji: '⏳',
      sentiment: '整理中',
      confidence: 0,
      summary: '今日報告尚未生成，請稍後再試。',
      dos: [],
      donts: [],
      tomorrowWatch: [],
      reportUrl: baseUrl,
    };
  }

  const sentiment = report.market_sentiment || '震盪';
  const confidence = report.confidence_score || 50;
  const summary = report.summary || '今日市場情報整理中...';

  // 解析 full_report
  let fullReport: Record<string, unknown> = {};
  try {
    if (report.full_report && typeof report.full_report === 'string') {
      fullReport = JSON.parse(report.full_report);
    } else if (report.full_report && typeof report.full_report === 'object') {
      fullReport = report.full_report;
    }
  } catch {
    fullReport = {};
  }

  const extractArr = (val: unknown): string[] => {
    if (!val) return [];
    if (Array.isArray(val)) return val.map(String).filter(Boolean);
    if (typeof val === 'string') return val.split(/[,，、;；\n]/).map((s) => s.trim()).filter(Boolean);
    return [];
  };

  const emoji = sentiment.includes('偏多') ? '🟢' : sentiment.includes('偏空') ? '🔴' : '🟡';

  return {
    emoji,
    sentiment,
    confidence,
    summary,
    dos: extractArr(fullReport.what_to_watch_today).slice(0, 3),
    donts: extractArr(fullReport.what_not_to_do).slice(0, 3),
    tomorrowWatch: extractArr(fullReport.tomorrow_watchlist).slice(0, 3),
    reportUrl: `${baseUrl}/report/today`,
  };
}

export function formatLineMessageText(preview: LinePreviewMessage): string {
  let text = `${preview.emoji} 今日市場${preview.sentiment}（把握度 ${preview.confidence}/100）\n\n`;
  text += `${preview.summary}\n\n`;

  if (preview.dos.length > 0) {
    text += `✅ 可觀察：${preview.dos.join(' / ')}\n`;
  }
  if (preview.donts.length > 0) {
    text += `❌ 不建議：${preview.donts.join(' / ')}\n`;
  }

  if (preview.tomorrowWatch.length > 0) {
    text += `\n📌 明天市場在意：${preview.tomorrowWatch.join(' / ')}\n`;
  }

  if (preview.reportUrl) {
    text += `\n👉 查看完整 AI 盤前報告\n${preview.reportUrl}`;
  }

  return text;
}
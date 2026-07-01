import { supabase } from '@/lib/supabase';
import { callGetReportPayload } from '@/services/entitlementService';

export interface DataTimestamps {
  reportCreatedAt: string | null;
  intradayCheckCreatedAt: string | null;
  marketDataCapturedAt: string | null;
  marketNewsPublishedAt: string | null;
  openingRadarCreatedAt: string | null;
}

export async function getDataTimestamps(): Promise<DataTimestamps> {
  const now = new Date();
  const twNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  const today = `${twNow.getFullYear()}-${String(twNow.getMonth() + 1).padStart(2, '0')}-${String(twNow.getDate()).padStart(2, '0')}`;

  const results: DataTimestamps = {
    reportCreatedAt: null,
    intradayCheckCreatedAt: null,
    marketDataCapturedAt: null,
    marketNewsPublishedAt: null,
    openingRadarCreatedAt: null,
  };

  // 1. Latest report generated timestamp from server-trimmed payload
  try {
    const response = await callGetReportPayload();
    const payload = response.payload || {};
    const nestedAI = payload.ai_strategy_json && typeof payload.ai_strategy_json === 'object' && !Array.isArray(payload.ai_strategy_json)
      ? payload.ai_strategy_json as Record<string, unknown>
      : null;
    const generatedAt =
      payload.generated_at ||
      payload.generatedAt ||
      payload.report_generated_at ||
      payload.created_at ||
      payload.updated_at ||
      nestedAI?.generated_at;
    if (typeof generatedAt === 'string' && generatedAt.trim()) {
      results.reportCreatedAt = generatedAt.trim();
    }
  } catch {
    // ignore
  }

  // 2. intraday_checks 今日最新一筆 created_at
  try {
    const { data, error } = await supabase
      .from('intraday_checks')
      .select('created_at')
      .eq('check_date', today)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!error && data) {
      results.intradayCheckCreatedAt = String(data.created_at || '');
    }
  } catch {
    // ignore
  }

  // 3. market_data max(captured_at)
  try {
    const { data, error } = await supabase
      .from('market_data')
      .select('captured_at')
      .order('captured_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!error && data) {
      results.marketDataCapturedAt = String(data.captured_at || '');
    }
  } catch {
    // ignore
  }

  // 4. market_news max(published_at)
  try {
    const { data, error } = await supabase
      .from('market_news')
      .select('published_at')
      .order('published_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!error && data) {
      results.marketNewsPublishedAt = String(data.published_at || '');
    }
  } catch {
    // ignore
  }

  // 5. opening_market_radar 今日最新 updated_at
  try {
    const { data, error } = await supabase
      .from('opening_market_radar')
      .select('updated_at')
      .eq('report_date', today)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!error && data) {
      results.openingRadarCreatedAt = String(data.updated_at || '');
    }
  } catch {
    // ignore
  }

  return results;
}

function formatToTaipeiTime(dateStr: string | null): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('zh-TW', {
      timeZone: 'Asia/Taipei',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return '';
  }
}

export function formatTimestampForDisplay(ts: string | null): string {
  if (!ts) return '尚未更新';
  const formatted = formatToTaipeiTime(ts);
  if (!formatted) return '尚未更新';
  return formatted;
}

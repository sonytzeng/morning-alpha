import { supabase } from '@/lib/supabase';

export interface IntradayCheck {
  id: string;
  check_date: string;
  check_time: string;
  opening_status: string | null;
  taiex_change: number | null;
  futures_change: number | null;
  tsmc_change: number | null;
  volume_status: string | null;
  scenario_result: string | null;
  ai_summary: string | null;
  should_push_line: boolean;
  created_at: string;
}

function safeNumber(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return Number.isNaN(n) ? null : n;
}

function safeString(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  return String(val);
}

function safeBoolean(val: unknown): boolean {
  if (val === null || val === undefined) return false;
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') return val.toLowerCase() === 'true';
  if (typeof val === 'number') return val === 1;
  return false;
}

export function mapRowToIntradayCheck(row: Record<string, unknown>): IntradayCheck {
  return {
    id: String(row.id || ''),
    check_date: String(row.check_date || ''),
    check_time: String(row.check_time || ''),
    opening_status: safeString(row.opening_status),
    taiex_change: safeNumber(row.taiex_change),
    futures_change: safeNumber(row.futures_change),
    tsmc_change: safeNumber(row.tsmc_change),
    volume_status: safeString(row.volume_status),
    scenario_result: safeString(row.scenario_result),
    ai_summary: safeString(row.ai_summary),
    should_push_line: safeBoolean(row.should_push_line),
    created_at: String(row.created_at || ''),
  };
}

export async function getTodayIntradayCheck(): Promise<IntradayCheck | null> {
  const now = new Date();
  const twNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  const today = `${twNow.getFullYear()}-${String(twNow.getMonth() + 1).padStart(2, '0')}-${String(twNow.getDate()).padStart(2, '0')}`;

  const { data, error } = await supabase
    .from('intraday_checks')
    .select('*')
    .eq('check_date', today)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('getTodayIntradayCheck error:', error.message);
    return null;
  }
  if (!data) return null;

  return mapRowToIntradayCheck(data as Record<string, unknown>);
}

export async function getIntradayCheckByDate(date: string): Promise<IntradayCheck | null> {
  const { data, error } = await supabase
    .from('intraday_checks')
    .select('*')
    .eq('check_date', date)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('getIntradayCheckByDate error:', error.message);
    return null;
  }
  if (!data) return null;

  return mapRowToIntradayCheck(data as Record<string, unknown>);
}

export async function getLatestIntradayChecks(limit = 7): Promise<IntradayCheck[]> {
  const { data, error } = await supabase
    .from('intraday_checks')
    .select('*')
    .order('check_date', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('getLatestIntradayChecks error:', error.message);
    return [];
  }

  return (data || []).map((row) => mapRowToIntradayCheck(row as Record<string, unknown>));
}
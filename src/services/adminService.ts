import { supabase } from '@/lib/supabase';

export async function fetchAdminNewsSources() {
  const { count, error } = await supabase
    .from('reports')
    .select('*', { count: 'exact', head: true });

  if (error) throw new Error(`讀取失敗: ${error.message}`);

  return {
    totalReports: count || 0,
    lastReportDate: null as string | null,
  };
}

export async function fetchAdminKeywords() {
  return [] as Array<Record<string, unknown>>;
}

export async function fetchAdminMarketData() {
  return [] as Array<Record<string, unknown>>;
}

export async function fetchAdminReportStatus() {
  const { data, error } = await supabase
    .from('reports')
    .select('id, report_date, confidence_score')
    .order('report_date', { ascending: false })
    .limit(5);

  if (error) throw new Error(`讀取失敗: ${error.message}`);
  return data || [];
}

export async function fetchAdminPushLogs() {
  return [] as Array<Record<string, unknown>>;
}

export async function fetchAdminMembers() {
  return [] as Array<Record<string, unknown>>;
}

export async function fetchAdminStats() {
  const { count: reportCount, error: reportError } = await supabase
    .from('reports')
    .select('*', { count: 'exact', head: true });

  const { count: subCount, error: subError } = await supabase
    .from('subscribers')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'active');

  const { count: lineEnabledCount, error: lineError } = await supabase
    .from('subscribers')
    .select('*', { count: 'exact', head: true })
    .eq('line_push_enabled', true)
    .eq('status', 'active');

  const today = new Date().toISOString().slice(0, 10);
  const { count: todayPushCount, error: pushError } = await supabase
    .from('push_logs')
    .select('*', { count: 'exact', head: true })
    .gte('sent_at', `${today}T00:00:00Z`)
    .eq('status', 'success');

  const { count: totalPushCount, error: totalPushError } = await supabase
    .from('push_logs')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'success');

  if (reportError) throw new Error(`讀取報告統計失敗: ${reportError.message}`);

  return {
    totalReports: reportCount || 0,
    activeMembers: subCount || 0,
    proMembers: 0,
    premiumMembers: 0,
    freeMembers: subCount || 0,
    todayReports: 0,
    todayNewsImported: 0,
    todayPushesSent: todayPushCount || 0,
    avgAiConfidence: 0,
    lineSubscribers: lineEnabledCount || 0,
    totalPushesSent: totalPushCount || 0,
  };
}

export async function fetchTodayWorkflowSteps() {
  return [] as Array<Record<string, unknown>>;
}

export async function fetchLinePushStatus() {
  return {
    scheduledTime: '07:30',
    status: 'scheduled' as const,
    recipientCount: 0,
    successCount: 0,
    failedCount: 0,
    messagePreview: '推播功能尚未啟用',
  };
}

// Actions
export async function regenerateReport() {
  return { success: true, reportId: 'rs-new', generatedAt: new Date().toISOString() };
}

export async function publishReport() {
  return { success: true, publishedAt: new Date().toISOString() };
}

export interface AdminStats {
  totalReports: number;
  activeMembers: number;
  proMembers: number;
  premiumMembers: number;
  freeMembers: number;
  todayReports: number;
  todayNewsImported: number;
  todayPushesSent: number;
  avgAiConfidence: number;
  lineSubscribers: number;
  totalPushesSent: number;
}
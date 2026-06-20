import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Push Stats — Dashboard 用推播統計查詢
Deno.serve(async (req) => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    );

    // 1. 訂閱統計
    const { count: totalSubscribers, error: subError } = await supabase
      .from('subscribers')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active');

    const { count: lineEnabled, error: lineError } = await supabase
      .from('subscribers')
      .select('*', { count: 'exact', head: true })
      .eq('line_push_enabled', true)
      .eq('status', 'active');

    // 2. 今日推播統計
    const today = new Date().toISOString().slice(0, 10);
    const { data: todayPushes, error: pushError } = await supabase
      .from('push_logs')
      .select('status, sent_at')
      .gte('sent_at', `${today}T00:00:00Z`)
      .order('sent_at', { ascending: false })
      .limit(20);

    // 3. 最近 7 天推播趨勢
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const { data: recentPushes, error: recentError } = await supabase
      .from('push_logs')
      .select('status, sent_at')
      .gte('sent_at', sevenDaysAgo.toISOString())
      .order('sent_at', { ascending: false });

    // 4. 最近 5 筆推播紀錄（帶上報告資訊）
    const { data: pushLogs, error: logsError } = await supabase
      .from('push_logs')
      .select('id, status, sent_at, error_message, report_id, daily_reports!inner(report_date, one_sentence_summary)')
      .order('sent_at', { ascending: false })
      .limit(5);

    if (subError || lineError || pushError || recentError || logsError) {
      return new Response(
        JSON.stringify({
          error: 'Database query failed',
          details: { subError, lineError, pushError, recentError, logsError },
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 計算今日成功/失敗
    const todaySuccess = todayPushes?.filter((p) => p.status === 'success').length || 0;
    const todayFailed = todayPushes?.filter((p) => p.status === 'failed').length || 0;

    // 最近 7 天統計
    const recentSuccess = recentPushes?.filter((p) => p.status === 'success').length || 0;
    const recentFailed = recentPushes?.filter((p) => p.status === 'failed').length || 0;

    return new Response(
      JSON.stringify({
        subscribers: {
          total: totalSubscribers || 0,
          lineEnabled: lineEnabled || 0,
        },
        today: {
          success: todaySuccess,
          failed: todayFailed,
          total: todaySuccess + todayFailed,
        },
        recent7Days: {
          success: recentSuccess,
          failed: recentFailed,
          total: recentSuccess + recentFailed,
        },
        recentLogs: pushLogs || [],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Internal error', detail: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});

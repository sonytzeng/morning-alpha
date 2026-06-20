import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// LINE Daily Push V3 — 每天 07:33 推送 AI 盤前提醒
// V3 升級：加入台股交易日 Gate，休市日不推播盤前報告
// V2 升級：加入 sentiment_score/sentiment_label + sentiment_reason 推播

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, x-cron-secret',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 1. 驗證 cron secret
  const cronSecret = Deno.env.get('CRON_SECRET');
  const reqSecret = req.headers.get('x-cron-secret');

  if (!cronSecret || reqSecret !== cronSecret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const channelAccessToken = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN');
  if (!channelAccessToken) {
    return new Response(
      JSON.stringify({ error: 'LINE_CHANNEL_ACCESS_TOKEN not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  );

  const siteUrl = Deno.env.get('SITE_URL') || 'https://morningalphatw.com';

  // ─── V3: 取得台北今日日期 ───
  const taipeiToday = getTaipeiToday();
  console.log(`[LINE-PUSH-V3] Taipei today: ${taipeiToday}`);

  // 2. V3: 只查今天的報告，不查最新一筆（避免推到昨天的報告）
  const { data: report, error: reportError } = await supabase
    .from('reports')
    .select('*')
    .eq('report_date', taipeiToday)
    .maybeSingle();

  if (reportError) {
    console.error('[LINE-PUSH-V3] Report fetch error:', reportError);
    return new Response(
      JSON.stringify({
        success: false,
        sent: false,
        reason: 'REPORT_FETCH_ERROR',
        date: taipeiToday,
        error: reportError.message,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // ─── V3: 今天完全沒有報告 → 不推播，不 fallback 到昨天 ───
  if (!report) {
    console.log(`[LINE-PUSH-V3] No report for ${taipeiToday} — skip push`);
    return new Response(
      JSON.stringify({
        success: true,
        sent: false,
        reason: 'NO_REPORT_FOR_TODAY',
        date: taipeiToday,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // ─── V3: 交易日 Gate ───
  const tradingDecision = checkTradingDay(report);
  if (!tradingDecision.isTradingDay) {
    console.log(
      `[LINE-PUSH-V3] Market closed for ${taipeiToday}: ${tradingDecision.reason}` +
      (tradingDecision.holidayName ? ` (${tradingDecision.holidayName})` : '')
    );

    return new Response(
      JSON.stringify({
        success: true,
        sent: false,
        reason: tradingDecision.reason,
        date: taipeiToday,
        holiday_name: tradingDecision.holidayName || null,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  console.log(`[LINE-PUSH-V3] Trading day confirmed for ${taipeiToday} — proceeding to push`);

  const reportDate = taipeiToday;

  // 3. 取得所有 active subscribers
  const { data: subscribers, error: subError } = await supabase
    .from('line_subscribers')
    .select('id, line_user_id, display_name')
    .eq('is_active', true);

  if (subError) {
    return new Response(
      JSON.stringify({ error: 'Failed to fetch subscribers', detail: subError.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  if (!subscribers || subscribers.length === 0) {
    return new Response(
      JSON.stringify({
        success: true,
        sent: true,
        report_date: reportDate,
        total_subscribers: 0,
        sent_count: 0,
        failed_count: 0,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // 4. 組成 LINE push message
  const message = buildLineMessage(report, siteUrl);
  const messagePreview = message.text.slice(0, 200);

  // 5. 逐一推播（單一失敗不中斷全部）
  let sentCount = 0;
  let failedCount = 0;
  const now = new Date().toISOString();

  for (const sub of subscribers) {
    const userId = sub.line_user_id;
    if (!userId) continue;

    try {
      const pushRes = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${channelAccessToken}`,
        },
        body: JSON.stringify({
          to: userId,
          messages: [message],
        }),
      });

      if (pushRes.ok) {
        sentCount++;
        // 記錄成功
        await supabase.from('line_push_logs').insert({
          line_user_id: userId,
          push_type: 'daily_report',
          report_date: reportDate,
          status: 'success',
          message_preview: messagePreview,
        });
        // 更新 last_pushed_at
        await supabase
          .from('line_subscribers')
          .update({ last_pushed_at: now, updated_at: now })
          .eq('line_user_id', userId);
      } else {
        const errText = await pushRes.text();
        failedCount++;
        console.error(`Push failed for ${userId}:`, errText);
        await supabase.from('line_push_logs').insert({
          line_user_id: userId,
          push_type: 'daily_report',
          report_date: reportDate,
          status: 'failed',
          message_preview: messagePreview,
          error_message: errText.slice(0, 500),
        });
      }
    } catch (e) {
      failedCount++;
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error(`Push exception for ${userId}:`, errMsg);
      await supabase.from('line_push_logs').insert({
        line_user_id: userId,
        push_type: 'daily_report',
        report_date: reportDate,
        status: 'failed',
        message_preview: messagePreview,
        error_message: errMsg.slice(0, 500),
      });
    }
  }

  return new Response(
    JSON.stringify({
      success: true,
      sent: true,
      reason: 'TRADING_DAY_PUSH',
      report_date: reportDate,
      total_subscribers: subscribers.length,
      sent_count: sentCount,
      failed_count: failedCount,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});

// ─── V3: 取得台北今日日期 (YYYY-MM-DD) ───
function getTaipeiToday(): string {
  const now = new Date();
  // UTC+8
  const taipeiOffset = 8 * 60 * 60 * 1000;
  const taipeiTime = new Date(now.getTime() + taipeiOffset);
  const y = taipeiTime.getUTCFullYear();
  const m = String(taipeiTime.getUTCMonth() + 1).padStart(2, '0');
  const d = String(taipeiTime.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ─── V3: 交易日 Gate 檢查 ───
function checkTradingDay(report: Record<string, unknown>): {
  isTradingDay: boolean;
  reason: string;
  holidayName: string | null;
} {
  const aiRaw = report.ai_strategy_json;

  // 先看 report 頂層有沒有直接的 market_closed / is_trading_day 欄位
  if (report.market_closed === true) {
    return { isTradingDay: false, reason: 'MARKET_CLOSED', holidayName: null };
  }
  if (report.is_trading_day === false) {
    return { isTradingDay: false, reason: 'NOT_TRADING_DAY', holidayName: null };
  }

  // 解析 ai_strategy_json
  let ai: Record<string, unknown> | null = null;
  if (typeof aiRaw === 'string') {
    try {
      ai = JSON.parse(aiRaw);
    } catch {
      ai = null;
    }
  } else if (aiRaw && typeof aiRaw === 'object' && !Array.isArray(aiRaw)) {
    ai = aiRaw as Record<string, unknown>;
  }

  if (!ai) {
    // 沒有 ai_strategy_json → 保守處理：視為交易日（讓推播繼續）
    // 如果連 ai_strategy_json 都沒有，代表 report 本身就是不完整的，
    // 由前面的 !report 檢查已經處理了「今天沒報告」的情況
    return { isTradingDay: true, reason: 'NO_AI_STRATEGY_JSON_ASSUME_TRADING', holidayName: null };
  }

  // V3: 依序檢查所有非交易日旗標
  const holidayName = typeof ai.holiday_name === 'string' && ai.holiday_name.trim().length > 0
    ? ai.holiday_name.trim()
    : null;

  // is_trading_day === false (明確標記非交易日)
  if (ai.is_trading_day === false || ai.is_trading_day === 'false') {
    return {
      isTradingDay: false,
      reason: 'MARKET_CLOSED_HOLIDAY',
      holidayName: holidayName,
    };
  }

  // trading_day === false
  if (ai.trading_day === false || ai.trading_day === 'false') {
    return {
      isTradingDay: false,
      reason: 'MARKET_CLOSED_HOLIDAY',
      holidayName: holidayName,
    };
  }

  // market_closed === true
  if (ai.market_closed === true || ai.market_closed === 'true') {
    return {
      isTradingDay: false,
      reason: 'MARKET_CLOSED',
      holidayName: holidayName,
    };
  }

  // holiday === true
  if (ai.holiday === true || ai.holiday === 'true') {
    return {
      isTradingDay: false,
      reason: 'MARKET_CLOSED_HOLIDAY',
      holidayName: holidayName,
    };
  }

  // holiday_name 存在但以上旗標都沒觸發 → 仍視為休市
  if (holidayName) {
    return {
      isTradingDay: false,
      reason: 'MARKET_CLOSED_HOLIDAY',
      holidayName: holidayName,
    };
  }

  // 所有檢查通過 → 交易日
  return { isTradingDay: true, reason: 'TRADING_DAY_CONFIRMED', holidayName: null };
}

// ─── 推播訊息建構 (V2 logic, unchanged) ───
function buildLineMessage(report: Record<string, unknown>, siteUrl: string) {
  const bias = String(report.market_bias || '中性');
  const confidence = Number(report.confidence_score || 50);
  const summary = String(report.summary || '今日市場觀察中...');

  // V2: use sentiment_score + sentiment_label when available
  const sentimentScore = report.sentiment_score !== null && report.sentiment_score !== undefined
    ? Number(report.sentiment_score)
    : null;
  const sentimentLabel = report.sentiment_label ? String(report.sentiment_label) : null;
  const sentimentReason = report.sentiment_reason ? String(report.sentiment_reason) : null;
  const riskReason = report.risk_reason ? String(report.risk_reason) : null;

  const canWatch = safeStringArray(report.can_watch);
  const avoidToday = safeStringArray(report.avoid_today);

  // Build display sentiment line
  let sentimentLine: string;
  if (sentimentScore !== null && sentimentLabel) {
    sentimentLine = `市場情緒：${sentimentScore}/100\n${sentimentLabel}`;
  } else {
    sentimentLine = `市場情緒：${bias}\nAI 信心：${confidence}/100`;
  }

  let text = '';
  text += 'Morning Alpha｜今日 AI 盤前提醒\n';
  text += '━━━━━━━━━━\n\n';
  text += `${sentimentLine}\n\n`;

  if (sentimentReason) {
    // Format: show up to 3 items from reason
    const reasonItems = sentimentReason.split(/[、,，]/).slice(0, 3);
    if (reasonItems.length > 0) {
      text += `主要來源：\n${reasonItems.map((r) => `・${r.trim()}`).join('\n')}\n\n`;
    }
  }

  text += `今天最重要的一句話：\n「${summary.slice(0, 100)}${summary.length > 100 ? '...' : ''}」\n\n`;

  if (riskReason) {
    const riskItems = riskReason.split(/[、,，]/).slice(0, 2);
    if (riskItems.length > 0) {
      text += `風險提醒：\n${riskItems.map((r) => `・${r.trim()}`).join('\n')}\n\n`;
    }
  } else if (canWatch.length > 0) {
    text += `今天可以觀察：\n${canWatch.slice(0, 3).join('、')}\n\n`;
  }

  if (avoidToday.length > 0) {
    text += `今天避免：\n${avoidToday.slice(0, 2).join('、')}\n\n`;
  }

  text += `查看今日完整策略：\n${siteUrl}/report/today\n\n`;
  text += '提醒：本內容為 AI 市場情緒整理，不構成投資建議。';

  return { type: 'text', text };
}

function safeStringArray(val: unknown): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val.map(String).filter(Boolean);
  if (typeof val === 'string') return val.split(/[,，、;；\n]/).map((s) => s.trim()).filter(Boolean);
  return [];
}
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { resolveMarketStatus } from '../_shared/market-status.ts';
import { evaluatePremiumContentGate } from '../_shared/premium-content-gate.ts';
import { buildDeliveryIncidentLineMessage } from '../_shared/line-incident-message.ts';
import { authorizeInternalRequest, internalCredentialsFromEnv } from '../_shared/internal-function-auth.mjs';
import { buildLineDailyFlexMessage } from '../_shared/line-daily-flex-message.mjs';
import type { RuntimeDatabase } from '../_shared/runtime-database-contract.ts';

// LINE Daily Push V4 — 90 分硬閘門、事故通知、Transactional Outbox 重送
// V3 升級：加入台股交易日 Gate，休市日不推播盤前報告
// V2 升級：加入 sentiment_score/sentiment_label + sentiment_reason 推播

type LineSubscriber = {
  id: string;
  line_user_id: string | null;
  display_name: string | null;
};

type DeliveryTarget = LineSubscriber & {
  outbox_id: string;
  idempotency_key: string;
};

type DeliverySummary = {
  totalSubscribers: number;
  eligibleCount: number;
  alreadySentCount: number;
  sentCount: number;
  failedCount: number;
  pendingCount: number;
};

const SUBSCRIBER_PAGE_SIZE = 1000;
const LINE_MULTICAST_BATCH_SIZE = 500;
const DATABASE_BATCH_SIZE = 200;

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

  // 1. Shared internal service authentication.
  const auth = await authorizeInternalRequest(req.headers, internalCredentialsFromEnv());
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error_code, error_code: auth.error_code }), {
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

  const supabase = createClient<RuntimeDatabase>(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  );

  let requestBody: Record<string, unknown> = {};
  try {
    const parsed = await req.json();
    requestBody = parseRecord(parsed);
  } catch {
    requestBody = {};
  }
  const deliveryMode = requestBody.delivery_mode === 'incident' ? 'incident' : 'premium';
  const incidentReasonCodes = Array.isArray(requestBody.incident_reason_codes)
    ? requestBody.incident_reason_codes.map(String).filter(Boolean)
    : [];

  const siteUrl = Deno.env.get('SITE_URL') || 'https://morningalphatw.com';

  // ─── V3: 取得台北今日日期 ───
  const taipeiToday = getTaipeiToday();
  console.log(`[LINE-PUSH-V3] Taipei today: ${taipeiToday}`);
  const currentMarketStatus = resolveMarketStatus(taipeiToday);

  if (!currentMarketStatus.is_trading_day) {
    if (currentMarketStatus.market_status !== 'TYPHOON') {
      return new Response(
        JSON.stringify({
          success: true,
          sent: false,
          reason: 'MARKET_STATUS_NOT_OPEN',
          date: taipeiToday,
          market_status: currentMarketStatus.market_status,
          session_type: currentMarketStatus.session_type,
          is_trading_day: currentMarketStatus.is_trading_day,
          market_message: currentMarketStatus.market_message,
          next_trading_day: currentMarketStatus.next_trading_day,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const message = buildMarketClosedLineMessage(siteUrl);
    try {
      const summary = await deliverOutboxMessage({
        supabase, channelAccessToken, reportDate: taipeiToday, decisionSnapshotId: null,
        pushType: 'market_closed_typhoon', message,
      });
      return new Response(JSON.stringify({
        success: summary.failedCount === 0 && summary.pendingCount === 0,
        sent: summary.sentCount > 0, reason: 'TYPHOON_MARKET_CLOSED_PUSH', date: taipeiToday,
        market_status: currentMarketStatus.market_status, total_subscribers: summary.totalSubscribers,
        sent_count: summary.sentCount, failed_count: summary.failedCount, pending_count: summary.pendingCount,
      }), { status: summary.failedCount === 0 && summary.pendingCount === 0 ? 200 : 503, headers: { 'Content-Type': 'application/json' } });
    } catch (error) {
      return new Response(JSON.stringify({ success: false, sent: false, reason: 'TYPHOON_DELIVERY_ERROR', detail: error instanceof Error ? error.message : String(error) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
  }

  if (deliveryMode === 'incident') {
    const taipeiMinutes = getTaipeiMinutesNow();
    if (taipeiMinutes < 7 * 60 + 30) {
      return new Response(
        JSON.stringify({
          success: true,
          sent: false,
          reason: 'DELIVERY_DEADLINE_NOT_REACHED',
          date: taipeiToday,
          deadline: '07:30 Asia/Taipei',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const incidentMessage = buildDeliveryIncidentLineMessage(siteUrl, incidentReasonCodes);
    try {
      const summary = await deliverOutboxMessage({
        supabase,
        channelAccessToken,
        reportDate: taipeiToday,
        decisionSnapshotId: null,
        pushType: 'data_incident',
        message: incidentMessage,
      });
      return new Response(
        JSON.stringify({
          success: summary.failedCount === 0 && summary.pendingCount === 0,
          sent: summary.sentCount > 0,
          reason: summary.totalSubscribers === 0
            ? 'NO_ACTIVE_SUBSCRIBERS'
            : summary.eligibleCount === 0
              ? 'ALREADY_SENT'
              : 'DELIVERY_INCIDENT_NOTICE',
          report_date: taipeiToday,
          total_subscribers: summary.totalSubscribers,
          eligible_count: summary.eligibleCount,
          already_sent_count: summary.alreadySentCount,
          sent_count: summary.sentCount,
          failed_count: summary.failedCount,
          pending_count: summary.pendingCount,
        }),
        { status: summary.failedCount === 0 && summary.pendingCount === 0 ? 200 : 503, headers: { 'Content-Type': 'application/json' } },
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return new Response(
        JSON.stringify({ success: false, sent: false, reason: 'INCIDENT_DELIVERY_ERROR', detail }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }

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
  const { data: decisionSnapshot, error: decisionError } = await supabase
    .from('decision_snapshots')
    .select('*')
    .eq('report_date', reportDate)
    .eq('session_type', 'PREMARKET')
    .eq('is_current', true)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (decisionError) {
    return new Response(
      JSON.stringify({
        success: false,
        sent: false,
        reason: 'DECISION_SNAPSHOT_FETCH_ERROR',
        report_date: reportDate,
        detail: decisionError.message,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const ai = parseAiStrategy(report.ai_strategy_json);
  const importantNewsCount = Array.isArray(report.important_news_json)
    ? report.important_news_json.length
    : Array.isArray(ai.important_news)
      ? ai.important_news.length
      : Number(ai.fresh_news_count) || 0;
  const premiumGate = evaluatePremiumContentGate(ai, importantNewsCount);
  const decisionSnapshotId = String(decisionSnapshot?.id ?? '').trim();
  const snapshotStatus = String(decisionSnapshot?.status || '');
  const snapshotScore = Number(decisionSnapshot?.content_score);
  const snapshotMode = String(decisionSnapshot?.decision_mode || '');
  const snapshotEligible = Boolean(decisionSnapshotId)
    && snapshotStatus === 'READY'
    && Number.isFinite(snapshotScore)
    && snapshotScore >= 90
    && ['recommendations', 'no_trade'].includes(snapshotMode);
  const canonicalText = parseRecord(decisionSnapshot?.generated_text);
  const deliverySentence = firstText(
    canonicalText.daily_sentence,
    report.today_quote,
    parseRecord(ai.v8_daily_sentence).sentence,
    ai.today_quote,
  );
  const leadingDate = deliverySentence.match(/^(\d{4}-\d{2}-\d{2})(?:未|[，,。；;：:\s])/i)?.[1] || '';
  const sentenceDateEligible = !leadingDate || leadingDate === reportDate;

  if (!premiumGate.eligible || !snapshotEligible || !sentenceDateEligible) {
    const reasonCodes = Array.from(new Set([
      ...premiumGate.reason_codes,
      ...(!decisionSnapshotId ? ['decision_snapshot_missing'] : []),
      ...(decisionSnapshot && snapshotStatus !== 'READY' ? ['decision_snapshot_not_ready'] : []),
      ...(decisionSnapshot && (!Number.isFinite(snapshotScore) || snapshotScore < 90) ? ['decision_snapshot_score_below_90'] : []),
      ...(decisionSnapshot && !['recommendations', 'no_trade'].includes(snapshotMode) ? ['decision_snapshot_mode_blocked'] : []),
      ...(!sentenceDateEligible ? ['daily_sentence_date_mismatch'] : []),
    ]));
    console.warn('[LINE-PUSH-V4] Premium content hard gate blocked delivery:', reasonCodes);
    return new Response(
      JSON.stringify({
        success: false,
        sent: false,
        reason: 'PREMIUM_CONTENT_NOT_ELIGIBLE',
        report_date: reportDate,
        content_score: premiumGate.content_score,
        decision_snapshot_score: Number.isFinite(snapshotScore) ? snapshotScore : null,
        decision_mode: snapshotMode || premiumGate.decision_mode,
        reason_codes: reasonCodes,
      }),
      { status: 409, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // 4. 組成 LINE push message
  const message = buildLineMessage(
    report,
    siteUrl,
    decisionSnapshot && typeof decisionSnapshot === 'object' ? decisionSnapshot as Record<string, unknown> : null,
  );
  let delivery: DeliverySummary;
  try {
    delivery = await deliverOutboxMessage({
      supabase,
      channelAccessToken,
      reportDate,
      decisionSnapshotId,
      pushType: 'daily_report',
      message,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({
        success: false,
        sent: false,
        reason: 'LINE_DELIVERY_ERROR',
        report_date: reportDate,
        detail,
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  if (delivery.failedCount === 0 && delivery.pendingCount === 0) {
    await supabase.rpc('advance_trading_day_state_v1', {
      p_trading_date: reportDate, p_state: 'PREMARKET_DELIVERED', p_checkpoint: 'line_delivery', p_status: 'SUCCEEDED',
      p_correlation_id: crypto.randomUUID(), p_metadata: { decision_snapshot_id: decisionSnapshotId, sent_count: delivery.sentCount, already_sent_count: delivery.alreadySentCount },
    });
  }

  return new Response(
    JSON.stringify({
      success: delivery.failedCount === 0 && delivery.pendingCount === 0,
      sent: delivery.sentCount > 0,
      reason: delivery.totalSubscribers === 0
        ? 'NO_ACTIVE_SUBSCRIBERS'
        : delivery.eligibleCount === 0
          ? 'ALREADY_SENT'
        : delivery.failedCount === 0 && delivery.pendingCount === 0
          ? 'TRADING_DAY_PUSH'
          : 'PARTIAL_DELIVERY_FAILURE',
      report_date: reportDate,
      total_subscribers: delivery.totalSubscribers,
      eligible_count: delivery.eligibleCount,
      already_sent_count: delivery.alreadySentCount,
      sent_count: delivery.sentCount,
      failed_count: delivery.failedCount,
      pending_count: delivery.pendingCount,
    }),
    { status: delivery.failedCount === 0 && delivery.pendingCount === 0 ? 200 : 503, headers: { 'Content-Type': 'application/json' } },
  );
});

type SupabaseClient = ReturnType<typeof createClient<RuntimeDatabase>>;

async function deliverOutboxMessage(args: {
  supabase: SupabaseClient;
  channelAccessToken: string;
  reportDate: string;
  decisionSnapshotId: string | null;
  pushType: 'daily_report' | 'data_incident' | 'market_closed_typhoon';
  message: Record<string, unknown>;
}): Promise<DeliverySummary> {
  const subscribers = await fetchActiveSubscribers(args.supabase);
  if (subscribers.length === 0) {
    return {
      totalSubscribers: 0,
      eligibleCount: 0,
      alreadySentCount: 0,
      sentCount: 0,
      failedCount: 0,
      pendingCount: 0,
    };
  }

  const alreadySentIds = await fetchAlreadySentIds(args.supabase, args.reportDate, args.pushType);
  await reconcileAlreadySentOutbox(args.supabase, args.reportDate, args.pushType, alreadySentIds);
  const eligibleSubscribers = subscribers.filter((subscriber) => {
    const userId = subscriber.line_user_id;
    return Boolean(userId) && !alreadySentIds.has(String(userId));
  });
  if (eligibleSubscribers.length === 0) {
    return {
      totalSubscribers: subscribers.length,
      eligibleCount: 0,
      alreadySentCount: subscribers.filter((subscriber) => (
        subscriber.line_user_id && alreadySentIds.has(subscriber.line_user_id)
      )).length,
      sentCount: 0,
      failedCount: 0,
      pendingCount: 0,
    };
  }

  const messagePreview = firstText(args.message.altText, args.message.text).slice(0, 200);
  await enqueueDeliveryOutbox({
    supabase: args.supabase,
    subscribers: eligibleSubscribers,
    reportDate: args.reportDate,
    decisionSnapshotId: args.decisionSnapshotId,
    pushType: args.pushType,
    message: args.message,
    messagePreview,
  });

  let sentCount = 0;
  let failedCount = 0;
  let pendingCount = 0;
  const maxDrainPasses = 10;
  for (let pass = 0; pass < maxDrainPasses; pass++) {
    const targets = await claimDeliveryOutbox(
      args.supabase,
      args.reportDate,
      args.decisionSnapshotId,
      args.pushType,
    );
    if (targets.length === 0) break;
    const delivery = await sendMulticastBatches({
      supabase: args.supabase,
      channelAccessToken: args.channelAccessToken,
      subscribers: targets,
      message: args.message,
      messagePreview,
      reportDate: args.reportDate,
      pushType: args.pushType,
    });
    sentCount += delivery.sentCount;
    failedCount += delivery.failedCount;
    pendingCount += delivery.pendingCount;
    if (delivery.failedCount > 0) break;
  }

  const unprocessedCount = Math.max(0, eligibleSubscribers.length - sentCount - failedCount);
  return {
    totalSubscribers: subscribers.length,
    eligibleCount: eligibleSubscribers.length,
    alreadySentCount: subscribers.length - eligibleSubscribers.length,
    sentCount,
    failedCount,
    pendingCount: pendingCount + unprocessedCount,
  };
}

async function reconcileAlreadySentOutbox(
  supabase: SupabaseClient,
  reportDate: string,
  pushType: string,
  alreadySentIds: Set<string>,
): Promise<void> {
  const userIds = Array.from(alreadySentIds);
  const now = new Date().toISOString();
  for (let from = 0; from < userIds.length; from += DATABASE_BATCH_SIZE) {
    const { error } = await supabase
      .from('line_delivery_outbox')
      .update({
        status: 'SENT',
        sent_at: now,
        lease_expires_at: null,
        last_error: null,
        updated_at: now,
      })
      .eq('report_date', reportDate)
      .eq('push_type', pushType)
      .in('line_user_id', userIds.slice(from, from + DATABASE_BATCH_SIZE))
      .neq('status', 'SENT');
    if (error) throw new Error(`Failed to reconcile prior LINE delivery: ${error.message}`);
  }
}

async function enqueueDeliveryOutbox(args: {
  supabase: SupabaseClient;
  subscribers: LineSubscriber[];
  reportDate: string;
  decisionSnapshotId: string | null;
  pushType: string;
  message: Record<string, unknown>;
  messagePreview: string;
}): Promise<void> {
  const rows = args.subscribers.flatMap((subscriber) => {
    if (!subscriber.line_user_id) return [];
    return [{
      report_date: args.reportDate,
      decision_snapshot_id: args.decisionSnapshotId,
      line_subscriber_id: subscriber.id,
      line_user_id: subscriber.line_user_id,
      push_type: args.pushType,
      idempotency_key: [
        args.reportDate,
        args.pushType,
        subscriber.id,
      ].join(':'),
      payload: { message: args.message, message_preview: args.messagePreview },
    }];
  });

  for (let from = 0; from < rows.length; from += DATABASE_BATCH_SIZE) {
    const { error } = await args.supabase
      .from('line_delivery_outbox')
      .upsert(rows.slice(from, from + DATABASE_BATCH_SIZE), {
        onConflict: 'idempotency_key',
        ignoreDuplicates: true,
      });
    if (error) throw new Error(`Failed to enqueue LINE delivery: ${error.message}`);

    const subscriberIds = rows
      .slice(from, from + DATABASE_BATCH_SIZE)
      .map((row) => String(row.line_subscriber_id));
    const { error: refreshError } = await args.supabase
      .from('line_delivery_outbox')
      .update({
        decision_snapshot_id: args.decisionSnapshotId,
        payload: { message: args.message, message_preview: args.messagePreview },
        updated_at: new Date().toISOString(),
      })
      .eq('report_date', args.reportDate)
      .eq('push_type', args.pushType)
      .eq('status', 'PENDING')
      .in('line_subscriber_id', subscriberIds);
    if (refreshError) throw new Error(`Failed to refresh pending LINE delivery: ${refreshError.message}`);
  }
}

async function claimDeliveryOutbox(
  supabase: SupabaseClient,
  reportDate: string,
  decisionSnapshotId: string | null,
  pushType: string,
): Promise<DeliveryTarget[]> {
  const { data, error } = await supabase.rpc('claim_line_delivery_outbox_v1', {
    p_report_date: reportDate,
    p_decision_snapshot_id: decisionSnapshotId,
    p_push_type: pushType,
    p_limit: 1000,
    p_lease_seconds: 180,
  });
  if (error) throw new Error(`Failed to claim LINE delivery outbox: ${error.message}`);
  return ((data || []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.line_subscriber_id || ''),
    line_user_id: String(row.line_user_id || ''),
    display_name: null,
    outbox_id: String(row.id || ''),
    idempotency_key: String(row.idempotency_key || ''),
  })).filter((row) => row.id && row.line_user_id && row.outbox_id && row.idempotency_key);
}

async function markDeliveryOutbox(
  supabase: SupabaseClient,
  outboxIds: string[],
  status: 'SENT' | 'RETRY' | 'FAILED',
  errorDetail: string | null,
): Promise<void> {
  if (outboxIds.length === 0) return;
  const { error } = await supabase.rpc('mark_line_delivery_outbox_v1', {
    p_ids: outboxIds,
    p_status: status,
    p_error: errorDetail,
    p_retry_delay_seconds: 60,
  });
  if (error) throw new Error(`Failed to update LINE delivery outbox: ${error.message}`);
}

async function fetchActiveSubscribers(supabase: SupabaseClient): Promise<LineSubscriber[]> {
  const subscribers: LineSubscriber[] = [];
  for (let from = 0; ; from += SUBSCRIBER_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('line_subscribers')
      .select('id, line_user_id, display_name')
      .eq('is_active', true)
      .order('id', { ascending: true })
      .range(from, from + SUBSCRIBER_PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to fetch subscribers: ${error.message}`);
    const page = (data || []) as LineSubscriber[];
    subscribers.push(...page);
    if (page.length < SUBSCRIBER_PAGE_SIZE) break;
  }
  return subscribers;
}

async function fetchAlreadySentIds(
  supabase: SupabaseClient,
  reportDate: string,
  pushType: string,
): Promise<Set<string>> {
  const sentIds = new Set<string>();
  for (let from = 0; ; from += SUBSCRIBER_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('line_push_logs')
      .select('line_user_id')
      .eq('report_date', reportDate)
      .eq('push_type', pushType)
      .eq('status', 'success')
      .range(from, from + SUBSCRIBER_PAGE_SIZE - 1);
    if (error) throw new Error(`Failed to verify prior LINE pushes: ${error.message}`);
    const page = (data || []) as Array<{ line_user_id: string | null }>;
    for (const row of page) if (row.line_user_id) sentIds.add(row.line_user_id);
    if (page.length < SUBSCRIBER_PAGE_SIZE) break;
  }
  return sentIds;
}

async function createRetryKey(seed: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed)));
  const hex = Array.from(bytes).map((value) => value.toString(16).padStart(2, '0')).join('');
  const variant = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function insertPushLogs(
  supabase: SupabaseClient,
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  for (let from = 0; from < rows.length; from += DATABASE_BATCH_SIZE) {
    const { error } = await supabase.from('line_push_logs').insert(rows.slice(from, from + DATABASE_BATCH_SIZE));
    if (error) throw new Error(`Failed to persist LINE push logs: ${error.message}`);
  }
}

async function markSubscribersPushed(
  supabase: SupabaseClient,
  userIds: string[],
  now: string,
): Promise<void> {
  for (let from = 0; from < userIds.length; from += DATABASE_BATCH_SIZE) {
    const { error } = await supabase
      .from('line_subscribers')
      .update({ last_pushed_at: now, updated_at: now })
      .in('line_user_id', userIds.slice(from, from + DATABASE_BATCH_SIZE));
    if (error) throw new Error(`Failed to update subscriber push timestamps: ${error.message}`);
  }
}

async function sendMulticastBatches(args: {
  supabase: SupabaseClient;
  channelAccessToken: string;
  subscribers: DeliveryTarget[];
  message: Record<string, unknown>;
  messagePreview: string;
  reportDate: string;
  pushType: string;
}): Promise<{ sentCount: number; failedCount: number; pendingCount: number }> {
  let sentCount = 0;
  let failedCount = 0;
  let pendingCount = 0;
  const now = new Date().toISOString();

  for (let from = 0; from < args.subscribers.length; from += LINE_MULTICAST_BATCH_SIZE) {
    const batch = args.subscribers.slice(from, from + LINE_MULTICAST_BATCH_SIZE);
    const userIds = batch.map((subscriber) => String(subscriber.line_user_id)).filter(Boolean);
    const outboxIds = batch.map((subscriber) => subscriber.outbox_id);
    const retryKey = await createRetryKey(
      batch.map((subscriber) => subscriber.idempotency_key).sort().join('|'),
    );

    let response: Response;
    try {
      response = await fetch('https://api.line.me/v2/bot/message/multicast', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${args.channelAccessToken}`,
          'X-Line-Retry-Key': retryKey,
        },
        body: JSON.stringify({
          to: userIds,
          messages: [args.message],
          customAggregationUnits: [`ma_daily_${args.reportDate.replaceAll('-', '')}`],
        }),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      failedCount += userIds.length;
      pendingCount += userIds.length;
      await markDeliveryOutbox(args.supabase, outboxIds, 'RETRY', detail.slice(0, 500));
      await insertPushLogs(args.supabase, userIds.map((lineUserId) => ({
        line_user_id: lineUserId,
        push_type: args.pushType,
        report_date: args.reportDate,
        status: 'failed',
        message_preview: args.messagePreview,
        error_message: detail.slice(0, 500),
      })));
      continue;
    }

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      failedCount += userIds.length;
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable) pendingCount += userIds.length;
      await markDeliveryOutbox(args.supabase, outboxIds, retryable ? 'RETRY' : 'FAILED', detail);
      await insertPushLogs(args.supabase, userIds.map((lineUserId) => ({
        line_user_id: lineUserId,
        push_type: args.pushType,
        report_date: args.reportDate,
        status: 'failed',
        message_preview: args.messagePreview,
        error_message: detail,
      })));
      continue;
    }

    await markDeliveryOutbox(args.supabase, outboxIds, 'SENT', null);
    await insertPushLogs(args.supabase, userIds.map((lineUserId) => ({
      line_user_id: lineUserId,
      push_type: args.pushType,
      report_date: args.reportDate,
      status: 'success',
      message_preview: args.messagePreview,
    })));
    await markSubscribersPushed(args.supabase, userIds, now);
    sentCount += userIds.length;
  }

  return { sentCount, failedCount, pendingCount };
}

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

function getTaipeiMinutesNow(): number {
  const now = new Date();
  const taipeiTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return taipeiTime.getUTCHours() * 60 + taipeiTime.getUTCMinutes();
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


function buildMarketClosedLineMessage(siteUrl: string) {
  return {
    type: 'text',
    text: [
      '【Morning Alpha】',
      '',
      '今日因停班停市，',
      'Morning Alpha 已切換休市模式。',
      '',
      '今晚仍會整理：',
      '美股',
      '國際新聞',
      '下一交易日重點。',
      '',
      siteUrl,
    ].join('\n'),
  };
}

// ─── 推播訊息建構：短版、低重複、以報告 guardrail copy 為準 ───
function buildLineMessage(
  report: Record<string, unknown>,
  siteUrl: string,
  decisionSnapshot: Record<string, unknown> | null = null,
) {
  const ai = parseAiStrategy(report.ai_strategy_json);
  const copy = parseRecord(ai.line_push_copy);
  const freeSummary = parseRecord(ai.free_summary);
  const dailySentence = parseRecord(ai.v8_daily_sentence);
  const canonicalText = parseRecord(decisionSnapshot?.generated_text);
  const canonicalReasons = Array.isArray(canonicalText.reasons) ? canonicalText.reasons : [];
  const canonicalSectors = Array.isArray(canonicalText.preferred_sectors) ? canonicalText.preferred_sectors : [];
  const canonicalInvalidations = Array.isArray(canonicalText.invalidation_conditions) ? canonicalText.invalidation_conditions : [];
  const firstCanonicalInvalidation = parseRecord(canonicalInvalidations[0]);
  const bias = String(canonicalText.market_bias || decisionSnapshot?.market_regime || copy.market_bias || report.market_bias || '中性觀察');
  const todayLine = firstText(
    canonicalText.daily_sentence,
    report.today_quote,
    dailySentence.sentence,
    ai.today_quote,
    copy.one_sentence,
    freeSummary.one_sentence,
    report.summary,
    '資料不足，今日降級觀察，開盤後再確認方向。',
  );
  const opportunity = firstText(
    canonicalSectors[0],
    canonicalReasons[0],
    copy.opportunity,
    copy.watch_point,
    inferOpportunity(report, ai),
    '等待開盤後族群同步性確認',
  );
  const avoid = firstText(
    canonicalText.do_not_do,
    copy.do_not_do,
    freeSummary.do_not_do,
    firstArrayText(report.avoid_today),
    bias.includes('多') ? '避免把盤前偏多當成追價理由，先等量價確認。' : '避免急著撿便宜，先等賣壓與量能訊號。',
  );
  const risk = firstText(
    firstCanonicalInvalidation.condition,
    firstCanonicalInvalidation.trigger,
    firstCanonicalInvalidation.invalidation_condition,
    canonicalInvalidations[0],
    copy.risk,
    copy.max_risk,
    freeSummary.risk,
    ai.primary_risk,
    avoid,
  );
  const importantNewsCount = Array.isArray(ai.important_news)
    ? ai.important_news.length
    : Array.isArray(report.important_news_json)
      ? report.important_news_json.length
      : Number(ai.fresh_news_count) || 0;
  const premiumGate = evaluatePremiumContentGate(ai, importantNewsCount);
  const canonicalDecisionMode = firstText(decisionSnapshot?.decision_mode, premiumGate.decision_mode);
  const canonicalRecommendations = Array.isArray(canonicalText.recommendations)
    ? canonicalText.recommendations
    : [];
  const v10Recommendations = Array.isArray(ai.today_beneficiary_stocks_v10)
    ? ai.today_beneficiary_stocks_v10
    : [];
  const legacyRecommendations = Array.isArray(ai.today_beneficiary_stocks)
    ? ai.today_beneficiary_stocks
    : [];
  const recommendations = canonicalRecommendations.length > 0
    ? canonicalRecommendations
    : v10Recommendations.length > 0
      ? v10Recommendations
      : legacyRecommendations;

  return buildLineDailyFlexMessage({
    reportDate: String(report.report_date || ''),
    bias,
    todayLine,
    opportunity,
    risk,
    avoid,
    decisionMode: canonicalDecisionMode,
    recommendations,
    siteUrl,
  });
}

function parseAiStrategy(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string' && value.trim()) {
    try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
  }
  return {};
}

function parseRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function firstArrayText(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value.map((item) => String(item || '').trim()).find(Boolean) || '';
}

function clipLine(text: string, max: number): string {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max - 1) + '…' : clean;
}

function numeric(report: Record<string, unknown>, key: string): number | null {
  const n = Number(report[key]);
  return Number.isFinite(n) ? n : null;
}

function inferOpportunity(report: Record<string, unknown>, ai: Record<string, unknown>): string {
  const bias = String(ai.market_bias || report.market_bias || '');
  const tsm = numeric(report, 'tsm_adr_change');
  const sox = numeric(report, 'sox_change');
  if (bias.includes('弱')) return '抗跌權值、防禦資金與開盤後止穩訊號';
  if (tsm !== null && tsm < 0) return '台積電與電子權值能否抗住 ADR 壓力';
  if (sox !== null && sox > 0) return '半導體與 AI 供應鏈是否同步擴散';
  return '開盤後資金最先集中的族群';
}

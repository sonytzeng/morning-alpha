import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { resolveMarketStatus } from '../_shared/market-status.ts';

// ═══════════════════════════════════════════════════════════
// Close Market Review V1.2 — 收盤驗證（精確收盤窗口 + 防覆蓋版）
//
// V1.2 修正（2026-06-13）：
//   1. 收盤時間窗口改為 13:30-15:00 台北（non-negotiable）
//   2. 新增情境：中性震盪 + 明顯下跌 →「部分命中，風險低估」
//   3. market_data 無 phase 欄位 → 嚴格用時間窗口過濾
//
// V1.1 基礎（保留）：
//   收盤資料來源：只使用台北時間指定窗口的 market_data
//   防覆蓋機制：同日已有 verification_result 且非空時，預設不覆蓋
//   支援 ?force=true 參數強制覆蓋
//   收盤資料不足時，close_result 顯示「收盤資料不足」
//
// V1.0 基礎規則（保留）：
//   盤前原始假設唯一來源 = public.reports.market_bias
//   不得自行推導「偏多觀察」「盤前劇本命中」「方向一致」
//   只能做「收盤結果 vs reports.market_bias」的比較
//
// ═══════════════════════════════════════════════════════════

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info, x-cron-secret',
};

function getTaiwanDateString(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value || '';
  const m = parts.find((p) => p.type === 'month')?.value || '';
  const d = parts.find((p) => p.type === 'day')?.value || '';
  return `${y}-${m}-${d}`;
}

// ════════════════════════════════════════════
// 取得指定台北日期的「收盤時間窗口」
// 台股收盤 13:30，正式收盤資料窗口 13:30-15:00 台北
// 13:30 台北 = 05:30 UTC
// 15:00 台北 = 07:00 UTC
// ════════════════════════════════════════════

function getCloseWindowRange(taiwanDate: string): { start: string; end: string } {
  const start = `${taiwanDate}T05:30:00.000Z`;
  const end = `${taiwanDate}T07:00:00.000Z`;
  return { start, end };
}

// ════════════════════════════════════════════
// 收盤結果分類
// ════════════════════════════════════════════

function classifyCloseResult(taiexChange: number | null): string {
  if (taiexChange === null) return '收盤資料不足';
  if (taiexChange >= 1.0) return '明顯上漲';
  if (taiexChange >= 0.3) return '小漲';
  if (taiexChange > -0.3) return '震盪';
  if (taiexChange > -1.0) return '小跌';
  return '明顯下跌';
}

// ════════════════════════════════════════════
// 驗證結論產生器（唯一函式）
// 輸入：reports.market_bias + 收盤結果
// 輸出：{ validation_result, summary }
// 八條規則，零硬寫文案
// ════════════════════════════════════════════

function generateVerification(
  marketBias: string | null,
  closeResult: string,
  taiexChange: number | null,
  tsmcChange: number | null,
): { validation_result: string; summary: string } {
  const bias = (marketBias || '').trim();
  const taiexStr = taiexChange !== null ? `加權指數 ${taiexChange >= 0 ? '+' : ''}${taiexChange.toFixed(2)}%` : '';
  const tsmcStr = tsmcChange !== null ? `，台積電 ${tsmcChange >= 0 ? '+' : ''}${tsmcChange.toFixed(2)}%` : '';

  // 無盤前假設
  if (!bias) {
    return {
      validation_result: '資料不足',
      summary: `收盤實際結果為「${closeResult}」${taiexStr ? `（${taiexStr}${tsmcStr}）` : ''}，但盤前假設資料暫缺，無法比對。`,
    };
  }

  // 無收盤資料
  if (closeResult === '收盤資料不足') {
    return {
      validation_result: '資料不足',
      summary: `07:30 盤前原始假設為「${bias}」，但收盤資料不足，無法完成今日驗證。`,
    };
  }

  const isNeutralShock = bias.includes('中性震盪') || (bias.includes('中性') && bias.includes('震盪'));
  const isBullish = bias.includes('偏多');
  const isBearishOrRisk = bias.includes('偏弱') || bias.includes('偏空') || bias.includes('高風險') || bias.includes('保守');
  const isClearlyUp = closeResult === '明顯上漲';
  const isClearlyDown = closeResult === '明顯下跌';
  const isUp = closeResult === '明顯上漲' || closeResult === '小漲';
  const isDown = closeResult === '明顯下跌' || closeResult === '小跌';
  const isRanging = closeResult === '震盪';

  // ── 情境 1：中性震盪 + 明顯上漲 → 偏保守 ──
  if (isNeutralShock && isClearlyUp) {
    return {
      validation_result: '部分命中，盤前偏保守',
      summary: `07:30 盤前原始假設為「${bias}」，收盤實際結果為「${closeResult}」${taiexStr ? `（${taiexStr}${tsmcStr}）` : ''}。系統判定：本日盤前判斷偏保守，未完全捕捉今日漲幅，但主線觀察可作為後續校正依據。`,
    };
  }

  // ── 情境 2：中性震盪 + 明顯下跌 → 風險低估 ──
  if (isNeutralShock && isClearlyDown) {
    return {
      validation_result: '部分命中，風險低估',
      summary: `07:30 盤前原始假設為「${bias}」，收盤實際結果為「${closeResult}」${taiexStr ? `（${taiexStr}${tsmcStr}）` : ''}。系統判定：本日盤前判斷未充分捕捉下跌風險，實際跌幅超出中性震盪預期，需檢查權值股拋壓與資金面訊號。`,
    };
  }

  // ── 情境 3：偏多觀察 + 上漲 → 方向一致 ──
  if (isBullish && isUp) {
    return {
      validation_result: '方向一致',
      summary: `07:30 盤前原始假設為「${bias}」，收盤實際結果為「${closeResult}」${taiexStr ? `（${taiexStr}${tsmcStr}）` : ''}。系統判定：方向判斷一致。`,
    };
  }

  // ── 情境 4：偏多觀察 + 下跌 → 未命中 ──
  if (isBullish && isDown) {
    return {
      validation_result: '未命中',
      summary: `07:30 盤前原始假設為「${bias}」，收盤實際結果為「${closeResult}」${taiexStr ? `（${taiexStr}${tsmcStr}）` : ''}。系統判定：方向判斷未命中，需檢討盤前偏多訊號權重。`,
    };
  }

  // ── 情境 5：偏弱/高風險 + 上漲 → 未命中 ──
  if (isBearishOrRisk && isUp) {
    return {
      validation_result: '未命中',
      summary: `07:30 盤前原始假設為「${bias}」，收盤實際結果為「${closeResult}」${taiexStr ? `（${taiexStr}${tsmcStr}）` : ''}。系統判定：本日盤前判斷未命中，需檢查早盤資料、權值股強度與風險模型。`,
    };
  }

  // ── 情境 6：偏弱/高風險 + 下跌 → 方向一致 ──
  if (isBearishOrRisk && isDown) {
    return {
      validation_result: '方向一致',
      summary: `07:30 盤前原始假設為「${bias}」，收盤實際結果為「${closeResult}」${taiexStr ? `（${taiexStr}${tsmcStr}）` : ''}。系統判定：風險觀點成立，方向判斷一致。`,
    };
  }

  // ── 情境 7：中性震盪 + 震盪 → 大致一致 ──
  if (isNeutralShock && isRanging) {
    return {
      validation_result: '大致一致',
      summary: `07:30 盤前原始假設為「${bias}」，收盤結果為「${closeResult}」${taiexStr ? `（${taiexStr}${tsmcStr}）` : ''}。系統判定：大致一致，收盤結果與盤前假設接近。`,
    };
  }

  // ── 情境 8：中性震盪 + 小漲小跌 → 大致一致 ──
  if (isNeutralShock) {
    return {
      validation_result: '大致一致',
      summary: `07:30 盤前原始假設為「${bias}」，收盤結果為「${closeResult}」${taiexStr ? `（${taiexStr}${tsmcStr}）` : ''}。系統判定：盤前判斷大致符合區間預期。`,
    };
  }

  // ── 情境 9：偏多觀察 + 震盪 → 部分命中 ──
  if (isBullish && isRanging) {
    return {
      validation_result: '部分命中',
      summary: `07:30 盤前原始假設為「${bias}」，收盤結果為「${closeResult}」${taiexStr ? `（${taiexStr}${tsmcStr}）` : ''}。系統判定：方向判斷部分命中，漲幅未完全符合偏多預期。`,
    };
  }

  // ── 預設 ──
  return {
    validation_result: '待確認',
    summary: `07:30 盤前原始假設為「${bias}」，收盤實際結果為「${closeResult}」${taiexStr ? `（${taiexStr}${tsmcStr}）` : ''}。`,
  };
}

// ════════════════════════════════════════════
// 主函式
// ════════════════════════════════════════════

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const startTime = Date.now();
  const requestId = crypto.randomUUID().slice(0, 8);
  const logs: string[] = [];
  function log(m: string) { const line = `[${new Date().toISOString()}] ${m}`; logs.push(line); console.log(line); }

  try {
    const cronSecret = req.headers.get('x-cron-secret') || '';
    const authHeader = req.headers.get('Authorization') || '';
    const envCronSecret = Deno.env.get('CRON_SECRET') || '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    const supabaseServiceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

    const hasValidCronSecret = envCronSecret && cronSecret === envCronSecret;
    const hasValidBearer = authHeader.startsWith('Bearer ') &&
      (authHeader.slice(7) === supabaseAnonKey || authHeader.slice(7) === supabaseServiceRole);

    if (!hasValidCronSecret && !hasValidBearer) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
    }

    log(`=== Close Market Review V1.2 [${requestId}] ===`);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      supabaseServiceRole,
    );

    const today = getTaiwanDateString();
    log(`Report date: ${today}`);

    // ═══ 讀取 force 參數 ═══
    const url = new URL(req.url);
    const forceParam = (url.searchParams.get('force') || '').toLowerCase();
    const isForce = forceParam === 'true';
    log(`Force overwrite: ${isForce}`);

    const marketStatus = resolveMarketStatus(today);
    if (!marketStatus.is_trading_day) {
      log(`MARKET_CLOSED_SKIP status=${marketStatus.market_status} date=${today}`);
      return jsonResponse({
        success: true,
        skipped: true,
        reason: 'MARKET_STATUS_NOT_OPEN',
        report_date: today,
        market_status: marketStatus.market_status,
        session_type: marketStatus.session_type,
        is_trading_day: marketStatus.is_trading_day,
        market_message: marketStatus.market_message,
        next_trading_day: marketStatus.next_trading_day,
      });
    }

    // ═══ Step 0: 防覆蓋檢查 ═══
    const { data: existingReview } = await supabase
      .from('close_market_reviews')
      .select('id, verification_result, verification_note, taiex_change, tsmc_change, actual_market_result, created_at')
      .eq('report_date', today)
      .maybeSingle();

    if (existingReview) {
      const existingResult = String(((existingReview as Record<string, unknown>).verification_result || '')).trim();
      const existingCreatedAt = String(((existingReview as Record<string, unknown>).created_at || ''));
      log(`Existing review found. verification_result="${existingResult}", created_at=${existingCreatedAt}`);

      // 已有非空的 verification_result 且不是 force → 拒絕覆蓋
      if (existingResult && existingResult !== '資料不足' && existingResult !== '待確認' && existingResult !== '' && !isForce) {
        log(`ANTI-OVERWRITE: Existing verification_result is "${existingResult}". Skipping upsert. Use ?force=true to override.`);

        return new Response(JSON.stringify({
          success: true,
          version: 'V1.2',
          request_id: requestId,
          report_date: today,
          action: 'skipped',
          reason: '防覆蓋：同日收盤驗證已存在，且 verification_result 非空。使用 ?force=true 強制覆蓋。',
          existing_verification_result: existingResult,
          existing_taiex_change: (existingReview as Record<string, unknown>).taiex_change,
          existing_tsmc_change: (existingReview as Record<string, unknown>).tsmc_change,
          existing_actual_market_result: (existingReview as Record<string, unknown>).actual_market_result,
          duration_ms: Date.now() - startTime,
          logs,
        }), { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
      }

      if (isForce) {
        log(`FORCE=true: Will overwrite existing review.`);
      }
    }

    // ═══ Step 1: 讀取今日 reports（盤前假設唯一來源） ═══
    const { data: reportRow } = await supabase
      .from('reports')
      .select('id, market_bias, confidence_score, summary')
      .eq('report_date', today)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const premarketBias = reportRow ? String((reportRow as Record<string, unknown>).market_bias || '') : null;
    const premarketConfidence = reportRow ? Number((reportRow as Record<string, unknown>).confidence_score || 0) : null;
    const premarketSummary = reportRow ? String((reportRow as Record<string, unknown>).summary || '') : null;
    const premarketReportId = reportRow ? String((reportRow as Record<string, unknown>).id || '') : null;

    log(`Premarket bias from reports: "${premarketBias}", confidence: ${premarketConfidence}`);

    // ═══ Step 2: 讀取收盤時間窗口內的 market_data ═══
    // V1.2: market_data 沒有 phase 欄位 → 嚴格用台北 13:30-15:00 時間窗口過濾
    // 這是台股正式收盤的 non-negotiable 時間範圍
    const closeWindow = getCloseWindowRange(today);
    log(`Close window: ${closeWindow.start} ~ ${closeWindow.end} (UTC), i.e. 13:30-15:00 Taipei`);

    const { data: closeMarketRowsRaw } = await supabase
      .from('market_data')
      .select('symbol, name, value, change_percent, captured_at')
      .gte('captured_at', closeWindow.start)
      .lte('captured_at', closeWindow.end)
      .order('captured_at', { ascending: false })
      .limit(100);

    let marketData: Array<{ symbol: string; name: string; value: number; change_percent: number; captured_at: string }> = (closeMarketRowsRaw || []).map((r: Record<string, unknown>) => ({
      symbol: String(r.symbol || ''),
      name: String(r.name || ''),
      value: Number(r.value || 0),
      change_percent: Number(r.change_percent || 0),
      captured_at: String(r.captured_at || ''),
    }));

    let dataSourceLabel = '收盤窗口 (13:30-15:00 台北)';
    let dataWarning = false;

    // V1.2: 如果收盤窗口沒資料 → 嘗試寬窗口（09:00-17:00 台北），但標示 ⚠ 警告
    // 寬窗口資料不能用來覆蓋既有正確收盤驗證
    if (marketData.length === 0) {
      log('No close-window data found. Trying wider trading-day window (09:00-17:00 Taipei)...');
      const wideStart = `${today}T01:00:00.000Z`;  // 09:00 台北 = 01:00 UTC
      const wideEnd = `${today}T09:00:00.000Z`;     // 17:00 台北 = 09:00 UTC

      const { data: wideRowsRaw } = await supabase
        .from('market_data')
        .select('symbol, name, value, change_percent, captured_at')
        .gte('captured_at', wideStart)
        .lte('captured_at', wideEnd)
        .order('captured_at', { ascending: false })
        .limit(100);

      marketData = (wideRowsRaw || []).map((r: Record<string, unknown>) => ({
        symbol: String(r.symbol || ''),
        name: String(r.name || ''),
        value: Number(r.value || 0),
        change_percent: Number(r.change_percent || 0),
        captured_at: String(r.captured_at || ''),
      }));

      if (marketData.length > 0) {
        dataSourceLabel = '交易時段寬窗口 (09:00-17:00 台北) ⚠ 非精確收盤資料';
        dataWarning = true;
        log(`WARNING: Using wide-window data (${marketData.length} rows). Not guaranteed to be close-of-day values.`);
      }
    }

    // V1.2: 仍然沒資料 → 標示資料不足，不得硬判斷
    if (marketData.length === 0) {
      log('No market_data available for today at all. Marking as data insufficient.');

      const verification = generateVerification(premarketBias, '收盤資料不足', null, null);

      // 只在新建或 force 時才寫入「資料不足」（不要覆蓋既有正確資料）
      if (!existingReview || isForce) {
        const now = new Date().toISOString();
        const upsertData: Record<string, unknown> = {
          report_date: today,
          premarket_bias: premarketBias,
          premarket_confidence: premarketConfidence,
          premarket_summary: premarketSummary,
          taiex_change: null,
          tsmc_change: null,
          txf_change: null,
          actual_market_result: '收盤資料不足',
          verification_result: verification.validation_result,
          verification_label: verification.validation_result,
          verification_note: verification.summary,
          data_quality: '無資料',
          missing_data: ['TAIEX', '2330', 'TXF'],
          raw_payload: {
            today,
            request_id: requestId,
            version: 'V1.2',
            premarket_bias_source: 'reports.market_bias',
            premarket_bias: premarketBias,
            close_result: '收盤資料不足',
            data_source: '無可用 market_data',
          },
          updated_at: now,
        };

        await supabase
          .from('close_market_reviews')
          .upsert(upsertData, { onConflict: 'report_date' });
      }

      return new Response(JSON.stringify({
        success: true,
        version: 'V1.2',
        request_id: requestId,
        report_date: today,
        action: existingReview && !isForce ? 'skipped' : 'written',
        premarket_bias: premarketBias,
        close_result: '收盤資料不足',
        validation_result: verification.validation_result,
        summary: verification.summary,
        data_source: '無可用 market_data',
        duration_ms: Date.now() - startTime,
        logs,
      }), { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
    }

    log(`Market data source: ${dataSourceLabel}, rows: ${marketData.length}${dataWarning ? ' (WARNING: not close-window data)' : ''}`);

    // Symbol alias finder — 從 market_data 中找出 TAIEX / 2330 / TXF
    function findMarketData(symbols: string[]): { change_percent: number | null; value: number | null; captured_at: string | null } {
      for (const s of symbols) {
        const found = marketData.find((r) => r.symbol.toUpperCase() === s.toUpperCase());
        if (found && found.change_percent !== null && found.change_percent !== undefined) {
          return { change_percent: found.change_percent, value: found.value, captured_at: found.captured_at };
        }
      }
      return { change_percent: null, value: null, captured_at: null };
    }

    const taiex = findMarketData(['TAIEX', 'TWII', '^TWII']);
    const tsmc = findMarketData(['2330', '2330.TW', 'TSMC_TW']);
    const txf = findMarketData(['TXF', 'TX', 'TXF1']);

    const taiexChange = taiex.change_percent;
    const tsmcChange = tsmc.change_percent;
    const txfChange = txf.change_percent;

    log(`TAIEX: ${taiexChange}% (captured_at=${taiex.captured_at}), 2330: ${tsmcChange}% (captured_at=${tsmc.captured_at}), TXF: ${txfChange}% (captured_at=${txf.captured_at})`);

    // ═══ Step 3: 讀取 opening_market_radar（僅供參考，不推導盤前方向） ═══
    const { data: radarRow } = await supabase
      .from('opening_market_radar')
      .select('radar_status, market_bias, confidence_score, summary')
      .eq('report_date', today)
      .maybeSingle();

    const radarStatus = radarRow ? String((radarRow as Record<string, unknown>).radar_status || '') : null;
    const radarBias = radarRow ? String((radarRow as Record<string, unknown>).market_bias || '') : null;
    const radarConfidence = radarRow ? Number((radarRow as Record<string, unknown>).confidence_score || 0) : null;
    const radarSummary = radarRow ? String((radarRow as Record<string, unknown>).summary || '') : null;

    // ═══ Step 4: 分類收盤結果 ═══
    const closeResult = classifyCloseResult(taiexChange);
    log(`Close result: ${closeResult}`);

    // ═══ Step 5: 產生動態驗證結論（generated from reports.market_bias + close result only） ═══
    const verification = generateVerification(premarketBias, closeResult, taiexChange, tsmcChange);
    log(`Validation: result="${verification.validation_result}", summary="${verification.summary.slice(0, 80)}..."`);

    // ═══ Step 6: 資料品質判斷 ═══
    const missingData: string[] = [];
    if (taiexChange === null) missingData.push('TAIEX');
    if (tsmcChange === null) missingData.push('2330');
    if (txfChange === null) missingData.push('TXF');

    let dataQuality = '高可信';
    if (dataWarning) {
      dataQuality = '中可信（非收盤窗口資料）';
    }
    if (missingData.length >= 2) {
      dataQuality = '低可信';
    } else if (missingData.length === 1 && !dataWarning) {
      dataQuality = '中可信';
    }

    // ═══ Step 7: 防覆蓋二次確認（防止 race condition） ═══
    if (!isForce && existingReview) {
      const recheckResult = String(((existingReview as Record<string, unknown>).verification_result || '')).trim();
      if (recheckResult && recheckResult !== '資料不足' && recheckResult !== '待確認' && recheckResult !== '') {
        log(`ANTI-OVERWRITE (recheck): Existing verification_result is "${recheckResult}". Skipping.`);

        return new Response(JSON.stringify({
          success: true,
          version: 'V1.2',
          request_id: requestId,
          report_date: today,
          action: 'skipped',
          reason: '防覆蓋（二次檢查）：同日收盤驗證已存在。使用 ?force=true 強制覆蓋。',
          existing_verification_result: recheckResult,
          would_have_written: {
            verification_result: verification.validation_result,
            summary: verification.summary,
            taiex_change: taiexChange,
            tsmc_change: tsmcChange,
            close_result: closeResult,
          },
          duration_ms: Date.now() - startTime,
          logs,
        }), { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
      }
    }

    // ═══ Step 8: Upsert 到 close_market_reviews ═══
    const now = new Date().toISOString();
    const upsertData: Record<string, unknown> = {
      report_date: today,
      premarket_bias: premarketBias,
      premarket_confidence: premarketConfidence,
      premarket_summary: premarketSummary,
      opening_radar_status: radarStatus,
      opening_radar_bias: radarBias,
      opening_radar_confidence: radarConfidence,
      opening_radar_summary: radarSummary,
      taiex_change: taiexChange,
      tsmc_change: tsmcChange,
      txf_change: txfChange,
      actual_market_result: closeResult,
      verification_result: verification.validation_result,
      verification_label: verification.validation_result,
      verification_note: verification.summary,
      data_quality: dataQuality,
      missing_data: missingData,
      raw_payload: {
        today,
        request_id: requestId,
        version: 'V1.2',
        premarket_bias_source: 'reports.market_bias',
        premarket_bias: premarketBias,
        close_result: closeResult,
        taiex_change: taiexChange,
        tsmc_change: tsmcChange,
        txf_change: txfChange,
        data_source: dataSourceLabel,
        data_window: closeWindow,
        is_wide_window_fallback: dataWarning,
        force_overwrite: isForce,
      },
      updated_at: now,
    };

    // 只在新建或 force 時設定 created_at
    if (!existingReview || isForce) {
      upsertData.created_at = existingReview
        ? (existingReview as Record<string, unknown>).created_at  // force 覆蓋時保留原始 created_at
        : now;
    }

    const { error: upsertErr } = await supabase
      .from('close_market_reviews')
      .upsert(upsertData, { onConflict: 'report_date' });

    if (upsertErr) {
      log(`DB ERROR: ${upsertErr.message}`);
      return new Response(JSON.stringify({
        success: false,
        error: upsertErr.message,
        version: 'V1.2',
        request_id: requestId,
        verification,
        logs,
      }), { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
    }

    log(`SUCCESS: Close review for ${today} written (${isForce ? 'FORCE' : 'FIRST TIME'})`);
    log(`  → data_source: ${dataSourceLabel}${dataWarning ? ' ⚠' : ''}`);
    log(`  → premarket_bias: "${premarketBias}" (from reports.market_bias)`);
    log(`  → close_result: "${closeResult}"`);
    log(`  → validation_result: "${verification.validation_result}"`);

    return new Response(JSON.stringify({
      success: true,
      version: 'V1.2',
      request_id: requestId,
      report_date: today,
      action: isForce ? 'force_written' : 'written',
      premarket_bias: premarketBias,
      close_result: closeResult,
      validation_result: verification.validation_result,
      summary: verification.summary,
      taiex_change: taiexChange,
      tsmc_change: tsmcChange,
      txf_change: txfChange,
      data_quality: dataQuality,
      data_source: dataSourceLabel,
      is_wide_window_fallback: dataWarning,
      missing_data: missingData,
      duration_ms: Date.now() - startTime,
      logs,
    }), { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`FATAL: ${msg}`);
    return new Response(JSON.stringify({
      success: false,
      version: 'V1.2',
      error: msg,
      logs,
    }), { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
  }
});
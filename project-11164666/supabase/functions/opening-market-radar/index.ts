import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ═══════════════════════════════════════════════════════════
// Opening Market Radar V3.1 — 開盤後覆蓋盤前劇本
// V3.1: Fix summaries — dynamically reference reports.market_bias
//       Remove all hardcoded 「盤前偏多假設失效」「劇本成立一致」「方向一致」
//       premarket_bias ALWAYS from reports.market_bias (sole source of truth)
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

function taipeiDateTimeToUtcIso(date: string, hour: number, minute = 0, addDays = 0): string {
  const [year, month, day] = date.split('-').map((v) => Number(v));
  return new Date(Date.UTC(year, month - 1, day + addDays, hour - 8, minute, 0, 0)).toISOString();
}

function taipeiDateFromIso(iso: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value || '';
  const m = parts.find((p) => p.type === 'month')?.value || '';
  const d = parts.find((p) => p.type === 'day')?.value || '';
  return y && m && d ? `${y}-${m}-${d}` : null;
}

function getTaipeiHourMinute(): { hour: number; minute: number } {
  const now = new Date();
  const tw = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  return { hour: tw.getHours(), minute: tw.getMinutes() };
}

interface MarketDataRow {
  symbol: string;
  name: string;
  value: number;
  change_percent: number;
  captured_at: string;
}

interface OpeningRadarResult {
  radar_status: string;
  market_bias: string;
  confidence_score: number;
  summary: string;
  is_premarket_overridden: boolean;
  override_reason: string;
  taiex_change: number | null;
  txf_change: number | null;
  tsmc_change: number | null;
  spx_change: number | null;
  sox_change: number | null;
  vix_change: number | null;
  dxy_change: number | null;
  us10y_change: number | null;
}

function findSymbol(data: MarketDataRow[], candidates: string[]): MarketDataRow | null {
  for (const c of candidates) {
    const found = data.find((r) => r.symbol.toUpperCase() === c.toUpperCase());
    if (found) return found;
  }
  return null;
}

function getLatestCapturedAt(data: MarketDataRow[]): string | null {
  let latest = '';
  for (const row of data) {
    if (row.captured_at && (!latest || row.captured_at > latest)) latest = row.captured_at;
  }
  return latest || null;
}

// ═══════════════════════════════════════════════════════════
// V3.1: Dynamic summary builder — references reports.market_bias
// ═══════════════════════════════════════════════════════════

function buildDynamicSummary(
  radarStatus: string,
  premarketBias: string | null,
  isOverridden: boolean,
  taiexChg: number | null,
  txfChg: number | null,
  ts2330Chg: number | null,
  reasonParts: string[],
): string {
  const bias = (premarketBias || '未標記').trim();
  const dataParts: string[] = [];
  if (taiexChg !== null) dataParts.push(`TAIEX ${taiexChg >= 0 ? '+' : ''}${taiexChg.toFixed(2)}%`);
  if (txfChg !== null) dataParts.push(`TXF ${txfChg >= 0 ? '+' : ''}${txfChg.toFixed(2)}%`);
  if (ts2330Chg !== null) dataParts.push(`2330 ${ts2330Chg >= 0 ? '+' : ''}${ts2330Chg.toFixed(2)}%`);
  const dataStr = dataParts.length > 0 ? `（${dataParts.join('、')}）` : '';

  if (radarStatus === '明顯偏弱') {
    if (isOverridden && premarketBias) {
      return `07:30 盤前原始假設為「${bias}」，開盤後台股明顯轉弱${dataStr}。系統判定：盤前假設已被推翻，今日以風險控管為主。`;
    }
    return `開盤後台股明顯轉弱${dataStr}，今日以風險控管為主。盤前原始假設為「${bias}」。`;
  }

  if (radarStatus === '盤中轉弱') {
    if (isOverridden && premarketBias) {
      return `07:30 盤前原始假設為「${bias}」，開盤後實際走勢轉弱${dataStr}。系統判定：盤前假設已被推翻，今日改以風險觀察為主。`;
    }
    return `開盤後實際走勢轉弱${dataStr}，今日以風險觀察為主。盤前原始假設為「${bias}」。`;
  }

  if (radarStatus === '偏強確認') {
    if (premarketBias && premarketBias !== '未標記') {
      const isMatch = premarketBias.includes('多');
      if (isMatch) {
        return `07:30 盤前原始假設為「${bias}」，開盤後實際走勢偏強${dataStr}。系統判定：盤中走勢與盤前假設方向一致。`;
      }
      return `07:30 盤前原始假設為「${bias}」，開盤後實際走勢偏強${dataStr}。系統判定：盤中走勢強於盤前假設，盤前判斷偏保守。`;
    }
    return `開盤後實際走勢偏強${dataStr}，盤中追蹤顯示多方訊號明確。`;
  }

  // radarStatus === '觀察中'
  if (premarketBias && premarketBias !== '未標記') {
    return `07:30 盤前原始假設為「${bias}」，開盤後無明確方向訊號${dataStr}。系統判定：繼續觀察盤中走勢是否與盤前假設一致。`;
  }
  return `開盤後無明確方向訊號${dataStr}，繼續觀察盤中走勢。`;
}

// ═══════════════════════════════════════════════════════════
// V3.1: Core radar logic — dynamic summaries
// ═══════════════════════════════════════════════════════════

function computeRadar(data: MarketDataRow[], premarketBias: string | null, premarketConfidence: number | null, log: (m: string) => void): OpeningRadarResult {
  const taiex = findSymbol(data, ['TAIEX', 'TWII', '^TWII']);
  const txf = findSymbol(data, ['TXF', 'TX', 'TXF1']);
  const ts2330 = findSymbol(data, ['2330', '2330.TW', 'TSMC_TW']);
  const tsm = findSymbol(data, ['TSM', 'TSMC']);
  const spx = findSymbol(data, ['SPX', 'SP500', '^GSPC']);
  const sox = findSymbol(data, ['SOX', 'PHLX', '^SOX']);
  const vix = findSymbol(data, ['VIX', '^VIX']);
  const dxy = findSymbol(data, ['DXY', 'USDINDEX']);
  const us10y = findSymbol(data, ['US10Y', '^TNX']);

  const taiexChg = taiex?.change_percent ?? null;
  const txfChg = txf?.change_percent ?? null;
  const ts2330Chg = ts2330?.change_percent ?? null;

  const twCorePresent = [taiexChg !== null, txfChg !== null, ts2330Chg !== null].filter(Boolean).length;
  const twCoreMissing = 3 - twCorePresent;

  log(`TW Core: TAIEX=${taiexChg} TXF=${txfChg} 2330=${ts2330Chg} present=${twCorePresent}/3`);

  const biasRef = premarketBias || '未標記';

  // If 2+ missing → 資料不足
  if (twCoreMissing >= 2) {
    return {
      radar_status: '資料不足',
      market_bias: '資料不足',
      confidence_score: 60,
      summary: '台股核心指標不足，暫不判定盤中方向。',
      is_premarket_overridden: false,
      override_reason: '台股核心指標不足（TAIEX/TXF/2330 缺少 ≥2）',
      taiex_change: taiexChg,
      txf_change: txfChg,
      tsmc_change: ts2330Chg,
      spx_change: spx?.change_percent ?? null,
      sox_change: sox?.change_percent ?? null,
      vix_change: vix?.change_percent ?? null,
      dxy_change: dxy?.change_percent ?? null,
      us10y_change: us10y?.change_percent ?? null,
    };
  }

  // ═══ 明顯偏弱：TAIEX <= -1% or TXF <= -1% or 2330 <= -2% ═══
  if (
    (taiexChg !== null && taiexChg <= -1) ||
    (txfChg !== null && txfChg <= -1) ||
    (ts2330Chg !== null && ts2330Chg <= -2)
  ) {
    const reasonParts: string[] = [];
    if (taiexChg !== null && taiexChg <= -1) reasonParts.push(`TAIEX ${taiexChg.toFixed(2)}%`);
    if (txfChg !== null && txfChg <= -1) reasonParts.push(`TXF ${txfChg.toFixed(2)}%`);
    if (ts2330Chg !== null && ts2330Chg <= -2) reasonParts.push(`2330 ${ts2330Chg.toFixed(2)}%`);

    const isPremarketBullish = premarketBias?.includes('多') && !premarketBias?.includes('空');
    const overridden = isPremarketBullish;

    const dynamicSummary = buildDynamicSummary('明顯偏弱', premarketBias, overridden, taiexChg, txfChg, ts2330Chg, reasonParts);

    return {
      radar_status: '明顯偏弱',
      market_bias: '明顯偏弱',
      confidence_score: 30,
      summary: dynamicSummary,
      is_premarket_overridden: overridden,
      override_reason: overridden ? `盤前${biasRef}(${premarketConfidence})已被推翻：${reasonParts.join('、')} 明顯轉弱` : `${reasonParts.join('、')} 明顯轉弱`,
      taiex_change: taiexChg,
      txf_change: txfChg,
      tsmc_change: ts2330Chg,
      spx_change: spx?.change_percent ?? null,
      sox_change: sox?.change_percent ?? null,
      vix_change: vix?.change_percent ?? null,
      dxy_change: dxy?.change_percent ?? null,
      us10y_change: us10y?.change_percent ?? null,
    };
  }

  // ═══ 盤中轉弱 ═══
  const taiexNeg = taiexChg !== null && taiexChg < 0;
  const txfNeg = txfChg !== null && txfChg < 0;
  const ts2330Neg = ts2330Chg !== null && ts2330Chg < 0;

  const moderateWeak =
    (taiexChg !== null && taiexChg <= -0.5) ||
    (txfChg !== null && txfChg <= -0.5) ||
    (ts2330Chg !== null && ts2330Chg <= -1) ||
    (taiexNeg && txfNeg) ||
    (ts2330Neg && taiexNeg);

  if (moderateWeak) {
    const isPremarketBullish = premarketBias?.includes('多') && !premarketBias?.includes('空');
    const overridden = isPremarketBullish;

    const dynamicSummary = buildDynamicSummary('盤中轉弱', premarketBias, overridden, taiexChg, txfChg, ts2330Chg, []);

    return {
      radar_status: '盤中轉弱',
      market_bias: '偏弱觀察',
      confidence_score: 45,
      summary: dynamicSummary,
      is_premarket_overridden: overridden,
      override_reason: overridden ? `盤前${biasRef}(${premarketConfidence})被推翻：開盤後實際走勢轉弱` : '開盤後實際走勢轉弱',
      taiex_change: taiexChg,
      txf_change: txfChg,
      tsmc_change: ts2330Chg,
      spx_change: spx?.change_percent ?? null,
      sox_change: sox?.change_percent ?? null,
      vix_change: vix?.change_percent ?? null,
      dxy_change: dxy?.change_percent ?? null,
      us10y_change: us10y?.change_percent ?? null,
    };
  }

  // ═══ 偏強確認 ═══
  const taiexStrong = taiexChg !== null && taiexChg >= 1;
  const txfStrong = txfChg !== null && txfChg >= 1;

  if (taiexStrong || txfStrong) {
    const dynamicSummary = buildDynamicSummary('偏強確認', premarketBias, false, taiexChg, txfChg, ts2330Chg, []);

    return {
      radar_status: '偏強確認',
      market_bias: premarketBias?.includes('多') ? premarketBias : '偏多觀察',
      confidence_score: Math.max(75, premarketConfidence ?? 75),
      summary: dynamicSummary,
      is_premarket_overridden: false,
      override_reason: '',
      taiex_change: taiexChg,
      txf_change: txfChg,
      tsmc_change: ts2330Chg,
      spx_change: spx?.change_percent ?? null,
      sox_change: sox?.change_percent ?? null,
      vix_change: vix?.change_percent ?? null,
      dxy_change: dxy?.change_percent ?? null,
      us10y_change: us10y?.change_percent ?? null,
    };
  }

  // ═══ No strong signal: neutral ──
  const dynamicSummary = buildDynamicSummary('觀察中', premarketBias, false, taiexChg, txfChg, ts2330Chg, []);

  return {
    radar_status: '觀察中',
    market_bias: premarketBias || '中性震盪',
    confidence_score: Math.min(60, premarketConfidence ?? 60),
    summary: dynamicSummary,
    is_premarket_overridden: false,
    override_reason: '',
    taiex_change: taiexChg,
    txf_change: txfChg,
    tsmc_change: ts2330Chg,
    spx_change: spx?.change_percent ?? null,
    sox_change: sox?.change_percent ?? null,
    vix_change: vix?.change_percent ?? null,
    dxy_change: dxy?.change_percent ?? null,
    us10y_change: us10y?.change_percent ?? null,
  };
}

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

    log(`=== Opening Market Radar V3.1 [${requestId}] ===`);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      supabaseServiceRole,
    );

    const today = getTaiwanDateString();
    const { hour, minute } = getTaipeiHourMinute();
    const timeVal = hour * 60 + minute;
    const afterOpen = timeVal >= 9 * 60 + 15;

    log(`Taipei time: ${hour}:${String(minute).padStart(2, '0')}, afterOpen=${afterOpen}, date=${today}`);

    // 1. Fetch today's premarket report — SOLE SOURCE OF TRUTH
    const { data: reportRow } = await supabase
      .from('reports')
      .select('id, market_bias, confidence_score, report_date')
      .eq('report_date', today)
      .maybeSingle();

    const premarketBias = reportRow ? String((reportRow as Record<string, unknown>).market_bias || '') : null;
    const premarketConfidence = reportRow ? Number((reportRow as Record<string, unknown>).confidence_score || 0) : null;
    const premarketReportId = reportRow ? String((reportRow as Record<string, unknown>).id || '') : null;

    log(`Premarket from reports: bias="${premarketBias}", confidence=${premarketConfidence}`);

    // 2. Fetch today's live market_data only. Previous close snapshots must not become intraday radar.
    const openStartIso = taipeiDateTimeToUtcIso(today, 9);
    const now = new Date().toISOString();
    const { data: marketRows } = await supabase
      .from('market_data')
      .select('symbol, name, value, change_percent, captured_at')
      .gte('captured_at', openStartIso)
      .lte('captured_at', now)
      .order('captured_at', { ascending: false })
      .limit(50);

    const marketData: MarketDataRow[] = (marketRows || []).map((r: Record<string, unknown>) => ({
      symbol: String(r.symbol || ''),
      name: String(r.name || ''),
      value: Number(r.value || 0),
      change_percent: Number(r.change_percent || 0),
      captured_at: String(r.captured_at || ''),
    }));

    const latestCapturedAt = getLatestCapturedAt(marketData);
    const marketDataDate = latestCapturedAt ? taipeiDateFromIso(latestCapturedAt) : null;
    log(`Market data rows: ${marketData.length}, window=${openStartIso}..${now}, latest_captured_at=${latestCapturedAt || 'none'}, market_data_date=${marketDataDate || 'none'}, symbols: ${marketData.map(r => r.symbol).join(', ')}`);

    if (!latestCapturedAt || marketDataDate !== today) {
      log('NO_VALID_INTRADAY_DATA: no market_data captured at or after Taiwan 09:00 today');
      return new Response(JSON.stringify({
        success: false,
        reason: 'NO_VALID_INTRADAY_DATA',
        report_date: today,
        window_start: openStartIso,
        window_end: now,
        market_data_rows: marketData.length,
        latest_captured_at: latestCapturedAt,
        market_data_date: marketDataDate,
        version: 'V3.1',
        request_id: requestId,
        logs,
      }), { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
    }

    const requiredTaiex = findSymbol(marketData, ['TAIEX', 'TWII', '^TWII']);
    const requiredTxf = findSymbol(marketData, ['TXF', 'TX', 'TXF1']);
    const requiredTsmc = findSymbol(marketData, ['2330', '2330.TW', 'TSMC_TW']);
    const missingCoreSymbols = [
      requiredTaiex ? '' : 'TAIEX',
      requiredTxf ? '' : 'TXF',
      requiredTsmc ? '' : '2330',
    ].filter(Boolean);

    if (missingCoreSymbols.length > 0) {
      log(`NO_VALID_INTRADAY_DATA: missing required core symbols ${missingCoreSymbols.join(', ')}`);
      return new Response(JSON.stringify({
        success: false,
        reason: 'NO_VALID_INTRADAY_DATA',
        detail: 'MISSING_REQUIRED_CORE_SYMBOLS',
        missing_symbols: missingCoreSymbols,
        report_date: today,
        window_start: openStartIso,
        window_end: now,
        market_data_rows: marketData.length,
        latest_captured_at: latestCapturedAt,
        market_data_date: marketDataDate,
        version: 'V3.1',
        request_id: requestId,
        logs,
      }), { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
    }

    // 3. Compute radar
    const radar = computeRadar(marketData, premarketBias, premarketConfidence, log);

    log(`Radar: status=${radar.radar_status}, bias=${radar.market_bias}, confidence=${radar.confidence_score}, overridden=${radar.is_premarket_overridden}`);

    // 4. Upsert to opening_market_radar
    const upsertData: Record<string, unknown> = {
      report_date: today,
      radar_status: radar.radar_status,
      market_bias: radar.market_bias,
      confidence_score: radar.confidence_score,
      taiex_change: radar.taiex_change,
      txf_change: radar.txf_change,
      tsmc_change: radar.tsmc_change,
      spx_change: radar.spx_change,
      sox_change: radar.sox_change,
      vix_change: radar.vix_change,
      dxy_change: radar.dxy_change,
      us10y_change: radar.us10y_change,
      summary: radar.summary,
      premarket_report_id: premarketReportId || null,
      premarket_bias: premarketBias,
      premarket_confidence: premarketConfidence,
      is_premarket_overridden: radar.is_premarket_overridden,
      override_reason: radar.override_reason,
      captured_at: latestCapturedAt,
      source_kind: 'intraday_live',
      data_source: 'market_data',
      market_data_date: marketDataDate,
      created_at: now,
      updated_at: now,
    };

    const { error: upsertErr } = await supabase
      .from('opening_market_radar')
      .upsert(upsertData, { onConflict: 'report_date' });

    if (upsertErr) {
      log(`DB ERROR: ${upsertErr.message}`);
      return new Response(JSON.stringify({
        success: false,
        error: upsertErr.message,
        version: 'V3.1',
        request_id: requestId,
        radar,
        logs,
      }), { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
    }

    log(`SUCCESS: Radar for ${today} written (premarket_bias from reports: "${premarketBias}")`);

    return new Response(JSON.stringify({
      success: true,
      version: 'V3.1',
      request_id: requestId,
      report_date: today,
      radar_status: radar.radar_status,
      market_bias: radar.market_bias,
      confidence_score: radar.confidence_score,
      premarket_bias_source: 'reports.market_bias',
      premarket_bias: premarketBias,
      is_premarket_overridden: radar.is_premarket_overridden,
      override_reason: radar.override_reason,
      taiex_change: radar.taiex_change,
      txf_change: radar.txf_change,
      tsmc_change: radar.tsmc_change,
      captured_at: latestCapturedAt,
      source_kind: 'intraday_live',
      data_source: 'market_data',
      market_data_date: marketDataDate,
      after_open: afterOpen,
      duration_ms: Date.now() - startTime,
      logs,
    }), { status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`FATAL: ${msg}`);
    return new Response(JSON.stringify({
      success: false,
      version: 'V3.1',
      error: msg,
      logs,
    }), { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
  }
});

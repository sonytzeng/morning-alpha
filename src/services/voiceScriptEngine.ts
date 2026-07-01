import { supabase } from '@/lib/supabase';
import { fetchMarketDataBySymbols } from '@/services/marketDataService';
import { resolveActiveMorningAlphaReport } from '@/services/resolveActiveReport';
import type { Report } from '@/types/report';

// ==================== TYPES ====================

export interface StoryboardSegment {
  timeStart: number;
  timeEnd: number;
  mainText: string;
  subText: string;
  narrationLine: string;
}

export interface ReelsOutput {
  coverTitles: string[];
  narration: string;
  subtitleSegments: { startSec: number; endSec: number; text: string }[];
  storyboard: StoryboardSegment[];
  caption: string;
  hashtags: string;
  srt: string;
}

export interface VoiceScript {
  oneMinute: string;
  threeMinute: string;
  reels: ReelsOutput | null;
  generatedAt: string;
  reportDate: string;
  dataSources: string[];
  dataSourceCounts: {
    marketDataCount: number;
    marketNewsCount: number;
  };
}

export interface VoiceScriptInput {
  report: Report | null;
  marketData: MarketDataSnapshot[];
  marketNews: NewsSnapshot[];
  generatedAt: string;
}

export interface MarketDataSnapshot {
  symbol: string;
  name: string;
  value: number;
  changePercent: number;
}

export interface NewsSnapshot {
  title: string;
  category: string;
  finalScore: number;
  relatedTwNames: string[];
}

export interface VoiceReportRow {
  id: string;
  report_date: string;
  report_id: string | null;
  script_1min: string | null;
  script_3min: string | null;
  status: string | null;
  generated_at: string | null;
  created_at: string | null;
}

const CORE_SYMBOLS = ['TAIEX', 'TXF', '2330', 'TSM', 'SOX', 'VIX', 'DXY', 'US10Y'];

// ==================== SUPABASE HELPERS ====================

export async function getActiveReport(): Promise<Report | null> {
  const resolved = await resolveActiveMorningAlphaReport();
  if (!resolved.rawRow || resolved.isHistoricalFallback) return null;
  return mapRowToReport(resolved.rawRow as unknown as Record<string, unknown>);
}

export async function getSelectedMarketNews(): Promise<NewsSnapshot[]> {
  const { data } = await supabase
    .from('market_news')
    .select('*')
    .eq('is_selected', true)
    .order('final_score', { ascending: false })
    .limit(8);

  if (!data) return [];

  return (data as Record<string, unknown>[]).map((r) => ({
    title: String(r.title || ''),
    category: String(r.category || 'Other'),
    finalScore: Number(r.final_score || 0),
    relatedTwNames: Array.isArray(r.related_tw_names) ? (r.related_tw_names as string[]) : [],
  }));
}

export async function getLatestMarketData(): Promise<MarketDataSnapshot[]> {
  try {
    const data = await fetchMarketDataBySymbols([...CORE_SYMBOLS]);
    return (data || []).map((d: Record<string, unknown>) => ({
      symbol: String(d.symbol || ''),
      name: String(d.name || ''),
      value: Number(d.value),
      changePercent: Number(d.change_percent || 0),
    }));
  } catch {
    return [];
  }
}

export async function getTodayVoiceReport(): Promise<VoiceReportRow | null> {
  const today = new Date().toISOString().slice(0, 10);

  const { data } = await supabase
    .from('voice_reports')
    .select('*')
    .eq('report_date', today)
    .maybeSingle();

  if (!data) return null;

  return {
    id: String(data.id || ''),
    report_date: String(data.report_date || ''),
    report_id: data.report_id ? String(data.report_id) : null,
    script_1min: data.script_1min ? String(data.script_1min) : null,
    script_3min: data.script_3min ? String(data.script_3min) : null,
    status: data.status ? String(data.status) : null,
    generated_at: data.generated_at ? String(data.generated_at) : null,
    created_at: data.created_at ? String(data.created_at) : null,
  };
}

// ==================== REPORT MAPPER ====================

function mapRowToReport(row: Record<string, unknown>): Report {
  return {
    id: String(row.id || ''),
    report_date: String(row.report_date || ''),
    summary: row.summary as string | null,
    market_bias: row.market_bias as string | null,
    confidence_score: row.confidence_score as number | null,
    confidence_label: row.confidence_label as string | null,
    can_watch: row.can_watch as string[] | null,
    avoid_today: row.avoid_today as string[] | null,
    fear_greed: row.fear_greed as number | null,
    fear_greed_summary: row.fear_greed_summary as string | null,
    vix: row.vix as number | null,
    vix_summary: row.vix_summary as string | null,
    nasdaq_change: row.nasdaq_change as number | null,
    sp500_change: row.sp500_change as number | null,
    sox_change: row.sox_change as number | null,
    taiex_futures_change: row.taiex_futures_change as number | null,
    dxy: row.dxy as number | null,
    us_bond_yield: row.us_bond_yield as number | null,
    gold_price: row.gold_price as number | null,
    oil_price: row.oil_price as number | null,
    btc_price: row.btc_price as number | null,
    risk_factors_json: row.risk_factors_json as Report['risk_factors_json'],
    watch_sectors_json: row.watch_sectors_json as Report['watch_sectors_json'],
    focus_stock_json: row.focus_stock_json as Report['focus_stock_json'],
    tomorrow_watch_json: row.tomorrow_watch_json as Report['tomorrow_watch_json'],
    global_events_json: row.global_events_json as Report['global_events_json'],
    ai_strategy_json: row.ai_strategy_json as Report['ai_strategy_json'],
    important_news_json: row.important_news_json as Report['important_news_json'],
    yesterday_summary: row.yesterday_summary as string | null,
    today_summary: row.today_summary as string | null,
    created_at: String(row.created_at || new Date().toISOString()),
    today_quote: row.today_quote as string | null,
    today_strategy: row.today_strategy as Report['today_strategy'],
    watch_sectors_detailed: row.watch_sectors_detailed as Report['watch_sectors_detailed'],
    ai_psychology: row.ai_psychology as string | null,
    ai_retail_reminder: row.ai_retail_reminder as string | null,
    ai_confidence_reason: row.ai_confidence_reason as string | null,
    sentiment_score: row.sentiment_score as number | null,
    sentiment_label: row.sentiment_label as string | null,
    sentiment_reason: row.sentiment_reason as string | null,
    risk_reason: row.risk_reason as string | null,
    key_drivers: row.key_drivers as string[] | null,
    raw_ai_json: row.raw_ai_json as Record<string, unknown> | null,
  };
}

// ==================== INTERNAL HELPERS ====================

function describeChange(symbol: string, value: number, changePct: number): string {
  const absPct = Math.abs(changePct);
  const dir = changePct > 0.05 ? '上漲' : changePct < -0.05 ? '下跌' : '持平';

  if (absPct < 0.1) return `${symbol}幾乎持平，變動不大。`;

  const strength = absPct > 2 ? '強勢' : absPct > 1 ? '明顯' : absPct > 0.5 ? '小幅' : '微幅';
  const dirWord = changePct > 0.05 ? '上漲' : '下跌';

  if (symbol === 'VIX') {
    const v = value;
    if (v > 25) return `VIX 恐慌指數目前在 ${v.toFixed(0)}，市場情緒偏恐慌，${strength}${dirWord}了 ${absPct.toFixed(1)}%。`;
    if (v > 18) return `VIX 在 ${v.toFixed(0)}，${strength}${dirWord} ${absPct.toFixed(1)}%，市場有些緊張但還算可控。`;
    return `VIX 維持在 ${v.toFixed(0)} 的低檔，市場情緒平穩。`;
  }

  if (symbol === 'DXY') {
    return `美元指數 ${strength}${dirWord} ${absPct.toFixed(2)}%，目前在 ${value.toFixed(2)}。`;
  }

  if (symbol === 'US10Y') {
    return `美國十年期公債殖利率 ${dirWord}到 ${value.toFixed(2)}%。`;
  }

  const valueStr = symbol === '2330' ? `${value.toFixed(0)} 元` : `${value.toFixed(2)} 點`;
  return `${symbol} ${strength}${dirWord} ${absPct.toFixed(2)}%，收在 ${valueStr}。`;
}

function describeBias(bias: string | null | undefined, score: number | null): string {
  const s = score ?? 0;
  const b = bias || '';

  if (b === '資料不足，暫不判定' || b.includes('資料不足')) {
    return '今天盤前核心資料不足，台股本地指標尚未完整，暫不做完整盤前判斷。目前僅作資訊觀察。';
  }

  if (b.includes('偏多')) {
    if (s >= 85) return '今天盤前訊號明確偏多，各項數據一致性相當高，市場方向感清楚。';
    if (s >= 70) return '今天盤前訊號偏多，資料顯示多方動能相對明確。';
    return '盤前訊號偏多，但強度還不夠強，需要開盤後進一步確認。';
  }
  if (b.includes('偏空') || b.includes('偏弱') || b.includes('防守') || b.includes('高風險')) {
    if (s >= 85) return '今天盤前壓力明顯偏大，市場偏向防守，各項數據指向一致，風險訊號相對明確。';
    if (s >= 70) return '盤前訊號偏弱，市場情緒偏向保守，壓力大於支撐。';
    return '盤前訊號偏弱，壓力存在但尚未到恐慌程度，需要觀察開盤後的承接力道。';
  }
  return '今天盤前訊號中性，市場方向還沒有明確表態，處於觀望狀態。';
}

function describeConfidence(score: number | null): string {
  const s = score ?? 0;
  if (s >= 80) return `判讀把握度偏高，代表系統對目前的盤勢判斷比較確定，各項數據指向一致。`;
  if (s >= 60) return `判讀把握度中等，部分數據之間存在分歧，判斷需要保守一點。`;
  return `判讀把握度偏低，代表今天的數據之間矛盾較多，不確定性偏高，建議多看少做。`;
}

function describeConfidenceNote(score: number | null): string {
  const s = score ?? 0;
  if (s >= 80) return `判讀把握度 ${s}/100，越高代表系統對目前判讀越有把握，不代表行情越樂觀。`;
  if (s >= 60) return `判讀把握度 ${s}/100，把握度中等，數據之間存在分歧，判斷宜保守。`;
  return `判讀把握度 ${s}/100，把握度偏低，今天的不確定性較高。`;
}

function safeArray(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return val.map(String).filter(Boolean);
}

function getDateLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
  return `${m} 月 ${day} 日，星期${weekDays[d.getDay()]}`;
}

// ==================== REELS / 1-MIN SCRIPT HELPERS ====================

function generateHook(bias: string, score: number): string {
  const isBearish = bias.includes('偏空') || bias.includes('偏弱') || bias.includes('防守') || bias.includes('高風險');
  const isBullish = bias.includes('偏多');
  const s = score ?? 0;

  if (isBearish && s >= 80) {
    const hooks = [
      '今天台股開盤前，不是先找機會，是先確認風險站在哪一邊。',
      '今天不是追價盤，先看權值股能不能止穩。',
      '今天盤前訊號偏弱，重點不是猜反彈，而是先看風險。',
    ];
    return hooks[s % 3];
  }
  if (isBearish) {
    return '今天不是追價日，先看壓力有多大再動作。';
  }
  if (isBullish && s >= 80) {
    const hooks = [
      '今天盤前方向明確，但要記住：方向清楚不等於可以追高。',
      '早安。今天盤前數據一致偏多，但紀律還是第一優先。',
    ];
    return hooks[s % 2];
  }
  if (isBullish) {
    return '今天盤前訊號偏多，但強度還不夠，開盤後再確認。';
  }
  return '今天市場方向還沒表態，多看少做是上策。';
}

function buildGlobalSignalsBlock(
  marketData: VoiceScriptInput['marketData'],
  report: Report,
): string {
  const signals: string[] = [];
  const sox = marketData.find((d) => d.symbol === 'SOX');
  const tsm = marketData.find((d) => d.symbol === 'TSM');
  const vix = marketData.find((d) => d.symbol === 'VIX');
  const txfg = marketData.find((d) => d.symbol === 'TXF');
  const dxy = marketData.find((d) => d.symbol === 'DXY');

  // SOX — directional only, no exact percentages
  if (sox && Math.abs(sox.changePercent) > 0.3) {
    if (sox.changePercent > 0) {
      const absPct = Math.abs(sox.changePercent);
      signals.push(absPct > 1.5
        ? '費半強勢上漲，科技股資金明顯回流'
        : '費半上漲，科技股方向偏多');
    } else {
      signals.push('費半明顯轉弱，代表半導體壓力尚未消化');
    }
  }

  // TSM ADR — directional only
  if (tsm && Math.abs(tsm.changePercent) > 0.3) {
    if (tsm.changePercent > 0) {
      signals.push('台積電 ADR 走強，對台股權值股開盤有正面支撐');
    } else {
      signals.push('台積電 ADR 同步走弱，台股權值股開盤容易承壓');
    }
  }

  // VIX — level description, no exact number in narration
  if (vix) {
    const v = vix.value;
    if (v > 22) {
      signals.push('VIX 維持偏高，代表市場情緒還沒有真正放鬆');
    } else if (v > 16) {
      signals.push('VIX 處於中性偏高，市場情緒仍偏謹慎');
    }
  }

  // TXF night session — directional only
  if (txfg && Math.abs(txfg.changePercent) > 0.2) {
    if (txfg.changePercent > 0) {
      signals.push('台指夜盤走強，開盤有機會小幅開高');
    } else {
      signals.push('台指夜盤走弱，開盤可能直接反映壓力');
    }
  }

  // DXY — directional only
  if (dxy && Math.abs(dxy.changePercent) > 0.15) {
    if (dxy.changePercent > 0) {
      signals.push('美元走強，資金面偏緊，不利新興市場');
    } else {
      signals.push('美元走弱，新興市場資金壓力減輕');
    }
  }

  const topSignals = signals.slice(0, 3);

  if (topSignals.length === 0) {
    return '全球市場昨晚變動不大，沒有明顯的方向性訊號。';
  }

  const numberWords = ['第一', '第二', '第三'];
  return topSignals.map((s, i) => `${numberWords[i]}，${s}`).join('\n\n');
}

function buildObservationPoints(
  bias: string,
  canWatch: string[],
  avoidToday: string[],
): string {
  const isBearish = bias.includes('偏空') || bias.includes('偏弱') || bias.includes('防守') || bias.includes('高風險');
  const points: string[] = [];

  if (isBearish) {
    points.push('台積電能不能止穩。');
    points.push('半導體族群跌幅有沒有收斂。');
    points.push('盤中反彈有沒有量。');
  } else {
    if (canWatch.length > 0) {
      points.push(`${canWatch.slice(0, 2).join('、')} 族群能否延續盤前動能。`);
    }
    points.push('開盤量能是否足夠支撐方向。');
    if (avoidToday.length > 0) {
      points.push(`${avoidToday.slice(0, 2).join('、')} 需要特別留意風險。`);
    } else {
      points.push('盤中若出現方向反轉訊號，要及時調整判斷。');
    }
  }

  const numberWords = ['第一', '第二', '第三'];
  return points.slice(0, 3).map((p, i) => `${numberWords[i]}，${p}`).join('\n');
}

function splitNarrationToSegments(narration: string): { startSec: number; endSec: number; text: string }[] {
  // Split into sentences by punctuation: 。！？， then group into ~12-char chunks for mobile readability
  const rawSentences = narration
    .split(/(?<=[。！？，\n])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== '\n');

  const segments: { startSec: number; endSec: number; text: string }[] = [];
  const totalDuration = 60;
  const allChars = rawSentences.reduce((sum, s) => sum + s.length, 0);

  let currentChunk = '';
  let cumulativeChars = 0;
  const TARGET_CHUNK_SIZE = 14; // target ~8-18 chars per subtitle segment

  for (const sentence of rawSentences) {
    if (currentChunk && (currentChunk.length + sentence.length > TARGET_CHUNK_SIZE + 6)) {
      // Flush current chunk
      const ratio = currentChunk.length / Math.max(allChars, 1);
      const duration = Math.max(2, Math.round(ratio * totalDuration));
      const startSec = segments.length > 0 ? segments[segments.length - 1].endSec : 0;
      const endSec = Math.min(totalDuration, startSec + duration);
      segments.push({ startSec, endSec, text: currentChunk.trim() });
      cumulativeChars += currentChunk.length;
      currentChunk = sentence;
    } else {
      currentChunk += sentence;
    }
  }

  // Flush last chunk
  if (currentChunk.trim().length > 0) {
    const startSec = segments.length > 0 ? segments[segments.length - 1].endSec : 0;
    segments.push({ startSec, endSec: totalDuration, text: currentChunk.trim() });
  }

  // Redistribute timing evenly
  if (segments.length > 0) {
    const perSegment = totalDuration / segments.length;
    for (let i = 0; i < segments.length; i++) {
      segments[i].startSec = Math.round(i * perSegment);
      segments[i].endSec = Math.round((i + 1) * perSegment);
    }
    segments[segments.length - 1].endSec = totalDuration;
  }

  return segments;
}

function formatSrtTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const millis = Math.round((totalSeconds % 1) * 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

function buildSRT(segments: { startSec: number; endSec: number; text: string }[]): string {
  return segments
    .map((seg, i) => {
      return `${i + 1}\n${formatSrtTime(seg.startSec)} --> ${formatSrtTime(seg.endSec)}\n${seg.text}`;
    })
    .join('\n\n');
}

function buildStoryboard(
  narration: string,
  bias: string,
): StoryboardSegment[] {
  const lines = narration.split('\n').filter((l) => l.trim().length > 0);
  const isBearish = bias.includes('偏空') || bias.includes('偏弱') || bias.includes('防守') || bias.includes('高風險');

  // Locate structural delimiters
  const hookLine = lines[0] || '';
  const judgmentLine = lines.find((l) => l.includes('Morning Alpha 今日判讀')) || '';

  // Signal zone: between "原因有" marker and the impact line
  const signalStartIdx = lines.findIndex((l) => /^原因有/.test(l));
  const impactIdx = lines.findIndex((l, i) => i > signalStartIdx && /^(所以今天|對台股來說)/.test(l));
  const signalZone = signalStartIdx >= 0
    ? lines.slice(signalStartIdx + 1, impactIdx > signalStartIdx ? impactIdx : undefined)
    : [];
  const signalLines = signalZone.filter((l) => /^第[一二三四五六七八九十]，/.test(l));

  const impactLine = impactIdx >= 0 ? lines[impactIdx] : '';

  // Observation zone: between "今天先看" marker and confidence note
  const obsStartIdx = lines.findIndex((l) => /^今天先看/.test(l));
  const confidenceIdx = lines.findIndex((l, i) => i > (obsStartIdx >= 0 ? obsStartIdx : 0) && l.includes('判讀把握度'));
  const obsZone = obsStartIdx >= 0
    ? lines.slice(obsStartIdx + 1, confidenceIdx > obsStartIdx ? confidenceIdx : undefined)
    : [];
  const obsLines = obsZone.filter((l) => /^第[一二三四五六七八九十]，/.test(l) || l.includes('能不能') || l.includes('有沒有') || l.includes('量能') || l.includes('動能') || l.includes('反轉') || l.includes('留意'));
  const obsGuideLine = obsStartIdx >= 0 ? lines[obsStartIdx] : '';

  // Confidence + closing
  const confidenceLine = confidenceIdx >= 0 ? lines[confidenceIdx] : '';
  const closingLine = lines.find((l) => /^(每天開盤前|完整盤前劇本)/.test(l)) || '';

  const segments: StoryboardSegment[] = [
    {
      timeStart: 0,
      timeEnd: 3,
      mainText: hookLine.length > 18 ? hookLine.slice(0, 16) : hookLine.replace(/[。，]$/, ''),
      subText: 'Morning Alpha 盤前速報',
      narrationLine: hookLine,
    },
    {
      timeStart: 3,
      timeEnd: 12,
      mainText: judgmentLine.replace('Morning Alpha 今日判讀：', '').replace(/[。，]$/, ''),
      subText: '今日判讀',
      narrationLine: judgmentLine,
    },
    {
      timeStart: 12,
      timeEnd: 25,
      mainText: signalLines.slice(0, 2).map((l) => l.replace(/^第[一二三四五六七八九十]，/, '').replace(/[。，]$/, '')).join('｜'),
      subText: '全球市場訊號',
      narrationLine: [signalLines[0] || '', signalLines[1] || ''].filter(Boolean).join(' '),
    },
    {
      timeStart: 25,
      timeEnd: 35,
      mainText: (signalLines[2] || '').replace(/^第[一二三四五六七八九十]，/, '').replace(/[。，]$/, '') || (impactLine ? impactLine.slice(0, 18) : ''),
      subText: isBearish ? '台股壓力觀察' : '台股影響',
      narrationLine: [signalLines[2] || '', impactLine].filter(Boolean).join(' '),
    },
    {
      timeStart: 35,
      timeEnd: 50,
      mainText: obsLines.slice(0, 3).map((l) => l.replace(/^第[一二三四五六七八九十]，/, '').replace(/[。，]$/, '')).join('｜'),
      subText: '今日觀察重點',
      narrationLine: [obsGuideLine, ...obsLines.slice(0, 3)].filter(Boolean).join(' '),
    },
    {
      timeStart: 50,
      timeEnd: 60,
      mainText: '看完整盤前劇本',
      subText: 'Morning Alpha',
      narrationLine: [confidenceLine, closingLine].filter(Boolean).join(' '),
    },
  ];

  // Fallback: if mainText is empty, use the narrationLine snippet
  for (const seg of segments) {
    if (!seg.mainText.trim()) {
      seg.mainText = seg.subText;
    }
  }

  return segments;
}

function buildReelsOutput(
  narration: string,
  report: Report,
  dateLabel: string,
  marketDataCount: number,
): ReelsOutput {
  const bias = report.market_bias || '觀察中';
  const score = report.confidence_score ?? 0;
  const isBearish = bias.includes('偏空') || bias.includes('偏弱') || bias.includes('防守') || bias.includes('高風險');
  const isBullish = bias.includes('偏多');
  const dataSparse = marketDataCount < 3;

  // --- Cover Titles (3 variants per bias) ---
  const allBearishTitles = [
    '今天不是追高日',
    '先看風險站在哪一邊',
    '台股開盤前，這三個訊號要先看',
    '盤前壓力偏大，先確認風險',
    '權值股能不能止穩？先看這三件事',
    '今天先防守，這三個訊號是關鍵',
  ];
  const allBullishTitles = [
    '今天盤前方向明確，但紀律第一',
    '多方訊號來了，先看這三點',
    '台股開盤前，這三個方向要先掌握',
    '偏多盤前訊號，不追高是關鍵',
  ];
  const allNeutralTitles = [
    '市場還沒表態，先看這三件事',
    '今天觀望為主，這三個訊號先確認',
    '台股盤前方向未明，多看少做',
    '盤前中性，先看清楚再動作',
  ];

  let pool: string[];
  if (isBearish) pool = allBearishTitles;
  else if (isBullish) pool = allBullishTitles;
  else pool = allNeutralTitles;

  // Pick 3 deterministically using score as seed
  const idx = score % pool.length;
  const coverTitles: string[] = [];
  for (let i = 0; i < 3; i++) {
    coverTitles.push(pool[(idx + i) % pool.length]);
  }

  // --- Caption (80~120 chars, single paragraph) ---
  let biasLabel: string;
  let riskLabel: string;
  if (isBearish) {
    biasLabel = '壓力偏大';
    riskLabel = '防守';
  } else if (isBullish) {
    biasLabel = '多方訊號';
    riskLabel = '偏積極';
  } else {
    biasLabel = '方向未明';
    riskLabel = '觀望';
  }

  let caption = `今天 Morning Alpha 盤前判讀：${biasLabel}。全球市場訊號偏向${riskLabel}，台股開盤前先看權值股與半導體能不能止穩。完整盤前劇本已整理在 Morning Alpha。`;

  if (dataSparse) {
    caption = `今天 Morning Alpha 盤前判讀：${biasLabel}。部分資料尚未更新，今日判讀以已確認資料為主。完整盤前劇本已整理在 Morning Alpha。`;
  }

  // --- Hashtags (fixed) ---
  const hashtags = '#MorningAlpha #台股盤前 #台股 #投資觀察 #全球市場 #盤前判讀';

  // --- Subtitle segments ---
  const subtitleSegments = splitNarrationToSegments(narration);

  return {
    coverTitles,
    narration,
    subtitleSegments,
    storyboard: buildStoryboard(narration, bias),
    caption,
    hashtags,
    srt: buildSRT(subtitleSegments),
  };
}

// ==================== MAIN BUILDER FUNCTIONS ====================

export function buildVoiceScript1Min(input: VoiceScriptInput): string {
  const { report, marketData, marketNews } = input;

  if (!report) {
    return `Morning Alpha 盤前速報。\n\n今天的盤前報告尚未產生，請在早上七點半後再回來查看。`;
  }

  const bias = report.market_bias || '觀察中';
  const score = report.confidence_score ?? 0;
  const keyDrivers = safeArray(report.key_drivers);
  const canWatch = safeArray(report.can_watch);
  const avoidToday = safeArray(report.avoid_today);
  const riskReason = report.risk_reason || '';
  const summary = report.summary || '';
  const dateLabel = getDateLabel(report.report_date);
  const isBearish = bias.includes('偏空') || bias.includes('偏弱') || bias.includes('防守') || bias.includes('高風險');

  const lines: string[] = [];

  // ===== 0~3 秒：一句話鉤子 =====
  lines.push(generateHook(bias, score));

  // ===== 3~12 秒：Morning Alpha 今日判讀 =====
  lines.push('');
  lines.push(`Morning Alpha 今日判讀：${isBearish ? '盤前壓力偏大，市場偏向防守。' : bias.includes('偏多') ? '盤前訊號偏多，多方動能相對明確。' : '盤前訊號中性，市場方向尚未表態。'}`);

  // ===== 12~30 秒：全球市場訊號 2~3 個 =====
  lines.push('');
  const globalSignals = buildGlobalSignalsBlock(marketData, report);
  const signalCount = globalSignals.split('\n\n').filter((l) => /^第[一二三四五六七八九十]，/.test(l)).length;
  if (signalCount > 0) {
    lines.push(`原因有${signalCount === 1 ? '一個' : signalCount === 2 ? '兩個' : '三個'}。`);
    lines.push('');
    lines.push(globalSignals);
  }
  if (signalCount < 2 || marketData.length < 3) {
    lines.push('');
    lines.push('部分資料尚未更新，今日判讀以已確認資料為主。');
  }

  // ===== 30~45 秒：轉成台股影響 =====
  lines.push('');
  if (isBearish) {
    lines.push('所以今天重點不是猜最低點，也不是看到下跌就急著搶反彈。');
    if (riskReason && riskReason.length > 5) {
      const shortRisk = riskReason.length > 80 ? riskReason.slice(0, 80) + '...' : riskReason;
      lines.push(shortRisk);
    }
  } else {
    if (keyDrivers.length > 0) {
      lines.push(`對台股來說，今天的焦點圍繞在 ${keyDrivers.slice(0, 3).join('、')}。`);
    }
    if (summary) {
      const firstSentence = summary.split(/[。\n]/).filter((s) => s.length > 10)[0];
      if (firstSentence) lines.push(firstSentence.slice(0, 80) + '。');
    }
    if (riskReason && riskReason.length > 5) {
      const shortRisk = riskReason.length > 80 ? riskReason.slice(0, 80) + '...' : riskReason;
      lines.push(`留意風險：${shortRisk}`);
    }
  }

  // ===== 45~55 秒：今日觀察重點（最多三點）=====
  const obsPoints = buildObservationPoints(bias, canWatch, avoidToday);
  const obsCount = obsPoints.split('\n').filter((l) => /^第[一二三四五六七八九十]，/.test(l)).length;
  if (obsCount > 0) {
    lines.push('');
    lines.push(`今天先看${obsCount === 1 ? '一件事' : obsCount === 2 ? '兩件事' : '三件事'}。`);
    lines.push('');
    lines.push(obsPoints);
  }

  // ===== 52~56 秒：判讀把握度免責 =====
  lines.push('');
  lines.push(describeConfidenceNote(score));

  // ===== 56~60 秒：品牌收尾 =====
  lines.push('');
  if (isBearish) {
    lines.push('每天開盤前，先看 Morning Alpha，把今天的風險地圖看完再進場。');
  } else {
    lines.push('完整盤前劇本與今日觀察重點，已經整理在 Morning Alpha。');
  }

  return lines.join('\n');
}

export function buildVoiceScript3Min(input: VoiceScriptInput): string {
  const { report, marketData, marketNews, generatedAt } = input;

  if (!report) {
    return `Morning Alpha 盤前研究筆記。\n\n今天的盤前報告尚未產生，請在早上七點半後再回來查看。`;
  }

  const dateLabel = getDateLabel(report.report_date);
  const bias = report.market_bias || '觀察中';
  const score = report.confidence_score ?? 0;
  const keyDrivers = safeArray(report.key_drivers);
  const canWatch = safeArray(report.can_watch);
  const avoidToday = safeArray(report.avoid_today);
  const riskReason = report.risk_reason || '';
  const summary = report.summary || '';
  const isBearish = bias.includes('偏空') || bias.includes('偏弱') || bias.includes('防守') || bias.includes('高風險');

  const lines: string[] = [];

  // ===== 1. 開場（直接切入，不是早安廣播） =====
  lines.push('歡迎收聽 Morning Alpha 盤前研究筆記，我是今天的 AI 主理人。');
  lines.push(`今天是 ${dateLabel}。我們在開盤前快速掃描全球市場脈動，判斷今天台股的風險與觀察重點。`);
  lines.push('');

  // ===== 2. 全球市場背景 =====
  lines.push('首先來看昨晚的全球市場。');

  const sox = marketData.find((d) => d.symbol === 'SOX');
  const tsm = marketData.find((d) => d.symbol === 'TSM');
  const vix = marketData.find((d) => d.symbol === 'VIX');
  const dxy = marketData.find((d) => d.symbol === 'DXY');
  const us10y = marketData.find((d) => d.symbol === 'US10Y');

  const usMarkets = [sox, tsm, vix, dxy, us10y].filter(Boolean);

  if (usMarkets.length > 0) {
    if (sox) {
      lines.push(`費城半導體指數${describeChange('費半', sox.value, sox.changePercent)}`);
    }
    if (tsm) {
      lines.push(`台積電 ADR ${describeChange('ADR', tsm.value, tsm.changePercent)}`);
    }
    if (vix) {
      lines.push(describeChange('VIX', vix.value, vix.changePercent));
    }
    if (dxy) {
      lines.push(describeChange('美元指數', dxy.value, dxy.changePercent));
    }
    if (us10y) {
      lines.push(describeChange('美債', us10y.value, us10y.changePercent));
    }
  } else {
    lines.push('全球市場數據目前還在整理中，我們會在盤前完成更新。');
  }

  lines.push('');

  // ===== 3. 今日台股盤前判讀 =====
  lines.push('回到台股來看今天的盤前判斷。');
  lines.push(describeBias(bias, score));

  if (score >= 80) {
    lines.push(`判讀把握度偏高，${score}/100，今天的數據一致性高，盤前方向的可靠度不錯。`);
  } else if (score >= 60) {
    lines.push(`判讀把握度中等，${score}/100，有部分數據之間有分歧，要特別留意開盤後的變化。`);
  } else {
    lines.push(`提醒：判讀把握度偏低，${score}/100，代表數據矛盾較多，今天盤勢不容易判斷，建議多看少做。`);
  }

  if (keyDrivers.length > 0) {
    lines.push(`今天的主線圍繞在 ${keyDrivers.slice(0, 4).join('、')}。`);
  }

  if (marketNews.length > 0) {
    const topCategories = [...new Set(marketNews.map((n) => n.category).filter((c) => c && c !== 'Other'))].slice(0, 3);
    if (topCategories.length > 0) {
      lines.push(`從今天的高分新聞來看，${topCategories.join('、')} 是目前市場關注的焦點。`);
    }
  }

  lines.push('');

  // ===== 4. 受惠方向 / 風險方向 =====
  if (canWatch.length > 0) {
    lines.push(`值得觀察的方向：${canWatch.slice(0, 4).join('、')}。`);
  } else if (keyDrivers.length > 0) {
    lines.push(`目前來看，${keyDrivers.slice(0, 2).join('、')} 相關的族群值得觀察。`);
  }

  if (avoidToday.length > 0) {
    lines.push(`風險方面，${avoidToday.slice(0, 3).join('、')} 是今天比較需要小心的區域。`);
  }
  if (riskReason && riskReason.length > 10) {
    const shortRisk = riskReason.length > 120 ? riskReason.slice(0, 120) + '...' : riskReason;
    lines.push(`今天比較大的不確定因素：${shortRisk}`);
  }

  lines.push('');

  // ===== 5. 09:15 與 10:30 觀察重點 =====
  lines.push('開盤之後，有兩個時間點很重要。');

  if (isBearish) {
    lines.push('九點十五分，觀察有沒有特定權值股逆勢轉強。如果某個權值族群開低後快速翻紅，偏弱的判斷就需要重新評估。');
    lines.push('十點半左右，留意大盤的量價結構。如果指數在低檔出現帶量的承接力道，今天可能不會一路走弱。');
  } else if (bias.includes('偏多')) {
    lines.push('九點十五分，看一下開盤的量能。如果開高但量能明顯不足，追價風險會偏高。');
    lines.push('十點半左右，盤中如果有拉回，要看主流族群能不能撐住。如果主流族群出現帶量轉弱，偏多判斷就需要調整。');
  } else {
    lines.push('九點十五分，先觀察開盤的方向性。如果開盤後十五分鐘內有明確的漲跌力道，方向才會比較明朗。');
    lines.push('十點半左右，再確認一次。如果方向還是很模糊，今天就先以觀望為主。');
  }

  if (keyDrivers.length > 0) {
    lines.push(`另外，${keyDrivers[0]} 相關族群能不能延續盤前的動能，也是今天重要的看點。`);
  }

  lines.push('');

  // ===== 6. 收尾 =====
  lines.push('總結來說，');
  if (summary) {
    const shortSummary = summary.length > 180 ? summary.slice(0, 180) + '。' : summary;
    lines.push(shortSummary);
  } else {
    const biasText = isBearish
      ? '今天市場壓力較大，保守為上。重點不是猜最低點，而是觀察承接力道。'
      : bias.includes('偏多')
      ? '今天多方訊號相對明確，但保持紀律、不追高仍是關鍵。'
      : '今天市場方向還沒有明確表態，多看少做是上策。';
    lines.push(biasText);
  }

  lines.push('');
  lines.push('最後提醒：本內容為市場資訊整理與情境判讀，不構成任何買賣建議或投資邀約。市場有風險，決策請自行判斷。');
  lines.push('感謝收聽 Morning Alpha，我們明天見。');

  return lines.join('\n');
}

// ==================== LEGACY WRAPPER (keeps backward compat) ====================

export function generateVoiceScript(input: VoiceScriptInput): VoiceScript {
  const { report, marketData, marketNews, generatedAt } = input;

  const oneMinute = buildVoiceScript1Min(input);
  const threeMinute = buildVoiceScript3Min(input);

  let reels: ReelsOutput | null = null;
  if (report) {
    const dateLabel = getDateLabel(report.report_date);
    reels = buildReelsOutput(oneMinute, report, dateLabel, marketData.length);
  }

  const dataSources: string[] = ['Morning Alpha 盤前報告'];
  if (marketData.length > 0) dataSources.push('全球市場數據');
  if (marketNews.length > 0) dataSources.push('高分市場新聞');

  return {
    oneMinute,
    threeMinute,
    reels,
    generatedAt,
    reportDate: report?.report_date || '',
    dataSources,
    dataSourceCounts: {
      marketDataCount: marketData.length,
      marketNewsCount: marketNews.length,
    },
  };
}

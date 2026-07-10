import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '@/components/feature/Navbar';
import Footer from '@/components/feature/Footer';
import ErrorBoundary from '@/components/base/ErrorBoundary';
import { getMorningAlphaDisplayState, type MorningAlphaDisplayState } from '@/lib/morningAlphaDisplayState';
import { buildCanonicalNarrative } from '@/lib/canonicalNarrative';
import { renderSafeText } from '@/utils/renderSafe';
import { trackPageView, trackEvent } from '@/utils/analytics';
import { resolveActiveMorningAlphaReport } from '@/services/resolveActiveReport';

// ═══════════════════════════════════════════════════
// V9.0: Three-tier beneficiary stock types
// ═══════════════════════════════════════════════════
interface TierStock {
  stock_id: string;
  stock_name: string;
  sector: string;
  beneficiary_level: 'core' | 'extended' | 'scenario';
  trigger_event: string;
  reason: string;
  risk_note: string;
  confidence_level?: 'high' | 'medium' | 'low';
  has_confidence: boolean;
  data_basis: string;
  // legacy compat
  symbol?: string;
  name?: string;
  direction?: string;
  conviction_level?: string;
  catalyst_type?: string;
  watch_point?: string;
  validation_signal?: string;
  source_signals?: string;
  not_buy_signal?: boolean;
}

interface V10OpportunityStock {
  symbol: string;
  name: string;
  industryCode: string;
  industryName: string;
  rank: number | null;
  totalScore: number | null;
  confidenceLevel: string;
  netEvidenceDirection: 'positive' | 'neutral' | 'negative' | string;
  positiveEvidenceCount: number;
  negativeEvidenceCount: number;
  riskFlags: string[];
  scoringReasons: string[];
  benefitChain: string[];
  observationReason: string;
  confirmationPendingReason: string;
  stopObservingCondition: string;
  observationChain: string[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function compactText(value: unknown): string {
  return String(value ?? '').trim();
}


function confidenceLevelFrom(value: unknown): TierStock['confidence_level'] {
  const normalized = compactText(value).toLowerCase();
  if (normalized === 'high' || normalized === 'medium' || normalized === 'low') return normalized;

  const numeric = typeof value === 'number' ? value : Number(value);
  if (Number.isFinite(numeric)) {
    if (numeric >= 75) return 'high';
    if (numeric >= 50) return 'medium';
  }

  return 'low';
}

function parseEvidence(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => compactText(item)).filter(Boolean).join('；');
  return compactText(value);
}

function hasConfidenceValue(raw: Record<string, unknown>): boolean {
  return raw.confidence_level !== undefined || raw.confidence !== undefined || raw.confidence_score !== undefined || raw.score !== undefined;
}

function hasExplicitStockIdentity(row: Record<string, unknown>): boolean {
  const stockId = compactText(row.stock_id || row.symbol || row.stock_code || row.code || row.ticker);
  const stockName = compactText(row.stock_name || row.name || row.stock || row.company_name || row.title);
  return Boolean(stockId || stockName);
}

function parseTierStock(
  raw: Record<string, unknown>,
  fallbackLevel: TierStock['beneficiary_level'] = 'extended',
  fallbackDataBasis = '',
): TierStock | null {
  const stockId = compactText(raw.stock_id || raw.symbol || raw.stock_code || raw.code || raw.ticker);
  const stockName = compactText(raw.stock_name || raw.name || raw.stock || raw.company_name || raw.title);
  if (!stockId && !stockName) return null;

  const rawLevel = compactText(raw.beneficiary_level);
  const beneficiaryLevel: TierStock['beneficiary_level'] = rawLevel === 'core' || rawLevel === 'extended' || rawLevel === 'scenario'
    ? rawLevel
    : fallbackLevel;

  return {
    stock_id: stockId,
    stock_name: stockName || stockId,
    sector: compactText(raw.sector || raw.group || raw.category || raw.industry),
    beneficiary_level: beneficiaryLevel,
    trigger_event: compactText(raw.trigger_event || raw.catalyst || raw.catalyst_type || raw.event),
    reason: compactText(raw.reason || raw.why_this_stock || raw.thesis || raw.member_thesis || raw.why_it_matters || raw.score_reason),
    risk_note: compactText(raw.risk_note || raw.risk || raw.invalidation_condition || raw.invalidation_conditions || raw.failure_conditions),
    confidence_level: hasConfidenceValue(raw) ? confidenceLevelFrom(raw.confidence_level || raw.confidence || raw.confidence_score || raw.score) : undefined,
    has_confidence: hasConfidenceValue(raw),
    data_basis: compactText(raw.data_basis || raw.source_type || raw.source || fallbackDataBasis || parseEvidence(raw.evidence) || parseEvidence(raw.source_signals)),
    symbol: stockId,
    name: stockName,
    direction: compactText(raw.direction || '觀察'),
    conviction_level: compactText(raw.conviction_level || ''),
    catalyst_type: compactText(raw.catalyst_type || ''),
    watch_point: compactText(raw.watch_point || raw.validation_signal || raw.what_to_watch),
    validation_signal: compactText(raw.validation_signal),
    source_signals: parseEvidence(raw.source_signals),
    not_buy_signal: raw.not_buy_signal !== false,
  };
}

function mapTierStocks(
  rows: unknown,
  level: TierStock['beneficiary_level'],
  dataBasis: string,
): TierStock[] {
  return asRecordArray(rows)
    .map((row) => parseTierStock(row, level, dataBasis))
    .filter((stock): stock is TierStock => stock !== null);
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => compactText(item)).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function mapV10OpportunityStocks(rows: unknown): V10OpportunityStock[] {
  return asRecordArray(rows).map((row, index) => ({
    symbol: compactText(row.symbol || row.stock_id || row.stock_code),
    name: compactText(row.name || row.stock_name || row.company_name),
    industryCode: compactText(row.industry_code),
    industryName: compactText(row.industry_name || row.industry || row.sector),
    rank: numberOrNull(row.rank) ?? index + 1,
    totalScore: numberOrNull(row.total_score),
    confidenceLevel: compactText(row.confidence_level || 'low'),
    netEvidenceDirection: compactText(row.net_evidence_direction || 'neutral'),
    positiveEvidenceCount: numberOrNull(row.positive_evidence_count) ?? 0,
    negativeEvidenceCount: numberOrNull(row.negative_evidence_count) ?? 0,
    riskFlags: stringArray(row.risk_flags),
    scoringReasons: stringArray(row.scoring_reasons),
    benefitChain: stringArray(row.benefit_chain),
    observationReason: compactText(row.observation_reason),
    confirmationPendingReason: compactText(row.confirmation_pending_reason),
    stopObservingCondition: compactText(row.stop_observing_condition),
    observationChain: stringArray(row.observation_chain),
  })).filter((stock) => Boolean(stock.symbol || stock.name));
}

function confidenceLevelLabel(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized === 'high') return '高把握';
  if (normalized === 'medium') return '中把握';
  if (normalized === 'insufficient') return '資料不足';
  return '低把握';
}

function evidenceDirectionLabel(value: string): string {
  if (value === 'positive') return '正向證據';
  if (value === 'negative') return '負向證據';
  return '中性觀察';
}

function humanizeChainPart(value: string): string {
  const raw = compactText(value);
  const normalized = raw.toUpperCase();
  const map: Record<string, string> = {
    SEMICONDUCTOR: '半導體',
    AI_SERVER: 'AI 伺服器',
    ELECTRONIC_BLUE_CHIP: '電子權值',
    FINANCIAL: '金融',
    PETROCHEMICAL: '塑化',
    SHIPPING: '航運',
    OIL: '油價',
    FX: '匯率',
    RATE: '利率',
    DXY: '美元指數',
    US10Y: '美債殖利率',
  };
  return map[normalized] || raw.replace(/_/g, ' ');
}

function uniqueNonEmpty(values: string[], limit = 4): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  values.forEach((value) => {
    const text = compactText(value);
    if (!text || seen.has(text)) return;
    seen.add(text);
    result.push(text);
  });
  return result.slice(0, limit);
}

function stockTitle(stock: Pick<V10OpportunityStock, 'symbol' | 'name'>): string {
  return [stock.symbol, stock.name].filter(Boolean).join(' ') || '未命名標的';
}

function stockScriptName(stock: V10OpportunityStock): string {
  const chainParts = stock.benefitChain.length > 0 ? stock.benefitChain.map(humanizeChainPart) : stock.observationChain.map(humanizeChainPart);
  const lastUsefulPart = [...chainParts].reverse().find((part) => part && !/^\d{4}$/.test(part));
  return stock.industryName || stock.industryCode || lastUsefulPart || '待確認劇本';
}

function sentenceOrFallback(value: string, fallback: string): string {
  const text = compactText(value);
  if (!text) return fallback;
  return text
    .replace(/^今天為什麼觀察？/, '')
    .replace(/^還缺什麼？/, '')
    .replace(/^不用再觀察的條件：/, '')
    .trim() || fallback;
}

function chainSentence(parts: string[], fallback: string): string {
  const cleaned = uniqueNonEmpty(parts.map(humanizeChainPart), 5);
  return cleaned.length >= 2 ? cleaned.join(' → ') : fallback;
}

function beneficiaryReason(stock: V10OpportunityStock): string {
  return sentenceOrFallback(
    stock.observationReason,
    chainSentence(stock.benefitChain, '正向證據與族群同步性達到門檻，才列入強受惠股。'),
  );
}

function observationReason(stock: V10OpportunityStock): string {
  return sentenceOrFallback(
    stock.observationReason,
    chainSentence(stock.observationChain.length > 0 ? stock.observationChain : stock.benefitChain, '今天值得追蹤，但還沒有足夠證據列入強受惠股。'),
  );
}

function confirmationNeeded(stock: V10OpportunityStock): string {
  return sentenceOrFallback(
    stock.confirmationPendingReason,
    '需要代表股與大盤同向，且盤中量能開始擴散。',
  );
}

function stopCondition(stock: V10OpportunityStock): string {
  return sentenceOrFallback(
    stock.stopObservingCondition,
    '若代表股不同步或量能不足，今天降級觀察。',
  );
}

function upgradeDowngradeText(stock: V10OpportunityStock): string {
  return `補上條件：${confirmationNeeded(stock)}；降級條件：${stopCondition(stock)}`;
}

function riskReasons(stock: V10OpportunityStock): string[] {
  const reasons = new Set<string>();
  if (stock.negativeEvidenceCount > 0 || stock.netEvidenceDirection === 'negative') {
    reasons.add('事件鏈未被市場確認');
    reasons.add('不列為強受惠股');
  }
  if (stock.riskFlags.length > 0) {
    reasons.add('量能不足');
    reasons.add('主線未擴散');
  }
  if (stock.positiveEvidenceCount <= stock.negativeEvidenceCount) {
    reasons.add('代表股不同步');
  }
  if (reasons.size === 0) reasons.add('今日證據不足，先排除強受惠判斷');
  return Array.from(reasons).slice(0, 4);
}

function qualityMessage(status: string, warning: string): string {
  const warningText = compactText(warning);
  if (warningText) return warningText.replace(/_/g, ' ');
  if (status === 'insufficient_positive_evidence') return '今日沒有足夠正向證據支持強受惠股，先觀察資金是否擴散。';
  if (status) return humanStatus(status);
  return '依今日資料分層顯示，不用舊名單補強受惠股。';
}

function legacyToV10(stock: TierStock, index: number, tone: 'beneficiary' | 'observation' | 'risk'): V10OpportunityStock {
  return {
    symbol: stock.stock_id,
    name: stock.stock_name,
    industryCode: stock.sector,
    industryName: stock.sector,
    rank: index + 1,
    totalScore: null,
    confidenceLevel: stock.confidence_level || 'low',
    netEvidenceDirection: tone === 'risk' ? 'negative' : tone === 'beneficiary' ? 'positive' : 'neutral',
    positiveEvidenceCount: tone === 'beneficiary' ? 1 : 0,
    negativeEvidenceCount: tone === 'risk' ? 1 : 0,
    riskFlags: tone === 'risk' ? [stock.risk_note || 'risk'] : [],
    scoringReasons: stock.reason ? [stock.reason] : [],
    benefitChain: [stock.trigger_event, stock.sector, stock.stock_id].filter(Boolean),
    observationReason: stock.reason,
    confirmationPendingReason: stock.validation_signal || stock.watch_point,
    stopObservingCondition: stock.risk_note,
    observationChain: [stock.trigger_event, stock.sector, stock.stock_id].filter(Boolean),
  };
}

function mapMemberResearchCandidates(rows: unknown): TierStock[] {
  return asRecordArray(rows)
    .map((row) => parseTierStock({
      ...row,
      stock_id: row.stock_id || row.symbol || row.stock_code,
      stock_name: row.stock_name || row.name,
      risk_note: row.risk_note || row.risk,
      data_basis: row.data_basis || parseEvidence(row.evidence) || 'member_research_note_v2.beneficiary_candidates',
    }, 'core', 'member_research_note_v2.beneficiary_candidates'))
    .filter((stock): stock is TierStock => stock !== null);
}

function dedupeTierStocks(stocks: TierStock[], used = new Set<string>()): TierStock[] {
  const result: TierStock[] = [];

  stocks.forEach((stock) => {
    const key = (stock.stock_id ? `ID:${stock.stock_id}` : `NAME:${stock.stock_name}`).trim().toUpperCase();
    if (!key || used.has(key)) return;
    used.add(key);
    result.push(stock);
  });

  return result;
}

function resolveLegacyBeneficiaries(ai: Record<string, unknown>, report: Record<string, unknown>) {
  const memberResearchNoteV2 = asRecord(ai.member_research_note_v2);
  const publicSummary = asRecord(ai.public_summary) || asRecord(ai.free_summary);
  const used = new Set<string>();

  // Debug-safe resolver: use only real existing V7/member-note fields, never static fallback stocks.
  const coreStocks = dedupeTierStocks([
    ...mapTierStocks(ai.core_beneficiary_stocks, 'core', 'core_beneficiary_stocks'),
    ...mapTierStocks(ai.beneficiary_stocks, 'core', 'beneficiary_stocks'),
    ...mapTierStocks(ai.today_beneficiary_stocks, 'core', 'today_beneficiary_stocks'),
    ...mapTierStocks(ai.one_teaser_stock ? [ai.one_teaser_stock] : [], 'core', 'one_teaser_stock'),
    ...mapTierStocks(publicSummary.beneficiary_stocks, 'core', 'public_summary.beneficiary_stocks'),
    ...mapMemberResearchCandidates(memberResearchNoteV2.beneficiary_candidates),
    ...mapTierStocks(report.focus_stock_json, 'core', 'reports.focus_stock_json'),
  ], used);

  const extendedStocks = dedupeTierStocks([
    ...mapTierStocks(ai.extended_watchlist, 'extended', 'extended_watchlist'),
    ...mapTierStocks(ai.watchlist, 'extended', 'watchlist'),
    ...mapTierStocks(asRecordArray(report.watch_sectors_json).filter(hasExplicitStockIdentity), 'extended', 'reports.watch_sectors_json'),
  ], used);

  const scenarioStocks = dedupeTierStocks([
    ...mapTierStocks(ai.scenario_watchlist, 'scenario', 'scenario_watchlist'),
  ], used);

  return { coreStocks, extendedStocks, scenarioStocks };
}

// ═══════════════════════════════════════════════════
// Confidence level badge
// ═══════════════════════════════════════════════════
function confidenceBadge(level: string) {
  if (level === 'high') return { label: '高把握', cls: 'bg-primary-100 text-primary-700 border-primary-200', dot: 'bg-primary-500' };
  if (level === 'medium') return { label: '中把握', cls: 'bg-accent-100 text-accent-700 border-accent-200', dot: 'bg-accent-500' };
  return { label: '低把握', cls: 'bg-secondary-100 text-secondary-700 border-secondary-200', dot: 'bg-secondary-400' };
}

function levelBadge(level: string) {
  if (level === 'core') return { label: '核心受惠', cls: 'bg-primary-100 text-primary-700 border-primary-300', dot: 'bg-primary-500' };
  if (level === 'extended') return { label: '延伸觀察', cls: 'bg-accent-100 text-accent-700 border-accent-300', dot: 'bg-accent-500' };
  return { label: '情境觀察', cls: 'bg-secondary-100 text-secondary-700 border-secondary-200', dot: 'bg-secondary-400' };
}


function scoreTone(score: number | null): { stars: string; label: string } {
  if (score === null || !Number.isFinite(score)) return { stars: '☆☆☆☆☆', label: '待驗證' };
  if (score >= 80) return { stars: '★★★★★', label: '高把握' };
  if (score >= 65) return { stars: '★★★★☆', label: '中高把握' };
  if (score >= 50) return { stars: '★★★☆☆', label: '觀察' };
  if (score >= 35) return { stars: '★★☆☆☆', label: '低把握' };
  return { stars: '★☆☆☆☆', label: '僅供觀察' };
}

function humanStatus(value: unknown): string {
  const raw = compactText(value).toLowerCase();
  if (!raw) return '待驗證';
  if (['ready', 'complete', 'completed'].includes(raw)) return '資料已完成';
  if (raw === 'mixed' || raw === 'partial') return '部分成立';
  if (raw === 'true') return '符合推論';
  if (raw === 'false') return '未符合盤前推論';
  if (raw === 'pending' || raw === 'pending_real_market_data') return '等待收盤資料';
  if (raw === 'degraded') return '資料不完整';
  return compactText(value);
}

function dataBasisLabel(value: unknown): string {
  const text = compactText(value);
  if (!text) return '';
  const normalized = text.toLowerCase();
  if (normalized.includes('member_research_note')) return '會員研究筆記';
  if (normalized.includes('public_summary')) return '公開摘要';
  if (normalized.includes('today_beneficiary') || normalized.includes('beneficiary_stocks') || normalized.includes('core_beneficiary')) return '今日受惠股名單';
  if (normalized.includes('extended_watchlist')) return '延伸觀察名單';
  if (normalized.includes('scenario_watchlist')) return '情境觀察名單';
  if (normalized.includes('focus_stock') || normalized.includes('watch_sectors')) return '盤前報告資料';
  return text.replace(/_/g, ' ');
}

// ═══════════════════════════════════════════════════
function OpportunitiesContent() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ds, setDs] = useState<MorningAlphaDisplayState | null>(null);
  const [coreStocks, setCoreStocks] = useState<TierStock[]>([]);
  const [extendedStocks, setExtendedStocks] = useState<TierStock[]>([]);
  const [scenarioStocks, setScenarioStocks] = useState<TierStock[]>([]);
  const [doNotDoList, setDoNotDoList] = useState<string[]>([]);
  const [invalidationItems, setInvalidationItems] = useState<string[]>([]);
  const [isHistoricalFallback, setIsHistoricalFallback] = useState(false);
  const [fallbackReportDate, setFallbackReportDate] = useState<string | null>(null);

  useEffect(() => {
    trackPageView('/opportunities');
    async function load() {
      try {
        setLoading(true);
        const resolved = await resolveActiveMorningAlphaReport();
        const report = resolved.rawRow;

        if (!report) { setDs(null); return; }

        const displayState = getMorningAlphaDisplayState(report as Record<string, unknown> | null);
        setDs(displayState);
        setIsHistoricalFallback(resolved.isHistoricalFallback);
        setFallbackReportDate(resolved.fallbackReportDate);

        if (displayState.market_status !== 'OPEN' || resolved.isHistoricalFallback) {
          setCoreStocks([]);
          setExtendedStocks([]);
          setScenarioStocks([]);
          return;
        }

        // V9.0/V8 preview: V8 ready wins; otherwise fall back to real V7 beneficiary fields.
        const ai = displayState.rawAI || {};
        const legacyBeneficiaries = resolveLegacyBeneficiaries(ai, report as Record<string, unknown>);

        setCoreStocks(legacyBeneficiaries.coreStocks);
        setExtendedStocks(legacyBeneficiaries.extendedStocks);
        setScenarioStocks(legacyBeneficiaries.scenarioStocks);

        // Do-not-do
        const dnd = Array.isArray(ai.do_not_do_list) ? (ai.do_not_do_list as string[]) : [];
        const at = Array.isArray(ai.avoid_today) ? (ai.avoid_today as string[]) : [];
        setDoNotDoList(dnd.length > 0 ? dnd : at);

        const ic = Array.isArray(ai.invalidation_conditions)
          ? (ai.invalidation_conditions as Record<string, unknown>[]).filter((inv) => inv.condition).map((inv) => String(inv.condition))
          : [];
        setInvalidationItems(ic);
      } catch (err) {
        setError(err instanceof Error ? err.message : '讀取資料失敗');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // ═══ Loading ═══
  if (loading) {
    return (
      <div className="min-h-screen bg-background-50 flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin mx-auto mb-3" />
            <span className="text-foreground-500 text-sm">載入中...</span>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background-50 flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="text-center max-w-md">
            <i className="ri-error-warning-line text-red-500 text-3xl mb-3"></i>
            <h2 className="text-foreground-900 font-semibold text-base mb-2">讀取失敗</h2>
            <p className="text-foreground-500 text-sm mb-4">{error}</p>
            <button onClick={() => window.location.reload()} className="px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white text-sm rounded-xl transition-colors whitespace-nowrap">重新載入</button>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (!ds) {
    return (
      <div className="min-h-screen bg-background-50 flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="text-center max-w-md">
            <i className="ri-time-line text-foreground-200 text-3xl mb-3"></i>
            <h2 className="text-foreground-900 font-semibold text-base mb-2">今日報告尚未產生</h2>
            <p className="text-foreground-500 text-sm mb-4">每天 07:30 自動生成，請稍後再回來查看。</p>
            <Link to="/" className="px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white text-sm rounded-xl transition-colors inline-block whitespace-nowrap">返回首頁</Link>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // ═══ Market closed ═══
  if (ds.market_status !== 'OPEN') {
    return (
      <div className="min-h-screen bg-background-50 flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="max-w-md text-center bg-background-100 border border-background-200/70 rounded-2xl p-6">
            <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-secondary-100 border border-secondary-200 flex items-center justify-center">
              <i className="ri-calendar-close-line text-secondary-500 text-2xl"></i>
            </div>
            <h1 className="text-foreground-900 font-bold text-xl mb-2">今日台股休市</h1>
            <p className="text-foreground-500 text-sm mb-2">日期：{ds.currentDate}</p>
            {ds.holidayName && <p className="text-foreground-400 text-sm mb-4">休市原因：{ds.holidayName}</p>}
            <p className="text-foreground-400 text-xs leading-relaxed mb-5">今日台股休市，不產生今日受惠股。請於下一個交易日再查看最新主線地圖。</p>
            <Link to="/" className="inline-block mt-2 px-4 py-2 rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-sm">返回首頁</Link>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (isHistoricalFallback) {
    return (
      <div className="min-h-screen bg-background-50 flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="max-w-md text-center bg-background-100 border border-background-200/70 rounded-2xl p-6">
            <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-amber-100 border border-amber-200 flex items-center justify-center">
              <i className="ri-time-line text-amber-500 text-2xl"></i>
            </div>
            <h1 className="text-foreground-900 font-bold text-xl mb-2">今日盤前報告尚未產生</h1>
            <p className="text-foreground-500 text-sm mb-2">今日日期：{ds.currentDate}</p>
            {fallbackReportDate && <p className="text-foreground-400 text-sm mb-4">上一份報告參考：{fallbackReportDate}</p>}
            <p className="text-foreground-400 text-xs leading-relaxed mb-5">今日受惠股需等待 07:30 盤前報告產生後才會顯示。為避免誤導，這裡不會把上一份報告的受惠股顯示成今日名單。</p>
            <Link to="/" className="inline-block mt-2 px-4 py-2 rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-sm">返回首頁</Link>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  const hasCore = coreStocks.length > 0;
  const hasExtended = extendedStocks.length > 0;
  const hasScenario = scenarioStocks.length > 0;
  const hasAnyStocks = hasCore || hasExtended || hasScenario;
  const rawAI = (ds.rawAI || {}) as Record<string, unknown>;
  const canonicalNarrative = buildCanonicalNarrative({
    displayState: ds,
    ai: rawAI,
    memberResearchNoteV2: asRecord(rawAI.member_research_note_v2),
  });
  const canonicalScriptHeadline = compactText(canonicalNarrative.today_script.headline || canonicalNarrative.today_focus.headline);
  const v10BeneficiaryEnabled = rawAI.v10_beneficiary_enabled === true || rawAI.v10_beneficiary_enabled === 'true' || ds.v10BeneficiaryEnabled === true;
  const v10BeneficiaryStocks = mapV10OpportunityStocks(rawAI.today_beneficiary_stocks_v10 || ds.v10BeneficiaryStocks);
  const v10ObservationWatchlist = mapV10OpportunityStocks(rawAI.v10_observation_watchlist || ds.v10ObservationWatchlist);
  const v10RiskWatchlist = mapV10OpportunityStocks(rawAI.v10_risk_watchlist || ds.v10RiskWatchlist);
  const v10DataQualityStatus = compactText(rawAI.v10_data_quality_status || ds.v10DataQualityStatus);
  const v10Warning = compactText(rawAI.v10_warning || ds.v10Warning);
  const strongOpportunityStocks = v10BeneficiaryEnabled
    ? v10BeneficiaryStocks
    : coreStocks.map((stock, index) => legacyToV10(stock, index, 'beneficiary'));
  const observationOpportunityStocks = v10BeneficiaryEnabled
    ? v10ObservationWatchlist
    : [...extendedStocks, ...scenarioStocks].map((stock, index) => legacyToV10(stock, index, 'observation'));
  const riskOpportunityStocks = v10BeneficiaryEnabled ? v10RiskWatchlist : [];
  const legacyRiskNotes = v10BeneficiaryEnabled ? [] : uniqueNonEmpty([...doNotDoList, ...invalidationItems], 5);
  const observationGroups = uniqueNonEmpty([
    canonicalScriptHeadline,
    ...observationOpportunityStocks.map(stockScriptName),
  ], 3);
  const riskGroups = uniqueNonEmpty([
    canonicalNarrative.today_focus.risk,
    ...riskOpportunityStocks.map(stockScriptName),
  ], 3);
  const pageQualityMessage = qualityMessage(v10DataQualityStatus, v10Warning);
  const hasStrongOpportunities = strongOpportunityStocks.length > 0;
  const hasObservationOpportunities = observationOpportunityStocks.length > 0;
  const hasRiskOpportunities = riskOpportunityStocks.length > 0 || legacyRiskNotes.length > 0;
  const noStrongMessage = v10BeneficiaryEnabled
    ? '今日沒有足夠證據支持強受惠股，先觀察資金是否擴散。'
    : '今日強受惠股尚未產生，先等待盤前報告或盤中驗證補齊。';

  return (
    <div className="min-h-screen bg-background-50 flex flex-col overflow-x-hidden">
      <Navbar />

      <main className="flex-1 overflow-x-hidden">
        <div className="border-b border-background-200/70 bg-background-100/80 backdrop-blur-sm">
          <div className="max-w-5xl mx-auto px-4 md:px-6 py-3 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-md bg-primary-100 flex items-center justify-center">
                <i className="ri-compass-3-line text-primary-500 text-sm"></i>
              </div>
              <h1 className="text-foreground-900 font-bold text-sm md:text-base whitespace-nowrap">
                今日受惠股｜{ds.reportDate}
              </h1>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-accent-100 text-accent-700 text-[10px] font-medium rounded-full border border-accent-200 whitespace-nowrap">
                <i className="ri-check-line text-[9px]"></i>
                依今日證據分層
              </span>
            </div>
          </div>
        </div>

        <div className="max-w-5xl mx-auto px-4 md:px-6 py-6 md:py-8 space-y-6 md:space-y-8">
          <section className="p-5 md:p-6 rounded-2xl bg-background-100 border border-background-200/70 space-y-5">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
              <div>
                <p className="text-primary-600 text-[11px] font-semibold tracking-[0.18em] uppercase mb-2">Opportunity Map</p>
                <h2 className="text-foreground-900 font-bold text-xl md:text-2xl">今日受惠股總覽</h2>
                <p className="text-foreground-500 text-sm leading-relaxed mt-2 max-w-2xl">
                  這頁不把所有股票混成一張清單，而是拆成三種判斷：證據足夠的強受惠、只能觀察的劇本，以及今天應排除的風險。
                </p>
              </div>
              <Link
                to="/member-note"
                onClick={() => trackEvent('click_member_note', { location: 'opportunities_header' })}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-sm font-semibold transition-colors whitespace-nowrap"
              >
                查看完整研究筆記
                <i className="ri-arrow-right-line"></i>
              </Link>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="p-4 rounded-xl bg-background-50 border border-background-200/70">
                <p className="text-foreground-400 text-[10px] uppercase tracking-wider mb-1">今天是否有強受惠股</p>
                <p className="text-foreground-900 font-bold text-lg">{hasStrongOpportunities ? `${strongOpportunityStocks.length} 檔` : '沒有'}</p>
              </div>
              <div className="p-4 rounded-xl bg-background-50 border border-background-200/70 md:col-span-1">
                <p className="text-foreground-400 text-[10px] uppercase tracking-wider mb-1">如果沒有，原因</p>
                <p className="text-foreground-700 text-xs leading-relaxed">{hasStrongOpportunities ? '正向證據已達門檻。' : pageQualityMessage}</p>
              </div>
              <div className="p-4 rounded-xl bg-background-50 border border-background-200/70">
                <p className="text-foreground-400 text-[10px] uppercase tracking-wider mb-1">主要觀察族群</p>
                <p className="text-foreground-900 font-bold text-sm leading-relaxed">{observationGroups.length > 0 ? observationGroups.join('、') : '尚未形成觀察族群'}</p>
              </div>
              <div className="p-4 rounded-xl bg-background-50 border border-background-200/70">
                <p className="text-foreground-400 text-[10px] uppercase tracking-wider mb-1">今天排除什麼</p>
                <p className="text-foreground-900 font-bold text-sm leading-relaxed">
                  {riskGroups.length > 0 ? riskGroups.join('、') : hasRiskOpportunities ? '未確認題材' : '尚無明確風險名單'}
                </p>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-foreground-900 font-bold text-base md:text-lg">強受惠股</h2>
                <p className="text-foreground-500 text-xs md:text-sm leading-relaxed">只有證據足夠、方向一致，才進入這一層。</p>
              </div>
              <span className="px-2 py-0.5 rounded-full bg-primary-100 text-primary-700 border border-primary-200 text-[10px]">{strongOpportunityStocks.length} 檔</span>
            </div>

            {hasStrongOpportunities ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {strongOpportunityStocks.slice(0, 6).map((stock) => (
                  <article key={`strong-${stock.symbol}-${stock.rank}`} className="p-4 rounded-2xl bg-background-100 border border-primary-200/70 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-foreground-900 font-bold text-sm">{stockTitle(stock)}</h3>
                        <p className="text-primary-700 text-[11px] mt-1">所屬劇本：{canonicalScriptHeadline || stockScriptName(stock)}</p>
                      </div>
                      <span className="px-2 py-0.5 rounded-full bg-primary-100 text-primary-700 border border-primary-200 text-[10px]">{confidenceLevelLabel(stock.confidenceLevel)}</span>
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                      <div className="p-3 rounded-xl bg-background-50 border border-background-200/70">
                        <p className="text-foreground-400 text-[10px] mb-1">為什麼入選</p>
                        <p className="text-foreground-800 text-xs leading-relaxed">{beneficiaryReason(stock)}</p>
                      </div>
                      <div className="p-3 rounded-xl bg-background-50 border border-background-200/70">
                        <p className="text-foreground-400 text-[10px] mb-1">今天怎麼驗證</p>
                        <p className="text-foreground-800 text-xs leading-relaxed">{confirmationNeeded(stock)}</p>
                      </div>
                      <div className="p-3 rounded-xl bg-background-50 border border-background-200/70">
                        <p className="text-foreground-400 text-[10px] mb-1">失效條件</p>
                        <p className="text-foreground-800 text-xs leading-relaxed">{stopCondition(stock)}</p>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="p-5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-700 text-sm leading-relaxed">
                {noStrongMessage}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-foreground-900 font-bold text-base md:text-lg">觀察名單</h2>
                <p className="text-foreground-500 text-xs md:text-sm leading-relaxed">可觀察，但不能追價；需要盤中證據補上。</p>
              </div>
              <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 text-[10px]">{observationOpportunityStocks.length} 檔</span>
            </div>

            {hasObservationOpportunities ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {observationOpportunityStocks.slice(0, 9).map((stock) => (
                  <article key={`observe-${stock.symbol}-${stock.rank}`} className="p-4 rounded-2xl bg-background-100 border border-amber-200/70 space-y-3">
                    <div>
                      <h3 className="text-foreground-900 font-bold text-sm">{stockTitle(stock)}</h3>
                      <p className="text-amber-700 text-[11px] mt-1">{canonicalScriptHeadline || stockScriptName(stock)}</p>
                    </div>
                    <div className="space-y-2">
                      <div>
                        <p className="text-foreground-400 text-[10px] mb-1">觀察原因</p>
                        <p className="text-foreground-800 text-xs leading-relaxed">{observationReason(stock)}</p>
                      </div>
                      <div>
                        <p className="text-foreground-400 text-[10px] mb-1">需要補上的條件</p>
                        <p className="text-foreground-800 text-xs leading-relaxed">{confirmationNeeded(stock)}</p>
                      </div>
                      <div>
                        <p className="text-foreground-400 text-[10px] mb-1">何時升級 / 降級</p>
                        <p className="text-foreground-800 text-xs leading-relaxed">{upgradeDowngradeText(stock)}</p>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="p-5 rounded-2xl bg-background-100 border border-background-200/70 text-foreground-500 text-sm">
                今日觀察名單尚未產生。
              </div>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-foreground-900 font-bold text-base md:text-lg">排除 / 風險名單</h2>
                <p className="text-foreground-500 text-xs md:text-sm leading-relaxed">這裡不是放空建議，而是今天不應誤判成強受惠的族群或標的。</p>
              </div>
              <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200 text-[10px]">{riskOpportunityStocks.length + legacyRiskNotes.length} 項</span>
            </div>

            {hasRiskOpportunities ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {riskOpportunityStocks.slice(0, 6).map((stock) => (
                  <article key={`risk-${stock.symbol}-${stock.rank}`} className="p-4 rounded-2xl bg-background-100 border border-red-200/70 space-y-3">
                    <div>
                      <h3 className="text-foreground-900 font-bold text-sm">{stockTitle(stock)}</h3>
                      <p className="text-red-700 text-[11px] mt-1">{canonicalScriptHeadline || stockScriptName(stock)}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {riskReasons(stock).map((reason) => (
                        <span key={reason} className="px-2 py-1 rounded-lg bg-red-50 border border-red-100 text-red-700 text-[11px]">{reason}</span>
                      ))}
                    </div>
                    <p className="text-foreground-600 text-xs leading-relaxed">{stopCondition(stock)}</p>
                  </article>
                ))}
                {legacyRiskNotes.map((note, index) => (
                  <article key={`legacy-risk-${index}`} className="p-4 rounded-2xl bg-background-100 border border-red-200/70 space-y-2">
                    <h3 className="text-foreground-900 font-bold text-sm">今日排除提醒</h3>
                    <p className="text-foreground-700 text-xs leading-relaxed">{renderSafeText(note)}</p>
                    <div className="flex flex-wrap gap-2">
                      <span className="px-2 py-1 rounded-lg bg-red-50 border border-red-100 text-red-700 text-[11px]">不列為強受惠股</span>
                      <span className="px-2 py-1 rounded-lg bg-red-50 border border-red-100 text-red-700 text-[11px]">等待市場確認</span>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="p-5 rounded-2xl bg-background-100 border border-background-200/70 text-foreground-500 text-sm">
                今日沒有明確排除名單；未被確認的題材仍不會列入強受惠股。
              </div>
            )}
          </section>

          <div className="flex justify-center pt-2 pb-4">
            <Link
              to="/member-note"
              onClick={() => trackEvent('click_member_note', { location: 'opportunities_bottom' })}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-primary-500 hover:bg-primary-600 text-white font-semibold text-sm rounded-xl transition-colors whitespace-nowrap"
            >
              <i className="ri-book-open-line"></i>
              查看完整研究筆記
            </Link>
          </div>

          <p className="text-foreground-300 text-[10px] text-center leading-relaxed">
            本平台提供市場資訊整理與情緒判讀參考，不構成投資建議。所有內容由 Morning Alpha 產生。
          </p>
        </div>
      </main>

      <Footer />
    </div>
  );
}


export default function Opportunities() {
  return (
    <ErrorBoundary fallbackTitle="今日主線地圖 暫時無法載入" fallbackMessage="資料讀取或畫面渲染時發生錯誤，請稍後再試。">
      <OpportunitiesContent />
    </ErrorBoundary>
  );
}

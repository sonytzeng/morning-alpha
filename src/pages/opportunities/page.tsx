import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '@/components/feature/Navbar';
import Footer from '@/components/feature/Footer';
import ErrorBoundary from '@/components/base/ErrorBoundary';
import { getMorningAlphaDisplayState, type MorningAlphaDisplayState } from '@/lib/morningAlphaDisplayState';
import { trackPageView } from '@/utils/analytics';
import { resolveActiveMorningAlphaReport } from '@/services/resolveActiveReport';
import { dedupePresentedOpportunities } from '@/lib/decisionPresentation';

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

function firstSentence(value: string | undefined, fallback: string): string {
  const text = value?.trim() || '';
  if (!text) return fallback;
  const sentence = text.match(/^.*?[。！？!?](?:\s|$)/)?.[0]?.trim() || text;
  return sentence.length > 76 ? `${sentence.slice(0, 75).trim()}…` : sentence;
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
function OpportunitiesContent() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ds, setDs] = useState<MorningAlphaDisplayState | null>(null);
  const [coreStocks, setCoreStocks] = useState<TierStock[]>([]);
  const [extendedStocks, setExtendedStocks] = useState<TierStock[]>([]);
  const [scenarioStocks, setScenarioStocks] = useState<TierStock[]>([]);
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
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-amber-400/20 bg-amber-500/10">
              <i className="ri-time-line text-amber-300 text-2xl"></i>
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

  const rawAI = (ds.rawAI || {}) as Record<string, unknown>;
  const v10BeneficiaryEnabled = rawAI.v10_beneficiary_enabled === true || rawAI.v10_beneficiary_enabled === 'true' || ds.v10BeneficiaryEnabled === true;
  const v10BeneficiaryStocks = mapV10OpportunityStocks(rawAI.today_beneficiary_stocks_v10 || ds.v10BeneficiaryStocks);
  const v10ObservationWatchlist = mapV10OpportunityStocks(rawAI.v10_observation_watchlist || ds.v10ObservationWatchlist);
  const strongOpportunityStocks = v10BeneficiaryEnabled
    ? v10BeneficiaryStocks
    : coreStocks.map((stock, index) => legacyToV10(stock, index, 'beneficiary'));
  const observationOpportunityStocks = v10BeneficiaryEnabled
    ? v10ObservationWatchlist
    : [...extendedStocks, ...scenarioStocks].map((stock, index) => legacyToV10(stock, index, 'observation'));
  const presentedStocks = dedupePresentedOpportunities(
    [...strongOpportunityStocks, ...observationOpportunityStocks] as unknown as Record<string, unknown>[],
    12,
  );

  return (
    <div className="ma-page flex flex-col overflow-x-hidden">
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
            </div>
          </div>
        </div>

        <div className="max-w-5xl mx-auto px-4 md:px-6 py-6 md:py-8 space-y-6 md:space-y-8">
          <section className="ma-card-elevated">
            <div>
              <p className="text-xs font-semibold text-foreground-400">今日股票</p>
              <h2 className="mt-2 text-foreground-900 font-bold text-2xl md:text-3xl">如果條件成立，要看誰？</h2>
              <p className="text-foreground-500 text-sm leading-relaxed mt-2 max-w-2xl">每檔只保留今天需要的理由、確認與取消條件。</p>
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-foreground-900 font-bold text-base md:text-lg">今天要確認的股票</h2>
              <span className="px-2 py-0.5 rounded-full bg-primary-100 text-primary-700 border border-primary-200 text-[10px]">{presentedStocks.length} 檔</span>
            </div>

            {presentedStocks.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {presentedStocks.map((stock) => (
                  <article key={`${stock.symbol}-${stock.name}`} className="ma-card-compact">
                    <h3 className="text-foreground-900 font-bold text-base">{stock.symbol} {stock.name}</h3>
                    <div className="mt-4 space-y-3 text-xs leading-relaxed">
                      <div><p className="font-semibold text-foreground-400">今天理由</p><p className="mt-1 text-foreground-700">{firstSentence(stock.oneLineReason, '理由尚未完整。')}</p></div>
                      <div><p className="font-semibold text-foreground-400">今天確認</p><p className="mt-1 text-foreground-700">{firstSentence(stock.confirmation, '確認訊號尚未提供。')}</p></div>
                      <div><p className="font-semibold text-foreground-400">取消條件</p><p className="mt-1 text-rose-100/80">{firstSentence(stock.invalidation, '取消條件尚未提供。')}</p></div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-amber-400/20 bg-amber-500/[0.06] p-5 text-sm leading-relaxed text-amber-200">
                今日尚無可顯示的股票理由。
              </div>
            )}
          </section>

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

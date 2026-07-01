import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '@/components/feature/Navbar';
import Footer from '@/components/feature/Footer';
import ErrorBoundary from '@/components/base/ErrorBoundary';
import { getMorningAlphaDisplayState, type MorningAlphaDisplayState } from '@/lib/morningAlphaDisplayState';
import { renderSafeText } from '@/utils/renderSafe';
import { trackPageView, trackEvent } from '@/utils/analytics';
import { resolveActiveMorningAlphaReport } from '@/services/resolveActiveReport';
import { parseAIStrategy, type V8BeneficiaryChain } from '@/utils/aiStrategyParser';
import type { Report } from '@/types/report';
import BeneficiaryChainCard from '@/components/v8/BeneficiaryChainCard';
import PaywallCard from '@/components/paywall/PaywallCard';
import { getCurrentEntitlement, hasFeature } from '@/services/entitlementService';
import type { UserEntitlement } from '@/types/subscription';

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
  if (level === 'high') return { label: '高信心', cls: 'bg-primary-100 text-primary-700 border-primary-200', dot: 'bg-primary-500' };
  if (level === 'medium') return { label: '中信心', cls: 'bg-accent-100 text-accent-700 border-accent-200', dot: 'bg-accent-500' };
  return { label: '低信心', cls: 'bg-secondary-100 text-secondary-700 border-secondary-200', dot: 'bg-secondary-400' };
}

function levelBadge(level: string) {
  if (level === 'core') return { label: '核心受惠', cls: 'bg-primary-100 text-primary-700 border-primary-300', dot: 'bg-primary-500' };
  if (level === 'extended') return { label: '延伸觀察', cls: 'bg-accent-100 text-accent-700 border-accent-300', dot: 'bg-accent-500' };
  return { label: '情境觀察', cls: 'bg-secondary-100 text-secondary-700 border-secondary-200', dot: 'bg-secondary-400' };
}

// ═══════════════════════════════════════════════════
function OpportunitiesContent() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ds, setDs] = useState<MorningAlphaDisplayState | null>(null);
  const [coreStocks, setCoreStocks] = useState<TierStock[]>([]);
  const [extendedStocks, setExtendedStocks] = useState<TierStock[]>([]);
  const [scenarioStocks, setScenarioStocks] = useState<TierStock[]>([]);
  const [dataStatus, setDataStatus] = useState<string>('');
  const [dataBasisNote, setDataBasisNote] = useState<string>('');
  const [doNotDoList, setDoNotDoList] = useState<string[]>([]);
  const [invalidationItems, setInvalidationItems] = useState<string[]>([]);
  const [isHistoricalFallback, setIsHistoricalFallback] = useState(false);
  const [fallbackReportDate, setFallbackReportDate] = useState<string | null>(null);
  const [v8BeneficiaryChain, setV8BeneficiaryChain] = useState<V8BeneficiaryChain | null>(null);
  const [entitlement, setEntitlement] = useState<UserEntitlement | null>(null);

  useEffect(() => {
    trackPageView('/opportunities');
    async function load() {
      try {
        setLoading(true);
        const resolved = await resolveActiveMorningAlphaReport();
        const report = resolved.rawRow;

        if (!report) { setDs(null); setV8BeneficiaryChain(null); return; }

        const displayState = getMorningAlphaDisplayState(report as Record<string, unknown> | null);
        setDs(displayState);
        setIsHistoricalFallback(resolved.isHistoricalFallback);
        setFallbackReportDate(resolved.fallbackReportDate);

        if (displayState.isMarketClosed || displayState.marketStatus !== 'trading' || resolved.isHistoricalFallback) {
          setCoreStocks([]);
          setExtendedStocks([]);
          setScenarioStocks([]);
          setV8BeneficiaryChain(null);
          setDataStatus(resolved.isHistoricalFallback ? 'historical_fallback' : 'insufficient');
          setDataBasisNote(resolved.isHistoricalFallback ? `上一份報告日期：${resolved.fallbackReportDate || displayState.reportDate}` : '今日非交易日，不產生今日受惠股。');
          return;
        }

        // V9.0/V8 preview: V8 ready wins; otherwise fall back to real V7 beneficiary fields.
        const ai = displayState.rawAI || {};
        const parsed = parseAIStrategy(report as unknown as Report);
        const legacyBeneficiaries = resolveLegacyBeneficiaries(ai, report as Record<string, unknown>);
        setV8BeneficiaryChain(parsed.v8_beneficiary_chain);
        const dStatus = String(ai.data_status || displayState.dataStatus || '');

        setCoreStocks(legacyBeneficiaries.coreStocks);
        setExtendedStocks(legacyBeneficiaries.extendedStocks);
        setScenarioStocks(legacyBeneficiaries.scenarioStocks);
        setDataStatus(dStatus);
        setDataBasisNote(String(ai.data_basis_note || displayState.dataBasisNote || ''));

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

  useEffect(() => {
    // Do not treat frontend gating as data security.
    getCurrentEntitlement().then(setEntitlement).catch(() => setEntitlement(null));
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
  if (ds.isMarketClosed || ds.marketStatus !== 'trading') {
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
  const hasV8BeneficiaryChain = v8BeneficiaryChain?.status === 'ready' && (v8BeneficiaryChain.beneficiaries || []).length > 0;
  const hasAnyBeneficiaryStock = hasAnyStocks || hasV8BeneficiaryChain;
  const coreDisplayCount = hasV8BeneficiaryChain ? (v8BeneficiaryChain?.beneficiaries || []).length : coreStocks.length;
  const watchDisplayCount = hasV8BeneficiaryChain ? 0 : extendedStocks.length + scenarioStocks.length;
  const confidenceText = ds.confidenceScore != null && ds.confidenceScore > 0
    ? `${ds.confidenceScore}/100`
    : '待驗證';
  const canViewOpportunitiesFull = hasFeature(entitlement, 'opportunities_full');
  const teaserStock = coreStocks[0] || extendedStocks[0] || scenarioStocks[0] || null;

  return (
    <div className="min-h-screen bg-background-50 flex flex-col overflow-x-hidden">
      <Navbar />

      <main className="flex-1 overflow-x-hidden">
        {/* ══════════ HEADER ══════════ */}
        <div className="border-b border-background-200/70 bg-background-100/80 backdrop-blur-sm">
          <div className="max-w-5xl mx-auto px-4 md:px-6 py-3 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-md bg-primary-100 flex items-center justify-center">
                <i className="ri-compass-3-line text-primary-500 text-sm"></i>
              </div>
              <h1 className="text-foreground-900 font-bold text-sm md:text-base whitespace-nowrap">
                今日主線地圖｜{ds.reportDate}
              </h1>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-accent-100 text-accent-700 text-[10px] font-medium rounded-full border border-accent-200 whitespace-nowrap">
                <i className="ri-check-line text-[9px]"></i>
                盤前資料已同步
              </span>
            </div>
          </div>
        </div>

        <div className="max-w-5xl mx-auto px-4 md:px-6 py-6 md:py-8 space-y-6 md:space-y-8">

          {/* ══════════ DATA BASIS + TODAY QUOTE ══════════ */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="p-3 rounded-xl bg-background-100 border border-background-200/70">
                <p className="text-foreground-400 text-[10px] uppercase tracking-wider mb-1">今日方向</p>
                <p className="text-foreground-900 font-bold text-sm">{ds.marketBias}</p>
              </div>
              <div className="p-3 rounded-xl bg-background-100 border border-background-200/70">
                <p className="text-foreground-400 text-[10px] uppercase tracking-wider mb-1">把握度</p>
                <p className="text-foreground-900 font-bold text-sm">{confidenceText}</p>
              </div>
              <div className="p-3 rounded-xl bg-background-100 border border-background-200/70">
                <p className="text-foreground-400 text-[10px] uppercase tracking-wider mb-1">核心受惠</p>
                <p className="text-foreground-900 font-bold text-sm">{coreDisplayCount} 檔</p>
              </div>
              <div className="p-3 rounded-xl bg-background-100 border border-background-200/70">
                <p className="text-foreground-400 text-[10px] uppercase tracking-wider mb-1">觀察名單</p>
                <p className="text-foreground-900 font-bold text-sm">{watchDisplayCount} 檔</p>
              </div>
            </div>

            {ds.todayQuote && (
              <div className="p-4 rounded-xl bg-accent-50 border border-accent-200/70">
                <p className="text-accent-700 text-sm leading-relaxed">{renderSafeText(ds.todayQuote)}</p>
              </div>
            )}

            {dataBasisNote && (
              <div className="flex items-start gap-2 px-1">
                <i className="ri-information-line text-foreground-300 text-xs mt-0.5"></i>
                <p className="text-foreground-400 text-[10px] leading-relaxed">{dataBasisNote}</p>
              </div>
            )}
          </div>

          {hasV8BeneficiaryChain && canViewOpportunitiesFull && (
            <BeneficiaryChainCard chain={v8BeneficiaryChain} tone="light" />
          )}

          {!hasAnyBeneficiaryStock && (
            <section className="p-6 rounded-2xl bg-background-100 border border-background-200/70 text-center">
              <div className="w-12 h-12 rounded-xl bg-background-50 flex items-center justify-center mx-auto mb-3">
                <i className="ri-focus-3-line text-foreground-300 text-xl"></i>
              </div>
              <h2 className="text-foreground-900 font-bold text-base mb-2">今日受惠股名單尚未產生</h2>
              <p className="text-foreground-500 text-sm leading-relaxed">
                請等待盤前報告或盤中雷達更新。
              </p>
            </section>
          )}

          {!canViewOpportunitiesFull && hasAnyBeneficiaryStock && (
            <section className="space-y-4">
              {teaserStock && (
                <div className="p-5 rounded-2xl bg-background-100 border border-background-200/70">
                  <p className="text-foreground-400 text-[10px] uppercase tracking-wider mb-2">免費觀察股</p>
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <span className="text-foreground-900 font-bold text-base">{[teaserStock.stock_id, teaserStock.stock_name].filter(Boolean).join(' ')}</span>
                    {teaserStock.sector && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent-100 text-accent-700 border border-accent-200">{teaserStock.sector}</span>
                    )}
                  </div>
                  <p className="text-foreground-500 text-xs leading-relaxed">
                    免費版僅提供一檔公開觀察股與今日追蹤數量；完整推理鏈、驗證訊號與失效條件保留在會員版。
                  </p>
                </div>
              )}
              <PaywallCard
                title="升級會員查看完整受惠股地圖"
                description={`今日共追蹤 ${coreDisplayCount + watchDisplayCount} 檔。完整名單、個股受惠原因、盤中驗證訊號、失效條件與來源訊號已收在會員版。`}
                requiredTier="member"
                featureList={['完整受惠股名單', '第一受惠股推理鏈', '盤中驗證與失效條件']}
                tone="light"
              />
            </section>
          )}

          {/* ══════════ INSUFFICIENT DATA WARNING ══════════ */}
          {canViewOpportunitiesFull && !hasV8BeneficiaryChain && dataStatus === 'insufficient' && !hasAnyStocks && (
            <div className="p-6 rounded-2xl bg-amber-50 border border-amber-200 text-center">
              <div className="w-12 h-12 rounded-xl bg-background-100 flex items-center justify-center mx-auto mb-3">
                <i className="ri-database-2-line text-amber-500/70 text-xl"></i>
              </div>
              <h2 className="text-foreground-900 font-bold text-base mb-2">今日資料不足</h2>
              <p className="text-foreground-500 text-sm leading-relaxed max-w-lg mx-auto">{dataBasisNote || '今日海外市場資料不足，僅提供核心觀察股，不擴充延伸名單。'}</p>
            </div>
          )}

          {/* ══════════ SECTION 1: 核心受惠股 ══════════ */}
          {canViewOpportunitiesFull && !hasV8BeneficiaryChain && hasCore && (
            <section>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-lg bg-primary-100 border border-primary-200 flex items-center justify-center">
                  <i className="ri-star-fill text-primary-500 text-sm"></i>
                </div>
                <div>
                  <h2 className="text-foreground-900 font-bold text-base">核心受惠股</h2>
                  <p className="text-foreground-400 text-xs">與昨夜美股／國際事件直接相關，產業鏈關聯明確</p>
                </div>
                <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 bg-primary-100 text-primary-700 text-[10px] font-medium rounded-full border border-primary-200">{coreStocks.length} 檔</span>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {coreStocks.map((stock, idx) => {
                  const conf = stock.has_confidence ? confidenceBadge(stock.confidence_level || 'low') : null;
                  const lvl = levelBadge(stock.beneficiary_level);
                  return (
                    <div key={idx} className="p-4 rounded-xl bg-background-100 border border-primary-200/70 flex flex-col">
                      {/* Header */}
                      <div className="flex items-center gap-2 mb-3 flex-wrap">
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${lvl.cls}`}>
                          <span className={`w-1 h-1 rounded-full ${lvl.dot}`}></span>
                          {lvl.label}
                        </span>
                        <span className="text-foreground-900 font-bold text-sm whitespace-nowrap">{[stock.stock_id, stock.stock_name].filter(Boolean).join(' ')}</span>
                        {conf && (
                          <span className={`ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium border ${conf.cls}`}>
                            <span className={`w-1 h-1 rounded-full ${conf.dot}`}></span>
                            {conf.label}
                          </span>
                        )}
                      </div>

                      {/* Sector */}
                      {stock.sector && (
                        <span className="text-foreground-400 text-[10px] uppercase tracking-wider mb-2">{stock.sector}</span>
                      )}

                      {/* Trigger */}
                      {stock.trigger_event && (
                        <div className="mb-3 p-2 rounded-lg bg-primary-50 border border-primary-100">
                          <p className="text-primary-700 text-[10px] uppercase tracking-wider mb-0.5">觸發事件</p>
                          <p className="text-foreground-900 text-xs leading-relaxed">{stock.trigger_event}</p>
                        </div>
                      )}

                      {/* Reason */}
                      {stock.reason && (
                        <div className="mb-3">
                          <p className="text-foreground-400 text-[10px] uppercase tracking-wider mb-0.5">受惠邏輯</p>
                          <p className="text-foreground-700 text-xs leading-relaxed">{stock.reason}</p>
                        </div>
                      )}

                      {stock.validation_signal && (
                        <div className="mb-3">
                          <p className="text-foreground-400 text-[10px] uppercase tracking-wider mb-0.5">盤中驗證</p>
                          <p className="text-foreground-700 text-xs leading-relaxed">{stock.validation_signal}</p>
                        </div>
                      )}

                      {/* Risk */}
                      {stock.risk_note && (
                        <div className="mb-3 p-2 rounded-lg bg-red-50 border border-red-100">
                          <p className="text-red-600 text-[10px] uppercase tracking-wider mb-0.5">風險提醒</p>
                          <p className="text-red-700/80 text-xs leading-relaxed">{stock.risk_note}</p>
                        </div>
                      )}

                      {/* Data basis */}
                      {stock.data_basis && (
                        <div className="mt-auto pt-3 border-t border-background-200/70">
                          <span className="inline-flex items-center gap-1 text-foreground-300 text-[9px]">
                            <i className="ri-database-2-line text-[8px]"></i>
                            {stock.data_basis}
                          </span>
                          {stock.source_signals && (
                            <p className="mt-1 text-foreground-300 text-[9px] leading-relaxed">來源訊號：{stock.source_signals}</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ══════════ SECTION 2: 延伸觀察股 ══════════ */}
          {canViewOpportunitiesFull && !hasV8BeneficiaryChain && hasExtended && (
            <section>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-lg bg-accent-100 border border-accent-200 flex items-center justify-center">
                  <i className="ri-stack-line text-accent-500 text-sm"></i>
                </div>
                <div>
                  <h2 className="text-foreground-900 font-bold text-base">延伸觀察股</h2>
                  <p className="text-foreground-400 text-xs">同一產業鏈上下游，關聯合理但強度低於核心</p>
                </div>
                <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 bg-accent-100 text-accent-700 text-[10px] font-medium rounded-full border border-accent-200">{extendedStocks.length} 檔</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {extendedStocks.map((stock, idx) => {
                  const conf = stock.has_confidence ? confidenceBadge(stock.confidence_level || 'low') : null;
                  const lvl = levelBadge(stock.beneficiary_level);
                  return (
                    <div key={idx} className="p-3 rounded-xl bg-background-100 border border-background-200/70 flex flex-col">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium border ${lvl.cls}`}>
                          <span className={`w-1 h-1 rounded-full ${lvl.dot}`}></span>
                          {lvl.label}
                        </span>
                        <span className="text-foreground-900 font-bold text-xs whitespace-nowrap">{[stock.stock_id, stock.stock_name].filter(Boolean).join(' ')}</span>
                        {conf && (
                          <span className={`ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium border ${conf.cls}`}>
                            <span className={`w-1 h-1 rounded-full ${conf.dot}`}></span>
                            {conf.label}
                          </span>
                        )}
                      </div>
                      {stock.sector && <span className="text-foreground-400 text-[9px] uppercase tracking-wider mb-1.5">{stock.sector}</span>}
                      {stock.reason && <p className="text-foreground-500 text-[11px] leading-relaxed mb-2">{stock.reason}</p>}
                      {stock.validation_signal && <p className="text-foreground-500 text-[10px] leading-relaxed mb-2"><span className="text-foreground-400">驗證：</span>{stock.validation_signal}</p>}
                      {stock.risk_note && <p className="text-red-500/70 text-[10px] leading-relaxed mb-2"><span className="text-red-400/60">風險：</span>{stock.risk_note}</p>}
                      {stock.data_basis && (
                        <div className="mt-auto pt-2 border-t border-background-200/50">
                          <span className="inline-flex items-center gap-1 text-foreground-300 text-[8px]"><i className="ri-database-2-line text-[7px]"></i>{stock.data_basis}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ══════════ SECTION 3: 情境觀察股 ══════════ */}
          {canViewOpportunitiesFull && !hasV8BeneficiaryChain && hasScenario && (
            <section>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-lg bg-secondary-100 border border-secondary-200 flex items-center justify-center">
                  <i className="ri-radar-line text-secondary-500 text-sm"></i>
                </div>
                <div>
                  <h2 className="text-foreground-900 font-bold text-base">情境觀察股</h2>
                  <p className="text-foreground-400 text-xs">僅在特定市場條件成立時才觀察</p>
                </div>
                <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 bg-secondary-100 text-secondary-700 text-[10px] font-medium rounded-full border border-secondary-200">{scenarioStocks.length} 檔</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {scenarioStocks.map((stock, idx) => {
                  const conf = stock.has_confidence ? confidenceBadge(stock.confidence_level || 'low') : null;
                  const lvl = levelBadge(stock.beneficiary_level);
                  return (
                    <div key={idx} className="p-3 rounded-xl bg-background-100 border border-secondary-200/70 flex flex-col">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium border ${lvl.cls}`}>
                          <span className={`w-1 h-1 rounded-full ${lvl.dot}`}></span>
                          {lvl.label}
                        </span>
                        <span className="text-foreground-900 font-bold text-xs whitespace-nowrap">{[stock.stock_id, stock.stock_name].filter(Boolean).join(' ')}</span>
                        {conf && (
                          <span className={`ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium border ${conf.cls}`}>
                            <span className={`w-1 h-1 rounded-full ${conf.dot}`}></span>
                            {conf.label}
                          </span>
                        )}
                      </div>
                      {/* Trigger event as the main highlight for scenario stocks */}
                      {stock.trigger_event && (
                        <div className="mb-2 p-2 rounded-lg bg-secondary-50 border border-secondary-100">
                          <p className="text-secondary-700 text-[10px] uppercase tracking-wider mb-0.5">情境條件</p>
                          <p className="text-foreground-700 text-[10px] leading-relaxed">{stock.trigger_event}</p>
                        </div>
                      )}
                      {stock.reason && <p className="text-foreground-500 text-[10px] leading-relaxed mb-1.5">{stock.reason}</p>}
                      {stock.validation_signal && <p className="text-foreground-500 text-[9px] leading-relaxed mb-1.5"><span className="text-foreground-400">驗證：</span>{stock.validation_signal}</p>}
                      {stock.risk_note && <p className="text-red-500/70 text-[9px] leading-relaxed"><span className="text-red-400/60">失效：</span>{stock.risk_note}</p>}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ══════════ SECTION 4: 今日不追高提醒 ══════════ */}
          {canViewOpportunitiesFull && (doNotDoList.length > 0 || invalidationItems.length > 0) && (
            <section className="p-5 md:p-6 rounded-2xl bg-background-100 border border-amber-200/70">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-lg bg-amber-100 border border-amber-200 flex items-center justify-center">
                  <i className="ri-alert-line text-amber-600 text-sm"></i>
                </div>
                <h2 className="text-foreground-900 font-bold text-base">今日不追高提醒</h2>
              </div>
              <div className="space-y-3">
                {doNotDoList.slice(0, 5).map((item, idx) => (
                  <div key={idx} className="flex items-start gap-3 p-3 rounded-xl bg-background-50 border border-amber-100">
                    <div className="w-6 h-6 rounded-md bg-amber-100 border border-amber-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <i className="ri-close-line text-amber-600 text-xs"></i>
                    </div>
                    <p className="text-foreground-700 text-sm leading-relaxed">{renderSafeText(item)}</p>
                  </div>
                ))}
              </div>
              {invalidationItems.length > 0 && (
                <div className="mt-4 pt-4 border-t border-background-200/70">
                  <p className="text-red-500/60 text-[10px] uppercase tracking-wider mb-2">失效條件提醒</p>
                  {invalidationItems.slice(0, 3).map((item, idx) => (
                    <div key={idx} className="flex items-start gap-2 mb-1.5">
                      <span className="text-red-400/40 text-[10px] mt-0.5">{idx + 1}.</span>
                      <span className="text-red-500/70 text-xs leading-relaxed">{renderSafeText(item)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* ══════════ EMPTY STATE ══════════ */}
          {canViewOpportunitiesFull && !hasV8BeneficiaryChain && !hasAnyStocks && dataStatus !== 'insufficient' && (
            <section className="p-6 rounded-2xl bg-background-100 border border-background-200/70 text-center">
              <div className="w-12 h-12 rounded-xl bg-background-50 flex items-center justify-center mx-auto mb-3">
                <i className="ri-focus-3-line text-foreground-300 text-xl"></i>
              </div>
              <h2 className="text-foreground-900 font-bold text-base mb-2">今日受惠股名單尚未產生</h2>
              <p className="text-foreground-500 text-sm leading-relaxed">請等待盤前報告或盤中雷達更新。</p>
            </section>
          )}

          {/* ══════════ BOTTOM NAV ══════════ */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 justify-center pt-2 pb-4">
            <Link to="/report/today" onClick={() => trackEvent('click_today_report', { location: 'opportunities' })} className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-primary-500 hover:bg-primary-600 text-white font-semibold text-sm rounded-xl transition-colors whitespace-nowrap">
              <i className="ri-file-text-line"></i>查看今日判斷
            </Link>
            <Link to="/member-note" className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-accent-100 hover:bg-accent-200 text-accent-700 text-sm rounded-xl transition-colors border border-accent-200 whitespace-nowrap">
              <i className="ri-book-open-line"></i>查看完整研究筆記
            </Link>
            <Link to="/" className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-background-100 hover:bg-background-200 text-foreground-700 text-sm rounded-xl transition-colors border border-background-200/70 whitespace-nowrap">
              <i className="ri-home-line"></i>返回首頁
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

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '@/components/feature/Navbar';
import Footer from '@/components/feature/Footer';
import { supabase } from '@/lib/supabase';

type ReportRecord = {
  id: string;
  report_date: string;
  market_bias: string | null;
  confidence_score: number | null;
  created_at: string | null;
  updated_at: string | null;
  ai_strategy_json: Record<string, unknown> | null;
};

type VerificationStatus = 'hit' | 'partial' | 'miss' | 'pending';

type PerformanceItem = {
  id: string;
  reportDate: string;
  openingBias: string;
  actualDirection: string;
  status: VerificationStatus;
  confidenceScore: number | null;
  dataQuality: string;
  firstBeneficiary: {
    symbol: string;
    name: string;
    performanceText: string;
    beatTaiexText: string;
    statusText: string;
  } | null;
  thesisText: string;
  beneficiaryReasoning: string;
  whatWasRight: string[];
  whatWasWrong: string[];
  tomorrowAdjustment: string[];
  hasMemberNote: boolean;
  hasClosingVerificationV2: boolean;
};

type SummaryStats = {
  verifiedDays: number;
  hit: number;
  partial: number;
  miss: number;
  pending: number;
  degraded: number;
  hitRate: number | null;
  partialIncludedRate: number | null;
};

const STATUS_LABEL: Record<VerificationStatus, string> = {
  hit: '命中',
  partial: '部分成立',
  miss: '失準',
  pending: '待驗證',
};

const STATUS_CLASS: Record<VerificationStatus, string> = {
  hit: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200',
  partial: 'border-amber-300/40 bg-amber-300/10 text-amber-100',
  miss: 'border-rose-400/40 bg-rose-400/10 text-rose-100',
  pending: 'border-white/15 bg-white/8 text-white/65',
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function listFromUnknown(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item.trim();
        const record = asRecord(item);
        return firstText(record?.title, record?.content, record?.note, record?.summary, record?.text);
      })
      .filter(Boolean);
  }
  const text = firstText(value);
  return text ? [text] : [];
}

function normalizeStatus(value: unknown): VerificationStatus {
  const raw = String(value || '').toLowerCase();
  if (['hit', 'correct', 'confirmed', 'success'].includes(raw)) return 'hit';
  if (['partial', 'mixed', 'partially_confirmed'].includes(raw)) return 'partial';
  if (['miss', 'wrong', 'failed'].includes(raw)) return 'miss';
  return 'pending';
}

function humanizeVerificationText(value: unknown): string {
  const raw = String(value || '').toLowerCase();
  if (!raw) return '資料不足，尚未納入統計';
  if (['hit', 'correct', 'confirmed', 'success', 'true'].includes(raw)) return raw === 'true' ? '符合推論' : '命中';
  if (['partial', 'mixed', 'partially_confirmed'].includes(raw)) return '部分成立';
  if (['miss', 'wrong', 'failed', 'false'].includes(raw)) return raw === 'false' ? '未符合盤前推論' : '失準';
  if (['pending', 'pending_real_market_data'].includes(raw)) return '待驗證';
  if (raw.includes('degraded')) return '資料不完整';
  return String(value || '資料不足，尚未納入統計');
}

function directionFromChange(change: number | null): string {
  if (change === null) return '等待收盤資料';
  if (change >= 0.3) return '上漲';
  if (change <= -0.3) return '下跌';
  return '震盪';
}

function formatPercent(value: number | null): string {
  if (value === null) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function formatRate(value: number | null): string {
  if (value === null) return '—';
  return `${Math.round(value * 100)}%`;
}

function formatDataQuality(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized.includes('complete')) return '資料已完成';
  if (normalized.includes('degraded')) return '資料不完整';
  if (normalized.includes('partial')) return '部分完成';
  if (normalized.includes('pending')) return '待驗證';
  if (normalized.includes('unknown')) return '待確認';
  return value || '待確認';
}

function getFirstBeneficiary(ai: Record<string, unknown>, memberNote: Record<string, unknown> | null) {
  const closing = asRecord(ai.closing_verification_v2);
  const validation = asRecord(closing?.first_beneficiary_validation);
  const noteFirst = asRecord(memberNote?.first_beneficiary_stock);
  const candidates = [
    validation?.predicted_stock,
    validation?.stock,
    noteFirst,
    ...asArray(ai.today_beneficiary_stocks),
    ...asArray(ai.beneficiary_stocks),
  ];

  for (const candidate of candidates) {
    const record = asRecord(candidate);
    if (!record) continue;
    const symbol = firstText(record.symbol, record.ticker, record.stock_symbol);
    const name = firstText(record.name, record.stock_name, record.company);
    if (symbol || name) return { symbol, name, record, validation };
  }

  return null;
}

function buildPerformanceItem(row: ReportRecord): PerformanceItem {
  const ai = row.ai_strategy_json || {};
  const closingV2 = asRecord(ai.closing_verification_v2);
  const closingLegacy = asRecord(ai.closing_verification);
  const closing = closingV2 || closingLegacy || null;
  const memberNote = asRecord(ai.member_research_note_v2);

  const actualTaiexChange = firstNumber(
    closing?.actual_taiex_change,
    asRecord(closing?.actual_taiex_close)?.change_percent,
    asRecord(closing?.actual_taiex_close)?.change,
  );

  const firstBeneficiary = getFirstBeneficiary(ai, memberNote);
  const validation = firstBeneficiary?.validation || null;
  const firstChange = firstNumber(validation?.close_change_percent, validation?.actual_change_percent, validation?.return_percent);
  const beatTaiex = validation?.outperformed_taiex;

  return {
    id: row.id,
    reportDate: row.report_date,
    openingBias: firstText(closing?.opening_bias, closing?.predicted_bias, row.market_bias, ai.market_bias) || '待判斷',
    actualDirection: firstText(closing?.actual_direction) || directionFromChange(actualTaiexChange),
    status: normalizeStatus(closing?.hit_or_miss || closing?.prediction_result || closing?.status),
    confidenceScore: firstNumber(closing?.opening_confidence, closing?.predicted_confidence, row.confidence_score, ai.confidence_score),
    dataQuality: firstText(closing?.data_status, ai.data_quality, ai.data_status, memberNote?.data_status) || 'unknown',
    firstBeneficiary: firstBeneficiary
      ? {
          symbol: firstBeneficiary.symbol,
          name: firstBeneficiary.name,
          performanceText: firstChange === null ? '資料不足' : formatPercent(firstChange),
          beatTaiexText: typeof beatTaiex === 'boolean'
            ? (beatTaiex ? '跑贏 TAIEX' : '未跑贏 TAIEX')
            : firstText(validation?.relative_result, validation?.beat_taiex_status) || '資料不足，尚未納入統計',
          statusText: humanizeVerificationText(firstText(validation?.status, validation?.verification_status, validation?.result)),
        }
      : null,
    thesisText: firstText(
      asRecord(memberNote?.opening_thesis)?.summary,
      asRecord(memberNote?.today_core_thesis)?.summary,
      memberNote?.today_core_thesis,
      memberNote?.opening_thesis,
      ai.today_quote,
      ai.summary,
    ) || '舊版報告，研究筆記結構不足',
    beneficiaryReasoning: firstText(
      asRecord(memberNote?.first_beneficiary_stock)?.why_this_stock,
      asRecord(memberNote?.first_beneficiary_stock)?.reasoning,
      memberNote?.beneficiary_reasoning,
      asRecord(memberNote?.beneficiary_reasoning_chain)?.summary,
    ) || '舊版報告，研究筆記結構不足',
    whatWasRight: listFromUnknown(closing?.what_was_right),
    whatWasWrong: listFromUnknown(closing?.what_was_wrong),
    tomorrowAdjustment: listFromUnknown(closing?.tomorrow_adjustment),
    hasMemberNote: Boolean(memberNote),
    hasClosingVerificationV2: Boolean(closingV2),
  };
}

function calculateSummary(items: PerformanceItem[]): SummaryStats {
  const verified = items.filter((item) => item.status !== 'pending');
  const hit = verified.filter((item) => item.status === 'hit').length;
  const partial = verified.filter((item) => item.status === 'partial').length;
  const miss = verified.filter((item) => item.status === 'miss').length;
  const pending = items.filter((item) => item.status === 'pending').length;
  const degraded = items.filter((item) => item.dataQuality.toLowerCase().includes('degraded')).length;

  return {
    verifiedDays: verified.length,
    hit,
    partial,
    miss,
    pending,
    degraded,
    hitRate: verified.length > 0 ? hit / verified.length : null,
    partialIncludedRate: verified.length > 0 ? (hit + partial) / verified.length : null,
  };
}

function StatCard({ label, value, helper }: { label: string; value: string | number; helper?: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
      <div className="text-xs text-white/45">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
      {helper ? <div className="mt-1 text-xs text-white/35">{helper}</div> : null}
    </div>
  );
}

function DetailList({ title, items, emptyText }: { title: string; items: string[]; emptyText: string }) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-white">{title}</h4>
      {items.length > 0 ? (
        <ul className="mt-2 space-y-2 text-sm text-white/65">
          {items.map((item, index) => (
            <li key={`${title}-${index}`} className="flex gap-2">
              <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-sky-300/70" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-white/40">{emptyText}</p>
      )}
    </div>
  );
}

export default function PerformancePage() {
  const [items, setItems] = useState<PerformanceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadReports() {
      setLoading(true);
      setErrorMessage('');

      const { data, error } = await supabase
        .from('reports')
        .select('id, report_date, market_bias, confidence_score, ai_strategy_json, created_at, updated_at')
        .order('report_date', { ascending: false })
        .limit(30);

      if (!mounted) return;

      if (error) {
        const message = error.message || '';
        const isRlsBlocked = error.code === '42501' || /permission denied|row level security|rls/i.test(message);
        console.warn(isRlsBlocked ? 'PERFORMANCE_REPORTS_RLS_BLOCKED' : 'PERFORMANCE_REPORTS_QUERY_FAILED', message);
        setItems([]);
        setErrorMessage(
          isRlsBlocked
            ? '歷史績效資料目前需要登入會員權限。公開頁仍保留摘要，完整 30 日績效中心會在會員權限下顯示。'
            : '歷史績效資料暫時無法載入，請稍後再試。',
        );
        setLoading(false);
        return;
      }

      const normalized = ((data || []) as ReportRecord[]).map(buildPerformanceItem);
      setItems(normalized);
      setLoading(false);
    }

    loadReports();
    return () => {
      mounted = false;
    };
  }, []);

  const summary = useMemo(() => calculateSummary(items), [items]);

  return (
    <div className="min-h-screen bg-[#07111f] text-white">
      <Navbar />
      <main className="mx-auto w-full max-w-7xl px-4 py-8 md:px-6 md:py-12">
        <section className="rounded-lg border border-white/10 bg-gradient-to-br from-sky-500/12 via-white/[0.04] to-emerald-400/8 p-5 md:p-8">
          <div className="max-w-3xl">
            <p className="text-sm font-medium text-sky-200/80">歷史預測與績效中心</p>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white md:text-4xl">
              歷史預測與績效中心
            </h1>
            <p className="mt-4 text-sm leading-7 text-white/65 md:text-base">
              回看 Morning Alpha 過去每天的盤前方向、收盤驗證與第一受惠股表現。這裡不美化結果，也不把待驗證算成失誤；只把已驗證的天數誠實攤開。
            </p>
          </div>
        </section>

        <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="已驗證天數" value={summary.verifiedDays} helper="待驗證不納入分母" />
          <StatCard label="命中率" value={formatRate(summary.hitRate)} helper={`${summary.hit} 命中 / ${summary.miss} 失準`} />
          <StatCard label="含部分命中率" value={formatRate(summary.partialIncludedRate)} helper={`${summary.hit + summary.partial} 命中或部分成立`} />
          <StatCard label="待驗證 / 資料不完整" value={`${summary.pending} / ${summary.degraded}`} helper="待驗證不視為失準" />
        </section>

        <section className="mt-8">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white">最近 30 筆交易日報告</h2>
              <p className="mt-1 text-sm text-white/45">盤前方向、收盤結果、命中狀態與研究筆記摘要。</p>
            </div>
            <Link
              to="/member-note"
              className="inline-flex w-fit items-center justify-center rounded-md bg-sky-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-sky-300"
            >
              查看完整研究筆記
            </Link>
          </div>

          {loading ? (
            <div className="mt-5 rounded-lg border border-white/10 bg-white/[0.04] p-6 text-sm text-white/55">
              正在讀取歷史績效資料...
            </div>
          ) : errorMessage ? (
            <div className="mt-5 rounded-lg border border-amber-300/25 bg-amber-300/8 p-6">
              <h3 className="text-base font-semibold text-amber-100">歷史績效暫時無法完整顯示</h3>
              <p className="mt-2 text-sm leading-6 text-white/60">{errorMessage}</p>
            </div>
          ) : items.length === 0 ? (
            <div className="mt-5 rounded-lg border border-white/10 bg-white/[0.04] p-6 text-sm text-white/55">
              目前尚無可顯示的歷史報告。等盤前報告與收盤驗證累積後，這裡會自動呈現績效統計。
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {items.map((item) => {
                const expanded = expandedId === item.id;
                return (
                  <article key={item.id} className="rounded-lg border border-white/10 bg-white/[0.04] p-4 md:p-5">
                    <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr_auto] lg:items-center">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-lg font-semibold text-white">{item.reportDate}</h3>
                          <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${STATUS_CLASS[item.status]}`}>
                            {STATUS_LABEL[item.status]}
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-white/55">
                          盤前方向：<span className="text-white/80">{item.openingBias}</span>
                        </p>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-3">
                        <div className="rounded-md bg-black/20 p-3">
                          <div className="text-xs text-white/35">實際收盤方向</div>
                          <div className="mt-1 text-sm font-medium text-white/85">{item.actualDirection}</div>
                        </div>
                        <div className="rounded-md bg-black/20 p-3">
                          <div className="text-xs text-white/35">判斷把握度</div>
                          <div className="mt-1 text-sm font-medium text-white/85">
                            {item.confidenceScore == null ? '待驗證' : `${item.confidenceScore}/100`}
                          </div>
                        </div>
                        <div className="rounded-md bg-black/20 p-3">
                          <div className="text-xs text-white/35">資料狀態</div>
                          <div className="mt-1 text-sm font-medium text-white/85">{formatDataQuality(item.dataQuality)}</div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => setExpandedId(expanded ? null : item.id)}
                        className="rounded-md border border-white/15 px-4 py-2 text-sm font-medium text-white/75 transition hover:border-white/30 hover:text-white"
                      >
                        {expanded ? '收合詳情' : '查看詳情'}
                      </button>
                    </div>

                    <div className="mt-4 rounded-md border border-white/8 bg-black/15 p-3">
                      <div className="text-xs text-white/35">第一受惠股表現摘要</div>
                      {item.firstBeneficiary ? (
                        <div className="mt-2 grid gap-2 text-sm text-white/65 sm:grid-cols-4">
                          <span>{item.firstBeneficiary.name || item.firstBeneficiary.symbol || '未命名標的'}</span>
                          <span>當日表現：{item.firstBeneficiary.performanceText}</span>
                          <span>{item.firstBeneficiary.beatTaiexText}</span>
                          <span>{item.firstBeneficiary.statusText}</span>
                        </div>
                      ) : (
                        <p className="mt-2 text-sm text-white/45">資料不足，尚未納入統計。</p>
                      )}
                    </div>

                    {expanded ? (
                      <div className="mt-5 grid gap-5 border-t border-white/10 pt-5 lg:grid-cols-2">
                        <div className="space-y-5">
                          <div>
                            <h4 className="text-sm font-semibold text-white">今日主軸</h4>
                            <p className="mt-2 text-sm leading-6 text-white/60">{item.thesisText}</p>
                          </div>
                          <div>
                            <h4 className="text-sm font-semibold text-white">第一受惠股推理摘要</h4>
                            <p className="mt-2 text-sm leading-6 text-white/60">{item.beneficiaryReasoning}</p>
                          </div>
                          {!item.hasMemberNote ? (
                            <p className="rounded-md border border-white/10 bg-white/[0.03] p-3 text-xs text-white/40">
                              舊版報告，研究筆記結構不足。
                            </p>
                          ) : null}
                        </div>

                        <div className="space-y-5">
                          <DetailList title="收盤驗證：判斷正確處" items={item.whatWasRight} emptyText="尚未產生判斷正確處。" />
                          <DetailList title="收盤驗證：需要修正處" items={item.whatWasWrong} emptyText="尚未產生需要修正處。" />
                          <DetailList title="明日調整" items={item.tomorrowAdjustment} emptyText="尚未產生明日調整。" />
                          {!item.hasClosingVerificationV2 ? (
                            <p className="rounded-md border border-amber-300/20 bg-amber-300/8 p-3 text-xs text-amber-100/80">
                              這筆報告尚未完成新版收盤驗證，因此目前顯示為待驗證，不納入命中率分母。
                            </p>
                          ) : null}
                          <Link
                            to={`/reports/${item.reportDate}`}
                            className="inline-flex items-center text-sm font-semibold text-sky-200 hover:text-sky-100"
                          >
                            查看該日完整研究筆記 →
                          </Link>
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>
      <Footer />
    </div>
  );
}

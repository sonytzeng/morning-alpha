import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '@/components/feature/Navbar';
import Footer from '@/components/feature/Footer';
import { supabase } from '@/lib/supabase';

type ReportRecord = {
  id: string;
  report_date: string;
  ai_strategy_json: Record<string, unknown> | null;
};

type VerificationStatus = 'hit' | 'partial' | 'miss' | 'pending' | 'no_data';

type JournalItem = {
  id: string;
  reportDate: string;
  morningJudgment: string;
  closingReality: string;
  status: VerificationStatus;
  dataQuality: string;
  marketStatus: string;
  isStatEligible: boolean;
  statusNote: string;
  whatWasRight: string[];
  whatWasWrong: string[];
  tomorrowAdjustment: string[];
};

type SummaryStats = {
  validDays: number;
  hit: number;
  partial: number;
  miss: number;
  noData: number;
};

const STATUS_LABEL: Record<VerificationStatus, string> = {
  hit: '成立',
  partial: '部分成立',
  miss: '失準',
  pending: '待驗證',
  no_data: '資料不足',
};

const STATUS_CLASS: Record<VerificationStatus, string> = {
  hit: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200',
  partial: 'border-amber-300/40 bg-amber-300/10 text-amber-100',
  miss: 'border-rose-400/40 bg-rose-400/10 text-rose-100',
  pending: 'border-white/15 bg-white/8 text-white/65',
  no_data: 'border-slate-400/30 bg-slate-400/10 text-slate-200',
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

function listFromAdjustment(value: unknown): string[] {
  if (Array.isArray(value) || typeof value === 'string' || typeof value === 'number') return listFromUnknown(value);
  const record = asRecord(value);
  if (!record) return [];
  return [
    ...listFromUnknown(record.downgrade),
    ...listFromUnknown(record.watch_tomorrow),
    ...listFromUnknown(record.keep),
  ].filter(Boolean).slice(0, 5);
}

function normalizeStatus(value: unknown): VerificationStatus {
  const raw = String(value || '').toLowerCase();
  if (!raw) return 'pending';
  if (['hit', 'correct', 'confirmed', 'success'].includes(raw)) return 'hit';
  if (['partial', 'mixed', 'partially_confirmed'].includes(raw)) return 'partial';
  if (['miss', 'wrong', 'failed'].includes(raw)) return 'miss';
  if (raw.includes('degraded') || raw.includes('insufficient') || raw.includes('no_data')) return 'no_data';
  return 'pending';
}

function directionFromChange(change: number | null): string {
  if (change === null) return '等待收盤資料';
  if (change >= 0.3) return '上漲';
  if (change <= -0.3) return '下跌';
  return '震盪';
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

function isCompleteDataStatus(value: string): boolean {
  const normalized = value.toLowerCase();
  return normalized === 'complete' || normalized === 'completed' || normalized === 'ready';
}

function buildJournalItem(row: ReportRecord): JournalItem {
  const ai = row.ai_strategy_json || {};
  const closingV2 = asRecord(ai.closing_verification_v2);
  const dataQuality = firstText(closingV2?.data_status, ai.data_quality, ai.data_status) || 'unknown';
  const marketStatus = firstText(ai.market_status, ai.trading_day_reason) || 'UNKNOWN';
  const status = closingV2 ? normalizeStatus(closingV2.hit_or_miss || closingV2.prediction_result || closingV2.status) : 'pending';
  const verificationStatus = firstText(closingV2?.status);
  const isOpenMarket = marketStatus === 'OPEN' || marketStatus === 'open';
  const isCompleteData = isCompleteDataStatus(dataQuality);
  const hasCompletedVerification = Boolean(closingV2) && !['pending', 'no_data'].includes(status);
  const isStatEligible = isOpenMarket && isCompleteData && hasCompletedVerification;

  const actualTaiexChange = firstNumber(
    closingV2?.actual_taiex_change,
    asRecord(closingV2?.actual_taiex_close)?.change_percent,
    asRecord(closingV2?.actual_taiex_close)?.change,
  );

  return {
    id: row.id,
    reportDate: row.report_date,
    morningJudgment: firstText(closingV2?.opening_bias) || '尚未完成新版收盤驗證',
    closingReality: firstText(closingV2?.actual_direction) || directionFromChange(actualTaiexChange),
    status: isStatEligible ? status : (closingV2 ? 'no_data' : 'pending'),
    dataQuality,
    marketStatus,
    isStatEligible,
    statusNote: !isOpenMarket
      ? '非交易日不納入統計'
      : !closingV2
        ? '尚未完成新版收盤驗證'
        : !isCompleteData
          ? `資料狀態：${formatDataQuality(dataQuality)}`
          : verificationStatus || '已完成收盤驗證',
    whatWasRight: listFromUnknown(closingV2?.what_was_right),
    whatWasWrong: listFromUnknown(closingV2?.what_was_wrong),
    tomorrowAdjustment: listFromAdjustment(closingV2?.tomorrow_adjustment),
  };
}

function calculateSummary(items: JournalItem[]): SummaryStats {
  const eligible = items.filter((item) => item.isStatEligible);
  const hit = eligible.filter((item) => item.status === 'hit').length;
  const partial = eligible.filter((item) => item.status === 'partial').length;
  const miss = eligible.filter((item) => item.status === 'miss').length;
  const noData = items.length - eligible.length;

  return {
    validDays: eligible.length,
    hit,
    partial,
    miss,
    noData,
  };
}

function getMonthlyLessons(items: JournalItem[]): string[] {
  return items
    .flatMap((item) => [...item.whatWasWrong, ...item.tomorrowAdjustment])
    .filter(Boolean)
    .slice(0, 5);
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
  const [items, setItems] = useState<JournalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadReports() {
      setLoading(true);
      setErrorMessage('');

      const { data: sessionData } = await supabase.auth.getSession();
      if (!mounted) return;

      if (!sessionData.session) {
        setItems([]);
        setErrorMessage('Decision Journal 目前需要登入會員權限。完整 30 日回顧會在會員權限下顯示。');
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('reports')
        .select('id, report_date, ai_strategy_json')
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
            ? 'Decision Journal 目前需要登入會員權限。完整 30 日回顧會在會員權限下顯示。'
            : 'Decision Journal 暫時無法載入，請稍後再試。',
        );
        setLoading(false);
        return;
      }

      const normalized = ((data || []) as ReportRecord[]).map(buildJournalItem);
      setItems(normalized);
      setLoading(false);
    }

    loadReports();
    return () => {
      mounted = false;
    };
  }, []);

  const summary = useMemo(() => calculateSummary(items), [items]);
  const monthlyLessons = useMemo(() => getMonthlyLessons(items), [items]);
  const redoNotes = useMemo(() => items.flatMap((item) => item.tomorrowAdjustment).filter(Boolean).slice(0, 4), [items]);

  return (
    <div className="min-h-screen bg-[#07111f] text-white">
      <Navbar />
      <main className="mx-auto w-full max-w-7xl px-4 py-8 md:px-6 md:py-12">
        <section className="rounded-lg border border-white/10 bg-gradient-to-br from-sky-500/12 via-white/[0.04] to-emerald-400/8 p-5 md:p-8">
          <div className="max-w-3xl">
            <p className="text-sm font-medium text-sky-200/80">Decision Journal</p>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white md:text-4xl">
              Decision Journal
            </h1>
            <p className="mt-4 text-sm leading-7 text-white/65 md:text-base">
              回看 Morning Alpha 過去如何判斷、哪些成立、哪些失效，以及收盤後留下的修正。這裡不美化結果，也不把資料不足包裝成命中。
            </p>
          </div>
        </section>

        <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="完整成立" value={summary.hit} helper={`有效交易日 ${summary.validDays} 天`} />
          <StatCard label="部分成立" value={summary.partial} helper="方向或條件只有部分被確認" />
          <StatCard label="失效" value={summary.miss} helper="收盤結果推翻早上劇本" />
          <StatCard label="資料不足" value={summary.noData} helper="休市、待驗證或資料不完整" />
        </section>

        <p className="mt-3 text-xs leading-6 text-white/45">
          只統計已完成收盤驗證且資料完整的交易日。休市、待驗證、資料不完整與舊版驗證不放進成立統計。
        </p>

        <section className="mt-8">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white">Today&apos;s Review Timeline</h2>
              <p className="mt-1 text-sm text-white/45">最近 30 筆報告，依日期回看早上判斷與收盤現實。</p>
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
              正在讀取 Decision Journal...
            </div>
          ) : errorMessage ? (
            <div className="mt-5 rounded-lg border border-amber-300/25 bg-amber-300/8 p-6">
              <h3 className="text-base font-semibold text-amber-100">Decision Journal 暫時無法完整顯示</h3>
              <p className="mt-2 text-sm leading-6 text-white/60">{errorMessage}</p>
            </div>
          ) : items.length === 0 ? (
            <div className="mt-5 rounded-lg border border-white/10 bg-white/[0.04] p-6 text-sm text-white/55">
              目前尚無可顯示的 Decision Journal。等盤前報告與收盤驗證累積後，這裡會自動呈現每日回顧。
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
                          早上判斷：<span className="text-white/80">{item.morningJudgment}</span>
                        </p>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-md bg-black/20 p-3">
                          <div className="text-xs text-white/35">收盤結果</div>
                          <div className="mt-1 text-sm font-medium text-white/85">{item.closingReality}</div>
                        </div>
                        <div className="rounded-md bg-black/20 p-3">
                          <div className="text-xs text-white/35">資料狀態</div>
                          <div className="mt-1 text-sm font-medium text-white/85">{item.statusNote}</div>
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

                    {expanded ? (
                      <div className="mt-5 grid gap-5 border-t border-white/10 pt-5 lg:grid-cols-2">
                        <div className="space-y-5">
                          <DetailList title="哪些成立？" items={item.whatWasRight} emptyText="這一天尚未留下成立項目。" />
                          <DetailList title="哪些失敗？" items={item.whatWasWrong} emptyText="這一天尚未留下失效項目。" />
                        </div>
                        <div className="space-y-5">
                          <DetailList title="我們學到什麼？" items={item.tomorrowAdjustment} emptyText="這一天尚未留下明日調整。" />
                          {!item.isStatEligible ? (
                            <p className="rounded-md border border-amber-300/20 bg-amber-300/8 p-3 text-xs text-amber-100/80">
                              {item.statusNote}，不納入完整成立統計。
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

        {!loading && !errorMessage && monthlyLessons.length > 0 ? (
          <section className="mt-8 rounded-lg border border-white/10 bg-white/[0.04] p-5 md:p-6">
            <p className="text-sm font-medium text-sky-200/80">What We Learned</p>
            <h2 className="mt-2 text-xl font-semibold text-white">本月最大的修正</h2>
            <ul className="mt-4 grid gap-3 md:grid-cols-2">
              {monthlyLessons.map((lesson, index) => (
                <li key={`${lesson}-${index}`} className="rounded-md border border-white/8 bg-black/15 p-3 text-sm leading-6 text-white/65">
                  {lesson}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {!loading && !errorMessage && redoNotes.length > 0 ? (
          <section className="mt-8 rounded-lg border border-white/10 bg-white/[0.04] p-5 md:p-6">
            <p className="text-sm font-medium text-emerald-200/80">If We Could Do It Again</p>
            <h2 className="mt-2 text-xl font-semibold text-white">如果重來一次，我們會怎麼調整</h2>
            <ul className="mt-4 space-y-3">
              {redoNotes.map((note, index) => (
                <li key={`${note}-${index}`} className="flex gap-3 text-sm leading-6 text-white/65">
                  <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-300/80" />
                  <span>{note}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
      <Footer />
    </div>
  );
}

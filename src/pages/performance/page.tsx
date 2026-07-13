import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Ban, CalendarCheck, CheckCircle2, Flag, Scale, ShieldCheck, Target, TrendingUp } from 'lucide-react';
import Navbar from '@/components/feature/Navbar';
import VisualPageHero from '@/components/feature/VisualPageHero';
import VisualSectionHeader from '@/components/feature/VisualSectionHeader';
import Footer from '@/components/feature/Footer';
import { supabase } from '@/lib/supabase';

type PublicPerformanceJournalRow = {
  report_date: string;
  market_bias: string | null;
  confidence_score: number | null;
  is_trading_day: boolean | null;
  report_mode: string | null;
  verification_status: string | null;
  verification_data_status: string | null;
  hit_or_miss: string | null;
  prediction_result: string | null;
  opening_bias: string | null;
  actual_direction: string | null;
  actual_taiex_close: number | null;
  what_was_right: string | null;
  what_was_wrong: string | null;
  tomorrow_adjustment: string | null;
  updated_at: string | null;
};

type ReportRecord = {
  id: string;
  report_date: string;
  market_bias: string | null;
  confidence_score: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  ai_strategy_json: Record<string, unknown> | null;
};

type JournalOutcome = 'complete' | 'partial' | 'failed' | 'insufficient';

type DecisionJournalEntry = {
  reportId: string;
  marketDate: string;
  outcome: JournalOutcome;
  isTradingDay: boolean;
  hasMorningReport: boolean;
  hasClosingVerification: boolean;
  hasCompleteVerification: boolean;
  marketBias: string;
  closingSummary: string;
  correctionSummary: string;
  confidence: number | null;
  statusNote: string;
  whatWasRight: string[];
  whatWasWrong: string[];
  tomorrowAdjustment: string[];
  dataStatus: string;
  completenessScore: number;
};

type JournalStats = {
  totalReports: number;
  closingVerificationCount: number;
  validCount: number;
  complete: number;
  partial: number;
  failed: number;
  insufficient: number;
  weightedSuccessRate: number | null;
  completeRate: number | null;
};

const OUTCOME_LABEL: Record<JournalOutcome, string> = {
  complete: '完整成立',
  partial: '部分成立',
  failed: '失敗',
  insufficient: '資料不足',
};

const OUTCOME_CLASS: Record<JournalOutcome, string> = {
  complete: 'border-emerald-400/35 bg-emerald-400/10 text-emerald-200',
  partial: 'border-amber-300/35 bg-amber-300/10 text-amber-100',
  failed: 'border-rose-400/35 bg-rose-400/10 text-rose-100',
  insufficient: 'border-slate-400/25 bg-slate-400/10 text-slate-200',
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) return fallback;
  const result = String(value).trim();
  return result || fallback;
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const result = text(value);
    if (result) return result;
  }
  return '';
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timestampMs(value: unknown): number {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function taipeiToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function isFutureReportDate(reportDate: string): boolean {
  return Boolean(reportDate) && reportDate > taipeiToday();
}

function listFromUnknown(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item.trim();
        const record = asRecord(item);
        return firstText(record?.title, record?.content, record?.note, record?.summary, record?.text, record?.action);
      })
      .filter(Boolean)
      .slice(0, 5);
  }
  const record = asRecord(value);
  if (record) {
    return [record.summary, record.note, record.action, record.reason]
      .map((item) => text(item))
      .filter(Boolean)
      .slice(0, 5);
  }
  const single = text(value);
  return single ? [single] : [];
}

function listFromAdjustment(value: unknown): string[] {
  if (Array.isArray(value) || typeof value === 'string' || typeof value === 'number') return listFromUnknown(value);
  const record = asRecord(value);
  if (!record) return [];
  return [
    ...listFromUnknown(record.keep),
    ...listFromUnknown(record.downgrade),
    ...listFromUnknown(record.watch_tomorrow),
    ...listFromUnknown(record.tomorrow_watch),
    ...listFromUnknown(record.adjustment),
  ].filter(Boolean).slice(0, 5);
}

function buildReportRecordFromPublicRow(row: PublicPerformanceJournalRow): ReportRecord {
  const actualTaiexClose = numberOrNull(row.actual_taiex_close);
  return {
    id: row.report_date,
    report_date: row.report_date,
    market_bias: row.market_bias,
    confidence_score: row.confidence_score,
    updated_at: row.updated_at,
    ai_strategy_json: {
      is_trading_day: row.is_trading_day,
      report_mode: row.report_mode,
      closing_verification_v2: {
        status: row.verification_status,
        data_status: row.verification_data_status,
        hit_or_miss: row.hit_or_miss,
        prediction_result: row.prediction_result,
        opening_bias: row.opening_bias,
        actual_direction: row.actual_direction,
        actual_taiex_close: actualTaiexClose === null ? null : { close: actualTaiexClose },
        what_was_right: row.what_was_right,
        what_was_wrong: row.what_was_wrong,
        tomorrow_adjustment: row.tomorrow_adjustment,
      },
    },
  };
}

function isTradingDay(ai: Record<string, unknown>, row: ReportRecord): boolean {
  const marketStatus = text(ai.market_status).toUpperCase();
  const reportMode = text(ai.report_mode).toLowerCase();
  const bias = text(row.market_bias || ai.market_bias);
  if (ai.is_trading_day === false) return false;
  if (ai.market_closed === true) return false;
  if (marketStatus && marketStatus !== 'OPEN') return false;
  if (reportMode.includes('non_trading') || reportMode.includes('holiday') || reportMode.includes('weekend')) return false;
  if (bias === '休市') return false;
  return true;
}

function normalizeOutcome(value: unknown): JournalOutcome {
  const raw = text(value).toLowerCase();
  if (['hit', 'correct', 'confirmed', 'success', 'accurate'].includes(raw)) return 'complete';
  if (['partial', 'mixed', 'partially_confirmed'].includes(raw)) return 'partial';
  if (['miss', 'wrong', 'failed', 'rejected', 'incorrect', 'inaccurate'].includes(raw)) return 'failed';
  return 'insufficient';
}

function isPendingVerification(closing: Record<string, unknown> | null): boolean {
  if (!closing) return true;
  const raw = [closing.status, closing.hit_or_miss, closing.prediction_result, closing.data_status]
    .map((item) => text(item).toLowerCase())
    .join('|');
  return raw.includes('pending') || raw.includes('real_market_data');
}

function isCompleteClosingData(closing: Record<string, unknown> | null): boolean {
  if (!closing || isPendingVerification(closing)) return false;
  const status = text(closing.status).toLowerCase();
  const dataStatus = text(closing.data_status).toLowerCase();
  const hasActualClose = Boolean(asRecord(closing.actual_taiex_close)) || text(closing.actual_direction) !== '';
  if (!hasActualClose) return false;
  if (status === 'direction_completed_data_degraded' || dataStatus === 'degraded') return false;
  return ['completed', 'complete', 'ready'].includes(status) || dataStatus === 'complete';
}

function reportSelectionScore(row: ReportRecord): number[] {
  const ai = row.ai_strategy_json || {};
  const closing = asRecord(ai.closing_verification_v2);
  const outcome = normalizeOutcome(closing?.hit_or_miss || closing?.prediction_result || closing?.status);
  const hasCompletedOutcome = isCompleteClosingData(closing) && outcome !== 'insufficient';
  const dataStatus = text(closing?.data_status).toLowerCase();
  return [
    hasCompletedOutcome ? 1 : 0,
    dataStatus === 'complete' ? 1 : 0,
    !isFutureReportDate(row.report_date) && isTradingDay(ai, row) ? 1 : 0,
    timestampMs(row.updated_at),
    timestampMs(row.created_at),
  ];
}

function shouldPreferReport(candidate: ReportRecord, current: ReportRecord): boolean {
  const candidateScore = reportSelectionScore(candidate);
  const currentScore = reportSelectionScore(current);
  for (let index = 0; index < candidateScore.length; index += 1) {
    if (candidateScore[index] !== currentScore[index]) return candidateScore[index] > currentScore[index];
  }
  return false;
}

function directionFromChange(change: number | null): string {
  if (change === null) return '尚未取得收盤方向';
  if (change >= 0.3) return `TAIEX 收盤上漲 ${change.toFixed(2)}%`;
  if (change <= -0.3) return `TAIEX 收盤下跌 ${change.toFixed(2)}%`;
  return `TAIEX 收盤震盪 ${change.toFixed(2)}%`;
}

function buildEntry(row: ReportRecord): DecisionJournalEntry {
  const ai = row.ai_strategy_json || {};
  const closing = asRecord(ai.closing_verification_v2);
  const dataStatus = text(closing?.data_status || ai.data_status || ai.data_quality, 'unknown');
  const tradingDay = isTradingDay(ai, row);
  const hasMorningReport = Boolean(row.id && row.report_date);
  const hasClosingVerification = Boolean(closing);
  const hasCompleteVerification = isCompleteClosingData(closing);
  const rawOutcome = normalizeOutcome(closing?.hit_or_miss || closing?.prediction_result || closing?.status);
  const futureReport = isFutureReportDate(row.report_date);
  const outcome: JournalOutcome = !futureReport && tradingDay && hasMorningReport && hasCompleteVerification ? rawOutcome : 'insufficient';
  const actualTaiex = asRecord(closing?.actual_taiex_close);
  const taiexChange = numberOrNull(closing?.actual_taiex_change) ?? numberOrNull(actualTaiex?.change_percent) ?? numberOrNull(actualTaiex?.change);
  const right = listFromUnknown(closing?.what_was_right);
  const wrong = listFromUnknown(closing?.what_was_wrong);
  const adjustment = listFromAdjustment(closing?.tomorrow_adjustment);
  const statusNote = futureReport
    ? '未來日期報告，不納入績效'
    : !tradingDay
      ? '休市或非交易日，不納入績效'
    : !hasClosingVerification
      ? '尚未完成收盤驗證'
      : !hasCompleteVerification
        ? `收盤驗證資料不完整（${dataStatus}）`
        : '已完成收盤驗證且納入統計';

  return {
    reportId: row.id,
    marketDate: row.report_date,
    outcome,
    isTradingDay: tradingDay,
    hasMorningReport,
    hasClosingVerification,
    hasCompleteVerification,
    marketBias: firstText(row.market_bias, ai.market_bias, closing?.opening_bias, '尚未結構化'),
    closingSummary: firstText(closing?.actual_direction, closing?.verdict_label, directionFromChange(taiexChange)),
    correctionSummary: firstText(wrong[0], adjustment[0], '本日尚未留下結構化修正'),
    confidence: numberOrNull(row.confidence_score) ?? numberOrNull(ai.confidence_score) ?? numberOrNull(closing?.opening_confidence),
    statusNote,
    whatWasRight: right,
    whatWasWrong: wrong,
    tomorrowAdjustment: adjustment,
    dataStatus,
    completenessScore: [right.length > 0, wrong.length > 0, adjustment.length > 0, hasCompleteVerification].filter(Boolean).length,
  };
}

function calculateStats(entries: DecisionJournalEntry[]): JournalStats {
  const valid = entries.filter((entry) => entry.outcome !== 'insufficient');
  const complete = valid.filter((entry) => entry.outcome === 'complete').length;
  const partial = valid.filter((entry) => entry.outcome === 'partial').length;
  const failed = valid.filter((entry) => entry.outcome === 'failed').length;
  return {
    totalReports: entries.length,
    closingVerificationCount: entries.filter((entry) => entry.hasClosingVerification).length,
    validCount: valid.length,
    complete,
    partial,
    failed,
    insufficient: entries.length - valid.length,
    weightedSuccessRate: valid.length > 0 ? ((complete + partial * 0.5) / valid.length) * 100 : null,
    completeRate: valid.length > 0 ? (complete / valid.length) * 100 : null,
  };
}

function pct(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)}%`;
}

function StatCard({ label, value, helper }: { label: string; value: string | number; helper: string; accent: string }) {
  return (
    <div className="ma-card-compact">
      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/42">{label}</div>
      <div className="mt-3 text-4xl font-semibold tracking-tight text-white md:text-5xl">{value}</div>
      <div className="mt-3 text-xs leading-5 text-white/36">{helper}</div>
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
              <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary-300/70" />
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

function MiniMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/35 px-4 py-3">
      <div className="text-[11px] font-medium text-white/38">{label}</div>
      <div className="mt-1 text-lg font-semibold text-white/90">{value}</div>
    </div>
  );
}

function RuleItem({ icon: Icon, children }: { icon: typeof CheckCircle2; children: string }) {
  return (
    <li className="flex gap-3 rounded-2xl border border-white/8 bg-slate-950/30 p-4">
      <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl border border-cyan-300/15 bg-cyan-300/8 text-cyan-200">
        <Icon size={16} strokeWidth={1.8} />
      </span>
      <span className="text-sm leading-6 text-white/58">{children}</span>
    </li>
  );
}

function TimelineFact({ icon: Icon, label, value }: { icon: typeof Flag; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-slate-950/25 p-3">
      <div className="flex items-center gap-2 text-[11px] font-medium text-white/35">
        <Icon size={14} strokeWidth={1.8} />
        {label}
      </div>
      <p className="mt-2 line-clamp-2 text-sm leading-5 text-white/72">{value}</p>
    </div>
  );
}

export default function PerformancePage() {
  const [entries, setEntries] = useState<DecisionJournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isSignedIn, setIsSignedIn] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function loadReports() {
      setLoading(true);
      setErrorMessage('');

      const { data: sessionData } = await supabase.auth.getSession();
      if (!mounted) return;
      setIsSignedIn(Boolean(sessionData.session));

      const { data, error } = await supabase.rpc('get_public_performance_journal', { p_limit: 90 });

      if (!mounted) return;

      if (error) {
        const message = error.message || '';
        const isRlsBlocked = error.code === '42501' || /permission denied|row level security|rls/i.test(message);
        setEntries([]);
        setErrorMessage(
          isRlsBlocked
            ? '目前無法讀取公開績效資料。請登入會員後查看完整 Decision Journal。'
            : 'Decision Journal 暫時無法載入，請稍後再試。',
        );
        setLoading(false);
        return;
      }

      const uniqueByDate = new Map<string, ReportRecord>();
      const publicRows = (data || []) as PublicPerformanceJournalRow[];
      for (const publicRow of publicRows) {
        const row = buildReportRecordFromPublicRow(publicRow);
        const current = uniqueByDate.get(row.report_date);
        if (!current || shouldPreferReport(row, current)) uniqueByDate.set(row.report_date, row);
      }
      setEntries(Array.from(uniqueByDate.values()).map(buildEntry));
      setLoading(false);
    }

    loadReports();
    return () => {
      mounted = false;
    };
  }, []);

  const validEntries = useMemo(() => entries.filter((entry) => entry.outcome !== 'insufficient').slice(0, 30), [entries]);
  const visibleEntries = useMemo(() => (isSignedIn ? validEntries : validEntries.slice(0, 3)), [isSignedIn, validEntries]);
  const recentTimeline = useMemo(() => validEntries.slice(0, 10), [validEntries]);
  const stats = useMemo(() => calculateStats(entries.filter((entry) => validEntries.includes(entry) || entry.outcome === 'insufficient')), [entries, validEntries]);
  const bestCase = useMemo(() => validEntries.filter((entry) => entry.outcome === 'complete').sort((a, b) => b.completenessScore - a.completenessScore || (b.confidence ?? 0) - (a.confidence ?? 0))[0] || null, [validEntries]);
  const failedCase = useMemo(() => validEntries.find((entry) => entry.outcome === 'failed') || null, [validEntries]);
  const lessons = useMemo(() => validEntries.flatMap((entry) => [...entry.whatWasWrong, ...entry.tomorrowAdjustment]).filter(Boolean).slice(0, 5), [validEntries]);
  const insufficientCount = entries.filter((entry) => entry.outcome === 'insufficient').length;
  const lockedCount = Math.max(0, validEntries.length - visibleEntries.length);

  return (
    <div className="ma-page">
      <Navbar />
      <VisualPageHero
        eyebrow="決策學習"
        icon="ri-history-line"
        title="昨天這個決定對不對？"
        subtitle="只看已完成的驗證結果、失敗原因與下一次改善；不重述當天劇本。"
        decisionLabel="目前已完成驗證"
        decision={`${stats.validCount} 個交易日`}
        ctaLabel="查看最近驗證"
        ctaTo={validEntries[0] ? `/reports/${validEntries[0].marketDate}` : "/reports"}
      />
      <main className="mx-auto w-full max-w-5xl px-4 py-8 md:px-6 md:py-10">

        {loading ? (
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-sm text-white/55">
            正在讀取 Performance Center...
          </div>
        ) : errorMessage ? (
          <div className="mt-6 rounded-2xl border border-amber-300/25 bg-amber-300/8 p-6">
            <h2 className="text-lg font-semibold text-amber-100">Decision Journal 暫時無法完整顯示</h2>
            <p className="mt-2 text-sm leading-6 text-white/60">{errorMessage}</p>
          </div>
        ) : stats.validCount === 0 ? (
          <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-6 md:p-8">
            <h2 className="text-xl font-semibold text-white">尚未累積完成驗證的交易日</h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-white/60">
              歷史績效只統計同時具備盤前判斷與收盤驗證的交易日。目前資料仍在累積，不會用休市、待驗證或不完整資料填充績效。
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MiniMetric label="已找到盤前報告" value={stats.totalReports} />
              <MiniMetric label="已完成收盤驗證" value={stats.closingVerificationCount} />
              <MiniMetric label="可納入績效" value={stats.validCount} />
              <MiniMetric label="未納入" value={stats.insufficient} />
            </div>
          </section>
        ) : (
          <>
            <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="完整成立" value={stats.complete} helper="已完成驗證交易日中的完整成立次數" accent="complete" />
              <StatCard label="部分成立" value={stats.partial} helper="方向或條件僅部分確認" accent="partial" />
              <StatCard label="失敗" value={stats.failed} helper="收盤結果明顯背離主要劇本" accent="failed" />
              <StatCard label="有效驗證日" value={stats.validCount} helper="complete + partial + failed，不含資料不足" accent="valid" />
            </section>

            <p className="mt-4 text-xs leading-6 text-slate-500">
              另有 {insufficientCount} 筆未納入統計：休市、待驗證或資料不完整。
            </p>

            <section className="ma-card mt-8 md:p-7">
              <VisualSectionHeader icon="ri-bar-chart-box-line" title="績效總覽" description="加權成立率不是投資報酬率。" />
              <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-200/75">近 30 個有效驗證日</p>
                  <p className="mt-2 text-sm leading-6 text-slate-400">加權成立率 = 完整成立 + 部分成立 0.5 權重；這不是投資報酬率。</p>
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <MiniMetric label="完整成立率" value={pct(stats.completeRate)} />
                  <MiniMetric label="加權成立率" value={pct(stats.weightedSuccessRate)} />
                  <MiniMetric label="有效日數" value={stats.validCount} />
                </div>
              </div>
              <div className="mt-6 h-3.5 overflow-hidden rounded-full bg-slate-700/80 ring-1 ring-white/5">
                <div className="h-full rounded-full bg-primary-500" style={{ width: `${Math.max(4, Math.min(100, stats.weightedSuccessRate ?? 0))}%` }} />
              </div>
            </section>

            <section className="mt-10">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-2xl font-semibold text-white">最近 10 個交易日結果</h2>
                  <p className="mt-2 text-sm text-slate-500">只顯示已完成收盤驗證且資料完整的交易日。</p>
                </div>
                {!isSignedIn ? <p className="text-xs text-slate-500">公開版顯示最近 3 筆，登入後查看 30 日回顧。</p> : null}
              </div>
              <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                {recentTimeline.map((entry) => (
                  <Link key={`timeline-${entry.marketDate}`} to={`/reports/${entry.marketDate}`} className="ma-card-compact transition-colors hover:border-primary-400/30">
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-lg font-semibold tracking-tight text-white">{entry.marketDate}</span>
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${OUTCOME_CLASS[entry.outcome]}`}>{OUTCOME_LABEL[entry.outcome]}</span>
                    </div>
                    <div className="mt-4 space-y-3">
                      <TimelineFact icon={Flag} label="驗證結果" value={entry.closingSummary} />
                    </div>
                  </Link>
                ))}
              </div>
            </section>

            <section className="mt-10">
              <h2 className="text-2xl font-semibold text-white">Decision Journal</h2>
              <p className="mt-2 text-sm text-slate-500">我們如何判斷、哪些成立、哪些失敗，以及下一次怎麼修正。</p>
              <div className="mt-5 space-y-4">
                {visibleEntries.map((entry) => {
                  const expanded = expandedId === entry.reportId;
                  return (
                    <article key={entry.reportId} className="ma-card md:p-6">
                      <div className="grid gap-5 lg:grid-cols-[0.72fr_2fr_auto] lg:items-center">
                        <div>
                          <div className="text-xl font-semibold tracking-tight text-white">{entry.marketDate}</div>
                          <span className={`mt-3 inline-flex rounded-full border px-3 py-1 text-xs font-medium ${OUTCOME_CLASS[entry.outcome]}`}>
                            {OUTCOME_LABEL[entry.outcome]}
                          </span>
                        </div>
                        <div className="relative pl-5">
                          <span className="absolute left-0 top-1 h-[calc(100%-0.25rem)] w-px bg-background-300" />
                          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/34">收盤驗證</div>
                          <div className="mt-2 line-clamp-2 text-sm leading-6 text-white/72">{entry.closingSummary}</div>
                          <div className="mt-2 line-clamp-1 text-xs text-slate-500">下一次修正：{entry.correctionSummary || '尚未留下修正'}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setExpandedId(expanded ? null : entry.reportId)}
                          className="rounded-xl border border-cyan-300/20 px-4 py-2.5 text-sm font-medium text-cyan-100/80 transition duration-200 hover:border-cyan-300/45 hover:bg-cyan-300/8 hover:text-cyan-50"
                        >
                          {expanded ? '收合' : '查看紀錄'}
                        </button>
                      </div>

                      {expanded ? (
                        <div className="mt-6 grid gap-5 border-t border-white/10 pt-5 lg:grid-cols-3">
                          <DetailList title="為什麼成立或失敗" items={[...entry.whatWasRight, ...entry.whatWasWrong].filter(Boolean)} emptyText="本日尚未留下結構化原因。" />
                          <DetailList title="下一次修正" items={entry.tomorrowAdjustment} emptyText="本日尚未留下結構化修正。" />
                          <div>
                            <h4 className="text-sm font-semibold text-white">研究筆記</h4>
                            <p className="mt-2 text-sm leading-6 text-white/45">{entry.statusNote}</p>
                            <Link to={`/reports/${entry.marketDate}`} className="mt-3 inline-flex text-sm font-semibold text-primary-200 hover:text-primary-100">
                              查看完整研究筆記 →
                            </Link>
                          </div>
                        </div>
                      ) : null}
                    </article>
                  );
                })}

                {!isSignedIn && lockedCount > 0 ? (
                  <div className="rounded-[24px] border border-amber-300/20 bg-amber-300/8 p-5 text-sm leading-6 text-amber-50/78">
                    還有 {lockedCount} 筆完整 Decision Journal 已鎖定。登入會員後可查看最近 30 個有效驗證交易日。
                  </div>
                ) : null}
              </div>
            </section>

            {validEntries.length >= 3 ? (
              <section className="mt-10 grid gap-4 lg:grid-cols-2">
                <div className="ma-card md:p-6">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-200/75">
                    <CheckCircle2 size={15} strokeWidth={1.8} />
                    Best Case
                  </div>
                  <h2 className="mt-3 text-2xl font-semibold text-white">最佳成立案例</h2>
                  {bestCase ? (
                    <div className="mt-4 text-sm leading-7 text-slate-300">
                      <p className="font-semibold text-white">{bestCase.marketDate}</p>
                      <p className="mt-2">{bestCase.whatWasRight[0] || bestCase.closingSummary}</p>
                    </div>
                  ) : (
                    <p className="mt-4 text-sm text-slate-500">目前尚無完整成立案例。</p>
                  )}
                </div>
                <div className="ma-card md:p-6">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-rose-200/75">
                    <Target size={15} strokeWidth={1.8} />
                    Correction Case
                  </div>
                  <h2 className="mt-3 text-2xl font-semibold text-white">需要修正案例</h2>
                  {failedCase ? (
                    <div className="mt-4 text-sm leading-7 text-slate-300">
                      <p className="font-semibold text-white">{failedCase.marketDate}</p>
                      <p className="mt-2">{failedCase.whatWasWrong[0] || failedCase.correctionSummary}</p>
                    </div>
                  ) : (
                    <p className="mt-4 text-sm text-slate-500">目前沒有已完成驗證的失敗案例。</p>
                  )}
                </div>
              </section>
            ) : null}

            {lessons.length > 0 ? (
              <section className="ma-card mt-10 overflow-hidden md:p-6">
                <div className="flex gap-4">
                  <div className="w-1 flex-shrink-0 rounded-full bg-primary-500" />
                  <div className="min-w-0 flex-1">
                    <h2 className="text-2xl font-semibold text-white">本月最大的修正</h2>
                    <ul className="mt-4 grid gap-3 md:grid-cols-2">
                      {lessons.map((lesson, index) => (
                        <li key={`${lesson}-${index}`} className="rounded-2xl bg-slate-950/30 p-4 text-sm leading-7 text-slate-300">
                          {lesson}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </section>
            ) : null}
          </>
        )}

        <section className="ma-card mt-10 md:p-6">
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} strokeWidth={1.8} className="text-primary-300" />
            <h2 className="text-xl font-semibold text-white">統計規則</h2>
          </div>
          <ul className="mt-4 grid gap-3 md:grid-cols-2">
            <RuleItem icon={CalendarCheck}>完成盤前報告與收盤驗證才納入統計。</RuleItem>
            <RuleItem icon={Ban}>休市、待驗證、資料不完整不列入成功率。</RuleItem>
            <RuleItem icon={Scale}>部分成立以 0.5 權重計入加權成立率。</RuleItem>
            <RuleItem icon={TrendingUp}>歷史結果只反映模型判斷紀錄，不代表投資報酬。</RuleItem>
          </ul>
        </section>
      </main>
      <Footer />
    </div>
  );
}

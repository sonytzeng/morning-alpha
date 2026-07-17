import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '@/components/feature/Navbar';
import Footer from '@/components/feature/Footer';
import ErrorBoundary from '@/components/base/ErrorBoundary';
import { resolveActiveMorningAlphaReport } from '@/services/resolveActiveReport';
import { getMorningAlphaDisplayState, type MorningAlphaDisplayState } from '@/lib/morningAlphaDisplayState';
import { buildCanonicalNarrative } from '@/lib/canonicalNarrative';
import {
  buildRuntimeDecisionTimeline,
  runtimeTimelineStatusLabel,
  type RuntimeTimelineStatus,
} from '@/lib/runtimeDecisionTimeline';
import { renderSafeText } from '@/utils/renderSafe';
import { trackPageView } from '@/utils/analytics';

type UnknownRecord = Record<string, unknown>;

type ClosingView = {
  complete: boolean;
  outcome: 'complete' | 'partial' | 'failed' | 'waiting';
  outcomeLabel: string;
  actualSummary: string;
  whatWasRight: string;
  whatWasWrong: string;
  nextAdjustment: string;
  statusNote: string;
};

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function publicVerificationText(value: unknown): string {
  return firstText(value)
    .replace(/\bSEMICONDUCTOR\b/gi, '半導體')
    .replace(/\bAI[ _-]?SERVER\b/gi, 'AI 伺服器')
    .replace(/\bTAIEX\b/gi, '加權指數')
    .replace(/\bTXF\b/gi, '台指期')
    .replace(/\b2330\b(?!\s*[／/])/g, '2330／台積電')
    .replace(/\bADR\b/gi, '海外存託憑證')
    .replace(/\bunknown\b/gi, '尚未取得')
    .replace(/Runtime checkpoint/gi, '盤中驗證節點')
    .replace(/checkpoint\s*(\d{2})(\d{2})/gi, (_match, hours: string, minutes: string) => `${hours}:${minutes} 驗證`)
    .replace(/freshness window/gi, '有效時間範圍')
    .replace(/\bphase\b/gi, '資料階段')
    .replace(/\s+/g, ' ')
    .trim();
}

function valueSummary(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return publicVerificationText(value);
  if (Array.isArray(value)) {
    return value.map(valueSummary).find(Boolean) || '';
  }
  const record = asRecord(value);
  return publicVerificationText(firstText(
    record.summary,
    record.note,
    record.action,
    record.reason,
    record.text,
    record.title,
  ));
}

function directionFromChange(change: number | null): string {
  if (change === null) return '';
  if (change >= 0.3) return `加權指數收盤上漲 ${change.toFixed(2)}%`;
  if (change <= -0.3) return `加權指數收盤下跌 ${Math.abs(change).toFixed(2)}%`;
  return `加權指數收盤震盪 ${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
}

function buildClosingView(ai: UnknownRecord): ClosingView {
  const v2 = asRecord(ai.closing_verification_v2);
  const closing = Object.keys(v2).length > 0 ? v2 : asRecord(ai.closing_verification);
  const taiex = asRecord(closing.actual_taiex_close);
  const status = firstText(closing.status, closing.verification_status).toLowerCase();
  const dataStatus = firstText(closing.data_status).toLowerCase();
  const rawOutcome = firstText(closing.hit_or_miss, closing.prediction_result, closing.result).toLowerCase();
  const actualDirection = firstText(closing.actual_direction).toLowerCase();
  const actualChange = numberOrNull(closing.actual_taiex_change)
    ?? numberOrNull(taiex.change_percent)
    ?? numberOrNull(taiex.change);
  const hasNamedDirection = Boolean(actualDirection)
    && !['unknown', 'pending', 'unavailable', 'n/a', '尚未取得', '待資料'].includes(actualDirection);
  const hasActualOutcome = hasNamedDirection || actualChange !== null;
  const complete = ['completed', 'complete', 'ready', 'done'].includes(status)
    && !['degraded', 'insufficient', 'pending'].includes(dataStatus)
    && hasActualOutcome;

  let outcome: ClosingView['outcome'] = 'waiting';
  if (complete && ['hit', 'correct', 'confirmed', 'success'].includes(rawOutcome)) outcome = 'complete';
  else if (complete && ['partial', 'mixed', 'partial_hit'].includes(rawOutcome)) outcome = 'partial';
  else if (complete && ['miss', 'wrong', 'failed', 'rejected', 'incorrect'].includes(rawOutcome)) outcome = 'failed';

  const outcomeLabel = outcome === 'complete'
    ? '完整成立'
    : outcome === 'partial'
      ? '部分成立'
      : outcome === 'failed'
        ? '未成立'
        : '等待完整收盤資料';

  return {
    complete,
    outcome,
    outcomeLabel,
    actualSummary: complete
      ? publicVerificationText(firstText(closing.actual_direction, closing.verdict_label, directionFromChange(actualChange)))
      : '收盤方向與完整驗證資料尚未同時到齊。',
    whatWasRight: complete ? valueSummary(closing.what_was_right) : '',
    whatWasWrong: complete ? valueSummary(closing.what_was_wrong) : '',
    nextAdjustment: complete ? valueSummary(closing.tomorrow_adjustment) : '',
    statusNote: complete
      ? '已取得可核對的收盤方向，這筆紀錄可進入歷史績效。'
      : '資料未完整前不判定命中，也不納入歷史績效。',
  };
}

function VerificationContent() {
  const [displayState, setDisplayState] = useState<MorningAlphaDisplayState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    trackPageView('/verification');

    async function load() {
      try {
        const resolved = await resolveActiveMorningAlphaReport();
        if (!mounted) return;
        setDisplayState(getMorningAlphaDisplayState(resolved.rawRow as unknown as UnknownRecord | null));
      } catch {
        if (mounted) setError('今日驗證資料暫時無法取得，請稍後再試。');
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();
    return () => { mounted = false; };
  }, []);

  const ai = useMemo(() => displayState?.rawAI || {}, [displayState?.rawAI]);
  const narrative = useMemo(() => buildCanonicalNarrative({ displayState, ai }), [ai, displayState]);
  const closing = useMemo(() => buildClosingView(ai), [ai]);
  const timeline = useMemo(() => buildRuntimeDecisionTimeline({
    ai,
    hasReport: Boolean(displayState?.rawRow),
    reportGeneratedAt: firstText(asRecord(displayState?.rawRow).generated_at, asRecord(displayState?.rawRow).created_at),
    isTradingDay: displayState?.is_trading_day ?? true,
  }), [ai, displayState]);

  if (loading) {
    return <div className="ma-page flex min-h-screen flex-col"><Navbar /><main className="flex-1 grid place-items-center text-white/60">正在讀取今日驗證...</main><Footer /></div>;
  }

  if (error || !displayState?.rawRow) {
    return (
      <div className="ma-page flex min-h-screen flex-col">
        <Navbar />
        <main className="flex-1 grid place-items-center px-4">
          <section className="w-full max-w-lg rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-center">
            <h1 className="text-xl font-bold text-white">今日驗證尚未可用</h1>
            <p className="mt-2 text-sm leading-relaxed text-white/60">{error || '今日報告尚未產生，請稍後再回來查看。'}</p>
            <Link to="/report/today" className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-white px-5 text-sm font-semibold text-slate-950">返回今日判斷</Link>
          </section>
        </main>
        <Footer />
      </div>
    );
  }

  const reportDate = displayState.reportDate;
  const thesis = publicVerificationText(
    narrative.decision_lifecycle.current_thesis.summary
      || narrative.today_focus.summary
      || displayState.todayQuote,
  );
  const openingSummary = publicVerificationText(
    narrative.decision_lifecycle.decision_status.reason
      || narrative.intraday_progress.current_step,
  ) || '盤中資料仍在整理。';
  const toneClass = closing.outcome === 'complete'
    ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100'
    : closing.outcome === 'failed'
      ? 'border-rose-400/30 bg-rose-400/10 text-rose-100'
      : 'border-amber-300/25 bg-amber-300/10 text-amber-100';

  return (
    <div className="ma-page flex min-h-screen flex-col overflow-x-hidden">
      <Navbar />
      <main className="flex-1">
        <header className="border-b border-white/10 bg-slate-950 px-4 py-12 md:py-16">
          <div className="mx-auto max-w-6xl">
            <p className="text-xs font-semibold tracking-[0.16em] text-sky-300">今日驗證 · {reportDate}</p>
            <h1 className="mt-4 max-w-3xl text-3xl font-bold leading-tight text-white md:text-5xl">今天的判斷走到哪裡？</h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-white/65 md:text-base">把盤前假設、盤中證據與收盤結果分開核對；資料未完成時，不把暫時訊號包裝成命中率。</p>
          </div>
        </header>

        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-6">
            <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 md:p-7">
              <span className="text-xs font-semibold tracking-[0.14em] text-white/45">盤前假設</span>
              <h2 className="mt-3 text-xl font-bold text-white md:text-2xl">{renderSafeText(thesis || '今日主線仍在整理')}</h2>
              <dl className="mt-6 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-black/20 p-4"><dt className="text-xs text-white/45">盤前方向</dt><dd className="mt-1 font-semibold text-white">{renderSafeText(displayState.marketBias)}</dd></div>
                <div className="rounded-xl bg-black/20 p-4"><dt className="text-xs text-white/45">判斷信心</dt><dd className="mt-1 font-semibold text-white">{displayState.confidenceScore == null ? '資料不足' : `${displayState.confidenceScore}/100`}</dd></div>
              </dl>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 md:p-7">
              <span className="text-xs font-semibold tracking-[0.14em] text-white/45">盤中進度</span>
              <h2 className="mt-2 text-xl font-bold text-white">每個節點只記錄已發生的結果</h2>
              <p className="mt-2 text-sm leading-6 text-white/60">{renderSafeText(openingSummary)}</p>
              <ol className="mt-6 grid gap-3 sm:grid-cols-2">
                {timeline.map((node) => (
                  <li key={`${node.time}-${node.label}`} className="rounded-xl border border-white/10 bg-black/20 p-4">
                    <div className="flex items-center justify-between gap-3"><strong className="text-white">{node.time}｜{node.label}</strong><span className="text-xs text-white/45">{runtimeTimelineStatusLabel(node.status as RuntimeTimelineStatus)}</span></div>
                    <p className="mt-2 text-sm leading-6 text-white/55">{renderSafeText(publicVerificationText(node.detail))}</p>
                  </li>
                ))}
              </ol>
            </section>

            <section className={`rounded-2xl border p-5 md:p-7 ${toneClass}`}>
              <span className="text-xs font-semibold tracking-[0.14em] opacity-65">收盤結果</span>
              <h2 className="mt-2 text-2xl font-bold">{closing.outcomeLabel}</h2>
              <p className="mt-3 text-sm leading-6 opacity-80">{renderSafeText(closing.actualSummary)}</p>
              <p className="mt-2 text-xs leading-5 opacity-65">{closing.statusNote}</p>
              {closing.complete && (
                <dl className="mt-6 grid gap-3">
                  {closing.whatWasRight && <div className="rounded-xl bg-black/15 p-4"><dt className="text-xs opacity-60">做對了什麼</dt><dd className="mt-1 text-sm leading-6">{renderSafeText(closing.whatWasRight)}</dd></div>}
                  {closing.whatWasWrong && <div className="rounded-xl bg-black/15 p-4"><dt className="text-xs opacity-60">做錯了什麼</dt><dd className="mt-1 text-sm leading-6">{renderSafeText(closing.whatWasWrong)}</dd></div>}
                  {closing.nextAdjustment && <div className="rounded-xl bg-black/15 p-4"><dt className="text-xs opacity-60">下一次改善</dt><dd className="mt-1 text-sm leading-6">{renderSafeText(closing.nextAdjustment)}</dd></div>}
                </dl>
              )}
            </section>
          </div>

          <aside className="h-fit rounded-2xl border border-white/10 bg-white/[0.04] p-5 lg:sticky lg:top-24">
            <span className="text-xs font-semibold tracking-[0.14em] text-white/45">驗證規則</span>
            <ol className="mt-4 space-y-4 text-sm leading-6 text-white/65">
              <li><strong className="mr-2 text-white">01</strong>盤前報告與收盤資料必須是同一交易日。</li>
              <li><strong className="mr-2 text-white">02</strong>必須取得真實收盤方向或漲跌幅。</li>
              <li><strong className="mr-2 text-white">03</strong>資料不足、休市與待驗證一律不計入績效。</li>
            </ol>
            <div className="mt-6 grid gap-3">
              <Link to="/report/today" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-white px-4 text-sm font-semibold text-slate-950">回到今日判斷</Link>
              <Link to="/performance" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-white/10 px-4 text-sm font-semibold text-white">查看歷史績效</Link>
            </div>
          </aside>
        </div>
      </main>
      <Footer />
    </div>
  );
}

export default function Verification() {
  return (
    <ErrorBoundary fallbackTitle="今日驗證暫時無法載入" fallbackMessage="資料讀取或畫面渲染時發生錯誤，請稍後再試。">
      <VerificationContent />
    </ErrorBoundary>
  );
}

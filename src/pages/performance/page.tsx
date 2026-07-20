import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '@/components/feature/Navbar';
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

function publicPerformanceText(value: unknown): string {
  return text(value)
    .replace(/\bTAIEX\b/gi, '加權指數')
    .replace(/\bTXF\b/gi, '台指期')
    .replace(/\b2330\b(?!\s*[／/])/g, '2330／台積電')
    .replace(/\bunknown\b/gi, '尚未取得')
    .replace(/\s+/g, ' ')
    .trim();
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
  const actualTaiexClose = asRecord(closing.actual_taiex_close);
  const actualDirection = text(closing.actual_direction).toLowerCase();
  const hasNamedDirection = Boolean(actualDirection)
    && !['unknown', 'pending', 'unavailable', 'n/a', '尚未取得', '待資料'].includes(actualDirection);
  const hasVerifiableDirection = hasNamedDirection
    || numberOrNull(closing.actual_taiex_change) !== null
    || numberOrNull(actualTaiexClose?.change_percent) !== null
    || numberOrNull(actualTaiexClose?.change) !== null;
  if (!hasVerifiableDirection) return false;
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
  if (change >= 0.3) return `加權指數收盤上漲 ${change.toFixed(2)}%`;
  if (change <= -0.3) return `加權指數收盤下跌 ${change.toFixed(2)}%`;
  return `加權指數收盤震盪 ${change.toFixed(2)}%`;
}

function buildEntry(row: ReportRecord): DecisionJournalEntry {
  const ai = row.ai_strategy_json || {};
  const closing = asRecord(ai.closing_verification_v2);
  const dataStatus = text(closing?.data_status || ai.data_status || ai.data_quality, '資料不足');
  const tradingDay = isTradingDay(ai, row);
  const hasMorningReport = Boolean(row.id && row.report_date);
  const hasClosingVerification = Boolean(closing);
  const hasCompleteVerification = isCompleteClosingData(closing);
  const rawOutcome = normalizeOutcome(closing?.hit_or_miss || closing?.prediction_result || closing?.status);
  const futureReport = isFutureReportDate(row.report_date);
  const outcome: JournalOutcome = !futureReport && tradingDay && hasMorningReport && hasCompleteVerification ? rawOutcome : 'insufficient';
  const actualTaiex = asRecord(closing?.actual_taiex_close);
  const taiexChange = numberOrNull(closing?.actual_taiex_change) ?? numberOrNull(actualTaiex?.change_percent) ?? numberOrNull(actualTaiex?.change);
  const right = listFromUnknown(closing?.what_was_right).map(publicPerformanceText).filter(Boolean);
  const wrong = listFromUnknown(closing?.what_was_wrong).map(publicPerformanceText).filter(Boolean);
  const adjustment = listFromAdjustment(closing?.tomorrow_adjustment).map(publicPerformanceText).filter(Boolean);
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
    marketBias: publicPerformanceText(firstText(row.market_bias, ai.market_bias, closing?.opening_bias, '尚未結構化')),
    closingSummary: publicPerformanceText(firstText(closing?.actual_direction, closing?.verdict_label, directionFromChange(taiexChange))),
    correctionSummary: publicPerformanceText(firstText(wrong[0], adjustment[0], '本日尚未留下結構化修正')),
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
            ? '目前無法讀取公開績效資料。請登入會員後查看完整決策帳本。'
            : '決策帳本暫時無法載入，請稍後再試。',
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
  const stats = useMemo(() => calculateStats(entries.filter((entry) => validEntries.includes(entry) || entry.outcome === 'insufficient')), [entries, validEntries]);
  const lessons = useMemo(() => validEntries.flatMap((entry) => [...entry.whatWasWrong, ...entry.tomorrowAdjustment]).filter(Boolean).slice(0, 5), [validEntries]);
  const insufficientCount = entries.filter((entry) => entry.outcome === 'insufficient').length;
  const lockedCount = Math.max(0, validEntries.length - visibleEntries.length);
  const hasMatureSample = stats.validCount >= 20;

  return (
    <div className="ma-page ma-performance-page ma-performance-v3 flex flex-col overflow-x-hidden">
      <Navbar />
      <main className="flex-1 overflow-x-hidden">
        <header className="ma-performance-v3-header">
          <div className="ma-performance-v3-shell">
            <span>公開決策帳本</span>
            <h1>績效不是宣傳數字，<br />是每一天可回看的驗證紀錄</h1>
            <p>{hasMatureSample ? '只計入完成收盤驗證的交易日，並保留成功、失敗與下一次改善。' : `目前累積 ${stats.validCount} 個有效交易日；樣本未滿 20 日前，不用小樣本包裝命中率。`}</p>
          </div>
        </header>

        <div className="ma-performance-v3-shell ma-performance-v3-content">
          {loading ? (
            <div className="ma-performance-v3-state" aria-live="polite">正在讀取公開驗證紀錄...</div>
          ) : errorMessage ? (
            <div className="ma-performance-v3-state is-warning"><strong>歷史績效暫時無法完整顯示</strong><p>{errorMessage}</p></div>
          ) : stats.validCount === 0 ? (
            <div className="ma-performance-v3-state"><strong>目前沒有可計入績效的完整收盤紀錄</strong><p>只有同一交易日、具真實收盤方向且資料狀態完整的驗證才會列入；資料不足與部分完成紀錄不會拿來填充績效。</p></div>
          ) : (
            <>
              <section className="ma-performance-v3-summary" aria-label="驗證摘要">
                <div><span>有效交易日</span><strong>{stats.validCount}</strong><p>完成條件後才計入</p></div>
                <div><span>完整成立</span><strong>{stats.complete}</strong><p>有收盤資料可回看</p></div>
                <div><span>{hasMatureSample ? '加權命中率' : '樣本狀態'}</span><strong>{hasMatureSample ? pct(stats.weightedSuccessRate) : `${stats.validCount}/20`}</strong><p>{hasMatureSample ? '部分成立以 0.5 計' : '滿 20 日後再顯示比率'}</p></div>
                <div><span>排除資料</span><strong>{insufficientCount}</strong><p>休市、待驗證或不完整</p></div>
              </section>

              <section className="ma-performance-v3-ledger" aria-labelledby="performance-ledger-title">
                <header><div><span>逐日紀錄</span><h2 id="performance-ledger-title">驗證帳本</h2></div><p>點開任一日期，查看當天成功、失敗與改善。</p></header>
                <div className="ma-performance-v3-ledger-head" aria-hidden="true"><span>日期</span><span>盤前方向</span><span>收盤結果</span><span>判定</span></div>
                {visibleEntries.map((entry) => {
                  const expanded = expandedId === entry.reportId;
                  return (
                    <article key={entry.reportId} className={`is-${entry.outcome}`}>
                      <button type="button" onClick={() => setExpandedId(expanded ? null : entry.reportId)} aria-expanded={expanded}>
                        <time>{entry.marketDate}</time><span>{entry.marketBias}</span><span>{entry.closingSummary}</span><em>{OUTCOME_LABEL[entry.outcome]}<i className={`ri-arrow-${expanded ? 'up' : 'down'}-s-line`} aria-hidden="true" /></em>
                      </button>
                      {expanded && (
                        <div className="ma-performance-v3-ledger-detail">
                          <div><strong>做對了什麼</strong><p>{entry.whatWasRight[0] || '本日尚未留下結構化成功原因。'}</p></div>
                          <div><strong>做錯了什麼</strong><p>{entry.whatWasWrong[0] || '本日尚未留下結構化失敗原因。'}</p></div>
                          <div><strong>下一次改善</strong><p>{entry.tomorrowAdjustment[0] || entry.correctionSummary}</p></div>
                          <Link to={`/reports/${entry.marketDate}`}>查看當日報告<i className="ri-arrow-right-line" aria-hidden="true" /></Link>
                        </div>
                      )}
                    </article>
                  );
                })}
              </section>

              {lockedCount > 0 && (
                <section className="ma-performance-v3-locked">
                  <div><span>尚有 {lockedCount} 筆驗證紀錄</span><p>登入後可回看完整逐日帳本；會員方案開放前可先登記通知。</p></div>
                  <Link to="/pricing#early-access">查看會員計畫<i className="ri-arrow-right-line" aria-hidden="true" /></Link>
                </section>
              )}

              <section className="ma-performance-v3-method" aria-labelledby="performance-method-title">
                <header><span>統計方法</span><h2 id="performance-method-title">哪些資料會被計入？</h2></header>
                <ol><li><span>01</span><p>只計入正常交易日。</p></li><li><span>02</span><p>必須存在完整收盤驗證。</p></li><li><span>03</span><p>資料不足與休市樣本明確排除。</p></li></ol>
                {lessons[0] && <blockquote><span>最近改善</span><p>{lessons[0]}</p></blockquote>}
              </section>
            </>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import ErrorBoundary from '@/components/base/ErrorBoundary';
import Footer from '@/components/feature/Footer';
import Navbar from '@/components/feature/Navbar';
import { useLatestReport } from '@/hooks/useLatestReport';
import { buildCanonicalNarrative } from '@/lib/canonicalNarrative';
import { getMorningAlphaDisplayState, type MorningAlphaDisplayState } from '@/lib/morningAlphaDisplayState';
import { reconcileRuntimeTimeline, runtimeTimelineStatusLabel, selectNextRuntimeTimelineNode } from '@/lib/runtimeDecisionTimeline';
import { formatTaipeiDate, resolveMarketStatus } from '@/utils/tradingDay';
import type { WarRoomTimelineStatus } from './warRoomPresentationMapper';
import { humanizePublicRuntimeText } from '@/utils/publicRuntimeCopy';
import { SubscriberAnswer } from '@/features/decision-v1/DecisionBrief';
import { intradayAnswer } from '@/features/decision-v1/presentation';
import { SUBSCRIBER_ANALYSIS_INCOMPLETE, type SubscriberCheckpointKey } from '@/lib/subscriberReportContract';
import { getSubscriberReportProjection } from '@/lib/subscriberReportProjection';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function safeText(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function publicWarRoomText(value: unknown, fallback = '尚未取得'): string {
  const text = humanizePublicRuntimeText(safeText(value, fallback))
    .replace(/MAIN_THESIS/gi, '今日主線')
    .replace(/CAPITAL_NEXT/gi, '資金下一站')
    .replace(/CONFIRMATION/gi, '確認條件')
    .replace(/EXTERNAL/gi, '外部變數')
    .replace(/RISK/gi, '風險觀察')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text || fallback;
}

function timelineDetail(status: WarRoomTimelineStatus): string {
  if (status === 'completed') return '本節點資料已到位';
  if (status === 'insufficient') return '資料不完整，本節點未升級判斷';
  if (status === 'current') return '正在等待本節點的新資料';
  if (status === 'not_applicable') return '今天不適用此驗證節點';
  return '尚未到達驗證時間';
}

export default function WarRoom() {
  return (
    <ErrorBoundary
      fallbackTitle="盤中追蹤暫時無法載入"
      fallbackMessage="資料讀取或畫面渲染時發生錯誤，請稍後再試。"
    >
      <WarRoomContent />
    </ErrorBoundary>
  );
}

function WarRoomContent() {
  const {
    report,
    isLoading,
    error,
    morningState,
  } = useLatestReport();

  const todayTaipeiStr = formatTaipeiDate();
  const canonicalMarketStatus = resolveMarketStatus(todayTaipeiStr);
  const isWeekend = canonicalMarketStatus.market_status === 'WEEKEND';
  const displayState: MorningAlphaDisplayState | null = useMemo(() => {
    if (!morningState?.resolveResult?.rawRow) return null;
    return getMorningAlphaDisplayState(
      (morningState.resolveResult.rawRow as unknown as Record<string, unknown>) ?? null,
    );
  }, [morningState]);
  const reportAI = isRecord(report?.ai_strategy_json)
    ? report.ai_strategy_json as Record<string, unknown>
    : null;
  const rawAI = displayState?.rawAI ?? reportAI;
  const projection = getSubscriberReportProjection(displayState?.rawRow || report, { todayDate: todayTaipeiStr });
  const analysisUnavailable = !projection.analysisAvailable;
  const marketClosedInfo = displayState
    ? { closed: displayState.market_status !== 'OPEN', holidayName: displayState.holidayName }
    : { closed: isWeekend, holidayName: isWeekend ? '週末休市' : null as string | null };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-navy-950 flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center" aria-live="polite">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-white/20 border-t-amber-400/60 rounded-full animate-spin mx-auto mb-3" />
            <span className="text-white/50 text-sm">正在整理盤中變化...</span>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (marketClosedInfo.closed) {
    const nextDate = displayState?.nextTradingDate || '尚未公布';
    const nextWeekday = displayState?.nextTradingWeekday || '';
    return (
      <div className="min-h-screen bg-navy-950 flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="max-w-md text-center bg-navy-900/70 border border-red-500/20 rounded-2xl p-6">
            <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-red-500/10 border border-red-400/20 flex items-center justify-center" aria-hidden="true">
              <i className="ri-calendar-close-line text-red-300 text-2xl" />
            </div>
            <h1 className="text-white font-bold text-xl mb-2">今天沒有盤中驗證</h1>
            <p className="text-slate-400 text-sm mb-1">
              {displayState?.currentDate || report?.report_date || todayTaipeiStr}（{displayState?.currentWeekday || ''}）
            </p>
            <p className="text-slate-500 text-sm mb-4">
              {displayState?.holidayName || marketClosedInfo.holidayName || '市場休市'}
            </p>
            <div className="bg-navy-800/70 border border-navy-700/70 rounded-xl p-4 mb-5">
              <p className="text-slate-400 text-xs mb-1">下一個交易日</p>
              <p className="text-white font-bold text-base">{nextDate}{nextWeekday ? `（${nextWeekday}）` : ''}</p>
            </div>
            <Link to="/report/today" className="inline-flex min-h-11 items-center px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-sm border border-white/10">
              查看最近判斷
            </Link>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="min-h-screen bg-navy-950 flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="text-center max-w-md">
            <i className="ri-radar-line text-white/20 text-3xl mb-3" aria-hidden="true" />
            <h1 className="text-white font-semibold text-base mb-2">
              {error ? '盤中資料暫時讀取失敗' : '今天尚無可追蹤的判斷'}
            </h1>
            <p className="text-white/50 text-sm mb-4">目前無法建立盤中監控畫面，稍後重新整理即可。</p>
            <Link to="/report/today" className="inline-flex min-h-11 items-center px-4 py-2 bg-white/10 hover:bg-white/15 text-white text-sm rounded-xl transition-colors border border-white/10">
              返回今日判斷
            </Link>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (projection.historical) {
    return (
      <div className="min-h-screen bg-navy-950 flex flex-col">
        <Navbar marketStatusLabel="等待今日盤中資料" />
        <main className="flex-1 flex items-center justify-center px-4" data-subscriber-state={projection.displayStatus} data-report-date={projection.identity.reportDate} data-revision-id={projection.identity.revisionId || ''}>
          <div className="max-w-md text-center bg-navy-900/70 border border-amber-400/20 rounded-2xl p-6">
            <i className="ri-time-line text-amber-300 text-3xl" aria-hidden="true" />
            <h1 className="text-white font-bold text-xl mt-3">今天尚未建立盤中追蹤</h1>
            <p className="text-slate-400 text-sm mt-2">目前最新報告是 {projection.identity.reportDate}，不會把歷史時間軸冒充成今天進度。</p>
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <Link to="/report/today" className="inline-flex min-h-11 items-center px-4 py-2 rounded-xl bg-emerald-500 text-navy-950 text-sm font-semibold">返回今日判斷</Link>
              <Link to={`/reports/${projection.identity.reportDate}`} className="inline-flex min-h-11 items-center px-4 py-2 rounded-xl border border-white/10 text-white text-sm">查看 {projection.identity.reportDate} 歷史報告</Link>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  const canonicalNarrative = buildCanonicalNarrative({ displayState, ai: rawAI });
  const decisionReason = publicWarRoomText(projection.marketDecision.summary || projection.statusLabel, '目前沒有足夠新證據升級早上的判斷。');
  // Raw runtime labels never establish subscriber evidence. The shared
  // projection has already bound each checkpoint to this report and revision.
  const checkpointLabels: Array<[SubscriberCheckpointKey, string, string]> = [
    ['0900', '09:00', '開盤資料'], ['0930', '09:30', '開盤驗證'],
    ['1030', '10:30', '主線確認'], ['1300', '13:00', '午後追蹤'],
    ['1410', '14:10', '收盤資料'], ['1430', '14:30', '收盤驗證'],
  ];
  const timeline = reconcileRuntimeTimeline(checkpointLabels.map(([key, time, label]) => {
    const proof = projection.runtime.checkpoints[key];
    return { time, label, status: proof.status === 'failed' ? 'insufficient' as const : proof.status };
  })).map((node) => {
    const status = node.time === '14:30' && projection.closing.state === 'NOT_DUE' ? 'pending' as const : node.status;
    return { ...node, status, statusLabel: runtimeTimelineStatusLabel(status) };
  });
  const currentNode = selectNextRuntimeTimelineNode(timeline);
  const nextCheckpoint = currentNode
    ? `${currentNode.time}｜${currentNode.label}`
    : '等待下一次驗證';
  const hasNewIntradayEvidence = projection.runtime.newIntradayEvidence;
  const feedTimeline = [
    ...timeline.filter((item) => item.status === 'current'),
    ...timeline.filter((item) => !['current', 'pending'].includes(item.status)).reverse(),
    ...timeline.filter((item) => item.status === 'pending'),
  ];
  const answer = analysisUnavailable
    ? { title: SUBSCRIBER_ANALYSIS_INCOMPLETE, action: '等待正式市場判斷，不把候選分析當成失效劇本', tone: 'amber' as const }
    : intradayAnswer({
      status: projection.marketDecision.action === 'ACT' ? 'confirmed' : '',
      runtimeFailure: projection.marketDecision.runtimeFailure,
      confirmedEvidence: projection.runtime.confirmedIntradayEvidence,
      closing: projection.closing.outcome || '',
    });
  const action = projection.marketDecision.label;
  const statusLabel = analysisUnavailable
    ? '分析尚未完成'
    : projection.closing.complete
    ? '收盤驗證完成'
    : currentNode?.status === 'current'
      ? '監控中'
      : currentNode?.statusLabel || '等待驗證';

  const completedIntradaySteps = hasNewIntradayEvidence
    ? Array.from(new Set(canonicalNarrative.intraday_progress.completed_steps
      .map((item) => publicWarRoomText(item, ''))
      .filter(Boolean))).slice(0, 3)
    : [];
  const changeCondition = hasNewIntradayEvidence
    ? publicWarRoomText(
      canonicalNarrative.decision_lifecycle.failure_condition.trigger,
      '出現足以推翻早上判斷的新訊號',
    )
    : `等 ${nextCheckpoint} 取得完整資料後再判斷`;

  if (analysisUnavailable) {
    return (
      <div className="ma-page ma-war-room-page ma-war-room-v3 flex min-h-screen flex-col">
        <Navbar />
        <main className="flex-1" data-subscriber-state={projection.displayStatus} data-report-date={projection.identity.reportDate} data-revision-id={projection.identity.revisionId || ''}>
          <SubscriberAnswer question="早上的判斷有沒有改變？" date={projection.identity.reportDate}
            answer={projection.title} reason={projection.statusLabel} tone="amber">
            <p>判斷信心：{projection.confidence.label}</p>
            <p>{projection.marketDecision.label}</p>
          </SubscriberAnswer>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="ma-page ma-war-room-page ma-war-room-v3 flex flex-col overflow-x-hidden">
      <Navbar />
      <main className="flex-1 overflow-x-hidden" data-subscriber-state={projection.displayStatus} data-report-date={projection.identity.reportDate} data-revision-id={projection.identity.revisionId || ''}>
        <SubscriberAnswer question="早上的判斷有沒有改變？" date={projection.identity.reportDate}
          answer={answer.title} reason={decisionReason} tone={answer.tone}>
          <div className="ma-subscriber-three-answers"><div><h2>現在怎麼做</h2><strong>{action}</strong></div><div><h2>驗證狀態</h2><strong>{statusLabel}</strong></div></div>
        </SubscriberAnswer>

        <div className="ma-war-room-v3-shell ma-war-room-v3-layout">
          <div className="ma-war-room-v3-main">
            <details className="ma-war-room-v3-section ma-subscriber-timeline">
              <summary>展開已發生的盤中驗證紀錄</summary>
              <div className="ma-war-room-v3-section-heading">
                <div><span>即時紀錄</span><h2 id="war-room-updates-title">盤中更新</h2></div>
                <p>先看現在，再回看已發生；未到時間的節點排在後面。</p>
              </div>
              <ol className="ma-war-room-v3-feed">
                {feedTimeline.map((item) => (
                  <li key={item.time} className={`is-${item.status}`}>
                    <time>{item.time}</time>
                    <div>
                      <strong>{item.label}</strong>
                      <p>{timelineDetail(item.status)}</p>
                    </div>
                    <span>{item.statusLabel}</span>
                  </li>
                ))}
              </ol>
            </details>

            {!hasNewIntradayEvidence ? (
              <section className="ma-war-room-v3-section" aria-labelledby="war-room-waiting-title">
                <div className="ma-war-room-v3-no-update">
                  <i className="ri-time-line" aria-hidden="true" />
                  <div>
                    <span>目前狀態</span>
                    <h2 id="war-room-waiting-title">還沒有新的盤中更新</h2>
                    <p>正在等待 {nextCheckpoint} 的資料。資料到齊前，不重複顯示盤前內容，也不改變原判斷。</p>
                  </div>
                </div>
              </section>
            ) : (
              <section className="ma-war-room-v3-section" aria-labelledby="war-room-delta-title">
                <div className="ma-war-room-v3-section-heading">
                  <div><span>盤中變化</span><h2 id="war-room-delta-title">跟早上相比，哪裡變了？</h2></div>
                  <p>只呈現盤中新增的結果，不重播盤前報告與候選名單。</p>
                </div>
                <div className="ma-war-room-v3-delta-grid">
                  <article className="is-support">
                    <h3><i className="ri-pulse-line" aria-hidden="true" />這次多了什麼</h3>
                    {completedIntradaySteps.length > 0
                      ? completedIntradaySteps.map((item) => <p key={item}>{item}</p>)
                      : <p className="is-empty">本次更新沒有增加可用證據。</p>}
                  </article>
                  <article className="is-risk">
                    <h3><i className="ri-compass-3-line" aria-hidden="true" />判斷有沒有改變</h3>
                    <p>{action}</p>
                    <p>{decisionReason}</p>
                  </article>
                </div>
              </section>
            )}
          </div>

          <aside className="ma-war-room-v3-action-rail" aria-labelledby="war-room-action-title">
            <span>現在怎麼做</span>
            <h2 id="war-room-action-title">{action}</h2>
            <dl>
              <div><dt>目前節點</dt><dd>{nextCheckpoint}</dd></div>
              <div><dt>判斷理由</dt><dd>{decisionReason}</dd></div>
              <div><dt>何時改變</dt><dd>{changeCondition}</dd></div>
            </dl>
            <Link to="/report/today">回看今日判斷<i className="ri-arrow-right-line" aria-hidden="true" /></Link>
          </aside>
        </div>

        <nav className="ma-war-room-v3-shell ma-war-room-v3-next" aria-label="後續流程">
          <div><span>接著查看</span><p>把今天的判斷一路追蹤到收盤。</p></div>
          <Link to="/verification">收盤驗證<i className="ri-arrow-right-line" aria-hidden="true" /></Link>
          <Link to="/performance">歷史績效<i className="ri-arrow-right-line" aria-hidden="true" /></Link>
        </nav>
      </main>
      <Footer />
    </div>
  );
}

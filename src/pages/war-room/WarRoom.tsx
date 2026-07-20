import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import ErrorBoundary from '@/components/base/ErrorBoundary';
import Footer from '@/components/feature/Footer';
import Navbar from '@/components/feature/Navbar';
import { useLatestReport } from '@/hooks/useLatestReport';
import { buildCanonicalNarrative } from '@/lib/canonicalNarrative';
import { getRuntimeCheckpointState } from '@/lib/decisionEvidence';
import { getMorningAlphaDisplayState, type MorningAlphaDisplayState } from '@/lib/morningAlphaDisplayState';
import { selectNextRuntimeTimelineNode } from '@/lib/runtimeDecisionTimeline';
import { buildMarketState, type MarketState } from '@/services/marketStateEngine';
import {
  computeSectorRotationFreshness,
  type SectorRotationFreshness,
} from '@/services/sectorRotationService';
import { formatTaipeiDate, resolveMarketStatus } from '@/utils/tradingDay';
import {
  buildWarRoomClosingState,
  buildWarRoomTimeline,
  type WarRoomTimelineStatus,
} from './warRoomPresentationMapper';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function safeText(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function publicWarRoomText(value: unknown, fallback = '尚未取得'): string {
  const text = safeText(value, fallback)
    .replace(/checkpoint\s*0?9:?30/gi, '09:30 驗證')
    .replace(/checkpoint\s*10:?30/gi, '10:30 驗證')
    .replace(/checkpoint\s*13:?00/gi, '13:30 驗證')
    .replace(/freshness window/gi, '有效時間範圍')
    .replace(/\bSEMICONDUCTOR\b/gi, '半導體')
    .replace(/\bTAIEX\b/gi, '加權指數')
    .replace(/\bTXF\b/gi, '台指期')
    .replace(/\bAI[ _-]?SERVER\b/gi, 'AI 伺服器')
    .replace(/\bADR\b/gi, '海外存託憑證')
    .replace(/\bphase\b/gi, '資料階段')
    .replace(/\bunknown\b/gi, '尚未取得')
    .replace(/\bpending\b/gi, '等待驗證')
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
    openingRadar,
    marketData,
    marketDataTodayOnly,
    todayCloseVerification,
    morningState,
  } = useLatestReport();
  const [sectorFreshness, setSectorFreshness] = useState<SectorRotationFreshness | null>(null);

  const todayTaipeiStr = formatTaipeiDate();
  const canonicalMarketStatus = resolveMarketStatus(todayTaipeiStr);
  const isNonTradingDay = canonicalMarketStatus.market_status !== 'OPEN';
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
  const closingVerificationV2 = isRecord(rawAI?.closing_verification_v2)
    ? rawAI.closing_verification_v2
    : null;
  const publicClosingVerification = isRecord(rawAI?.closing_verification)
    ? rawAI.closing_verification
    : null;
  const runtimeSyncStatus = isRecord(rawAI?.intraday_sync_status)
    ? rawAI.intraday_sync_status
    : null;
  const hasVerifiedClose = todayCloseVerification?.data_quality === 'verified';
  const marketClosedInfo = displayState
    ? { closed: displayState.market_status !== 'OPEN', holidayName: displayState.holidayName }
    : { closed: isWeekend, holidayName: isWeekend ? '週末休市' : null as string | null };

  const marketState: MarketState = buildMarketState({
    todayReport: report,
    todayOpeningRadar: openingRadar,
    todayMarketData: marketDataTodayOnly ?? marketData ?? null,
    todayCloseVerification,
    sectorRotationFreshness: sectorFreshness,
  });

  useEffect(() => {
    const result = morningState?.sectorRotationState;
    if (!result) {
      setSectorFreshness(null);
      return;
    }
    const hasCloseVerification = hasVerifiedClose
      && todayCloseVerification?.report_date === todayTaipeiStr;
    const hasIntradayCheckpoint = ['0930', '1030', '1300']
      .some((checkpoint) => getRuntimeCheckpointState(runtimeSyncStatus, checkpoint) === 'completed');
    let phaseForFreshness = 'intraday';
    if (isNonTradingDay) phaseForFreshness = 'pre_market';
    else if (hasCloseVerification) phaseForFreshness = 'after_close_verified';
    else if (!hasIntradayCheckpoint) phaseForFreshness = 'pre_market';
    setSectorFreshness(computeSectorRotationFreshness(result, todayTaipeiStr, phaseForFreshness));
  }, [
    hasVerifiedClose,
    isNonTradingDay,
    morningState?.sectorRotationState,
    runtimeSyncStatus,
    todayCloseVerification,
    todayTaipeiStr,
  ]);

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

  if (report.report_date !== todayTaipeiStr) {
    return (
      <div className="min-h-screen bg-navy-950 flex flex-col">
        <Navbar marketStatusLabel="等待今日盤中資料" />
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="max-w-md text-center bg-navy-900/70 border border-amber-400/20 rounded-2xl p-6">
            <i className="ri-time-line text-amber-300 text-3xl" aria-hidden="true" />
            <h1 className="text-white font-bold text-xl mt-3">今天尚未建立盤中追蹤</h1>
            <p className="text-slate-400 text-sm mt-2">目前最新報告是 {report.report_date}，不會把歷史時間軸冒充成今天進度。</p>
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <Link to="/report/today" className="inline-flex min-h-11 items-center px-4 py-2 rounded-xl bg-emerald-500 text-navy-950 text-sm font-semibold">返回今日判斷</Link>
              <Link to={`/reports/${report.report_date}`} className="inline-flex min-h-11 items-center px-4 py-2 rounded-xl border border-white/10 text-white text-sm">查看 {report.report_date} 歷史報告</Link>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  const canonicalNarrative = buildCanonicalNarrative({ displayState, ai: rawAI });
  const decisionStatus = canonicalNarrative.decision_lifecycle.decision_status;
  const decisionState = safeText(decisionStatus.status).toLowerCase();
  const decisionReason = publicWarRoomText(decisionStatus.reason, '目前沒有足夠新證據升級早上的判斷。');
  const closingState = buildWarRoomClosingState({
    closingVerificationV2,
    publicClosingVerification,
    todayCloseVerification,
  });
  const timeline = buildWarRoomTimeline({
    intradaySyncStatus: runtimeSyncStatus,
    openingRadar: isRecord(openingRadar) ? openingRadar : null,
    closingVerificationV2,
    publicClosingVerification,
    todayCloseVerification,
    isTradingDay: !isNonTradingDay,
  });
  const currentNode = selectNextRuntimeTimelineNode(timeline);
  const nextCheckpoint = currentNode
    ? `${currentNode.time}｜${currentNode.label}`
    : '等待下一次驗證';
  const hasNewIntradayEvidence = closingState.isPostClose
    || getRuntimeCheckpointState(runtimeSyncStatus, '1030') === 'completed'
    || getRuntimeCheckpointState(runtimeSyncStatus, '1300') === 'completed';
  const feedTimeline = [
    ...timeline.filter((item) => item.status === 'current'),
    ...timeline.filter((item) => !['current', 'pending'].includes(item.status)).reverse(),
    ...timeline.filter((item) => item.status === 'pending'),
  ];
  const action = decisionState === 'rejected'
    ? '停止沿用早上的判斷'
    : decisionState === 'confirmed' || decisionState === 'completed'
      ? '維持原計畫，不追價'
      : '先不改變早上的判斷';
  const headline = decisionState === 'rejected'
    ? '盤中證據已推翻早上的判斷'
    : decisionState === 'confirmed' || decisionState === 'completed'
      ? '盤中證據仍支持早上的判斷'
      : '目前沒有新資料足以改變早上的判斷';
  const statusLabel = closingState.isPostClose
    ? closingState.label
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

  return (
    <div className="ma-page ma-war-room-page ma-war-room-v3 flex flex-col overflow-x-hidden">
      <Navbar marketState={marketState} />
      <main className="flex-1 overflow-x-hidden">
        <header className="ma-war-room-v3-console-header">
          <div className="ma-war-room-v3-shell">
            <div className="ma-war-room-v3-console-meta">
              <span><i className="ri-pulse-line" aria-hidden="true" />盤中監控中</span>
              <time dateTime={report.report_date}>{report.report_date}</time>
              <strong className={`is-${currentNode?.status || 'pending'}`}>{statusLabel}</strong>
            </div>
            <h1>{headline}</h1>
            <p>{decisionReason}</p>
          </div>
        </header>

        <div className="ma-war-room-v3-shell ma-war-room-v3-layout">
          <div className="ma-war-room-v3-main">
            <section className="ma-war-room-v3-section" aria-labelledby="war-room-updates-title">
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
            </section>

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

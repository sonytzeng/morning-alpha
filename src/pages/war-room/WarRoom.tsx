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
  type SectorRotationItem,
} from '@/services/sectorRotationService';
import { formatTaipeiDate, resolveMarketStatus } from '@/utils/tradingDay';
import {
  buildWarRoomClosingState,
  buildWarRoomObservationCards,
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

function safeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatPercent(value: number | null): string {
  if (value === null) return '尚未取得';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
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
  const [sectorData, setSectorData] = useState<SectorRotationItem[]>([]);
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
      setSectorData([]);
      setSectorFreshness(null);
      return;
    }
    setSectorData(result.items);
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
  const action = decisionState === 'rejected'
    ? '停止沿用早上的判斷'
    : decisionState === 'confirmed' || decisionState === 'completed'
      ? '維持原計畫，不追價'
      : '暫不升級決策';
  const headline = decisionState === 'rejected'
    ? '盤中證據已推翻早上的判斷'
    : decisionState === 'confirmed' || decisionState === 'completed'
      ? '盤中證據仍支持早上的判斷'
      : '目前沒有足夠新證據改變早上判斷';
  const statusLabel = closingState.isPostClose
    ? closingState.label
    : currentNode?.status === 'current'
      ? '監控中'
      : currentNode?.statusLabel || '等待驗證';

  const tsmcChange = safeNumber(openingRadar?.tsmc_change);
  const taiexChange = safeNumber(openingRadar?.taiex_change);
  const txfChange = safeNumber(openingRadar?.txf_change);
  const evidenceRows = [
    { label: '台積電', value: formatPercent(tsmcChange), state: tsmcChange === null ? 'missing' : 'ready' },
    { label: '加權指數', value: formatPercent(taiexChange), state: taiexChange === null ? 'missing' : 'ready' },
    { label: '台指期', value: formatPercent(txfChange), state: txfChange === null ? 'missing' : 'ready' },
    {
      label: '主線族群',
      value: publicWarRoomText(sectorData[0]?.sector, '尚未確認'),
      state: sectorFreshness?.canUseAsTodayStrategy ? 'ready' : 'missing',
    },
  ];

  const supportingSignals = Array.from(new Set([
    ...canonicalNarrative.intraday_progress.completed_steps,
    ...evidenceRows.filter((item) => item.state === 'ready').map((item) => `${item.label} ${item.value}`),
  ].map((item) => publicWarRoomText(item, '')).filter(Boolean))).slice(0, 3);
  const opposingSignals = Array.from(new Set([
    canonicalNarrative.decision_lifecycle.failure_condition.trigger,
    ...canonicalNarrative.failure_triggers.map((item) => item.trigger),
  ].map((item) => publicWarRoomText(item, '')).filter(Boolean))).slice(0, 3);
  const observations = buildWarRoomObservationCards({
    sources: [
      ...(displayState?.v10ObservationWatchlist || []),
      ...(displayState?.coreBeneficiaryStocks || []),
    ],
    closingVerificationV2,
    publicClosingVerification,
    todayCloseVerification,
    fallbackNext: nextCheckpoint,
    fallbackStop: canonicalNarrative.decision_lifecycle.failure_condition.trigger,
    limit: 4,
  });

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
                <div><span>即時紀錄</span><h2 id="war-room-updates-title">最新異動</h2></div>
                <p>只記錄會改變決策的節點，不重複整份盤前報告。</p>
              </div>
              <ol className="ma-war-room-v3-feed">
                {[...timeline].reverse().map((item) => (
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

            <section className="ma-war-room-v3-section" aria-labelledby="war-room-evidence-title">
              <div className="ma-war-room-v3-section-heading">
                <div><span>同步狀態</span><h2 id="war-room-evidence-title">證據矩陣</h2></div>
                <p>缺少的來源直接標示，不拿不完整資料補結論。</p>
              </div>
              <div className="ma-war-room-v3-evidence-table" role="table" aria-label="盤中證據狀態">
                {evidenceRows.map((item) => (
                  <div key={item.label} role="row">
                    <span role="cell">{item.label}</span>
                    <strong role="cell">{item.value}</strong>
                    <em role="cell" className={`is-${item.state}`}>{item.state === 'ready' ? '已取得' : '待補資料'}</em>
                  </div>
                ))}
              </div>
            </section>

            <section className="ma-war-room-v3-section" aria-labelledby="war-room-delta-title">
              <div className="ma-war-room-v3-section-heading">
                <div><span>決策差異</span><h2 id="war-room-delta-title">與盤前相比</h2></div>
                <p>只看新增支持與新增風險，避免把原報告再讀一次。</p>
              </div>
              <div className="ma-war-room-v3-delta-grid">
                <article className="is-support">
                  <h3><i className="ri-add-circle-line" aria-hidden="true" />新增支持</h3>
                  {supportingSignals.length > 0
                    ? supportingSignals.map((item) => <p key={item}>{item}</p>)
                    : <p className="is-empty">目前沒有新增支持證據。</p>}
                </article>
                <article className="is-risk">
                  <h3><i className="ri-error-warning-line" aria-hidden="true" />新增風險</h3>
                  {opposingSignals.length > 0
                    ? opposingSignals.map((item) => <p key={item}>{item}</p>)
                    : <p className="is-empty">目前沒有新增風險訊號。</p>}
                </article>
              </div>
            </section>

            {observations.length > 0 && (
              <section className="ma-war-room-v3-section" aria-labelledby="war-room-watchlist-title">
                <div className="ma-war-room-v3-section-heading">
                  <div><span>逐檔監控</span><h2 id="war-room-watchlist-title">監控清單</h2></div>
                  <p>每檔只保留角色、下一確認與停止條件。</p>
                </div>
                <div className="ma-war-room-v3-watch-table">
                  <div className="ma-war-room-v3-watch-head" aria-hidden="true">
                    <span>股票／角色</span><span>下一確認</span><span>停止條件</span><span>狀態</span>
                  </div>
                  {observations.map((item) => (
                    <article key={item.key}>
                      <div>
                        <strong>{publicWarRoomText(item.name || item.symbol)}</strong>
                        <span>{item.roles.map((role) => publicWarRoomText(role)).join('／') || '待確認角色'}</span>
                      </div>
                      <p><small>{item.detailLabel}</small>{publicWarRoomText(item.next)}</p>
                      <p><small>停止條件</small>{publicWarRoomText(item.stop)}</p>
                      <em className={`is-${item.statusTone}`}>{publicWarRoomText(item.status)}</em>
                    </article>
                  ))}
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
              <div><dt>何時改變</dt><dd>{publicWarRoomText(canonicalNarrative.decision_lifecycle.failure_condition.trigger, '等新證據足以改變原判斷')}</dd></div>
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

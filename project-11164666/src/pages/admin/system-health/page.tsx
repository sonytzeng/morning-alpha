import { Link } from 'react-router-dom';
import { useState } from 'react';
import Navbar from '@/components/feature/Navbar';
import Footer from '@/components/feature/Footer';
import { useSystemHealthCheck, type ItemStatus, type PMAcceptance, type PMCheckDetail } from '@/hooks/useSystemHealthCheck';

// ===== Status config =====

const STATUS_CONFIG: Record<ItemStatus, { label: string; dot: string; bg: string; text: string; border: string }> = {
  normal: { label: '正常', dot: 'bg-green-400', bg: 'bg-green-500/10', text: 'text-green-400', border: 'border-green-500/20' },
  warning: { label: '警告', dot: 'bg-yellow-400', bg: 'bg-yellow-500/10', text: 'text-yellow-400', border: 'border-yellow-500/20' },
  error: { label: '異常', dot: 'bg-red-400', bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/20' },
  not_connected: { label: '未串接', dot: 'bg-gray-400', bg: 'bg-gray-500/10', text: 'text-gray-400', border: 'border-gray-500/20' },
};

function StatusBadge({ status }: { status: ItemStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border whitespace-nowrap ${cfg.bg} ${cfg.text} ${cfg.border}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`}></span>
      {cfg.label}
    </span>
  );
}

// ===== Score Ring =====

function ScoreRing({ score, label, size }: { score: number | null; label: string; size?: 'lg' | 'md' }) {
  const isLarge = size === 'lg';
  const radius = isLarge ? 42 : 34;
  const svgSize = isLarge ? 120 : 96;
  const circumference = 2 * Math.PI * radius;
  const displayScore = score ?? 0;
  const offset = circumference - (displayScore / 100) * circumference;

  let ringColor = 'text-red-400';
  let ringGlow = 'rgba(239, 68, 68, 0.12)';
  let textColor = 'text-red-300';
  if (displayScore >= 90) { ringColor = 'text-green-400'; ringGlow = 'rgba(74, 222, 128, 0.12)'; textColor = 'text-green-300'; }
  else if (displayScore >= 75) { ringColor = 'text-yellow-400'; ringGlow = 'rgba(250, 204, 21, 0.12)'; textColor = 'text-yellow-300'; }
  else if (displayScore >= 60) { ringColor = 'text-amber-400'; ringGlow = 'rgba(251, 191, 36, 0.12)'; textColor = 'text-amber-300'; }

  const fontSize = isLarge ? 'text-3xl' : 'text-2xl';
  const labelSize = isLarge ? 'text-[10px]' : 'text-[9px]';

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: svgSize, height: svgSize }}>
        <div
          className="absolute inset-3 rounded-full blur-lg"
          style={{ backgroundColor: ringGlow }}
        ></div>
        <svg className="relative w-full h-full -rotate-90" viewBox="0 0 100 100">
          <circle
            cx="50" cy="50" r={radius}
            fill="none" stroke="currentColor" strokeWidth="5"
            className="text-white/[0.05]"
          />
          <circle
            cx="50" cy="50" r={radius}
            fill="none" stroke="currentColor" strokeWidth="5"
            strokeLinecap="round"
            className={ringColor}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 0.8s ease-out' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-white font-bold ${fontSize}`}>{displayScore}</span>
          <span className="text-white/25 text-[10px]">/100</span>
        </div>
      </div>
      <span className={`mt-2 ${labelSize} text-white/40 font-medium tracking-wide`}>{label}</span>
    </div>
  );
}

// ===== Score interpretation =====

function ScoreLabel({ score, isNonTrading }: { score: number; isNonTrading?: boolean }) {
  if (isNonTrading && score >= 60) return <span className="text-amber-400 text-xs font-semibold">非交易日，使用最近資料</span>;
  if (score >= 90) return <span className="text-green-400 text-xs font-semibold">系統健康</span>;
  if (score >= 75) return <span className="text-yellow-400 text-xs font-semibold">可用但需觀察</span>;
  if (score >= 60) return <span className="text-amber-400 text-xs font-semibold">資料不足，請檢查</span>;
  return <span className="text-red-400 text-xs font-semibold">不建議公開</span>;
}

// ===== Main Page =====

export default function SystemHealthDashboard() {
  const {
    loading,
    error,
    taipeiDate,
    healthCheckDate,
    isUsingLatestTradingDay,
    report,
    marketDataCount,
    marketNewsCount,
    marketDataLatestTime,
    marketNewsLatestTime,
    missingSymbols,
    presentSymbols,
    symbolStatuses,
    healthItems,
    systemHealthScore,
    contentQualityScore,
    directionConfidenceScore,
    authenticityStatus,
    impactChainCount,
    memberReadingLength,
    reportVersion,
    reportSource,
    validationStatus,
    noFakeFallback,
    repairedBySystem,
    openingRadarStatus,
    openingRadarDate,
    closeReviewResult,
    closeReviewTaiexChange,
    closeReviewDate,
    closeReviewDataQuality,
    forbiddenWordsPassed,
    forbiddenWordsDetails,
    twCoreSymbolsAllPresent,
    pmAcceptance,
    refresh,
  } = useSystemHealthCheck();

  const normalCount = healthItems.filter((h) => h.status === 'normal').length;
  const warningCount = healthItems.filter((h) => h.status === 'warning').length;
  const errorCount = healthItems.filter((h) => h.status === 'error').length;

  return (
    <div className="min-h-screen bg-navy-950 flex flex-col">
      <Navbar />

      <main className="flex-1">
        <div className="w-full px-4 md:px-6 py-6 md:py-8">
          <div className="max-w-6xl mx-auto">

            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 md:mb-8">
              <div>
                <h1 className="text-white font-bold text-xl md:text-2xl mb-1">Morning Alpha 系統健康檢查</h1>
                <p className="text-white/30 text-sm">監控每日報告品質、資料完整性與系統運作狀態</p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  to="/admin"
                  className="px-3 py-2 bg-white/5 hover:bg-white/10 text-white/60 text-xs rounded-lg transition-colors whitespace-nowrap border border-white/10"
                >
                  <i className="ri-arrow-left-line mr-1"></i>
                  管理後台
                </Link>
                <button
                  onClick={refresh}
                  className="px-3 py-2 bg-white/5 hover:bg-white/10 text-white/60 text-xs rounded-lg transition-colors whitespace-nowrap border border-white/10"
                >
                  <i className="ri-refresh-line mr-1"></i>
                  重新整理
                </button>
              </div>
            </div>

            {/* Non-Trading Day Banner (V49) */}
            {!loading && !error && isUsingLatestTradingDay && (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-4 md:p-5 mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                    <i className="ri-calendar-event-line text-amber-400 text-lg"></i>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-amber-400 font-semibold text-sm">非交易日提醒</h3>
                    <p className="text-white/50 text-xs mt-1">
                      今天（{taipeiDate}）為非交易日，系統健康檢查目前使用最近交易日 <strong className="text-white/70">{healthCheckDate}</strong> 資料。
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* ── V50: PM Acceptance Panel ── */}
            {!loading && !error && pmAcceptance && (
              <PMAcceptancePanel acceptance={pmAcceptance} healthCheckDate={healthCheckDate} isUsingLatestTradingDay={isUsingLatestTradingDay} />
            )}

            {/* Loading */}
            {loading && (
              <div className="flex items-center justify-center py-20">
                <div className="text-center">
                  <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
                  <p className="text-white/30 text-sm">載入系統健康資料中...</p>
                </div>
              </div>
            )}

            {/* Error */}
            {error && !loading && (
              <div className="rounded-xl border border-red-500/15 bg-red-500/[0.03] p-8 text-center">
                <i className="ri-error-warning-line text-red-400 text-2xl mb-2 block"></i>
                <p className="text-red-400 text-sm font-medium mb-1">讀取系統資料失敗</p>
                <p className="text-white/30 text-xs mb-4">{error}</p>
                <button
                  onClick={refresh}
                  className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white text-sm rounded-lg transition-colors whitespace-nowrap border border-white/10"
                >
                  重新載入
                </button>
              </div>
            )}

            {/* Content */}
            {!loading && !error && (
              <div className="space-y-4">
                {/* Top 3 Score Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* Card 1: System Health Score */}
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5 md:p-6 flex flex-col items-center">
                    <ScoreRing score={systemHealthScore} label="系統健康分數" size="lg" />
                    <div className="mt-3">
                      <ScoreLabel score={systemHealthScore} isNonTrading={isUsingLatestTradingDay} />
                    </div>
                    <p className="text-white/20 text-[10px] mt-2 text-center">
                      滿分 100 分，低於 60 不建議公開
                    </p>
                  </div>

                  {/* Card 2: Content Quality Score */}
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5 md:p-6 flex flex-col items-center">
                    <ScoreRing score={contentQualityScore} label="內容品質分數" />
                    <div className="mt-3">
                      {contentQualityScore !== null ? (
                        contentQualityScore >= 88 ? (
                          <span className="text-green-400 text-xs font-semibold">品質優良</span>
                        ) : contentQualityScore >= 70 ? (
                          <span className="text-yellow-400 text-xs font-semibold">品質尚可</span>
                        ) : (
                          <span className="text-red-400 text-xs font-semibold">品質不合格</span>
                        )
                      ) : (
                        <span className="text-white/30 text-xs">內容品質：待確認</span>
                      )}
                    </div>
                    <p className="text-white/20 text-[10px] mt-2 text-center">
                      此分數代表內容完整度，不等於方向把握度
                    </p>
                  </div>

                  {/* Card 3: Direction Confidence Score */}
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5 md:p-6 flex flex-col items-center">
                    <ScoreRing score={directionConfidenceScore} label="盤前方向把握度" />
                    <div className="mt-3">
                      {directionConfidenceScore !== null ? (
                        directionConfidenceScore >= 70 ? (
                          <span className="text-green-400 text-xs font-semibold">信心充足</span>
                        ) : directionConfidenceScore >= 50 ? (
                          <span className="text-yellow-400 text-xs font-semibold">中度信心</span>
                        ) : (
                          <span className="text-amber-400 text-xs font-semibold">方向不明</span>
                        )
                      ) : (
                        <span className="text-white/30 text-xs">尚未判定</span>
                      )}
                    </div>
                    <p className="text-white/20 text-[10px] mt-2 text-center">
                      此分數代表{isUsingLatestTradingDay ? `最近交易日（${healthCheckDate}）` : '今日'}方向判斷信心
                    </p>
                  </div>
                </div>

                {/* Data Authenticity Banner */}
                <div className={`rounded-xl border p-4 md:p-5 ${
                  authenticityStatus === '真資料報告'
                    ? 'bg-green-500/[0.04] border-green-500/20'
                    : 'bg-red-500/[0.04] border-red-500/20'
                }`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                      authenticityStatus === '真資料報告' ? 'bg-green-500/10' : 'bg-red-500/10'
                    }`}>
                      <i className={`${
                        authenticityStatus === '真資料報告'
                          ? 'ri-shield-check-line text-green-400'
                          : 'ri-shield-flash-line text-red-400'
                      } text-lg`}></i>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className={`font-semibold text-sm ${
                          authenticityStatus === '真資料報告' ? 'text-green-400' : 'text-red-400'
                        }`}>
                          {authenticityStatus}
                        </h3>
                        <StatusBadge status={authenticityStatus === '真資料報告' ? 'normal' : 'error'} />
                      </div>
                      <p className="text-white/40 text-xs mt-1">
                        {authenticityStatus === '真資料報告'
                          ? 'source=openai, validation=passed, no_fake_fallback=true, repaired_by_system=false, impact_chain_count=3'
                          : '部分條件未滿足，請檢查下方各項指標'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Check Data Status (V49: was "今日資料狀態") */}
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 md:p-5">
                  <h3 className="text-white font-semibold text-sm mb-4">檢查資料狀態</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    <StatusRow label="檢查日期" value={healthCheckDate} mono />
                    <StatusRow label="今天狀態" value={isUsingLatestTradingDay ? '非交易日' : '交易日'} />
                    <StatusRow label="使用資料" value={isUsingLatestTradingDay ? '最近交易日資料' : '今日即時資料'} />
                    <StatusRow label="報告日期" value={report?.report_date || '—'} />
                    <StatusRow label="報告版本" value={reportVersion || '—'} mono />
                    <StatusRow label="資料來源" value={reportSource || '—'} />
                    <StatusRow label="品質狀態" value={validationStatus || '—'} mono />
                    <StatusRow label="真資料檢查" value={authenticityStatus} />
                    <StatusRow label={isUsingLatestTradingDay ? '最近交易日市場資料' : '今日市場資料'} value={marketDataCount > 0 ? `${marketDataCount} 筆` : '資料暫缺'} mono />
                    <StatusRow label={isUsingLatestTradingDay ? '最近交易日新聞資料' : '今日新聞資料'} value={marketNewsCount > 0 ? `${marketNewsCount} 筆` : '資料暫缺'} mono />
                    <StatusRow label="影響鏈數量" value={`${impactChainCount} 條`} mono />
                    <StatusRow label="假資料防線" value={noFakeFallback === true ? '未使用' : noFakeFallback === false ? '疑似使用' : '—'} />
                    <StatusRow label="系統修補" value={repairedBySystem === false ? '非修補' : repairedBySystem === true ? '已修補' : '—'} />
                    {/* V49: Opening Radar */}
                    <StatusRow label="盤中追蹤" value={openingRadarStatus ? '已完成' : '未執行'} />
                    <StatusRow label="盤中狀態" value={openingRadarStatus || '—'} />
                    {/* V49: Close Review */}
                    <StatusRow label="收盤驗證" value={closeReviewResult ? '已完成' : '未完成'} />
                    <StatusRow label="驗證結果" value={closeReviewResult || '—'} />
                    {closeReviewTaiexChange !== null && (
                      <StatusRow label="TAIEX 變動" value={`${closeReviewTaiexChange >= 0 ? '+' : ''}${closeReviewTaiexChange}%`} mono />
                    )}
                    {closeReviewDataQuality && closeReviewDataQuality !== '—' && (
                      <StatusRow label="資料狀態" value={closeReviewDataQuality} />
                    )}
                    {/* V49: Forbidden Words */}
                    <StatusRow label="禁詞檢查" value={forbiddenWordsPassed === true ? '通過' : forbiddenWordsPassed === false ? `未通過：${forbiddenWordsDetails.join('、')}` : '—'} />
                    <StatusRow
                      label="會員判讀"
                      value={memberReadingLength !== null ? `已生成（${memberReadingLength} 字）` : '尚未生成'}
                    />
                    <StatusRow label="核心 Symbol" value={presentSymbols.length > 0 ? `${presentSymbols.length}/10` : '—'} mono />
                  </div>
                </div>

                {/* Daily Formal Check Process */}
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 md:p-5">
                  <div className="mb-1">
                    <h3 className="text-white font-semibold text-sm">每日正式檢查流程</h3>
                    <p className="text-white/25 text-[11px] mt-0.5">每天盤前、盤中、收盤後照順序確認，避免資料錯位、假資料、前台顯示不一致。</p>
                  </div>

                  <div className="space-y-2.5 mt-4">
                    {/* Step 1: Cron */}
                    <ChecklistCard
                      seq={1}
                      name="cron 是否跑完"
                      status="warning"
                      statusText="需人工確認"
                      dataSource="cron-job.org（外部）"
                      passCriteria="07:30 Daily Report 成功、09:15 Opening Radar 成功、13:30 Close Market Review 成功、LINE Push 成功"
                      suggestion="請至 cron-job.org 確認四個排程執行狀態"
                    />

                    {/* Step 2: Reports */}
                    <ChecklistCard
                      seq={2}
                      name="reports 是否生成"
                      status={report ? 'normal' : 'error'}
                      statusText={report ? `已完成，report_date=${healthCheckDate}，market_bias=${report.market_bias || '—'}` : '尚未生成'}
                      dataSource="public.reports"
                      passCriteria={`${healthCheckDate} 有 reports、report_date 正確、market_bias 有值、version 有值`}
                      suggestion={report ? '—' : '請檢查 Daily Report cron 或 Edge Function'}
                    />

                    {/* Step 3: True Data & Quality */}
                    {(() => {
                      const item3Pass = reportSource === 'openai'
                        && (validationStatus === 'passed' || validationStatus === 'soft_passed')
                        && noFakeFallback === true
                        && repairedBySystem === false
                        && contentQualityScore !== null && contentQualityScore >= 80;
                      return (
                        <ChecklistCard
                          seq={3}
                          name="真資料與品質驗證"
                          status={item3Pass ? 'normal' : 'error'}
                          statusText={item3Pass
                            ? `通過，source=${reportSource}，validation=${validationStatus}，quality_score=${contentQualityScore}，no_fake=${noFakeFallback}`
                            : '未通過，請檢查下方健康檢查明細'}
                          dataSource="public.reports / ai_strategy_json"
                          passCriteria="source=openai、validation_status=passed、no_fake_fallback=true、repaired_by_system=false、quality_score ≥ 80"
                          suggestion={item3Pass ? '—' : '請檢查 Edge Function 是否正確使用 OpenAI API'}
                        />
                      );
                    })()}

                    {/* Step 4: TAIEX / TXF / 2330 */}
                    <ChecklistCard
                      seq={4}
                      name="TAIEX / TXF / 2330 是否存在"
                      status={twCoreSymbolsAllPresent ? 'normal' : 'error'}
                      statusText={twCoreSymbolsAllPresent ? '通過，TAIEX / TXF / 2330 已取得' : '台股核心 Symbol 缺少'}
                      dataSource="public.market_data"
                      passCriteria="TAIEX 或台股加權指數存在、TXF 或台指期存在、2330 或台積電存在"
                      suggestion={twCoreSymbolsAllPresent ? 'market_data 為市場快照；正式收盤驗證以 close_market_reviews 為準。' : '請檢查 fetch-market-data 排程'}
                    />

                    {/* Step 5: Impact Chains */}
                    <ChecklistCard
                      seq={5}
                      name="impact chains 是否足夠"
                      status={impactChainCount >= 3 ? 'normal' : impactChainCount >= 1 ? 'warning' : 'error'}
                      statusText={impactChainCount >= 3 ? `通過，${impactChainCount} 條影響鏈` : impactChainCount >= 1 ? `${impactChainCount} 條，不足 3 條` : '尚未生成'}
                      dataSource="reports.ai_strategy_json.overnight_impact_chains"
                      passCriteria="至少 3 條影響鏈，每條包含主題、影響族群、代表股票、盤中觀察點"
                      suggestion={impactChainCount >= 3 ? '—' : '檢查 AI 是否完整生成三條影響鏈'}
                    />

                    {/* Step 6: Opening Radar */}
                    <ChecklistCard
                      seq={6}
                      name="盤中追蹤是否完成"
                      status={openingRadarStatus ? 'normal' : 'warning'}
                      statusText={openingRadarStatus ? `通過，${openingRadarStatus}` : '尚未執行'}
                      dataSource="public.opening_market_radar"
                      passCriteria={`${healthCheckDate} 有 opening_market_radar、premarket_bias 等於 reports.market_bias、radar_status 有值、不得出現「劇本成立」`}
                      suggestion={openingRadarStatus ? '—' : '請檢查 opening-market-radar cron 排程'}
                    />

                    {/* Step 7: Close Review */}
                    <ChecklistCard
                      seq={7}
                      name="收盤驗證是否完成"
                      status={closeReviewResult ? 'normal' : 'warning'}
                      statusText={closeReviewResult
                        ? `通過，${closeReviewResult}${closeReviewTaiexChange !== null ? `，TAIEX ${closeReviewTaiexChange >= 0 ? '+' : ''}${closeReviewTaiexChange}%` : ''}`
                        : '尚未完成'}
                      dataSource="public.close_market_reviews"
                      passCriteria={`${healthCheckDate} 有 close_market_reviews、verification_result 有值、verification_note 有值、不得被 test run 覆蓋、不得出現「盤前劇本命中」「偏多觀察方向一致」「劇本成立」`}
                      suggestion={closeReviewResult ? '—' : '請檢查 close-market-review cron 排程'}
                    />

                    {/* Step 8: Frontend Consistency */}
                    <ChecklistCard
                      seq={8}
                      name="前台頁面是否一致"
                      status="warning"
                      statusText="需人工快速確認"
                      dataSource="綜合判斷 reports + opening_market_radar + close_market_reviews"
                      passCriteria="首頁顯示最近交易日資料、今日判斷頁顯示最近交易日完整回顧、盤中追蹤頁不顯示錯誤即時數字、收盤驗證顯示部分命中盤前偏保守、不出現資料不足/待確認/盤前等待等錯誤狀態"
                      suggestion="建議管理者查看首頁 / 今日判斷 / 盤中追蹤三頁"
                    />
                  </div>

                  {/* Today's Management Conclusion */}
                  <div className="mt-5 pt-4 border-t border-white/5">
                    {(() => {
                      const items2To7AllPass = report !== null
                        && reportSource === 'openai'
                        && (validationStatus === 'passed' || validationStatus === 'soft_passed')
                        && noFakeFallback === true
                        && repairedBySystem === false
                        && contentQualityScore !== null && contentQualityScore >= 80
                        && twCoreSymbolsAllPresent
                        && impactChainCount >= 3
                        && openingRadarStatus !== null
                        && closeReviewResult !== null
                        && forbiddenWordsPassed === true;

                      if (items2To7AllPass) {
                        return (
                          <div className="flex items-start gap-3">
                            <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center flex-shrink-0">
                              <i className="ri-check-double-line text-green-400"></i>
                            </div>
                            <div>
                              <h4 className="text-green-400 font-semibold text-xs mb-1">今日管理結論</h4>
                              <p className="text-white/40 text-[11px] leading-relaxed">
                                系統資料鏈正常。{isUsingLatestTradingDay ? `今天為非交易日，目前使用最近交易日 ${healthCheckDate} 資料。` : ''}建議確認 cron-job.org 與前台三頁顯示後，即可視為今日檢查完成。
                              </p>
                            </div>
                          </div>
                        );
                      }
                      return (
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 rounded-lg bg-yellow-500/10 flex items-center justify-center flex-shrink-0">
                            <i className="ri-alert-line text-yellow-400"></i>
                          </div>
                          <div>
                            <h4 className="text-yellow-400 font-semibold text-xs mb-1">今日管理結論</h4>
                            <p className="text-white/40 text-[11px] leading-relaxed">
                              部分檢查項目需要關注。請依上方流程逐項確認，優先處理異常項目後再檢視前台頁面。
                            </p>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Health Check Detail Table */}
                <div className="rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">
                  <div className="p-4 md:p-5 border-b border-white/5">
                    <div className="flex items-center justify-between">
                      <h3 className="text-white font-semibold text-sm">健康檢查明細</h3>
                      <div className="flex items-center gap-3 text-[10px]">
                        <span className="inline-flex items-center gap-1 text-green-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-400"></span>正常 {normalCount}
                        </span>
                        <span className="inline-flex items-center gap-1 text-yellow-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-yellow-400"></span>警告 {warningCount}
                        </span>
                        <span className="inline-flex items-center gap-1 text-red-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-400"></span>異常 {errorCount}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[800px]">
                      <thead>
                        <tr className="bg-white/[0.02]">
                          <th className="px-4 py-3 text-left text-white/30 text-[10px] font-medium uppercase tracking-wider w-[140px]">模組</th>
                          <th className="px-4 py-3 text-left text-white/30 text-[10px] font-medium uppercase tracking-wider w-[80px]">狀態</th>
                          <th className="px-4 py-3 text-left text-white/30 text-[10px] font-medium uppercase tracking-wider">結果</th>
                          <th className="px-4 py-3 text-left text-white/30 text-[10px] font-medium uppercase tracking-wider w-[180px]">資料來源</th>
                          <th className="px-4 py-3 text-left text-white/30 text-[10px] font-medium uppercase tracking-wider w-[150px]">最新時間</th>
                          <th className="px-4 py-3 text-left text-white/30 text-[10px] font-medium uppercase tracking-wider">建議處理</th>
                        </tr>
                      </thead>
                      <tbody>
                        {healthItems.map((item, idx) => {
                          const isErr = item.status === 'error';
                          const isWarn = item.status === 'warning';
                          return (
                            <tr
                              key={idx}
                              className={`border-t border-white/5 transition-colors ${
                                isErr ? 'bg-red-500/[0.02]' : isWarn ? 'bg-yellow-500/[0.02]' : ''
                              }`}
                            >
                              <td className="px-4 py-3">
                                <span className="text-white/80 text-xs font-medium">{item.module}</span>
                              </td>
                              <td className="px-4 py-3">
                                <StatusBadge status={item.status} />
                              </td>
                              <td className="px-4 py-3">
                                <span className={`text-xs ${isErr ? 'text-red-300/80' : isWarn ? 'text-yellow-300/80' : 'text-white/60'}`}>
                                  {item.result}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <span className="text-white/25 text-[10px] font-mono">{item.dataSource}</span>
                              </td>
                              <td className="px-4 py-3">
                                <span className="text-white/30 text-[10px] font-mono">{item.latestTime}</span>
                              </td>
                              <td className="px-4 py-3">
                                <span className={`text-[10px] ${isErr ? 'text-red-400/70' : isWarn ? 'text-yellow-400/70' : 'text-white/25'}`}>
                                  {item.suggestion}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Health Score Breakdown (V49: 12-item ratio) */}
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 md:p-5">
                  <h3 className="text-white font-semibold text-sm mb-3">健康分數計算明細</h3>
                  <div className="text-white/40 text-[11px] leading-relaxed mb-3">
                    採 12 項檢查比例制，每通過一項得 1 分（滿分 12 = 100 分）。90-100 系統健康，75-89 可用但需觀察，60-74 資料不足請檢查，低於 60 不建議公開。
                    {isUsingLatestTradingDay && (
                      <span className="block mt-1 text-amber-400/70">
                        目前為非交易日，使用最近交易日 {healthCheckDate} 資料進行檢查。
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                    <ScoreDetail label="reports 存在" max={1} earned={report ? 1 : 0} />
                    <ScoreDetail label="source=openai" max={1} earned={reportSource === 'openai' ? 1 : 0} />
                    <ScoreDetail label="validation passed" max={1} earned={(validationStatus === 'passed' || validationStatus === 'soft_passed') ? 1 : 0} />
                    <ScoreDetail label="no_fake_fallback" max={1} earned={noFakeFallback === true ? 1 : 0} />
                    <ScoreDetail label="quality_score 存在" max={1} earned={contentQualityScore !== null ? 1 : 0} />
                    <ScoreDetail label="confidence_score 存在" max={1} earned={directionConfidenceScore !== null ? 1 : 0} />
                    <ScoreDetail label="impact_chains ≥ 3" max={1} earned={impactChainCount >= 3 ? 1 : 0} />
                    <ScoreDetail label="market_data 有資料" max={1} earned={marketDataCount >= 1 ? 1 : 0} />
                    <ScoreDetail label="market_news 有資料" max={1} earned={marketNewsCount >= 1 ? 1 : 0} />
                    <ScoreDetail label="opening_radar" max={1} earned={openingRadarStatus ? 1 : 0} />
                    <ScoreDetail label="close_review" max={1} earned={closeReviewResult ? 1 : 0} />
                    <ScoreDetail label="verification_result" max={1} earned={closeReviewResult ? 1 : 0} />
                  </div>
                </div>

                {/* Market Data Symbols */}
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 md:p-5">
                  <h3 className="text-white font-semibold text-sm mb-3">核心市場 Symbol 檢查</h3>
                  <div className="flex flex-wrap gap-2">
                    {symbolStatuses.map((entry) => {
                      const badgeLabel = entry.has && entry.matchedName
                        ? `${entry.display}（${entry.matchedName}）`
                        : entry.has && entry.matchedAlias && entry.matchedAlias !== entry.display
                          ? `${entry.display}（${entry.matchedAlias}）`
                          : entry.display;

                      return (
                        <span
                          key={entry.display}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-mono border whitespace-nowrap ${
                            entry.has
                              ? 'bg-green-500/10 border-green-500/20 text-green-400'
                              : 'bg-red-500/[0.05] border-red-500/10 text-red-400/60'
                          }`}
                        >
                          {entry.has ? (
                            <i className="ri-check-line text-[10px]"></i>
                          ) : (
                            <i className="ri-close-line text-[10px]"></i>
                          )}
                          {badgeLabel}
                        </span>
                      );
                    })}
                  </div>
                  {missingSymbols.length > 0 && (
                    <p className="text-white/30 text-[11px] mt-3">
                      缺少 {missingSymbols.length} 個：{missingSymbols.join('、')}
                    </p>
                  )}
                  <div className="mt-3 pt-3 border-t border-white/5">
                    <p className="text-white/25 text-[10px] leading-relaxed">
                      <i className="ri-information-line mr-1 align-middle"></i>
                      market_data 為市場快照；正式收盤驗證以 close_market_reviews 為準。
                    </p>
                  </div>
                </div>

                {/* Cron + LINE External */}
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 md:p-5">
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="w-8 h-8 bg-yellow-500/20 rounded-lg flex items-center justify-center border border-white/5">
                      <i className="ri-external-link-line text-yellow-400 text-sm"></i>
                    </div>
                    <h3 className="text-white font-semibold text-sm">外部系統狀態</h3>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/[0.02] border border-white/5">
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-yellow-400"></span>
                        <span className="text-white/60 text-xs">Cron 排程</span>
                      </div>
                      <span className="text-white/30 text-xs">
                        外部系統，請至{' '}
                        <a
                          href="https://cron-job.org"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-amber-400 hover:text-amber-300 underline"
                        >
                          cron-job.org
                        </a>
                        {' '}確認
                      </span>
                    </div>
                    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/[0.02] border border-white/5">
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-yellow-400"></span>
                        <span className="text-white/60 text-xs">LINE 推播</span>
                      </div>
                      <span className="text-white/30 text-xs">
                        外部系統，請至 cron-job.org 或 LINE log 確認
                      </span>
                    </div>
                  </div>
                </div>

                {/* Summary Banner */}
                <div className={`rounded-xl border p-4 md:p-5 ${
                  errorCount === 0 && warningCount === 0
                    ? 'bg-green-500/[0.04] border-green-500/20'
                    : errorCount > 0
                      ? 'bg-red-500/[0.04] border-red-500/20'
                      : 'bg-yellow-500/[0.04] border-yellow-500/20'
                }`}>
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                      errorCount === 0 && warningCount === 0
                        ? 'bg-green-500/10'
                        : errorCount > 0
                          ? 'bg-red-500/10'
                          : 'bg-yellow-500/10'
                    }`}>
                      <i className={`text-lg ${
                        errorCount === 0 && warningCount === 0
                          ? 'ri-check-double-line text-green-400'
                          : errorCount > 0
                            ? 'ri-error-warning-line text-red-400'
                            : 'ri-alert-line text-yellow-400'
                      }`}></i>
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className={`font-semibold text-sm mb-1 ${
                        errorCount === 0 && warningCount === 0
                          ? 'text-green-400'
                          : errorCount > 0
                            ? 'text-red-400'
                            : 'text-yellow-400'
                      }`}>
                        {(() => {
                          if (errorCount === 0 && warningCount === 0) {
                            return twCoreSymbolsAllPresent ? '所有檢查項目正常' : '台股核心 Symbol 需補齊';
                          }
                          if (!twCoreSymbolsAllPresent) {
                            return '核心資料部分需確認';
                          }
                          if (errorCount > 0) {
                            return `${errorCount} 項異常，${warningCount} 項警告`;
                          }
                          return `${warningCount} 項警告，請多加觀察`;
                        })()}
                      </h3>
                      <p className="text-white/40 text-xs leading-relaxed">
                        系統健康分數 {systemHealthScore}/100
                        {isUsingLatestTradingDay
                          ? `，非交易日使用最近交易日 ${healthCheckDate} 資料。`
                          : systemHealthScore >= 90 ? '，Morning Alpha 自動化運行正常。' :
                            systemHealthScore >= 75 ? '，可用但建議觀察部分指標。' :
                            systemHealthScore >= 60 ? '，資料不足，請檢查各項排程。' :
                            '，不建議公開，請優先修復異常項目。'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}

// ===== Sub components =====

// ── V50: PM Acceptance Panel ──

function PMAcceptancePanel({ acceptance, healthCheckDate, isUsingLatestTradingDay }: {
  acceptance: PMAcceptance;
  healthCheckDate: string;
  isUsingLatestTradingDay: boolean;
}) {
  const { conclusion, conclusionLabel, conclusionColor, conclusionReason, checks, passedCount, totalCount } = acceptance;

  const colorConfig = {
    green: {
      bg: 'bg-green-500/[0.06]',
      border: 'border-green-500/25',
      iconBg: 'bg-green-500/15',
      icon: 'ri-check-double-line text-green-400',
      title: 'text-green-400',
      badge: 'bg-green-500/15 text-green-400 border-green-500/25',
      reason: 'text-green-400/80',
      countBadge: 'bg-green-500/20 text-green-400',
    },
    yellow: {
      bg: 'bg-yellow-500/[0.06]',
      border: 'border-yellow-500/25',
      iconBg: 'bg-yellow-500/15',
      icon: 'ri-alert-line text-yellow-400',
      title: 'text-yellow-400',
      badge: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25',
      reason: 'text-yellow-400/80',
      countBadge: 'bg-yellow-500/20 text-yellow-400',
    },
    red: {
      bg: 'bg-red-500/[0.06]',
      border: 'border-red-500/25',
      iconBg: 'bg-red-500/15',
      icon: 'ri-error-warning-line text-red-400',
      title: 'text-red-400',
      badge: 'bg-red-500/15 text-red-400 border-red-500/25',
      reason: 'text-red-400/80',
      countBadge: 'bg-red-500/20 text-red-400',
    },
  };

  const cfg = colorConfig[conclusionColor];
  const [expandedChecks, setExpandedChecks] = useState<Set<string>>(new Set());

  const toggleCheck = (label: string) => {
    setExpandedChecks((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  return (
    <div className={`rounded-xl border ${cfg.border} ${cfg.bg} p-4 md:p-5 mb-4`}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-1">
        <div className={`w-8 h-8 rounded-lg ${cfg.iconBg} flex items-center justify-center flex-shrink-0`}>
          <i className={cfg.icon}></i>
        </div>
        <div>
          <h2 className="text-white font-bold text-sm">今日 PM 驗收結論</h2>
          {isUsingLatestTradingDay && (
            <p className="text-white/25 text-[10px]">使用最近交易日 {healthCheckDate} 資料</p>
          )}
        </div>
      </div>

      {/* Conclusion Banner */}
      <div className={`mt-3 rounded-lg border ${cfg.border} bg-white/[0.02] p-3 md:p-4`}>
        <div className="flex items-center gap-3">
          <span className={`px-3 py-1 rounded-full text-xs font-bold border whitespace-nowrap ${cfg.badge}`}>
            {conclusionLabel}
          </span>
          <span className={`text-[11px] leading-relaxed ${cfg.reason}`}>{conclusionReason}</span>
        </div>
        <div className="flex items-center gap-2 mt-3">
          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${cfg.countBadge}`}>
            {passedCount}/{totalCount} 項通過
          </span>
        </div>
      </div>

      {/* Check Items */}
      <div className="mt-3 space-y-2">
        {checks.map((check) => {
          const isExpanded = expandedChecks.has(check.label);
          const itemCfg = check.passed
            ? { dot: 'bg-green-400', text: 'text-green-400', bg: 'bg-green-500/[0.04]', border: 'border-green-500/15' }
            : { dot: 'bg-red-400', text: 'text-red-400', bg: 'bg-red-500/[0.04]', border: 'border-red-500/15' };

          return (
            <div key={check.label} className={`rounded-lg border ${itemCfg.border} ${itemCfg.bg} overflow-hidden`}>
              <button
                onClick={() => toggleCheck(check.label)}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-white/[0.02] transition-colors cursor-pointer"
              >
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${itemCfg.dot}`}></span>
                <span className={`text-xs font-semibold ${itemCfg.text} flex-shrink-0`}>{check.label}.</span>
                <span className="text-white/80 text-xs font-medium flex-1">{check.name}</span>
                <span className={`text-[10px] font-semibold whitespace-nowrap ${itemCfg.text}`}>
                  {check.passed ? '✓ 通過' : '✗ 未通過'}
                </span>
                {isExpanded ? (
                  <i className="ri-arrow-up-s-line text-white/25 text-xs"></i>
                ) : (
                  <i className="ri-arrow-down-s-line text-white/25 text-xs"></i>
                )}
              </button>

              {/* Summary line (always visible) */}
              <div className="px-3 pb-2">
                <p className={`text-[10px] leading-relaxed ${check.passed ? 'text-white/35' : 'text-red-400/70'}`}>
                  {check.detail}
                </p>
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="border-t border-white/5 px-3 py-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {check.items.map((item) => (
                      <div key={item.label} className="flex items-center gap-2 py-1">
                        <span className={`w-1 h-1 rounded-full flex-shrink-0 ${item.ok ? 'bg-green-400/60' : 'bg-red-400/60'}`}></span>
                        <span className="text-white/25 text-[10px] flex-shrink-0 min-w-[100px]">{item.label}</span>
                        <span className={`text-[10px] font-mono ${item.ok ? 'text-white/45' : 'text-red-400/70'}`}>
                          {item.detail}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-3 pt-3 border-t border-white/5 flex flex-wrap gap-3 text-[10px] text-white/25">
        <span className="inline-flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400"></span>綠色 = 可以公開
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-yellow-400"></span>黃色 = 可公開但需人工確認
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-red-400"></span>紅色 = 不建議公開
        </span>
      </div>
    </div>
  );
}

function StatusRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="py-2 px-3 rounded-lg bg-white/[0.02] border border-white/5">
      <span className="text-white/30 text-[10px] block mb-0.5">{label}</span>
      <span className={`text-white/70 text-xs ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

// ===== Checklist Card Component =====

function ChecklistCard({ seq, name, status, statusText, dataSource, passCriteria, suggestion }: {
  seq: number;
  name: string;
  status: ItemStatus;
  statusText: string;
  dataSource: string;
  passCriteria: string;
  suggestion: string;
}) {
  const cfg = STATUS_CONFIG[status];
  return (
    <div className={`rounded-lg border p-3 md:p-4 ${cfg.bg} ${cfg.border}`}>
      <div className="flex items-start gap-3">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-[11px] font-bold ${
          status === 'normal' ? 'bg-green-500/15 text-green-400' :
          status === 'warning' ? 'bg-yellow-500/15 text-yellow-400' :
          'bg-red-500/15 text-red-400'
        }`}>
          {seq}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <h4 className="text-white text-xs font-semibold">{name}</h4>
            <StatusBadge status={status} />
          </div>
          <p className={`text-[11px] leading-relaxed mb-2 ${status === 'normal' ? 'text-white/50' : status === 'warning' ? 'text-yellow-300/70' : 'text-red-300/70'}`}>
            {statusText}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <span className="text-white/20 text-[9px] uppercase tracking-wider block mb-0.5">資料來源</span>
              <span className="text-white/35 text-[10px] font-mono">{dataSource}</span>
            </div>
            <div>
              <span className="text-white/20 text-[9px] uppercase tracking-wider block mb-0.5">建議處理</span>
              <span className="text-white/30 text-[10px]">{suggestion}</span>
            </div>
          </div>
          <div className="mt-2 pt-2 border-t border-white/5">
            <span className="text-white/20 text-[9px] uppercase tracking-wider block mb-0.5">通過標準</span>
            <span className="text-white/25 text-[10px] leading-relaxed">{passCriteria}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ScoreDetail({ label, max, earned }: { label: string; max: number; earned: number }) {
  const ratio = max > 0 ? earned / max : 0;
  const colorClass = ratio >= 1 ? 'text-green-400' : ratio > 0 ? 'text-yellow-400' : 'text-white/15';

  return (
    <div className="py-2 px-3 rounded-lg bg-white/[0.02] border border-white/5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-white/35 text-[10px] truncate mr-1">{label}</span>
        <span className={`font-mono text-[10px] font-semibold ${colorClass}`}>{earned}/{max}</span>
      </div>
      <div className="w-full h-1 bg-white/[0.05] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            ratio >= 1 ? 'bg-green-500/60' : ratio > 0 ? 'bg-yellow-500/60' : 'bg-transparent'
          }`}
          style={{ width: `${ratio * 100}%` }}
        ></div>
      </div>
    </div>
  );
}
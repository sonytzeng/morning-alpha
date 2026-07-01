import { useSystemHealthCheck } from '@/hooks/useSystemHealthCheck';
import { Link } from 'react-router-dom';
import { useState } from 'react';

function getTaipeiDayOfWeek(): number {
  return new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' })
  ).getDay();
}

function isActualWeekend(): boolean {
  const dow = getTaipeiDayOfWeek();
  return dow === 0 || dow === 6;
}

export default function AdminDashboard() {
  const {
    loading,
    error,
    taipeiDate,
    healthCheckDate,
    isUsingLatestTradingDay,
    report,
    reportSource,
    noFakeFallback,
    contentQualityScore,
    directionConfidenceScore,
    impactChainCount,
    refresh,
    memberReadingLength,
    hasMemberResearchNote,
    publishReady,
    fakeFallbackUsed,
    dataDateAligned,
    marketDataBasisDate,
    memberValueScore,
    reelsAvailable,
    socialPostAvailable,
    lineAvailable,
    morningAlpha,
  } = useSystemHealthCheck();

  const [showRawData, setShowRawData] = useState(false);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
          <p className="text-foreground-500 text-sm">載入中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white border border-red-200 rounded-xl p-6 text-center">
        <i className="ri-error-warning-line text-red-400 text-xl mb-2 block"></i>
        <p className="text-red-600 text-sm font-medium mb-1">讀取失敗</p>
        <p className="text-foreground-500 text-xs mb-3">{error}</p>
        <button onClick={refresh} className="px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white text-sm rounded-lg transition-colors whitespace-nowrap">
          重新載入
        </button>
      </div>
    );
  }

  const hasReport = report !== null;
  const isNonTrading = isUsingLatestTradingDay; // true only on actual weekends
  const todayIsWeekday = !isNonTrading;
  const displayBasisDate = marketDataBasisDate || report?.report_date || '—';

  // ── V7.55: Use the adapter's authoritative publish gate ──
  const isPublishGatePassed = morningAlpha?.canPublish ?? false;

  // ── 今日結論卡 ──
  let conclusionLabel: string;
  let conclusionColor: { dot: string; text: string; bg: string; border: string };
  let conclusionReason: string;
  let nextStep: string;

  if (!hasReport) {
    conclusionLabel = '報告缺失';
    conclusionColor = { dot: 'bg-red-400', text: 'text-red-700', bg: 'bg-red-500/5', border: 'border-red-300' };
    conclusionReason = 'reports 資料表無報告，請檢查 cron 排程。';
    nextStep = '請檢查 cron-job.org 排程與 Edge Function 是否正常執行。';
  } else if (isNonTrading) {
    conclusionLabel = '非交易日';
    conclusionColor = { dot: 'bg-amber-400', text: 'text-amber-700', bg: 'bg-amber-500/5', border: 'border-amber-300' };
    conclusionReason = `今天（${taipeiDate}）為週末非交易日，使用最近交易日報告。`;
    nextStep = '週末不需處理，等待下一個交易日 cron 自動執行。';
  } else if (isPublishGatePassed) {
    conclusionLabel = morningAlpha?.dashboardStatus?.label || '可公開';
    conclusionColor = { dot: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-500/5', border: 'border-emerald-300' };
    conclusionReason = morningAlpha?.dashboardStatus?.message || `內容品質 ${contentQualityScore}/100，會員價值 ${memberValueScore}/100，無假資料，已通過發布檢查。`;
    nextStep = morningAlpha?.nextActionText || '今日報告已通過發布檢查，下一步請前往前台驗收顯示內容。';
  } else {
    conclusionLabel = '需確認';
    conclusionColor = { dot: 'bg-red-400', text: 'text-red-700', bg: 'bg-red-500/5', border: 'border-red-300' };
    const issues: string[] = [];
    if (!publishReady) issues.push('publish_ready 未通過');
    if (noFakeFallback !== true) issues.push('no_fake_fallback 未通過');
    if (fakeFallbackUsed !== false) issues.push('疑似使用假資料');
    if (dataDateAligned !== true) issues.push('資料日期未對齊');
    if ((contentQualityScore ?? 0) < 75) issues.push(`品質偏低（${contentQualityScore}/100）`);
    if ((memberValueScore ?? 0) < 80) issues.push(`會員價值偏低（${memberValueScore}/100）`);
    conclusionReason = issues.join('、');
    nextStep = '請前往會員內容體驗中心查看詳細狀態，必要時重新觸發報告。';
  }

  // ── 內容產出狀態 ──
  const lineStatusLabel = lineAvailable ? '已產生' : '未接入';
  const lineStatusStyle = lineAvailable ? 'text-emerald-600' : 'text-foreground-400';
  const reelsStatusLabel = reelsAvailable ? '已產生' : hasReport ? '尚未產生' : '不可用';
  const reelsStatusStyle = reelsAvailable ? 'text-emerald-600' : hasReport ? 'text-amber-600' : 'text-red-500';
  const postStatusLabel = socialPostAvailable ? '可用' : hasReport ? '尚未產生' : '不可用';
  const postStatusStyle = socialPostAvailable ? 'text-emerald-600' : hasReport ? 'text-amber-600' : 'text-red-500';
  const memberStatusLabel = hasMemberResearchNote ? `已產生${memberReadingLength ? `（${memberReadingLength} 字）` : ''}` : '尚未產生';
  const memberStatusStyle = hasMemberResearchNote ? 'text-emerald-600' : 'text-amber-600';

  return (
    <div className="max-w-4xl space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-foreground-900 font-bold text-lg">總控台</h1>
          <p className="text-foreground-500 text-sm mt-0.5">
            {isNonTrading ? `非交易日 ${taipeiDate}` : `交易日 ${taipeiDate}`}
            {displayBasisDate !== taipeiDate ? `｜資料基準 ${displayBasisDate}` : ''}
          </p>
        </div>
        <button onClick={refresh} className="px-3 py-2 bg-white border border-background-200 rounded-lg text-foreground-600 text-sm hover:bg-background-50 transition-colors whitespace-nowrap">
          <i className="ri-refresh-line mr-1"></i>重新整理
        </button>
      </div>

      {/* ── Basis date notice (V7.54) ── */}
      {todayIsWeekday && displayBasisDate !== taipeiDate && (
        <div className="bg-sky-50 border border-sky-200 rounded-xl px-4 py-3 flex items-start gap-3">
          <i className="ri-information-line text-sky-500 mt-0.5"></i>
          <div>
            <p className="text-sky-700 text-sm font-medium">今日盤前報告已更新</p>
            <p className="text-sky-600 text-xs mt-0.5">
              資料基準：最近完整交易日 {displayBasisDate}。此為盤前報告，使用最近完整交易日市場資料，今日盤中變化請看盤中雷達。
            </p>
          </div>
        </div>
      )}

      {/* ═══ 7 Questions Card ═══ */}
      <div className="bg-white border border-background-200 rounded-xl p-5">
        <h3 className="text-foreground-900 font-semibold text-sm mb-4">今天需要知道的 7 件事</h3>
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <span className="text-foreground-900 font-bold text-sm flex-shrink-0 whitespace-nowrap">1. 使用哪一天資料？</span>
            <span className="text-foreground-600 text-sm">
              資料基準日：{displayBasisDate}{isNonTrading ? '（非交易日）' : ''}
            </span>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-foreground-900 font-bold text-sm flex-shrink-0 whitespace-nowrap">2. 報告是否可用？</span>
            <span className={`text-sm font-medium ${hasReport ? 'text-emerald-600' : 'text-red-500'}`}>
              {hasReport ? '可用' : '不可用 — 報告尚未生成'}
            </span>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-foreground-900 font-bold text-sm flex-shrink-0 whitespace-nowrap">3. 免費摘要是否可用？</span>
            <span className={`text-sm font-medium ${hasReport ? 'text-emerald-600' : 'text-red-500'}`}>
              {hasReport ? '可用 — 已公開' : '不可用 — 報告缺失'}
            </span>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-foreground-900 font-bold text-sm flex-shrink-0 whitespace-nowrap">4. 會員研究筆記是否產生？</span>
            <span className={`text-sm font-medium ${memberStatusStyle}`}>
              {memberStatusLabel}
            </span>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-foreground-900 font-bold text-sm flex-shrink-0 whitespace-nowrap">5. Reels / LINE 是否可用？</span>
            <span className="text-sm">
              <span className={reelsStatusStyle}>Reels {reelsStatusLabel}</span>
              <span className="text-foreground-400 mx-1.5">|</span>
              <span className={lineStatusStyle}>LINE {lineStatusLabel}</span>
            </span>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-foreground-900 font-bold text-sm flex-shrink-0 whitespace-nowrap">6. 是否需要站長處理？</span>
            <span className={`text-sm font-medium ${isPublishGatePassed ? 'text-emerald-600' : 'text-amber-600'}`}>
              {isPublishGatePassed ? '不需要' : '需確認'}
            </span>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-foreground-900 font-bold text-sm flex-shrink-0 whitespace-nowrap">7. 下一步建議</span>
            <span className="text-foreground-600 text-sm">{nextStep}</span>
          </div>
        </div>
      </div>

      {/* ── Card A: 狀態卡 ── */}
      <div className={'rounded-xl border ' + conclusionColor.border + ' ' + conclusionColor.bg + ' p-5'}>
        <div className="flex items-center gap-2.5 mb-3">
          <div className={'w-3 h-3 rounded-full ' + conclusionColor.dot}></div>
          <span className={'font-bold text-base ' + conclusionColor.text}>
            {conclusionLabel}
          </span>
        </div>
        <p className="text-foreground-700 text-sm">{conclusionReason}</p>
        {isPublishGatePassed && (
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 text-xs rounded-full font-medium">內容品質 {contentQualityScore}/100</span>
            <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 text-xs rounded-full font-medium">會員價值 {memberValueScore}/100</span>
            <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 text-xs rounded-full font-medium">無假資料</span>
            <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 text-xs rounded-full font-medium">已通過發布檢查</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* ── Card B: 今日報告 ── */}
        <div className="bg-white border border-background-200 rounded-xl p-5">
          <h3 className="text-foreground-900 font-semibold text-sm mb-4">今日報告</h3>
          {hasReport ? (
            <div className="space-y-2">
              <ReportRow label="報告日期" value={taipeiDate} />
              {displayBasisDate !== taipeiDate && (
                <ReportRow label="資料基準日" value={displayBasisDate} />
              )}
              <ReportRow label="盤前假設" value={report.market_bias || '—'} />
              <ReportRow label="方向把握度" value={directionConfidenceScore != null ? `${directionConfidenceScore}/100` : '—'} />
              <ReportRow label="內容品質" value={contentQualityScore != null ? `${contentQualityScore}/100` : '—'} />
              <ReportRow label="會員價值" value={memberValueScore != null ? `${memberValueScore}/100` : '—'} />
              <ReportRow label="發布狀態" value={publishReady ? '已通過' : '未通過'} />
              <ReportRow label="資料狀態" value={
                noFakeFallback === true && fakeFallbackUsed === false && dataDateAligned === true
                  ? '真實資料 / 無假資料 / 已通過發布檢查'
                  : '待確認'
              } />

              {/* 展開原始資料 */}
              <div className="pt-2 mt-2 border-t border-background-100">
                <button
                  onClick={() => setShowRawData(!showRawData)}
                  className="flex items-center gap-1.5 text-foreground-400 hover:text-foreground-600 text-xs transition-colors cursor-pointer"
                >
                  <i className={`${showRawData ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-sm`}></i>
                  展開原始資料
                </button>
                {showRawData && (
                  <div className="mt-2 space-y-1.5 pl-1">
                    <RawRow label="資料來源" value={reportSource || '—'} status={(reportSource?.startsWith('openai') ?? false) ? 'good' : 'bad'} />
                    <RawRow label="假資料防線" value={noFakeFallback === true ? '未使用假資料' : noFakeFallback === false ? '疑似使用' : '—'} status={noFakeFallback === true ? 'good' : 'bad'} />
                    <RawRow label="假資料旗標" value={fakeFallbackUsed === false ? '無' : fakeFallbackUsed === true ? '有' : '—'} status={fakeFallbackUsed === false ? 'good' : 'bad'} />
                    <RawRow label="日期對齊" value={dataDateAligned === true ? '已對齊' : dataDateAligned === false ? '未對齊' : '—'} status={dataDateAligned === true ? 'good' : 'bad'} />
                    <RawRow label="隔夜影響鏈" value={`${impactChainCount} 條`} status={impactChainCount >= 3 ? 'good' : impactChainCount >= 1 ? 'warn' : 'bad'} />
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="text-foreground-400 text-sm">暫無報告資料</p>
          )}
        </div>

        {/* ── Card C: 今日內容產出 ── */}
        <div className="bg-white border border-background-200 rounded-xl p-5">
          <h3 className="text-foreground-900 font-semibold text-sm mb-4">今日內容產出</h3>
          {isNonTrading && (
            <p className="text-amber-600 text-xs mb-3 bg-amber-500/5 border border-amber-200 rounded-lg px-3 py-2">
              非交易日不要求今日即時內容。以下狀態以最近交易日報告資料判定。
            </p>
          )}
          <div className="space-y-3 mb-4">
            <StatusItem label="LINE 推播" statusText={lineStatusLabel} ok={lineAvailable} />
            <StatusItem label="Reels 腳本" statusText={reelsStatusLabel} ok={reelsAvailable} />
            <StatusItem label="社群貼文" statusText={postStatusLabel} ok={socialPostAvailable} />
            <StatusItem label="會員研究筆記" statusText={memberStatusLabel} ok={hasMemberResearchNote} />
            <StatusItem label="內容品質檢查" statusText={isPublishGatePassed ? '已通過' : '尚未通過'} ok={isPublishGatePassed} />
            <StatusItem label="自動發布判斷" statusText={publishReady ? '已通過' : '未通過'} ok={publishReady} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/admin/scripts" className="px-3 py-2 bg-background-100 hover:bg-background-200 text-foreground-700 text-xs rounded-lg transition-colors whitespace-nowrap">
              <i className="ri-film-line mr-1"></i>前往腳本 / Reels
            </Link>
            <Link to="/admin/reports" className="px-3 py-2 bg-background-100 hover:bg-background-200 text-foreground-700 text-xs rounded-lg transition-colors whitespace-nowrap">
              <i className="ri-file-list-3-line mr-1"></i>查看每日報告
            </Link>
          </div>
        </div>
      </div>

      {/* ── Card D: 快速操作 ── */}
      <div className="bg-white border border-background-200 rounded-xl p-5">
        <h3 className="text-foreground-900 font-semibold text-sm mb-4">快速操作</h3>
        <div className="flex flex-wrap gap-2">
          <button onClick={refresh} className="px-4 py-2 bg-background-100 hover:bg-background-200 text-foreground-700 text-sm rounded-lg transition-colors whitespace-nowrap">
            <i className="ri-refresh-line mr-1.5"></i>重新整理
          </button>
          <Link to="/" className="px-4 py-2 bg-background-100 hover:bg-background-200 text-foreground-700 text-sm rounded-lg transition-colors whitespace-nowrap">
            <i className="ri-eye-line mr-1.5"></i>前往公開頁
          </Link>
          <Link to="/admin/reports" className="px-4 py-2 bg-background-100 hover:bg-background-200 text-foreground-700 text-sm rounded-lg transition-colors whitespace-nowrap">
            <i className="ri-file-list-3-line mr-1.5"></i>前往每日報告
          </Link>
          <Link to="/admin/scripts" className="px-4 py-2 bg-background-100 hover:bg-background-200 text-foreground-700 text-sm rounded-lg transition-colors whitespace-nowrap">
            <i className="ri-film-line mr-1.5"></i>前往腳本 / Reels
          </Link>
          <Link to="/admin/system-check" className="px-4 py-2 bg-background-100 hover:bg-background-200 text-foreground-700 text-sm rounded-lg transition-colors whitespace-nowrap">
            <i className="ri-shield-check-line mr-1.5"></i>前往系統檢查
          </Link>
        </div>
      </div>
    </div>
  );
}

function ReportRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-foreground-500 text-xs">{label}</span>
      <span className="text-foreground-800 text-xs font-medium">{value}</span>
    </div>
  );
}

function StatusItem({ label, statusText, ok }: { label: string; statusText: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-foreground-500 text-sm">{label}</span>
      <span className={`text-sm font-medium ${ok ? 'text-emerald-600' : 'text-foreground-400'}`}>
        <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${ok ? 'bg-emerald-500' : 'bg-foreground-300'}`}></span>
        {statusText}
      </span>
    </div>
  );
}

function RawRow({ label, value, status }: { label: string; value: string; status: 'good' | 'warn' | 'bad' }) {
  const statusColors = {
    good: 'text-emerald-600',
    warn: 'text-amber-600',
    bad: 'text-red-500',
  };
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-foreground-400 text-[10px]">{label}</span>
      <span className={`text-[10px] font-mono ${statusColors[status]}`}>{value}</span>
    </div>
  );
}
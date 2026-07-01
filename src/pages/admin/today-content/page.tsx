import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { resolveMorningAlphaState, type MorningAlphaState } from '@/lib/morningAlpha/resolveMorningAlphaState';

function getStatusCard(state: MorningAlphaState | null) {
  if (!state || !state.reportExists) {
    return {
      level: 'error' as const,
      dot: 'bg-slate-400',
      text: 'text-slate-600',
      bg: 'bg-slate-500/5',
      border: 'border-slate-300',
      label: '尚未產生',
      message: 'reports 資料表尚無可用報告，請檢查 cron 排程與 Edge Function 是否正常執行。',
    };
  }

  // V27: Non-today report check
  if (!state.isReportForToday) {
    return {
      level: 'error' as const,
      dot: 'bg-red-400',
      text: 'text-red-600',
      bg: 'bg-red-500/5',
      border: 'border-red-300',
      label: '非今日報告',
      message: `最新報告日期為 ${state.reportDate}，今日 ${state.todayTaipeiDate} 尚無報告。請檢查 generate-daily-report-v7 排程。`,
    };
  }

  if (state.publishReady) {
    return {
      level: 'success' as const,
      dot: 'bg-emerald-500',
      text: 'text-emerald-700',
      bg: 'bg-emerald-500/5',
      border: 'border-emerald-300',
      label: '可公開',
      message: '今日報告已通過發布檢查。',
    };
  }

  return {
    level: 'warning' as const,
    dot: 'bg-amber-400',
    text: 'text-amber-700',
    bg: 'bg-amber-500/5',
    border: 'border-amber-300',
    label: '今日報告已產生',
    message: '今日報告已產生，部分內容欄位可能尚未完整。',
  };
}

export default function TodayContentPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<MorningAlphaState | null>(null);
  const [showTech, setShowTech] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await resolveMorningAlphaState();
      setState(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : '讀取失敗');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

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
      <div className="max-w-4xl space-y-5">
        <div className="bg-white border border-red-200 rounded-xl p-6 text-center">
          <i className="ri-error-warning-line text-red-400 text-xl mb-2 block"></i>
          <p className="text-red-600 text-sm font-medium mb-1">讀取失敗</p>
          <p className="text-foreground-500 text-xs mb-3">{error}</p>
          <button onClick={load} className="px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white text-sm rounded-lg transition-colors whitespace-nowrap">
            重新載入
          </button>
        </div>
      </div>
    );
  }

  if (!state) return null;

  const card = getStatusCard(state);
  const displayDate = state.reportDate !== '—' ? state.reportDate : state.todayTaipeiDate;
  const basisDate = state.marketDataDate !== '—' ? state.marketDataDate : '—';
  const basisDiffers = basisDate !== '—' && basisDate !== displayDate;

  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-foreground-900 font-bold text-lg">今日內容</h1>
          <p className="text-foreground-500 text-sm mt-0.5">
            報告日期 {displayDate}
            {basisDiffers ? `｜市場資料基準 ${basisDate}` : ''}
            {'｜產生時間 '}{state.createdAtTaipei}
          </p>
        </div>
        <button onClick={load} className="px-3 py-2 bg-white border border-background-200 rounded-lg text-foreground-600 text-sm hover:bg-background-50 transition-colors whitespace-nowrap">
          <i className="ri-refresh-line mr-1"></i>重新整理
        </button>
      </div>

      {/* Big Status Card */}
      <div className={'rounded-xl border ' + card.border + ' ' + card.bg + ' p-6'}>
        <div className="flex items-center gap-3 mb-4">
          <div className={'w-4 h-4 rounded-full ' + card.dot}></div>
          <span className={'font-bold text-lg ' + card.text}>{card.label}</span>
        </div>
        <p className="text-foreground-700 text-sm mb-4">{card.message}</p>

        {state.reportExists && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
            <StatBadge label="報告日期" value={displayDate} />
            <StatBadge label="市場資料基準" value={basisDate} />
            <StatBadge label="盤前假設" value={state.marketBias} />
            <StatBadge label="把握度" value={state.confidenceScore != null ? `${state.confidenceScore}/100` : '—'} />
            <StatBadge label="內容品質" value={state.debug.qualityScore > 0 ? `${state.debug.qualityScore}/100` : '未評分'} highlight={state.activeReport.qualityPass} />
            <StatBadge label="會員價值" value={state.debug.memberValueScore > 0 ? `${state.debug.memberValueScore}/100` : '未評分'} highlight={state.activeReport.memberValuePass} />
          </div>
        )}
      </div>

      {/* Action Buttons */}
      {state.reportExists && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Link to="/report/today" className="flex items-center justify-center gap-2 px-5 py-3 bg-foreground-900 hover:bg-foreground-800 text-white text-sm font-medium rounded-xl transition-colors whitespace-nowrap">
            <i className="ri-eye-line"></i>查看完整報告
          </Link>
          {state.hasReels ? (
            <Link to="/admin/publish" className="flex items-center justify-center gap-2 px-5 py-3 bg-white border-2 border-emerald-500/30 hover:border-emerald-500/60 text-emerald-600 text-sm font-medium rounded-xl transition-colors whitespace-nowrap">
              <i className="ri-file-copy-line"></i>複製 Reels 腳本
            </Link>
          ) : (
            <div className="flex items-center justify-center gap-2 px-5 py-3 bg-white border border-background-200 rounded-xl text-foreground-400 text-sm whitespace-nowrap">
              <i className="ri-film-line"></i>Reels 尚未產生
            </div>
          )}
          {state.hasSocialPost ? (
            <Link to="/admin/publish" className="flex items-center justify-center gap-2 px-5 py-3 bg-white border-2 border-emerald-500/30 hover:border-emerald-500/60 text-emerald-600 text-sm font-medium rounded-xl transition-colors whitespace-nowrap">
              <i className="ri-file-copy-line"></i>複製社群貼文
            </Link>
          ) : (
            <div className="flex items-center justify-center gap-2 px-5 py-3 bg-white border border-background-200 rounded-xl text-foreground-400 text-sm whitespace-nowrap">
              <i className="ri-chat-3-line"></i>社群貼文尚未產生
            </div>
          )}
        </div>
      )}

      {/* One Sentence */}
      {state.reportExists && state.hasFreeContent && state.freeSummary && (
        <section className="bg-white border border-background-200 rounded-xl p-5">
          <h2 className="text-foreground-900 font-semibold text-sm mb-3 flex items-center gap-2">
            <i className="ri-message-2-line text-foreground-400"></i>今日一句話
          </h2>
          <p className="text-foreground-800 text-base font-medium leading-relaxed">
            {state.activeReport.oneSentence}
          </p>
        </section>
      )}

      {/* Display Badges */}
      {state.displayBadges.length > 0 && (
        <section className="bg-white border border-background-200 rounded-xl p-5">
          <h2 className="text-foreground-900 font-semibold text-sm mb-3 flex items-center gap-2">
            <i className="ri-price-tag-3-line text-foreground-400"></i>狀態標籤
          </h2>
          <div className="flex flex-wrap gap-2">
            {state.displayBadges.map((badge, i) => (
              <span key={i} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border ${
                badge.color === 'green' ? 'bg-emerald-500/8 text-emerald-600 border-emerald-500/20' :
                badge.color === 'amber' ? 'bg-amber-500/8 text-amber-600 border-amber-500/20' :
                badge.color === 'red' ? 'bg-red-500/8 text-red-500 border-red-500/20' :
                'bg-background-100 text-foreground-500 border-background-200'
              }`}>
                <i className={badge.icon}></i>
                {badge.label}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* ═══ DEBUG BLOCK: 目前全站 active report ═══ */}
      {state.reportExists && (
        <div className="bg-white border-2 border-amber-300 rounded-xl overflow-hidden">
          <div className="px-5 py-3 bg-amber-500/5 border-b border-amber-100 flex items-center gap-2">
            <i className="ri-radar-line text-amber-500 text-sm"></i>
            <span className="text-amber-700 text-sm font-semibold">目前全站 active report</span>
            <span className="text-amber-500 text-[10px]">— 所有前台頁面共用此筆報告</span>
          </div>
          <div className="px-5 py-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              <DebugBox label="report_id" value={state.debug.reportId} mono />
              <DebugBox label="report_date" value={state.debug.reportDate} mono />
              <DebugBox label="market_data_date" value={state.debug.marketDataDate} mono />
              <DebugBox label="us_market_date" value={state.debug.usMarketDate} mono />
              <DebugBox label="created_at_taipei" value={state.debug.createdAtTaipei} />
              <DebugBox label="market_bias" value={state.debug.marketBias} />
              <DebugBox label="confidence_score" value={state.debug.confidenceScore != null ? String(state.debug.confidenceScore) : '—'} mono />
              <DebugBox label="publish_ready" value={state.debug.publishReady ? 'true' : 'false'} mono />
              <DebugBox label="no_fake_fallback" value={state.debug.noFakeFallback ? 'true' : 'false'} mono />
              <DebugBox label="fake_fallback_used" value={state.debug.fakeFallbackUsed ? 'true' : 'false'} mono />
              <DebugBox label="ai_version" value={state.debug.aiVersion} mono />
              <DebugBox label="source" value={state.debug.source} />
            </div>
          </div>
        </div>
      )}

      {/* Content sections */}
      {!state.reportExists && (
        <div className="bg-white border border-background-200 rounded-xl p-10 text-center">
          <div className="w-12 h-12 rounded-xl bg-background-50 border border-background-200 flex items-center justify-center mx-auto mb-3">
            <i className="ri-file-unknow-line text-foreground-400 text-xl"></i>
          </div>
          <p className="text-foreground-700 text-sm font-medium mb-1">尚未產生報告</p>
          <p className="text-foreground-500 text-xs mb-4">請確認 cron 排程與 Edge Function 是否正常執行。</p>
          <button onClick={load} className="px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white text-sm rounded-lg transition-colors whitespace-nowrap">
            <i className="ri-refresh-line mr-1.5"></i>重新整理
          </button>
        </div>
      )}
    </div>
  );
}

function StatBadge({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`p-2.5 rounded-lg border ${highlight ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-white border-background-100'}`}>
      <p className="text-foreground-400 text-[10px] uppercase tracking-wider mb-0.5">{label}</p>
      <p className={`text-xs font-bold ${highlight ? 'text-emerald-600' : 'text-foreground-800'}`}>{value}</p>
    </div>
  );
}

function DebugBox({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="p-2 rounded-lg bg-amber-50 border border-amber-100">
      <p className="text-amber-600/60 text-[9px] uppercase tracking-wider mb-0.5">{label}</p>
      <p className={`text-xs font-medium truncate ${mono ? 'font-mono' : ''} text-amber-800`}>{value || '—'}</p>
    </div>
  );
}
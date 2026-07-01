import { useState, useEffect } from 'react';
import Navbar from '@/components/feature/Navbar';
import Footer from '@/components/feature/Footer';
import { Link } from 'react-router-dom';
import type {
  SystemHealthData,
  ReportStatus,
  MarketDataStatus,
  MarketNewsStatus,
  IntradayStatus,
  LinePushStatus,
  CronStatus,
  LatestReport,
  LatestMarketData,
  LatestMarketNews,
  HealthScore,
} from '@/services/systemHealthService';
import { fetchSystemHealth } from '@/services/systemHealthService';

// ===== Sub-components =====

function StatusDot({ status }: { status: 'normal' | 'warning' | 'error' | 'missing' | 'unknown' | 'expired' | 'healthy' | 'usable' }) {
  const colors: Record<string, string> = {
    normal: 'bg-green-500',
    healthy: 'bg-green-500',
    warning: 'bg-yellow-500',
    usable: 'bg-yellow-500',
    error: 'bg-red-500',
    missing: 'bg-red-500',
    expired: 'bg-red-500',
    unknown: 'bg-gray-500',
  };
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${colors[status] || 'bg-gray-500'} flex-shrink-0`}></span>;
}

function StatusLabel({ status, label }: { status: string; label?: string }) {
  const colors: Record<string, string> = {
    normal: 'bg-green-500/10 text-green-400 border-green-500/20',
    healthy: 'bg-green-500/10 text-green-400 border-green-500/20',
    warning: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    usable: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    error: 'bg-red-500/10 text-red-400 border-red-500/20',
    missing: 'bg-red-500/10 text-red-400 border-red-500/20',
    expired: 'bg-red-500/10 text-red-400 border-red-500/20',
    unknown: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
  };
  const display = label || status;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${colors[status] || colors.unknown}`}>
      <StatusDot status={status as never} />
      {display}
    </span>
  );
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-navy-800/60 border border-navy-700 rounded-xl ${className}`}>
      {children}
    </div>
  );
}

// ===== Report Status Card =====
function ReportStatusCard({ data }: { data: ReportStatus }) {
  const statusText = data.status === 'normal' ? '正常' : data.status === 'expired' ? '過期' : '尚未產生';
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-white font-semibold text-sm">今日報告狀態</h3>
        <StatusLabel status={data.status} label={statusText} />
      </div>
      <div className="space-y-2">
        <div className="flex justify-between text-xs">
          <span className="text-gray-500">報告日期</span>
          <span className="text-gray-300 font-mono">{data.report_date}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-gray-500">建立時間</span>
          <span className="text-gray-300 font-mono text-[11px]">
            {data.created_at !== '-' ? new Date(data.created_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) : '-'}
          </span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-gray-500">市場方向</span>
          <span className="text-gray-200 font-medium">{data.market_bias || '-'}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-gray-500">劇本成立度</span>
          <span className="text-gray-200 font-medium">{data.confidence_score ?? '-'}</span>
        </div>
      </div>
    </Card>
  );
}

// ===== Market Data Status Card =====
function MarketDataStatusCard({ data }: { data: MarketDataStatus }) {
  const statusText = data.status === 'normal' ? '正常' : data.status === 'warning' ? '部分缺失' : '異常';
  const coreList = Object.entries(data.coreSymbols);
  const presentCount = coreList.filter(([, v]) => v).length;
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-white font-semibold text-sm">市場資料狀態</h3>
        <StatusLabel status={data.status} label={statusText} />
      </div>
      <div className="space-y-2">
        <div className="flex justify-between text-xs">
          <span className="text-gray-500">最新擷取</span>
          <span className="text-gray-300 font-mono text-[11px]">
            {data.latestCapturedAt !== '-' ? new Date(data.latestCapturedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) : '-'}
          </span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-gray-500">今日筆數</span>
          <span className="text-gray-200 font-medium">{data.todayCount}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-gray-500">核心 Symbol</span>
          <span className="text-gray-200 font-medium">{presentCount}/{coreList.length}</span>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {coreList.map(([sym, present]) => (
            <span
              key={sym}
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono ${
                present
                  ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                  : 'bg-red-500/10 text-red-400 border border-red-500/20'
              }`}
            >
              <span className={`w-1 h-1 rounded-full ${present ? 'bg-green-400' : 'bg-red-400'}`}></span>
              {sym}
            </span>
          ))}
        </div>
        {data.missingCore.length > 0 && (
          <p className="text-red-400 text-[10px] mt-1">缺少：{data.missingCore.join(', ')}</p>
        )}
      </div>
    </Card>
  );
}

// ===== Market News Status Card =====
function MarketNewsStatusCard({ data }: { data: MarketNewsStatus }) {
  const statusText = data.status === 'normal' ? '正常' : data.status === 'warning' ? '偏少' : '異常';
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-white font-semibold text-sm">新聞資料狀態</h3>
        <StatusLabel status={data.status} label={statusText} />
      </div>
      <div className="space-y-2">
        <div className="flex justify-between text-xs">
          <span className="text-gray-500">最新時間</span>
          <span className="text-gray-300 font-mono text-[11px]">
            {data.latestCreatedAt !== '-' ? new Date(data.latestCreatedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) : '-'}
          </span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-gray-500">今日總數</span>
          <span className="text-gray-200 font-medium">{data.todayTotal}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-gray-500">已選中 (is_selected)</span>
          <span className={`font-medium ${data.selectedToday >= 5 ? 'text-green-400' : data.selectedToday >= 3 ? 'text-yellow-400' : 'text-red-400'}`}>
            {data.selectedToday}
          </span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-gray-500">平均 final_score</span>
          <span className="text-gray-200 font-medium">{data.avgFinalScore}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-gray-500">已排除 (低相關)</span>
          <span className="text-gray-200 font-medium">{data.rejectedCount}</span>
        </div>
      </div>
    </Card>
  );
}

// ===== LINE Push Status Card =====
function LinePushStatusCard({ data }: { data: LinePushStatus }) {
  const statusText = data.status === 'normal' ? '正常' : data.status === 'warning' ? '部分失敗' : '尚無資料';
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-white font-semibold text-sm">LINE 推播狀態</h3>
        <StatusLabel status={data.status} label={statusText} />
      </div>
      {data.status === 'unknown' ? (
        <div className="space-y-2">
          <div className="flex items-start gap-2 text-gray-400 text-xs">
            <i className="ri-information-line mt-0.5"></i>
            <p>需由 cron-job.org 驗證排程執行狀態。若每天有收到 LINE 推播，代表正常運作。</p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">今日推播數</span>
            <span className="text-gray-200 font-medium">{data.todayPushCount}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">成功</span>
            <span className="text-green-400 font-medium">{data.todaySuccessCount}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">失敗</span>
            <span className={data.todayFailCount > 0 ? 'text-red-400 font-medium' : 'text-gray-200 font-medium'}>
              {data.todayFailCount}
            </span>
          </div>
          {data.latestPushAt && (
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">最後推播</span>
              <span className="text-gray-300 font-mono text-[11px]">
                {new Date(data.latestPushAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}
              </span>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ===== Cron Status Card =====
function CronStatusCard({ data }: { data: CronStatus[] }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-white font-semibold text-sm">自動排程狀態</h3>
        <StatusLabel status="unknown" label="需 cron-job.org 驗證" />
      </div>
      <div className="space-y-2.5">
        {data.map((fn) => (
          <div key={fn.slug} className="flex items-center justify-between">
            <span className="text-gray-400 text-xs font-mono">{fn.name}</span>
            <span className="inline-flex items-center gap-1.5 text-gray-500 text-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-500"></span>
              待驗證
            </span>
          </div>
        ))}
        <p className="text-gray-600 text-[10px] mt-2 flex items-start gap-1">
          <i className="ri-information-line mt-0.5"></i>
          排程由外部 cron-job.org 管理，需登入 cron-job.org 確認執行記錄。
        </p>
      </div>
    </Card>
  );
}

// ===== Tomorrow Checklist =====
function TomorrowChecklist() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);

  const [checks, setChecks] = useState<{
    reportExists: boolean;
    marketDataExists: boolean;
    marketNewsExists: boolean;
    loading: boolean;
  }>({ reportExists: false, marketDataExists: false, marketNewsExists: false, loading: true });

  useEffect(() => {
    async function check() {
      try {
        const { supabase } = await import('@/lib/supabase');

        const [reportRes, mdRes, newsRes] = await Promise.all([
          supabase.from('reports').select('id').eq('report_date', tomorrowStr).maybeSingle(),
          supabase.from('market_data').select('captured_at').gte('captured_at', `${tomorrowStr}T00:00:00`).lte('captured_at', `${tomorrowStr}T23:59:59`).limit(1),
          supabase.from('market_news').select('created_at').gte('created_at', `${tomorrowStr}T00:00:00`).lte('created_at', `${tomorrowStr}T23:59:59`).limit(1),
        ]);

        setChecks({
          reportExists: !!reportRes.data,
          marketDataExists: (mdRes.data || []).length > 0,
          marketNewsExists: (newsRes.data || []).length > 0,
          loading: false,
        });
      } catch {
        setChecks({ reportExists: false, marketDataExists: false, marketNewsExists: false, loading: false });
      }
    }
    check();
  }, [tomorrowStr]);

  const checkItems = [
    {
      label: '07:27 daily report cron 設定',
      icon: 'ri-timer-line',
      description: '需確認 cron-job.org 已設定 Fetch Global Market News 排程',
      pass: null,
      note: '需登入 cron-job.org 確認',
    },
    {
      label: '07:30 LINE push cron 設定',
      icon: 'ri-timer-line',
      description: '需確認 cron-job.org 已設定 LINE Daily Push 排程',
      pass: null,
      note: '需登入 cron-job.org 確認',
    },
    {
      label: `reports 出現 ${tomorrowStr} 日期`,
      icon: 'ri-file-text-line',
      description: 'Daily Report Cron 執行後，reports 表應出現明日 report_date',
      pass: checks.reportExists,
      note: checks.reportExists ? '已出現 (疑為提前執行)' : '尚未出現 ✓ (正常)',
    },
    {
      label: `market_data 有 ${tomorrowStr} captured_at`,
      icon: 'ri-database-2-line',
      description: 'Market Data 排程執行後，應有明日 captured_at 的市場資料',
      pass: checks.marketDataExists,
      note: checks.marketDataExists ? '已出現 (疑為提前執行)' : '尚未出現 ✓ (正常)',
    },
    {
      label: `market_news 有 ${tomorrowStr} created_at`,
      icon: 'ri-newspaper-line',
      description: 'Fetch News 排程執行後，應有明日 created_at 的新聞',
      pass: checks.marketNewsExists,
      note: checks.marketNewsExists ? '已出現 (疑為提前執行)' : '尚未出現 ✓ (正常)',
    },
    {
      label: `前台顯示 ${tomorrowStr} report_date`,
      icon: 'ri-eye-line',
      description: '今日頁面應顯示明日日期的盤前劇本 (07:30 後驗證)',
      pass: null,
      note: '明天 07:30 後手動驗證',
    },
  ];

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-4">
        <i className="ri-check-double-line text-amber-400 text-base"></i>
        <h3 className="text-white font-semibold text-sm">明日檢查清單 ({tomorrowStr})</h3>
        {checks.loading && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-500/10 text-amber-400 text-[10px] rounded-full">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></div>
            檢查中
          </span>
        )}
      </div>
      <p className="text-gray-500 text-xs mb-4">
        明天早上 07:27-07:30 自動更新後，逐項確認資料是否正確產生。目前為事前檢查。
      </p>
      <div className="space-y-2">
        {checkItems.map((item, idx) => (
          <div
            key={idx}
            className={`flex items-start gap-3 p-3 rounded-lg border ${
              item.pass === null
                ? 'bg-gray-500/5 border-gray-500/10'
                : item.pass
                  ? 'bg-green-500/5 border-green-500/10'
                  : 'bg-red-500/5 border-red-500/10'
            }`}
          >
            <div className="w-7 h-7 flex items-center justify-center flex-shrink-0 mt-0.5">
              {item.pass === null ? (
                <div className="w-5 h-5 rounded-full border-2 border-gray-500/40 flex items-center justify-center">
                  <span className="text-gray-500/60 text-[10px] font-bold">{idx + 1}</span>
                </div>
              ) : item.pass ? (
                <i className="ri-checkbox-circle-line text-green-400 text-lg"></i>
              ) : (
                <i className="ri-close-circle-line text-red-400 text-lg"></i>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <i className={`${item.icon} text-gray-400 text-xs`}></i>
                <span className="text-white text-sm font-medium">{item.label}</span>
                {idx < 2 && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 text-[10px] font-medium">
                    <i className="ri-external-link-line text-[8px]"></i>
                    cron-job.org
                  </span>
                )}
              </div>
              <p className="text-gray-500 text-xs mt-0.5">{item.description}</p>
              {item.note && (
                <p className={`text-[10px] mt-1 ${
                  item.pass === true ? 'text-green-400' : item.pass === false ? 'text-red-400' : 'text-amber-400/70'
                }`}>
                  <i className="ri-information-line text-[10px] mr-1"></i>
                  {item.note}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 pt-3 border-t border-navy-700">
        <div className="flex items-start gap-2">
          <i className="ri-information-line text-gray-500 text-xs mt-0.5 flex-shrink-0"></i>
          <p className="text-gray-600 text-[10px] leading-relaxed">
            明天 07:30 自動更新成功後，前 3 項 (reports / market_data / market_news) 的狀態會從「尚未出現」變為「已出現」。
            最後一項需在前台手動確認：首頁是否顯示 {tomorrowStr} 的盤前劇本。
            若全部通過，即可放心刪除 fetch-market-data-v7/v8/v9 舊版 Function。
          </p>
        </div>
      </div>
    </Card>
  );
}

// ===== Health Score Gauge =====
function HealthScoreGauge({ data }: { data: HealthScore }) {
  const getColorClass = () => {
    switch (data.label) {
      case 'healthy': return 'text-green-400';
      case 'usable': return 'text-yellow-400';
      case 'warning': return 'text-orange-400';
      case 'error': return 'text-red-400';
    }
  };
  const getBgClass = () => {
    switch (data.label) {
      case 'healthy': return 'bg-green-500';
      case 'usable': return 'bg-yellow-500';
      case 'warning': return 'bg-orange-500';
      case 'error': return 'bg-red-500';
    }
  };
  const getLabelText = () => {
    switch (data.label) {
      case 'healthy': return '健康';
      case 'usable': return '可用但需觀察';
      case 'warning': return '警告';
      case 'error': return '異常';
    }
  };

  return (
    <Card className="p-5">
      <h3 className="text-white font-semibold text-sm mb-4">系統健康分數</h3>
      <div className="flex items-center gap-5">
        <div className="relative w-24 h-24 flex-shrink-0">
          <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="8" className="text-navy-700" />
            <circle
              cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${(data.score / 100) * 264} 264`}
              className={getBgClass()}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={`text-2xl font-bold ${getColorClass()}`}>{data.score}</span>
          </div>
        </div>
        <div className="flex-1 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className={`text-lg font-bold ${getColorClass()}`}>{getLabelText()}</span>
          </div>
          <div className="space-y-1 text-[10px]">
            {[
              { label: '報告', score: data.breakdown.reports, max: 25 },
              { label: '市場資料', score: data.breakdown.marketData, max: 25 },
              { label: '新聞選中', score: data.breakdown.marketNews, max: 25 },
              { label: '核心 Symbol', score: data.breakdown.coreSymbols, max: 15 },
              { label: '低相關排除', score: data.breakdown.lowRelevance, max: 10 },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-2">
                <span className="text-gray-500 w-16">{item.label}</span>
                <div className="flex-1 h-1.5 bg-navy-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${item.score >= item.max ? 'bg-green-500' : item.score > 0 ? 'bg-yellow-500' : 'bg-red-500'}`}
                    style={{ width: `${(item.score / item.max) * 100}%` }}
                  ></div>
                </div>
                <span className="text-gray-400 w-8 text-right font-mono">{item.score}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

// ===== Warning Banners =====
function WarningBanners({
  reportStatus,
  marketNewsStatus,
  marketDataStatus,
  intradayStatus,
}: {
  reportStatus: ReportStatus;
  marketNewsStatus: MarketNewsStatus;
  marketDataStatus: MarketDataStatus;
  intradayStatus: IntradayStatus;
}) {
  const warnings: { type: 'red' | 'yellow'; message: string }[] = [];

  if (!reportStatus.isToday && reportStatus.status !== 'missing') {
    warnings.push({
      type: 'red',
      message: '今日報告尚未產生，前台不得顯示為今日資料。',
    });
  }
  if (!marketDataStatus.isToday && marketDataStatus.status !== 'missing') {
    warnings.push({
      type: 'yellow',
      message: '市場資料尚未更新至今日，前台資料可能過期。',
    });
  }
  if (!marketNewsStatus.isToday && marketNewsStatus.status !== 'error') {
    warnings.push({
      type: 'yellow',
      message: '最新新聞尚未更新至今日，AI 分析可能偏舊。',
    });
  }
  if (!intradayStatus.isToday && intradayStatus.status !== 'missing') {
    warnings.push({
      type: 'yellow',
      message: '開盤雷達尚未更新至今日，盤中驗證可能過期。',
    });
  }
  if (marketDataStatus.missingCore.includes('TXF') || marketDataStatus.missingCore.includes('2330')) {
    warnings.push({
      type: 'yellow',
      message: '台指期或台積電現股資料缺失，盤中判斷可信度下降。',
    });
  }
  if (marketNewsStatus.selectedToday < 3 && marketNewsStatus.selectedToday > 0) {
    warnings.push({
      type: 'yellow',
      message: '今日有效新聞過少，AI 軍師內容可能重複或偏弱。',
    });
  }

  if (warnings.length === 0) return null;

  return (
    <div className="space-y-2">
      {warnings.map((w, i) => (
        <div
          key={i}
          className={`flex items-start gap-2 px-4 py-3 rounded-lg border text-sm ${
            w.type === 'red'
              ? 'bg-red-500/10 border-red-500/20 text-red-400'
              : 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400'
          }`}
        >
          <i className={`ri-${w.type === 'red' ? 'error-warning' : 'alert'}-line mt-0.5`}></i>
          <p>{w.message}</p>
        </div>
      ))}
    </div>
  );
}

// ===== Data Tables =====
function ReportsTable({ data }: { data: LatestReport[] }) {
  return (
    <Card className="overflow-hidden">
      <div className="px-5 py-3 border-b border-navy-700">
        <h3 className="text-white font-semibold text-sm">最新 Reports (共 {data.length} 筆)</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[700px]">
          <thead>
            <tr className="bg-navy-800">
              <th className="px-4 py-2.5 text-left text-gray-500 text-xs font-medium">日期</th>
              <th className="px-4 py-2.5 text-left text-gray-500 text-xs font-medium">建立時間</th>
              <th className="px-4 py-2.5 text-left text-gray-500 text-xs font-medium">市場方向</th>
              <th className="px-4 py-2.5 text-left text-gray-500 text-xs font-medium">成立度</th>
              <th className="px-4 py-2.5 text-left text-gray-500 text-xs font-medium">摘要</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-700">
            {data.map((r, i) => (
              <tr key={i} className="hover:bg-navy-700/50 transition-colors">
                <td className="px-4 py-2.5 text-gray-200 text-xs font-mono whitespace-nowrap">{r.report_date}</td>
                <td className="px-4 py-2.5 text-gray-400 text-[11px] font-mono whitespace-nowrap">
                  {r.created_at !== '-' ? new Date(r.created_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) : '-'}
                </td>
                <td className="px-4 py-2.5">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${
                    (r.market_bias || '').includes('多')
                      ? 'bg-green-500/10 text-green-400'
                      : (r.market_bias || '').includes('空')
                        ? 'bg-red-500/10 text-red-400'
                        : 'bg-yellow-500/10 text-yellow-400'
                  }`}>
                    {r.market_bias || '-'}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-gray-200 text-xs font-mono">{r.confidence_score ?? '-'}</td>
                <td className="px-4 py-2.5 text-gray-400 text-[11px] max-w-xs truncate">
                  {(r.summary || '-').slice(0, 80)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function MarketDataTable({ data }: { data: LatestMarketData[] }) {
  return (
    <Card className="overflow-hidden">
      <div className="px-5 py-3 border-b border-navy-700">
        <h3 className="text-white font-semibold text-sm">最新 Market Data (共 {data.length} 筆)</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[700px]">
          <thead>
            <tr className="bg-navy-800">
              <th className="px-4 py-2.5 text-left text-gray-500 text-xs font-medium">Symbol</th>
              <th className="px-4 py-2.5 text-left text-gray-500 text-xs font-medium">Name</th>
              <th className="px-4 py-2.5 text-right text-gray-500 text-xs font-medium">Value</th>
              <th className="px-4 py-2.5 text-right text-gray-500 text-xs font-medium">Change %</th>
              <th className="px-4 py-2.5 text-left text-gray-500 text-xs font-medium">Captured At</th>
              <th className="px-4 py-2.5 text-center text-gray-500 text-xs font-medium">狀態</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-700">
            {data.map((r, i) => (
              <tr key={i} className="hover:bg-navy-700/50 transition-colors">
                <td className="px-4 py-2.5">
                  <span className={`font-mono text-xs whitespace-nowrap ${r.isCore ? 'text-green-400 font-semibold' : 'text-gray-300'}`}>
                    {r.symbol}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-gray-300 text-xs whitespace-nowrap">{r.name}</td>
                <td className="px-4 py-2.5 text-gray-200 text-xs text-right font-mono whitespace-nowrap">
                  {r.value.toLocaleString('zh-TW', { maximumFractionDigits: 2 })}
                </td>
                <td className={`px-4 py-2.5 text-xs text-right font-mono whitespace-nowrap ${
                  r.change_percent > 0 ? 'text-green-400' : r.change_percent < 0 ? 'text-red-400' : 'text-gray-400'
                }`}>
                  {r.change_percent > 0 ? '+' : ''}{r.change_percent.toFixed(2)}%
                </td>
                <td className="px-4 py-2.5 text-gray-400 text-[11px] font-mono whitespace-nowrap">
                  {r.captured_at !== '-' ? new Date(r.captured_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) : '-'}
                </td>
                <td className="px-4 py-2.5 text-center">
                  {r.isCore ? (
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${
                      r.isToday ? 'bg-green-500/10 text-green-400' : 'bg-yellow-500/10 text-yellow-400'
                    }`}>
                      <span className={`w-1 h-1 rounded-full ${r.isToday ? 'bg-green-400' : 'bg-yellow-400'}`}></span>
                      {r.isToday ? '核心' : '過期'}
                    </span>
                  ) : (
                    <span className="text-gray-600 text-[10px]">-</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function MarketNewsTable({ data }: { data: LatestMarketNews[] }) {
  return (
    <Card className="overflow-hidden">
      <div className="px-5 py-3 border-b border-navy-700">
        <h3 className="text-white font-semibold text-sm">最新 Market News (共 {data.length} 筆)</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead>
            <tr className="bg-navy-800">
              <th className="px-4 py-2.5 text-left text-gray-500 text-xs font-medium">Title</th>
              <th className="px-4 py-2.5 text-left text-gray-500 text-xs font-medium">Source</th>
              <th className="px-4 py-2.5 text-left text-gray-500 text-xs font-medium">Category</th>
              <th className="px-4 py-2.5 text-center text-gray-500 text-xs font-medium">Score</th>
              <th className="px-4 py-2.5 text-center text-gray-500 text-xs font-medium">Selected</th>
              <th className="px-4 py-2.5 text-left text-gray-500 text-xs font-medium">TW Names</th>
              <th className="px-4 py-2.5 text-left text-gray-500 text-xs font-medium">Rejection</th>
              <th className="px-4 py-2.5 text-left text-gray-500 text-xs font-medium">Created At</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-700">
            {data.map((r, i) => (
              <tr key={i} className={`hover:bg-navy-700/50 transition-colors ${r.isLowRelevance ? 'bg-red-500/5' : ''}`}>
                <td className="px-4 py-2.5 text-xs max-w-xs">
                  <span className={r.isLowRelevance ? 'text-red-400' : 'text-gray-200'}>
                    {r.title}
                  </span>
                  {r.isLowRelevance && (
                    <span className="inline-flex items-center gap-0.5 ml-1.5 px-1 py-0.5 rounded text-[9px] bg-red-500/10 text-red-400 whitespace-nowrap">
                      低相關
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-gray-400 text-[11px] whitespace-nowrap">{r.source}</td>
                <td className="px-4 py-2.5 text-gray-400 text-[11px] whitespace-nowrap">{r.category}</td>
                <td className="px-4 py-2.5 text-center">
                  <span className={`text-xs font-mono font-medium ${
                    r.final_score >= 80 ? 'text-green-400' : r.final_score >= 50 ? 'text-yellow-400' : 'text-red-400'
                  }`}>
                    {r.final_score}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-center">
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${
                    r.is_selected ? 'bg-green-500/10 text-green-400' : 'bg-gray-500/10 text-gray-500'
                  }`}>
                    {r.is_selected ? 'Yes' : 'No'}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-gray-400 text-[10px] max-w-[120px]">
                  <span className="line-clamp-1">{r.related_tw_names.join(', ') || '-'}</span>
                </td>
                <td className="px-4 py-2.5 text-gray-500 text-[10px] max-w-[100px]">
                  <span className="line-clamp-1">{r.rejection_reason || '-'}</span>
                </td>
                <td className="px-4 py-2.5 text-gray-400 text-[10px] font-mono whitespace-nowrap">
                  {r.created_at !== '-' ? new Date(r.created_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ===== Main Page =====
export default function SystemHealth() {
  const [data, setData] = useState<SystemHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const result = await fetchSystemHealth();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : '讀取資料失敗');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <div className="min-h-screen bg-navy-950 flex flex-col">
      <Navbar />

      <main className="flex-1">
        <div className="w-full px-4 md:px-6 py-6 md:py-8">
          <div className="max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h1 className="text-white font-bold text-xl md:text-2xl">系統健康儀表板</h1>
                  {data && (
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
                      data.healthScore.label === 'healthy'
                        ? 'bg-green-500/10 text-green-400 border-green-500/20'
                        : data.healthScore.label === 'usable'
                          ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                          : data.healthScore.label === 'warning'
                            ? 'bg-orange-500/10 text-orange-400 border-orange-500/20'
                            : 'bg-red-500/10 text-red-400 border-red-500/20'
                    }`}>
                      <StatusDot status={data.healthScore.label} />
                      健康分數 {data.healthScore.score}/100
                    </span>
                  )}
                </div>
                <p className="text-gray-500 text-sm">監控 Morning Alpha 各系統元件的即時運行狀態</p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  to="/admin"
                  className="px-3 py-2 bg-navy-700 hover:bg-navy-600 text-gray-300 text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
                >
                  <i className="ri-arrow-left-line mr-1"></i>
                  返回管理後台
                </Link>
                <button
                  onClick={() => window.location.reload()}
                  className="px-3 py-2 bg-navy-700 hover:bg-navy-600 text-gray-300 text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
                >
                  <i className="ri-refresh-line mr-1"></i>
                  重新整理
                </button>
              </div>
            </div>

            {/* Loading */}
            {loading && (
              <div className="flex items-center justify-center py-20">
                <div className="text-center">
                  <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
                  <p className="text-gray-500 text-sm">載入系統健康資料中...</p>
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <Card className="p-8 text-center">
                <i className="ri-error-warning-line text-red-400 text-2xl mb-2 block"></i>
                <p className="text-red-400 text-sm font-medium mb-1">讀取系統資料失敗</p>
                <p className="text-gray-500 text-xs mb-4">{error}</p>
                <button
                  onClick={() => window.location.reload()}
                  className="px-4 py-2 bg-navy-700 hover:bg-navy-600 text-white text-sm rounded-lg transition-colors"
                >
                  重新載入
                </button>
              </Card>
            )}

            {/* Data Content */}
            {data && !loading && !error && (
              <div className="space-y-5">
                {/* Warning Banners */}
                <WarningBanners
                  reportStatus={data.reportStatus}
                  marketNewsStatus={data.marketNewsStatus}
                  marketDataStatus={data.marketDataStatus}
                  intradayStatus={data.intradayStatus}
                />

                {/* Health Score */}
                <HealthScoreGauge data={data.healthScore} />

                {/* Status Cards Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
                  <ReportStatusCard data={data.reportStatus} />
                  <MarketDataStatusCard data={data.marketDataStatus} />
                  <MarketNewsStatusCard data={data.marketNewsStatus} />
                  <LinePushStatusCard data={data.linePushStatus} />
                  <CronStatusCard data={data.cronStatuses} />
                </div>

                {/* Tomorrow Checklist */}
                <TomorrowChecklist />

                {/* Data Tables */}
                <ReportsTable data={data.latestReports} />
                <MarketDataTable data={data.latestMarketData} />
                <MarketNewsTable data={data.latestMarketNews} />
              </div>
            )}
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
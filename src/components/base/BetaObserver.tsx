import { useState, useEffect } from 'react';
import { getLatestReports } from '@/services/reportService';

export default function BetaObserver() {
  const [reportCount, setReportCount] = useState<number | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const reports = await getLatestReports(7);
        setReportCount(reports.length);
      } catch {
        setReportCount(null);
      }
    }
    load();
  }, []);

  return (
    <section className="bg-white border border-surface-200 rounded-2xl p-4 md:p-6">
      <div className="flex items-center gap-2 mb-4 md:mb-5">
        <div className="w-7 h-7 md:w-8 md:h-8 bg-navy-800 rounded-lg flex items-center justify-center">
          <i className="ri-radar-line text-white text-sm"></i>
        </div>
        <div>
          <h3 className="text-navy-900 font-semibold text-sm md:text-base">封測觀察</h3>
          <p className="text-surface-500 text-[10px] md:text-xs">產品養成期數據，僅供內部參考</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
        {/* Today's visitors */}
        <div className="bg-surface-50 border border-surface-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 bg-surface-200 rounded flex items-center justify-center">
              <i className="ri-user-line text-surface-500 text-xs"></i>
            </div>
            <span className="text-navy-700 text-sm font-medium">今日訪客</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-surface-400 text-xs">封測數據收集中</span>
            <div className="w-2 h-2 rounded-full bg-surface-300 animate-breathing-slow"></div>
          </div>
          <p className="text-surface-500 text-[10px] mt-2">正式上線後將啟用分析</p>
        </div>

        {/* Last 7 days reports */}
        <div className="bg-surface-50 border border-surface-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 bg-surface-200 rounded flex items-center justify-center">
              <i className="ri-file-text-line text-surface-500 text-xs"></i>
            </div>
            <span className="text-navy-700 text-sm font-medium">最近 7 天報告</span>
          </div>
          {reportCount !== null ? (
            <div className="flex items-baseline gap-1.5">
              <span className="text-navy-900 text-2xl font-bold">{reportCount}</span>
              <span className="text-surface-400 text-xs">份 AI 報告已生成</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-surface-400 text-xs">載入中...</span>
            </div>
          )}
        </div>

        {/* Most viewed sections */}
        <div className="bg-surface-50 border border-surface-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 bg-surface-200 rounded flex items-center justify-center">
              <i className="ri-eye-line text-surface-500 text-xs"></i>
            </div>
            <span className="text-navy-700 text-sm font-medium">最常查看區塊</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-surface-400 text-xs">封測數據收集中</span>
            <div className="w-2 h-2 rounded-full bg-surface-300 animate-breathing-slow"></div>
          </div>
          <p className="text-surface-500 text-[10px] mt-2">正式上線後將啟用分析</p>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-surface-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-block px-2 py-0.5 bg-amber-500/10 text-amber-600 text-[10px] font-medium rounded-full border border-amber-500/20">
            免費封測中
          </span>
          <span className="text-surface-400 text-[10px]">目前免費開放，未來將依使用者需求開放進階功能</span>
        </div>
        <span className="text-surface-500 text-[10px]">每日 07:30 自動更新</span>
      </div>
    </section>
  );
}
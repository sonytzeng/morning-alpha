import { useState, useEffect } from 'react';
import {
  fetchLatestPublishedReport,
} from '@/services/dailyReportService';
import {
  generateLinePreview,
  formatLineMessageText,
} from '@/services/pushService';
import { BRAND_ICON_URL, BRAND_NAME } from '@/config/brand';
import type { SupabaseDailyReport } from '@/services/dailyReportService';

export default function LinePushPreview() {
  const [report, setReport] = useState<SupabaseDailyReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const r = await fetchLatestPublishedReport();
        setReport(r);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const preview = generateLinePreview(report, baseUrl);
  const lineMessage = formatLineMessageText(preview);

  if (loading) {
    return (
      <div className="bg-white border border-surface-200 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-6 h-6 bg-green-500 rounded-lg flex items-center justify-center">
            <i className="ri-chat-3-line text-white text-xs"></i>
          </div>
          <span className="text-navy-900 font-semibold text-sm">LINE 推播預覽</span>
        </div>
        <div className="animate-pulse space-y-2">
          <div className="h-3 bg-surface-100 rounded w-3/4"></div>
          <div className="h-3 bg-surface-100 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-surface-200 rounded-xl overflow-hidden">
      {/* LINE Header */}
      <div className="bg-green-500 px-4 py-3 flex items-center gap-2">
        <i className="ri-chat-3-line text-white text-sm"></i>
        <span className="text-white text-sm font-medium">{BRAND_NAME}</span>
      </div>

      {/* Chat Area */}
      <div className="p-4 space-y-3 bg-surface-50 min-h-[200px]">
        {/* AI Bot Avatar + Message */}
        <div className="flex items-start gap-2">
          <div className="w-8 h-8 bg-navy-800 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden">
            <img
              src={BRAND_ICON_URL}
              alt={BRAND_NAME}
              className="w-6 h-6 object-contain"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
                const parent = (e.target as HTMLImageElement).parentElement;
                if (parent) {
                  parent.innerHTML = '<i class="ri-bar-chart-box-line text-white text-xs"></i>';
                }
              }}
            />
          </div>
          <div className="bg-white rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm max-w-[90%]">
            <p className="text-navy-900 text-xs leading-relaxed whitespace-pre-line">
              {lineMessage}
            </p>
          </div>
        </div>

        {/* Simulated User Reply Hint */}
        <div className="flex items-start gap-2 justify-end opacity-50">
          <div className="bg-green-100 rounded-2xl rounded-tr-sm px-3 py-2">
            <p className="text-green-800 text-xs">輸入「報告」查看完整分析</p>
          </div>
        </div>
      </div>

      {/* Footer Info */}
      <div className="px-4 py-3 border-t border-surface-100 bg-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-green-500 rounded-full"></span>
            <span className="text-surface-500 text-xs">每天早上 07:30 自動推播</span>
          </div>
          <span className="text-surface-400 text-xs">{preview.sentiment} · 把握度 {preview.confidence}</span>
        </div>
      </div>
    </div>
  );
}
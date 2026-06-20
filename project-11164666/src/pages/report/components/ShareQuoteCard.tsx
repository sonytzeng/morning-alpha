import type { Report } from '@/types/report';

interface ShareQuoteCardProps {
  report: Report | null;
  onCopy: () => void;
  copied: boolean;
  onShareX: () => void;
  onShareThreads: () => void;
  onGenerateImage: () => void;
  onDownloadImage: () => void;
  generatingImage: boolean;
  shareImageUrl: string | null;
}

export default function ShareQuoteCard({
  report,
  onCopy,
  copied,
  onShareX,
  onShareThreads,
  onGenerateImage,
  onDownloadImage,
  generatingImage,
  shareImageUrl,
}: ShareQuoteCardProps) {
  const quote = report?.today_quote || report?.summary || '今日市場觀察中...';
  const bias = report?.market_bias || '震盪';
  const score = report?.confidence_score ?? 50;
  const date = report?.report_date || new Date().toLocaleDateString('zh-TW');

  return (
    <div className="relative bg-navy-900/80 border border-navy-800 rounded-2xl p-6 md:p-8 overflow-hidden">
      <div className="absolute -top-20 -right-20 w-40 h-40 rounded-full blur-[80px] opacity-[0.04] bg-amber-500 pointer-events-none"></div>

      <div className="relative text-center">
        <div className="mb-4">
          <i className="ri-double-quotes-l text-amber-400/20 text-3xl"></i>
        </div>

        <p className="text-white text-lg md:text-xl lg:text-[22px] font-bold leading-relaxed mb-4 max-w-2xl mx-auto">
          「{quote}」
        </p>

        <div className="flex items-center justify-center gap-2 mb-6">
          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-medium ${
            bias.includes('偏多') ? 'bg-rose-500/15 border-rose-400/35 text-rose-300' :
            bias.includes('偏空') ? 'bg-emerald-500/15 border-emerald-400/35 text-emerald-300' :
            'bg-amber-500/15 border-amber-400/35 text-amber-300'
          }`}>
            {bias}
          </span>
          <span className="text-white/30 text-xs">把握度 {score}/100 · {date}</span>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            onClick={onCopy}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-white/5 hover:bg-white/10 text-white/80 hover:text-white text-xs font-medium rounded-xl transition-all border border-white/10 min-h-[40px]"
          >
            <i className={`${copied ? 'ri-check-line text-forest-400' : 'ri-file-copy-line'} text-xs`}></i>
            {copied ? '已複製！' : '複製這句'}
          </button>

          <button
            onClick={onShareX}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-white/5 hover:bg-white/10 text-white/80 hover:text-white text-xs font-medium rounded-xl transition-all border border-white/10 min-h-[40px]"
          >
            <i className="ri-twitter-x-line text-xs"></i>
            分享到 X
          </button>

          <button
            onClick={onShareThreads}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-white/5 hover:bg-white/10 text-white/80 hover:text-white text-xs font-medium rounded-xl transition-all border border-white/10 min-h-[40px]"
          >
            <i className="ri-hashtag text-xs"></i>
            分享到 Threads
          </button>

          <button
            onClick={onGenerateImage}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-white/5 hover:bg-white/10 text-white/80 hover:text-white text-xs font-medium rounded-xl transition-all border border-white/10 min-h-[40px]"
          >
            <i className={`${generatingImage ? 'ri-loader-4-line animate-spin' : 'ri-image-line'} text-xs`}></i>
            {generatingImage ? '生成中...' : '生成圖卡'}
          </button>

          {shareImageUrl && (
            <button
              onClick={onDownloadImage}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-forest-500/10 hover:bg-forest-500/20 text-forest-400 text-xs font-medium rounded-xl transition-all border border-forest-500/20 min-h-[40px]"
            >
              <i className="ri-download-line text-xs"></i>
              下載圖卡
            </button>
          )}
        </div>

        {shareImageUrl && (
          <div className="mt-4 flex justify-center">
            <img
              src={shareImageUrl}
              alt="Morning Alpha 分享圖卡"
              className="max-w-sm w-full rounded-xl border border-white/10"
            />
          </div>
        )}
      </div>
    </div>
  );
}
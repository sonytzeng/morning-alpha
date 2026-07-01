interface VoiceEntryCardProps {
  hasTodayReport: boolean;
}

export default function VoiceEntryCard({ hasTodayReport }: VoiceEntryCardProps) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 md:p-8">
      <div className="flex items-start justify-between gap-4 mb-4 md:mb-5">
        <div>
          <h2 className="text-white font-bold text-base md:text-lg mb-1">1 分鐘盤前速報｜暫緩開放</h2>
          <p className="text-white/40 text-xs md:text-sm leading-relaxed">
            未來將提供每日盤前語音摘要，目前優先完成資料穩定與盤前判讀品質。
            {hasTodayReport && ' 今日盤前報告已可檢視。'}
          </p>
        </div>
        <div className="flex-shrink-0 pt-1">
          <div className="w-10 h-10 bg-amber-500/15 rounded-xl flex items-center justify-center border border-amber-500/20">
            <i className="ri-mic-line text-amber-400 text-sm"></i>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4 mb-4">
        <div className="flex items-center gap-2 mb-2">
          <i className="ri-file-text-line text-amber-400 text-sm"></i>
          <span className="text-white/60 text-xs font-medium">速報內容</span>
        </div>
        <p className="text-white/40 text-xs leading-relaxed">
          早安開場 · 今日盤前訊號 · 全球市場背景 · 台股主線與風險方向 · 09:15 / 10:30 觀察重點 · 收尾提醒
        </p>
      </div>

      <span className="inline-flex items-center gap-2 px-5 py-3 bg-amber-500/10 text-amber-400/50 font-medium text-sm rounded-xl transition-colors whitespace-nowrap border border-amber-500/20 w-full justify-center cursor-not-allowed">
        <i className="ri-mic-line"></i>
        1 分鐘語音｜準備中
      </span>

      <p className="text-white/20 text-xs text-center mt-3">
        音訊播放功能尚未開放
      </p>
    </div>
  );
}
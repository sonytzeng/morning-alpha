import type { Report } from '@/types/report';

interface Props {
  report: Report | null;
}

interface CorrectionEvent {
  time: string;
  title: string;
  content: string;
  type: 'shift' | 'warning' | 'alert';
}

function getCorrectionEvents(report: Report | null): CorrectionEvent[] {
  if (!report) {
    return [
      {
        time: '10:42',
        title: '電子權值股轉弱',
        content: '市場開始偏離早上的偏多劇本。現在重點不是猜低點，而是避免用早上的情緒追價。',
        type: 'shift',
      },
      {
        time: '09:35',
        title: '開盤情緒過熱',
        content: 'AI 偵測到開盤後第一波上漲可能伴隨過多情緒。建議觀察 10:30 前是否延續。',
        type: 'warning',
      },
    ];
  }

  const bias = report.market_bias || '震盪';
  const score = report.confidence_score ?? 50;
  const events: CorrectionEvent[] = [];

  // 根據 bias 和 score 動態生成
  if (bias.includes('偏多') && score >= 75) {
    events.push({
      time: '09:35',
      title: '開盤情緒過熱',
      content: 'AI 偵測到開盤後第一波上漲可能伴隨過多情緒。建議觀察 10:30 前是否延續。不要追在第一根。',
      type: 'warning',
    });
    events.push({
      time: '10:42',
      title: '若電子權值股轉弱',
      content: '市場可能開始偏離早上的偏多劇本。現在重點不是猜低點，而是避免用早上的情緒追價。',
      type: 'shift',
    });
  } else if (bias.includes('偏多')) {
    events.push({
      time: '09:35',
      title: '開盤動能觀察',
      content: 'AI 看到開盤有方向，但動能還不夠強。建議等 10:30 確認主流延續性。',
      type: 'warning',
    });
    events.push({
      time: '11:15',
      title: '若主流族群散掉',
      content: '如果領漲族群開始退潮，代表盤前劇本可能失效。這時候不要硬撐。',
      type: 'shift',
    });
  } else if (bias.includes('偏空')) {
    events.push({
      time: '09:35',
      title: '開盤壓力觀察',
      content: 'AI 偵測到市場開盤偏弱。注意恐慌情緒是否擴散，不要跟著亂賣。',
      type: 'alert',
    });
    events.push({
      time: '10:30',
      title: '若持續無承接',
      content: '如果下跌過程中沒有明顯承接，代表盤前偏空劇本仍在持續。不要急著抄底。',
      type: 'shift',
    });
  } else {
    events.push({
      time: '09:35',
      title: '開盤方向不明',
      content: 'AI 偵測到市場開盤沒有明確方向。這種時候最容易犯的錯是硬找方向進場。',
      type: 'warning',
    });
    events.push({
      time: '11:00',
      title: '若輪動加速',
      content: '如果族群輪動開始變快，代表市場還沒有共識。繼續觀察，不要追。',
      type: 'shift',
    });
  }

  return events;
}

function eventStyle(type: 'shift' | 'warning' | 'alert') {
  switch (type) {
    case 'shift':
      return {
        border: 'border-amber-500/20',
        bg: 'bg-amber-500/[0.04]',
        iconBg: 'bg-amber-500/10',
        iconColor: 'text-amber-400',
        timeBg: 'bg-amber-500/10',
        timeColor: 'text-amber-400',
        title: 'text-white',
        content: 'text-white/60',
      };
    case 'warning':
      return {
        border: 'border-forest-500/20',
        bg: 'bg-forest-500/[0.04]',
        iconBg: 'bg-forest-500/10',
        iconColor: 'text-forest-400',
        timeBg: 'bg-forest-500/10',
        timeColor: 'text-forest-400',
        title: 'text-white',
        content: 'text-white/60',
      };
    case 'alert':
      return {
        border: 'border-red-500/20',
        bg: 'bg-red-500/[0.04]',
        iconBg: 'bg-red-500/10',
        iconColor: 'text-red-400',
        timeBg: 'bg-red-500/10',
        timeColor: 'text-red-400',
        title: 'text-white',
        content: 'text-white/60',
      };
  }
}

export default function IntradayCorrection({ report }: Props) {
  const events = getCorrectionEvents(report);

  return (
    <section className="w-full">
      <div className="mb-5 md:mb-6">
        <div className="flex items-center gap-2 mb-2">
          <p className="text-white/30 text-[10px] uppercase tracking-[0.3em] font-semibold">
            INTRADAY CORRECTION
          </p>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-500/10 text-amber-400 text-[10px] font-medium rounded-full border border-amber-500/20">
            <i className="ri-pulse-line animate-data-pulse"></i>
            盤中監測
          </span>
        </div>
        <h2 className="text-white font-bold text-xl md:text-2xl">AI 盤中校正</h2>
        <p className="text-white/40 text-sm mt-1">
          市場正在變化。這裡記錄盤中可能出現的劇本偏移，讓你在市場轉向時先停下來。
        </p>
      </div>

      <div className="relative">
        {/* Timeline line */}
        <div className="absolute left-4 md:left-5 top-6 bottom-6 w-px bg-white/5"></div>

        <div className="space-y-3 md:space-y-4">
          {events.map((event, idx) => {
            const style = eventStyle(event.type);
            return (
              <div
                key={idx}
                className={`relative flex items-start gap-3 md:gap-4 p-4 md:p-5 rounded-xl border ${style.border} ${style.bg} transition-all duration-300 hover:border-opacity-60`}
              >
                {/* Timeline dot */}
                <div className="relative flex-shrink-0">
                  <div className={`w-8 h-8 md:w-9 md:h-9 ${style.iconBg} rounded-lg flex items-center justify-center border ${style.border} z-10 relative`}>
                    <i className={`ri-radar-line ${style.iconColor} text-xs md:text-sm`}></i>
                  </div>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span className={`text-[10px] md:text-xs font-semibold px-2 py-0.5 rounded-full ${style.timeBg} ${style.timeColor}`}>
                      {event.time}
                    </span>
                    <h3 className={`text-sm md:text-base font-semibold ${style.title}`}>
                      {event.title}
                    </h3>
                  </div>
                  <p className={`text-xs md:text-sm leading-relaxed ${style.content}`}>
                    {event.content}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom disclaimer */}
      <div className="mt-4 md:mt-5 flex items-center gap-2 p-3 rounded-xl bg-white/[0.02] border border-white/5">
        <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-data-pulse"></div>
        <p className="text-white/30 text-xs">
          以上為盤前推演的潛在偏移情境，非即時盤中監測。實際盤中請依市場現況判斷。
        </p>
      </div>
    </section>
  );
}
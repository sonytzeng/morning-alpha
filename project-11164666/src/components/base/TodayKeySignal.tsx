import type { Report } from '@/types/report';

interface Signal {
  title: string;
  time: string;
  description: string;
  why: string;
  priority: 'high' | 'medium' | 'low';
}

function getKeySignals(report: Report | null): Signal[] {
  if (!report) {
    return [
      {
        title: '10:30 前，主流族群有沒有延續',
        time: '10:30',
        description: '如果 10:30 前主流散掉，今天就不要再用早上的偏多情緒判斷。',
        why: '這是盤中第一個確認點，主流延續與否決定今天盤前劇本是否有效。',
        priority: 'high',
      },
      {
        title: '半導體 / AI / 電子權值是否續強',
        time: '10:30',
        description: '電子權值股是台股主流方向，它的強弱直接影響大盤。',
        why: '權值股不撐盤時，指數容易走軟，這時候不要硬看多。',
        priority: 'high',
      },
      {
        title: '指數是否開高走低',
        time: '09:30',
        description: '開高走低是盤前偏多劇本最常見的失效模式。',
        why: '開高走低代表早盤情緒過熱後快速冷卻，這時候追價風險最大。',
        priority: 'medium',
      },
    ];
  }

  const signals: Signal[] = [];
  const bias = report.market_bias || '震盪';
  const score = report.confidence_score ?? 50;
  const avoid = report.avoid_today || [];
  const sectors = report.watch_sectors_json || [];

  // 固定三個核心訊號
  signals.push({
    title: '10:30 前，主流族群有沒有延續',
    time: '10:30',
    description: '如果 10:30 前主流散掉，今天就不要再用早上的偏多情緒判斷。',
    why: '這是盤中第一個確認點，主流延續與否決定今天盤前劇本是否有效。',
    priority: 'high',
  });

  signals.push({
    title: '半導體 / AI / 電子權值是否續強',
    time: '10:30',
    description: '電子權值股是台股主流方向，它的強弱直接影響大盤。',
    why: '權值股不撐盤時，指數容易走軟，這時候不要硬看多。',
    priority: 'high',
  });

  signals.push({
    title: '指數是否開高走低',
    time: '09:30',
    description: '開高走低是盤前偏多劇本最常見的失效模式。',
    why: '開高走低代表早盤情緒過熱後快速冷卻，這時候追價風險最大。',
    priority: 'medium',
  });

  return signals.slice(0, 3);
}

const fallbackSignals: Signal[] = [
  {
    title: '10:30 前，主流族群有沒有延續',
    time: '10:30',
    description: '如果 10:30 前主流散掉，今天就不要再用早上的偏多情緒判斷。',
    why: '這是盤中第一個確認點，主流延續與否決定今天盤前劇本是否有效。',
    priority: 'high',
  },
  {
    title: '半導體 / AI / 電子權值是否續強',
    time: '10:30',
    description: '電子權值股是台股主流方向，它的強弱直接影響大盤。',
    why: '權值股不撐盤時，指數容易走軟，這時候不要硬看多。',
    priority: 'high',
  },
  {
    title: '指數是否開高走低',
    time: '09:30',
    description: '開高走低是盤前偏多劇本最常見的失效模式。',
    why: '開高走低代表早盤情緒過熱後快速冷卻，這時候追價風險最大。',
    priority: 'medium',
  },
];

function priorityStyle(priority: 'high' | 'medium' | 'low') {
  switch (priority) {
    case 'high':
      return {
        border: 'border-red-500/20',
        bg: 'bg-red-500/[0.04]',
        badge: 'bg-red-500/10 border-red-500/20 text-red-400',
        timeBg: 'bg-red-500/10 text-red-400',
      };
    case 'medium':
      return {
        border: 'border-amber-500/20',
        bg: 'bg-amber-500/[0.04]',
        badge: 'bg-amber-500/10 border-amber-500/20 text-amber-400',
        timeBg: 'bg-amber-500/10 text-amber-400',
      };
    case 'low':
      return {
        border: 'border-white/10',
        bg: 'bg-white/[0.02]',
        badge: 'bg-white/5 border-white/10 text-white/50',
        timeBg: 'bg-white/5 text-white/40',
      };
  }
}

export default function TodayKeySignal({ report }: { report: Report | null }) {
  const signals = getKeySignals(report);
  const hasRealData = !!(report?.market_bias || report?.avoid_today);

  return (
    <section className="w-full">
      <div className="mb-5 md:mb-6">
        <div className="flex items-center gap-2 mb-2">
          <p className="text-white/30 text-[10px] uppercase tracking-[0.3em] font-semibold">KEY SIGNAL</p>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-500/10 text-amber-400 text-[10px] font-medium rounded-full border border-amber-500/20">
            <i className="ri-focus-3-line"></i>
            今日重點
          </span>
        </div>
        <h2 className="text-white font-bold text-xl md:text-2xl">你今天最該盯的訊號</h2>
        <p className="text-white/40 text-sm mt-1 leading-relaxed">
          不是叫你預測，而是提醒你今天盤中最該確認哪一件事。
        </p>
      </div>

      <div className="space-y-3 md:space-y-4">
        {signals.map((signal, idx) => {
          const style = priorityStyle(signal.priority);
          return (
            <div
              key={idx}
              className={`p-4 md:p-5 rounded-xl border ${style.border} ${style.bg} transition-all duration-300 hover:border-opacity-60`}
            >
              <div className="flex items-start gap-3 md:gap-4">
                <div className="flex-shrink-0">
                  <div className={`w-10 h-10 ${style.timeBg} rounded-xl flex items-center justify-center font-mono text-xs font-bold`}>
                    {signal.time}
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <h3 className="text-white text-sm md:text-base font-semibold">{signal.title}</h3>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border ${style.badge} font-medium`}>
                      {signal.priority === 'high' ? '最優先' : signal.priority === 'medium' ? '重要' : '留意'}
                    </span>
                  </div>
                  <p className="text-white/60 text-sm leading-relaxed mb-2">{signal.description}</p>
                  <div className="flex items-start gap-2">
                    <i className="ri-lightbulb-line text-white/20 text-xs mt-0.5 flex-shrink-0"></i>
                    <p className="text-white/30 text-xs leading-relaxed">{signal.why}</p>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Fallback 訊號（資料不足時） */}
      {!hasRealData && (
        <div className="mt-4 md:mt-5 bg-white/[0.02] border border-white/5 rounded-xl p-4 md:p-5">
          <p className="text-white/40 text-sm font-medium mb-3">其他值得留意的訊號：</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {fallbackSignals.slice(0, 4).map((signal, idx) => (
              <div key={idx} className="flex items-center gap-2 p-2.5 rounded-lg bg-white/[0.02] border border-white/5">
                <div className="w-6 h-6 bg-white/5 rounded-md flex items-center justify-center flex-shrink-0">
                  <span className="text-white/30 text-[10px] font-mono">{signal.time}</span>
                </div>
                <p className="text-white/40 text-xs truncate">{signal.title}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
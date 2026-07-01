import type { Report } from '@/types/report';

interface Signal {
  title: string;
  time: string;
  description: string;
  why: string;
  priority: 'high' | 'medium' | 'low';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePriority(value: unknown): Signal['priority'] {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'medium';
}

function addSignal(
  signals: Signal[],
  signal: {
    title: string;
    description: string;
    why?: string;
    time?: string;
    priority?: Signal['priority'];
  },
) {
  const title = signal.title.trim();
  const description = signal.description.trim();

  if (!title || !description || signals.length >= 3) return;

  signals.push({
    title,
    time: signal.time || '—',
    description,
    why: signal.why?.trim() || '資料來自今日盤前報告，盤中請依實際價格與成交量驗證。',
    priority: signal.priority || 'medium',
  });
}

function getKeySignals(report: Report | null): Signal[] {
  const signals: Signal[] = [];

  if (!report) return signals;

  const aiStrategy = isRecord(report.ai_strategy_json) ? report.ai_strategy_json : {};
  const validationPlan = isRecord(aiStrategy.intraday_validation_plan)
    ? aiStrategy.intraday_validation_plan
    : {};

  Object.entries(validationPlan).forEach(([key, value]) => {
    const description = getText(value);
    if (!description) return;

    addSignal(signals, {
      title: key.replace(/_/g, ' '),
      description,
      why: '這是 AI 策略 JSON 內的盤中驗證條件。',
      priority: 'high',
    });
  });

  if (Array.isArray(aiStrategy.invalidation_conditions)) {
    aiStrategy.invalidation_conditions.forEach((item) => {
      if (typeof item === 'string') {
        addSignal(signals, {
          title: '劇本失效條件',
          description: item,
          why: '若此條件發生，盤前假設需要重新評估。',
          priority: 'high',
        });
        return;
      }

      if (!isRecord(item)) return;
      addSignal(signals, {
        title: getText(item.title) || '劇本失效條件',
        description: getText(item.condition) || getText(item.description),
        why: getText(item.meaning) || '若此條件發生，盤前假設需要重新評估。',
        priority: 'high',
      });
    });
  }

  report.risk_factors_json?.forEach((risk) => {
    addSignal(signals, {
      title: risk.title,
      description: risk.description,
      why: '這是今日報告列出的風險因子。',
      priority: normalizePriority(risk.level),
    });
  });

  report.key_drivers?.forEach((driver) => {
    addSignal(signals, {
      title: '盤前關鍵驅動',
      description: driver,
      why: '這是今日報告列出的市場驅動因素。',
      priority: 'medium',
    });
  });

  report.today_strategy?.do?.forEach((item) => {
    addSignal(signals, {
      title: '今日觀察重點',
      description: item,
      why: '這是今日策略中可執行或可觀察的項目。',
      priority: 'medium',
    });
  });

  return signals.slice(0, 3);
}

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
        {signals.length > 0 ? (
          signals.map((signal, idx) => {
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
          })
        ) : (
          <div className="p-4 md:p-5 rounded-xl border border-white/10 bg-white/[0.02]">
            <p className="text-white/50 text-sm leading-relaxed">目前資料不足，等待盤前報告補齊盤中觀察訊號。</p>
          </div>
        )}
      </div>
    </section>
  );
}

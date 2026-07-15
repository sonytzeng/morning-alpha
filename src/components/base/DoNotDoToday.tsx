import type { Report } from '@/types/report';

interface DontRule {
  title: string;
  icon: string;
  reason: string;
  intensity: 'critical' | 'important' | 'gentle';
}

function getDontRules(report: Report | null): DontRule[] {
  const bias = report?.market_bias || '震盪';
  const score = report?.confidence_score ?? 50;
  const avoidList = report?.avoid_today || [];
  const riskWarning = report?.ai_strategy_json?.risk_warning || report?.risk_reason || '';

  // Build rules from report data first
  const reportRules: DontRule[] = [];
  if (avoidList.length > 0) {
    avoidList.slice(0, 2).forEach((item) => {
      reportRules.push({
        title: item,
        icon: 'ri-forbid-line',
        reason: '這個提醒來自今日 AI 盤前觀察，不是猜測，是根據市場情緒整理出的高頻錯誤。',
        intensity: 'critical',
      });
    });
  }

  const baseRules: DontRule[] = [
    {
      title: '不要看到電子股開高，就把它當成整天都會強',
      icon: 'ri-arrow-up-line',
      reason: '開盤強不代表收盤強。很多時候開高是隔夜消息的短暫反應，10:30 後才是真實方向。',
      intensity: 'critical',
    },
    {
      title: '不要因為昨天沒買到，今天一開盤就補進去',
      icon: 'ri-history-line',
      reason: '「怕錯過」是最貴的情緒。昨天沒買到的理由，今天可能還在，甚至更明顯。',
      intensity: 'critical',
    },
    {
      title: '不要把別人的獲利截圖，當成自己的進場理由',
      icon: 'ri-image-line',
      reason: '別人的獲利是結果，不是你的訊號。每個人的資金、風險承受度、進場時間都不同。',
      intensity: 'important',
    },
    {
      title: '不要在情緒最滿的時候重壓單一方向',
      icon: 'ri-emotion-line',
      reason: '興奮或恐慌時做的決定，通常品質最差。重壓需要的是冷靜，不是熱情。',
      intensity: 'important',
    },
    {
      title: '不要因為市場很熱，就覺得自己不能錯過',
      icon: 'ri-fire-line',
      reason: '市場最危險的地方，通常不是漲跌，而是你開始覺得自己不能錯過。這時候最容易失控。',
      intensity: 'critical',
    },
    {
      title: '不要開盤 5 分鐘內就做最大決定',
      icon: 'ri-time-line',
      reason: '開盤的波動最大，雜訊也最多。等等看，不會讓你少賺多少，但可能讓你少賠很多。',
      intensity: 'important',
    },
  ];

  // If risk warning exists, add it as a critical rule
  if (riskWarning) {
    reportRules.push({
      title: riskWarning,
      icon: 'ri-alarm-warning-line',
      reason: '今日風險提醒：這個訊號來自 AI 對市場整體情緒的評估，不是單一事件。',
      intensity: 'critical',
    });
  }

  // If market is over-heat, add extra rules
  if (bias.includes('偏多') && score >= 75) {
    return [
      ...reportRules,
      {
        title: '不要看到紅 K 就追，開盤追高是最貴的入場券',
        icon: 'ri-arrow-up-line',
        reason: '市場情緒過熱時，追高的風險遠大於機會。等拉回再觀察，比追在最高點安全。',
        intensity: 'critical',
      },
      ...baseRules,
    ];
  }

  // If market is bearish
  if (bias.includes('偏空')) {
    return [
      ...reportRules,
      {
        title: '不要因為跌多了就想抄底',
        icon: 'ri-arrow-down-line',
        reason: '底是市場走出來的，不是猜出來的。趨勢沒轉之前，你的「跌夠了」可能只是腰斬的開始。',
        intensity: 'critical',
      },
      ...baseRules,
    ];
  }

  return [...reportRules, ...baseRules];
}

function intensityStyle(intensity: 'critical' | 'important' | 'gentle') {
  switch (intensity) {
    case 'critical':
      return {
        border: 'border-red-500/20',
        bg: 'bg-red-500/5',
        iconBg: 'bg-red-500/15',
        iconColor: 'text-red-400',
        badge: 'border-red-500/30 text-red-400 bg-red-500/10',
      };
    case 'important':
      return {
        border: 'border-amber-500/20',
        bg: 'bg-amber-500/5',
        iconBg: 'bg-amber-500/15',
        iconColor: 'text-amber-400',
        badge: 'border-amber-500/30 text-amber-400 bg-amber-500/10',
      };
    case 'gentle':
      return {
        border: 'border-white/10',
        bg: 'bg-white/5',
        iconBg: 'bg-white/5',
        iconColor: 'text-white/40',
        badge: 'border-white/10 text-white/50 bg-white/5',
      };
  }
}

export default function DoNotDoToday({ report }: { report: Report | null }) {
  const rules = getDontRules(report);

  return (
    <section className="w-full">
      <div className="mb-5">
        <div className="flex items-center gap-2">
          <p className="text-white/30 text-[10px] uppercase tracking-widest font-semibold mb-1">Guard Rails</p>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-500/10 text-red-400 text-[10px] font-medium rounded-full">
            <i className="ri-alert-line"></i>
            重點提醒
          </span>
        </div>
        <h2 className="text-white font-bold text-xl md:text-2xl">今天不要做的事</h2>
        <p className="text-white/40 text-sm mt-1">
          市場最危險的地方，通常不是漲跌，而是你開始覺得自己不能錯過。
        </p>
      </div>

      <div className="bg-navy-900 rounded-2xl overflow-hidden">
        {/* Header */}
        <div className="px-4 md:px-6 py-4 border-b border-navy-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 md:w-10 md:h-10 bg-navy-800 rounded-xl flex items-center justify-center">
              <i className="ri-shield-check-line text-forest-400 text-base md:text-lg"></i>
            </div>
            <div>
              <p className="text-white text-sm md:text-sm font-semibold">盤前安全檢查清單</p>
              <p className="text-surface-500 text-xs">
                {report?.report_date || new Date().toLocaleDateString('zh-TW')} · 今天不做這些事，比做了什麼更重要
              </p>
            </div>
          </div>
        </div>

        {/* Rules */}
        <div className="p-4 md:p-6">
          <div className="space-y-2.5 md:space-y-3">
            {rules.map((rule, idx) => {
              const style = intensityStyle(rule.intensity);
              return (
                <div
                  key={idx}
                  className={`flex items-start gap-3 md:gap-4 p-3.5 md:p-4 rounded-xl border ${style.border} ${style.bg} transition-all duration-300 hover:border-opacity-50`}
                >
                  <div className={`w-8 h-8 md:w-9 md:h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${style.iconBg}`}>
                    <i className={`${rule.icon} ${style.iconColor} text-sm`}></i>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className={`text-[10px] md:text-xs px-2 py-0.5 rounded-full border font-medium ${style.badge}`}>
                        {rule.intensity === 'critical' ? '最重要' : rule.intensity === 'important' ? '重要' : '提醒'}
                      </span>
                      <h4 className="text-white text-sm font-semibold">{rule.title}</h4>
                    </div>
                    <p className="text-surface-400 text-xs md:text-xs leading-relaxed">{rule.reason}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer quote */}
        <div className="px-4 md:px-6 py-3 md:py-4 bg-navy-950/50 border-t border-navy-800">
          <p className="text-surface-500 text-xs text-center leading-relaxed">
            市場每天都有機會，但你的本金沒有第二次。今天少犯一個錯，比多賺一點更重要。
          </p>
        </div>
      </div>
    </section>
  );
}

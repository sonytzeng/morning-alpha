import type { Report } from '@/types/report';

interface Props {
  report: Report | null;
}

interface FearItem {
  title: string;
  severity: 'high' | 'medium' | 'low';
  context: string;
}

function getMarketFears(report: Report | null): FearItem[] {
  if (!report) {
    return [
      {
        title: '美國通膨擔憂',
        severity: 'medium',
        context: '會讓市場重新思考降息速度，這種時候不要追在最高點。',
      },
      {
        title: '美債殖利率波動',
        severity: 'medium',
        context: '可能壓抑高估值科技股，這是市場在「重新定價」的過程。',
      },
      {
        title: '情緒化交易',
        severity: 'high',
        context: '今天最危險的不是下跌，而是看到上漲就失去紀律。',
      },
    ];
  }

  const fears: FearItem[] = [];
  const bias = report.market_bias || '震盪';
  const score = report.confidence_score ?? 50;

  // 從 risk_factors_json 取
  const risks = report.risk_factors_json;
  if (risks && risks.length > 0) {
    risks.slice(0, 3).forEach((r) => {
      fears.push({
        title: r.title,
        severity: r.level === 'high' ? 'high' : r.level === 'medium' ? 'medium' : 'low',
        context: r.description,
      });
    });
  }

  // 從 avoid_today 取
  const avoid = report.avoid_today;
  if (avoid && avoid.length > 0 && fears.length < 3) {
    avoid.slice(0, 3 - fears.length).forEach((item) => {
      fears.push({
        title: item,
        severity: 'high',
        context: '這是 AI 根據今日市場情緒整理出的高頻風險，不是猜測，是提醒你在這種情緒下容易犯的錯。',
      });
    });
  }

  // 根據 market_bias 動態推斷
  if (bias.includes('偏多') && score >= 75) {
    if (fears.length < 3) {
      fears.push({
        title: 'AI 過熱後的獲利了結',
        severity: 'high',
        context: '市場情緒偏熱時，短線資金隨時可能撤退。不要追在情緒最高點，先確認主流延續。',
      });
    }
    if (fears.length < 3) {
      fears.push({
        title: '開高後量能不足',
        severity: 'medium',
        context: '開盤強勢如果沒有成交量配合，容易變成假突破。這種時候追價很危險。',
      });
    }
  } else if (bias.includes('偏空')) {
    if (fears.length < 3) {
      fears.push({
        title: '恐慌情緒擴散',
        severity: 'high',
        context: '市場偏弱時，恐慌會讓人亂賣。記住：亂賣比亂買更傷，先確認是不是真恐慌。',
      });
    }
    if (fears.length < 3) {
      fears.push({
        title: '避險族群也開始轉弱',
        severity: 'medium',
        context: '當防禦標的也撐不住，代表市場壓力比想像中大。這時候不要急著抄底。',
      });
    }
  } else {
    if (fears.length < 3) {
      fears.push({
        title: '主流族群輪動過快',
        severity: 'medium',
        context: '沒有明確方向時，資金東奔西跑，追什麼都容易被套。這種時候觀望比較安全。',
      });
    }
    if (fears.length < 3) {
      fears.push({
        title: '量能萎縮',
        severity: 'low',
        context: '成交量變小時，市場容易因為小資金就大幅波動。不要讓小波動影響你的判斷。',
      });
    }
  }

  return fears.slice(0, 3);
}

function severityStyle(severity: 'high' | 'medium' | 'low') {
  switch (severity) {
    case 'high':
      return {
        border: 'border-red-500/20',
        bg: 'bg-red-500/[0.04]',
        dot: 'bg-red-400',
        dotGlow: 'shadow-red-400/30',
        label: 'text-red-400',
        labelBg: 'bg-red-500/10',
        title: 'text-white',
        context: 'text-white/50',
      };
    case 'medium':
      return {
        border: 'border-amber-500/20',
        bg: 'bg-amber-500/[0.04]',
        dot: 'bg-amber-400',
        dotGlow: 'shadow-amber-400/30',
        label: 'text-amber-400',
        labelBg: 'bg-amber-500/10',
        title: 'text-white',
        context: 'text-white/50',
      };
    case 'low':
      return {
        border: 'border-white/10',
        bg: 'bg-white/[0.02]',
        dot: 'bg-white/40',
        dotGlow: 'shadow-white/10',
        label: 'text-white/50',
        labelBg: 'bg-white/5',
        title: 'text-white/80',
        context: 'text-white/40',
      };
  }
}

export default function MarketFearSection({ report }: Props) {
  const fears = getMarketFears(report);

  return (
    <section className="w-full">
      <div className="mb-5 md:mb-6">
        <div className="flex items-center gap-2 mb-2">
          <p className="text-white/30 text-[10px] uppercase tracking-[0.3em] font-semibold">MARKET FEAR</p>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-500/10 text-red-400 text-[10px] font-medium rounded-full border border-red-500/20">
            <i className="ri-alert-line"></i>
            風險感知
          </span>
        </div>
        <h2 className="text-white font-bold text-xl md:text-2xl">今天市場正在怕什麼</h2>
        <p className="text-white/40 text-sm mt-1 leading-relaxed">
          知道市場怕什麼，不是為了恐慌，而是讓你不要在錯的位置衝動。
        </p>
      </div>

      <div className="space-y-2.5 md:space-y-3">
        {fears.map((fear, idx) => {
          const style = severityStyle(fear.severity);
          return (
            <div
              key={idx}
              className={`group flex items-start gap-3 md:gap-4 p-4 md:p-5 rounded-xl border ${style.border} ${style.bg} transition-all duration-300 hover:border-opacity-60`}
              style={{ animationDelay: `${idx * 100}ms` }}
            >
              <div className="flex-shrink-0 mt-0.5">
                <div
                  className={`w-2.5 h-2.5 rounded-full ${style.dot} animate-live-pulse ${style.dotGlow}`}
                  style={{ animationDelay: `${idx * 200}ms` }}
                ></div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <h3 className={`text-sm md:text-base font-semibold ${style.title}`}>
                    {fear.title}
                  </h3>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border ${style.labelBg} ${style.label} font-medium`}>
                    {fear.severity === 'high' ? '高度' : fear.severity === 'medium' ? '中度' : '低度'}
                  </span>
                </div>
                <p className={`text-xs md:text-sm leading-relaxed ${style.context}`}>
                  {fear.context}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom insight */}
      <div className="mt-4 md:mt-5 flex items-start gap-3 p-3 md:p-4 rounded-xl bg-white/[0.02] border border-white/5">
        <div className="w-7 h-7 md:w-8 md:h-8 bg-navy-800 rounded-lg flex items-center justify-center flex-shrink-0">
          <i className="ri-brain-line text-white/40 text-xs md:text-sm"></i>
        </div>
        <div>
          <p className="text-white/60 text-xs md:text-sm font-medium">
            市場最危險的時候，通常是「大家都覺得沒問題」的時候。
          </p>
          <p className="text-white/30 text-xs mt-1">
            Morning Alpha 不是預測災難，而是幫你在市場最熱的時候，多一次停下來確認的機會。
          </p>
        </div>
      </div>
    </section>
  );
}
import type { Report, AIStrategy } from '@/types/report';

interface Props {
  strategy: AIStrategy | null;
  marketBias: string | null;
  confidenceScore: number | null;
}

interface Persona {
  key: string;
  title: string;
  subtitle: string;
  icon: string;
  iconBg: string;
  allocations: { label: string; percent: number; color: string }[];
  advice: string;
  reminder: string;
}

export default function SmallCapitalCard({ strategy, marketBias, confidenceScore }: Props) {
  const bias = marketBias || '中性';
  const score = confidenceScore ?? 50;
  const isBullish = bias.includes('偏多') || bias.includes('強勢');
  const isBearish = bias.includes('偏空') || bias.includes('弱');
  const isHighConfidence = score >= 75;

  // Dynamic allocation based on market bias + confidence
  const getAllocations = (): { conservative: Persona; balanced: Persona; aggressive: Persona } => {
    if (isBullish && isHighConfidence) {
      return {
        conservative: {
          key: 'conservative',
          title: '今天適合先穩住的人',
          subtitle: '市場有熱度，但你選擇冷靜',
          icon: 'ri-shield-check-line',
          iconBg: 'bg-forest-500',
          allocations: [
            { label: 'ETF', percent: 50, color: 'bg-forest-500' },
            { label: '現金', percent: 40, color: 'bg-surface-300' },
            { label: '觀察', percent: 10, color: 'bg-amber-400' },
          ],
          advice: '市場雖然偏多，但你不急著追。先用 ETF 感受大盤溫度，保留現金等更好的進場時機。',
          reminder: '今天最該避免的是「看到別人賺就開始慌」。你不用一次投入，市場每天都有機會。',
        },
        balanced: {
          key: 'balanced',
          title: '今天適合慢慢等機會的人',
          subtitle: '想參與但不想被情緒牽著走',
          icon: 'ri-scales-line',
          iconBg: 'bg-amber-500',
          allocations: [
            { label: 'ETF', percent: 35, color: 'bg-forest-500' },
            { label: 'AI/半導體', percent: 35, color: 'bg-amber-500' },
            { label: '現金', percent: 30, color: 'bg-surface-300' },
          ],
          advice: '趨勢偏強，但你不貪。適度配置熱門族群，保留現金應對可能的回檔。',
          reminder: '今天最容易失控的地方是「看到漲停就想追」。建立觀察清單比進場更重要。',
        },
        aggressive: {
          key: 'aggressive',
          title: '今天適合能承受波動的人',
          subtitle: '你願意承擔風險，但還是要有底線',
          icon: 'ri-flashlight-line',
          iconBg: 'bg-red-500',
          allocations: [
            { label: 'AI/半導體', percent: 45, color: 'bg-red-500' },
            { label: 'ETF', percent: 30, color: 'bg-forest-500' },
            { label: '現金', percent: 25, color: 'bg-surface-300' },
          ],
          advice: '趨勢明確，你選擇提高成長股比例，但還是保留現金應對突發變化。',
          reminder: '即使今天把握度高，也不要忘記「漲多的時候最危險的是覺得不會跌」。保留現金是保護自己。',
        },
      };
    }
    if (isBullish) {
      return {
        conservative: {
          key: 'conservative',
          title: '今天適合先穩住的人',
          subtitle: '市場有方向，但你選擇觀察',
          icon: 'ri-shield-check-line',
          iconBg: 'bg-forest-500',
          allocations: [
            { label: 'ETF', percent: 45, color: 'bg-forest-500' },
            { label: '現金', percent: 45, color: 'bg-surface-300' },
            { label: '觀察', percent: 10, color: 'bg-amber-400' },
          ],
          advice: '市場偏多但把握度普通，你選擇提高現金比例，ETF 少量參與就好。',
          reminder: '今天最該避免的是「覺得有方向就急著進場」。方向不算特別強，慢慢觀察更安全。',
        },
        balanced: {
          key: 'balanced',
          title: '今天適合慢慢等機會的人',
          subtitle: '想參與但不想被盤中衝高騙進去',
          icon: 'ri-scales-line',
          iconBg: 'bg-amber-500',
          allocations: [
            { label: 'ETF', percent: 40, color: 'bg-forest-500' },
            { label: 'AI/半導體', percent: 25, color: 'bg-amber-500' },
            { label: '現金', percent: 35, color: 'bg-surface-300' },
          ],
          advice: '趨勢尚可但劇本成立度不高，你選擇保守一些，保留彈性。',
          reminder: '今天最容易失控的地方是「早盤衝高就追進去」。先觀察再看盤中表現，不要急。',
        },
        aggressive: {
          key: 'aggressive',
          title: '今天適合能承受波動的人',
          subtitle: '願意小額試水溫，但知道底線在哪',
          icon: 'ri-flashlight-line',
          iconBg: 'bg-red-500',
          allocations: [
            { label: 'AI/半導體', percent: 35, color: 'bg-red-500' },
            { label: 'ETF', percent: 35, color: 'bg-forest-500' },
            { label: '現金', percent: 30, color: 'bg-surface-300' },
          ],
          advice: '雖然偏多但把握度普通，你選擇控制倉位，保留現金。',
          reminder: '今天不是重押的好時機。適合小額試水溫，不適合把樂觀當依據。',
        },
      };
    }
    if (isBearish) {
      return {
        conservative: {
          key: 'conservative',
          title: '今天適合先穩住的人',
          subtitle: '市場偏空，你選擇看戲',
          icon: 'ri-shield-check-line',
          iconBg: 'bg-forest-500',
          allocations: [
            { label: 'ETF', percent: 20, color: 'bg-forest-500' },
            { label: '現金', percent: 70, color: 'bg-surface-300' },
            { label: '觀察', percent: 10, color: 'bg-amber-400' },
          ],
          advice: '市場偏空，你選擇拉高現金比例，只保留少量 ETF 觀察大盤。',
          reminder: '今天最該避免的是「覺得跌夠了就進場」。保留現金等待更好的時機，觀察也是一種操作。',
        },
        balanced: {
          key: 'balanced',
          title: '今天適合慢慢等機會的人',
          subtitle: '想參與但知道今天不是時候',
          icon: 'ri-scales-line',
          iconBg: 'bg-amber-500',
          allocations: [
            { label: 'ETF', percent: 25, color: 'bg-forest-500' },
            { label: '現金', percent: 60, color: 'bg-surface-300' },
            { label: '觀察', percent: 15, color: 'bg-amber-400' },
          ],
          advice: '市場偏弱，你選擇以現金為主，少量 ETF 觀察趨勢是否轉折。',
          reminder: '如果你是新手，保留現金比急著進場更重要。等趨勢轉多再考慮，不用急。',
        },
        aggressive: {
          key: 'aggressive',
          title: '今天適合能承受波動的人',
          subtitle: '願意小額試水溫，但知道底線在哪',
          icon: 'ri-flashlight-line',
          iconBg: 'bg-red-500',
          allocations: [
            { label: 'ETF', percent: 30, color: 'bg-forest-500' },
            { label: 'AI/半導體', percent: 15, color: 'bg-red-500' },
            { label: '現金', percent: 55, color: 'bg-surface-300' },
          ],
          advice: '即使偏積極，偏空時也選擇降溫。現金為主，少量試水溫。',
          reminder: '今天最該避免的是「覺得跌夠了就想抄底」。趨勢轉多時再進場也不遲。',
        },
      };
    }
    // Neutral / default
    return {
      conservative: {
        key: 'conservative',
        title: '今天適合先穩住的人',
        subtitle: '市場沒方向，你選擇不亂動',
        icon: 'ri-shield-check-line',
        iconBg: 'bg-forest-500',
        allocations: [
          { label: 'ETF', percent: 35, color: 'bg-forest-500' },
          { label: '現金', percent: 50, color: 'bg-surface-300' },
          { label: '觀察', percent: 15, color: 'bg-amber-400' },
        ],
        advice: '市場方向不明，你選擇以觀察為主，ETF 少量配置，保留多數現金。',
        reminder: '今天最該避免的是「沒方向就硬找方向」。方向不清楚的時候，不操作就是最好的操作。',
      },
      balanced: {
        key: 'balanced',
        title: '今天適合慢慢等機會的人',
        subtitle: '想參與但不想被假突破騙進去',
        icon: 'ri-scales-line',
        iconBg: 'bg-amber-500',
        allocations: [
          { label: 'ETF', percent: 40, color: 'bg-forest-500' },
          { label: 'AI/半導體', percent: 15, color: 'bg-amber-500' },
          { label: '現金', percent: 45, color: 'bg-surface-300' },
        ],
        advice: '中性偏保守，你選擇多數現金觀望，少量參與大盤與趨勢族群。',
        reminder: '今天最容易犯的錯是「以為假突破是真突破」。先觀察盤中方向是否明朗，不要急著決定。',
      },
      aggressive: {
        key: 'aggressive',
        title: '今天適合能承受波動的人',
        subtitle: '願意小額試水溫，但知道底線在哪',
        icon: 'ri-flashlight-line',
        iconBg: 'bg-red-500',
        allocations: [
          { label: 'AI/半導體', percent: 25, color: 'bg-red-500' },
          { label: 'ETF', percent: 30, color: 'bg-forest-500' },
          { label: '現金', percent: 45, color: 'bg-surface-300' },
        ],
        advice: '即使偏積極，方向不明時也選擇保留現金，不硬上。',
        reminder: '市場沒有方向時，急著進場容易兩邊挨打。耐心觀察，等方向出來再動。',
      },
    };
  };

  const personas = getAllocations();
  const personaList = [personas.conservative, personas.balanced, personas.aggressive];

  return (
    <section>
      <div className="mb-5">
        <p className="text-surface-500 text-[10px] uppercase tracking-widest font-semibold mb-1">Simulation</p>
        <h2 className="text-navy-900 font-bold text-xl md:text-2xl">如果你只有 10 萬元</h2>
        <p className="text-surface-500 text-sm mt-1">以下為模擬配置，不是投資建議，僅供學習參考</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {personaList.map((p) => (
          <div key={p.key} className="bg-white border border-surface-200 rounded-2xl p-5 flex flex-col">
            <div className="flex items-center gap-2.5 mb-4">
              <div className={`w-9 h-9 ${p.iconBg} rounded-lg flex items-center justify-center`}>
                <i className={`${p.icon} text-white text-sm`}></i>
              </div>
              <div>
                <h3 className="text-navy-900 font-bold text-sm">{p.title}</h3>
                <p className="text-surface-500 text-xs">{p.subtitle}</p>
              </div>
            </div>

            {/* Allocation bar */}
            <div className="flex h-3 rounded-full overflow-hidden mb-3">
              {p.allocations.map((a, i) => (
                <div key={i} className={`${a.color} h-full`} style={{ width: `${a.percent}%` }}></div>
              ))}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mb-4">
              {p.allocations.map((a, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <div className={`w-2 h-2 rounded-full ${a.color}`}></div>
                  <span className="text-surface-600 text-xs">{a.label} <span className="font-semibold text-navy-700">{a.percent}%</span></span>
                </div>
              ))}
            </div>

            <p className="text-navy-700 text-sm leading-relaxed mb-3 flex-1">{p.advice}</p>

            <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 mt-auto">
              <p className="text-amber-800 text-xs leading-relaxed">
                <span className="font-semibold">今日提醒：</span>{p.reminder}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* AI overall advice */}
      {strategy?.overall_advice && (
        <div className="mt-4 bg-navy-50 border border-navy-100 rounded-xl p-3.5 flex items-start gap-2.5">
          <i className="ri-lightbulb-line text-navy-500 text-sm mt-0.5"></i>
          <p className="text-navy-700 text-xs leading-relaxed">
            <span className="font-semibold">AI 整體建議：</span>{strategy.overall_advice}
          </p>
        </div>
      )}
    </section>
  );
}
import type { Report } from '@/types/report';

interface Props {
  report: Report | null;
}

// Dynamic headline based on market bias + confidence
function getHeadline(bias: string, score: number): string {
  if (bias.includes('偏多')) {
    if (score >= 80) return '今天不是衝股票的日子，是慢慢觀察的日子。';
    if (score >= 65) return '今天市場會有人想追高，但別跟著失控。';
    return '今天 AI 族群有動能，但別太貪。';
  }
  if (bias.includes('偏空')) {
    if (score <= 40) return '今天適合看戲，不適合進場。';
    return '今天市場在擔心什麼，你最好先搞清楚。';
  }
  return '今天適合慢慢看，不適合亂衝。';
}

// The soul sentence - AI advisor's daily wisdom
function getSoulSentence(bias: string, score: number): string {
  const bullishHigh = [
    '今天不是拼速度，而是拼誰比較冷靜。',
    '市場很熱的時候，守住現金的人才是贏家。',
    '今天你會看到很多漲停，但不是每個漲停都值得追。',
    '今天最危險的不是下跌，是你看到別人賺錢後開始失控。',
  ];
  const bullishLow = [
    '今天有機會，但機會不屬於急著進場的人。',
    '市場有方向，但還不夠強，先觀察再說。',
    '今天適合建立觀察清單，不適合看到漲就追。',
  ];
  const bearish = [
    '今天不是賺錢的日子，是活下來的日子。',
    '市場下跌的時候，不操作就是最好的操作。',
    '今天如果你心情浮躁，最好不要亂開槓桿。',
    '保留現金不是懦弱，是智慧。',
  ];
  const neutral = [
    '今天不是賺最多的人贏，是活到下週的人贏。',
    '市場沒有方向的時候，耐心比勇氣更重要。',
    '今天適合練習觀察，不適合練習操作。',
    '如果你不知道該做什麼，那就什麼都不要做。',
  ];

  let pool = neutral;
  if (bias.includes('偏多')) pool = score >= 70 ? bullishHigh : bullishLow;
  else if (bias.includes('偏空')) pool = bearish;

  // Deterministic but varied by date
  const today = new Date().getDate();
  return pool[today % pool.length];
}

export default function AITodayReminder({ report }: Props) {
  if (!report) return null;

  const bias = report.market_bias || '震盪';
  const score = report.confidence_score ?? 50;
  const headline = getHeadline(bias, score);
  const soulSentence = getSoulSentence(bias, score);

  const isBullish = bias.includes('偏多');
  const isBearish = bias.includes('偏空');

  return (
    <section className="w-full">
      <div className="mb-5">
        <p className="text-surface-500 text-[10px] uppercase tracking-widest font-semibold mb-1">Daily Soul</p>
        <h2 className="text-navy-900 font-bold text-xl md:text-2xl">今天 AI 想提醒你</h2>
      </div>

      <div className="relative bg-navy-900 rounded-2xl overflow-hidden">
        {/* Subtle glow */}
        <div
          className={`absolute -top-20 -right-20 w-40 h-40 rounded-full blur-3xl opacity-20 ${
            isBullish ? 'bg-forest-500' : isBearish ? 'bg-red-500' : 'bg-amber-500'
          }`}
        ></div>

        <div className="relative p-6 md:p-8">
          {/* Mood label */}
          <div className="flex items-center gap-2 mb-4">
            <span
              className={`w-2 h-2 rounded-full ${
                isBullish ? 'bg-forest-400' : isBearish ? 'bg-red-400' : 'bg-amber-400'
              }`}
            ></span>
            <span className="text-surface-400 text-xs font-medium tracking-wide">
              AI 軍師 · {new Date().toLocaleDateString('zh-TW', { month: 'long', day: 'numeric', weekday: 'short' })}
            </span>
          </div>

          {/* Headline */}
          <h3 className="text-white font-bold text-lg md:text-xl leading-snug mb-4">
            {headline}
          </h3>

          {/* Divider */}
          <div className="w-12 h-px bg-surface-600 mb-4"></div>

          {/* Soul sentence - big and shareable */}
          <p className="text-surface-200 text-base md:text-lg leading-relaxed font-medium">
            「{soulSentence}」
          </p>

          {/* Market context micro-line */}
          <p className="text-surface-500 text-xs mt-4 leading-relaxed">
            今日市場情緒 {bias} · 劇本成立度 {score}/100 · AI 判斷：
            {score >= 75 ? '方向相對明確，但請保持冷靜' : score >= 50 ? '方向尚可，建議觀察為主' : '方向不明，不操作也是一種操作'}
          </p>
        </div>
      </div>
    </section>
  );
}
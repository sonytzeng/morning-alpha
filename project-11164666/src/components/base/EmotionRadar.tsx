import type { Report } from '@/types/report';

interface Props {
  report: Report | null;
}

interface RadarItem {
  name: string;
  score: number; // 0-100
  label: string;
  emoji: string;
  tip: string;
}

function generateRadarData(report: Report | null): RadarItem[] {
  if (!report) {
    return [
      { name: '散戶情緒', score: 55, label: '觀望', emoji: '👀', tip: '今天散戶還在觀察，沒有特別狂熱也沒有恐慌。' },
      { name: '主力動向', score: 50, label: '中性', emoji: '📊', tip: '主力今天動作不明顯，可能也在等方向。' },
      { name: '外資態度', score: 50, label: '觀望', emoji: '🌐', tip: '外資今日動向尚不明確，等盤中觀察。' },
      { name: 'AI 族群', score: 55, label: '活躍', emoji: '🤖', tip: 'AI 族群有話題性，但不一定每個都適合追。' },
      { name: 'ETF 資金', score: 50, label: '平穩', emoji: '📈', tip: 'ETF 資金流動正常，沒有特別異常。' },
      { name: '恐慌指數', score: 35, label: '冷靜', emoji: '😌', tip: '市場沒什麼人在恐慌，但冷靜不代表安全。' },
    ];
  }

  const bias = report.market_bias || '震盪';
  const score = report.confidence_score ?? 50;
  const vix = report.vix ?? 16;
  const fearGreed = report.fear_greed ?? 50;
  const nasdaq = report.nasdaq_change ?? 0;

  const isBullish = bias.includes('偏多');
  const isBearish = bias.includes('偏空');
  const isHot = isBullish && score >= 75;
  const isCold = isBearish || score <= 40;

  // Retail sentiment - based on fear_greed and bias
  let retailScore = fearGreed;
  let retailLabel = '觀望';
  let retailTip = '散戶今天觀望居多，沒有特別狂熱也沒有恐慌。';
  if (fearGreed >= 75) {
    retailLabel = '過熱';
    retailTip = '今天很多人怕錯過，容易亂追熱門股。你冷靜，他們就輸了。';
  } else if (fearGreed >= 55) {
    retailLabel = '偏熱';
    retailTip = '散戶開始樂觀，但還不算瘋狂。記得別跟著情緒走。';
  } else if (fearGreed <= 25) {
    retailLabel = '恐慌';
    retailTip = '散戶在害怕，這時候反而該問：「我怕什麼？」';
  } else if (fearGreed <= 40) {
    retailLabel = '偏冷';
    retailTip = '散戶比較保守，市場還沒有明顯的追價潮。';
  }

  // Smart money - inverse of retail, slightly delayed
  let smartScore = 100 - fearGreed + (isBullish ? 10 : isBearish ? -10 : 0);
  smartScore = Math.min(100, Math.max(0, smartScore));
  let smartLabel = '觀望';
  let smartTip = '主力今天沒有特別明顯的方向，可能也在觀察。';
  if (smartScore >= 70) {
    smartLabel = '進場';
    smartTip = isHot ? '主力可能在悄悄布局，但他們不會告訴你。' : '主力動向偏積極，但不代表要重壓。';
  } else if (smartScore <= 30) {
    smartLabel = '觀望';
    smartTip = '主力在休息，你也許該跟著休息。';
  }

  // Foreign investors - based on nasdaq + bias
  let foreignScore = 50 + (nasdaq > 0 ? nasdaq * 8 : nasdaq * 5);
  foreignScore = Math.min(100, Math.max(0, foreignScore));
  if (isBearish) foreignScore = Math.max(10, foreignScore - 20);
  let foreignLabel = '觀望';
  let foreignTip = '外資今天沒有特別方向，等盤中看有沒有轉折。';
  if (foreignScore >= 65) {
    foreignLabel = '偏多';
    foreignTip = '外資可能會回補台股，但一次回補不代表趨勢轉多。';
  } else if (foreignScore <= 35) {
    foreignLabel = '偏空';
    foreignTip = '外資可能在賣超，這時候不要急著接刀子。';
  }

  // AI sector - based on sox + nasdaq
  const sox = report.sox_change ?? 0;
  let aiScore = 50 + (sox > 0 ? sox * 12 : sox * 8) + (nasdaq > 0 ? 5 : -5);
  aiScore = Math.min(100, Math.max(0, aiScore));
  let aiLabel = '中性';
  let aiTip = 'AI 族群今天沒有特別動能，先看看大盤方向再說。';
  if (aiScore >= 70) {
    aiLabel = '強勢';
    aiTip = sox > 2 ? 'AI 族群很強，但越強越要小心追在最高點。' : 'AI 族群動能不錯，但不要一次壓滿。';
  } else if (aiScore <= 30) {
    aiLabel = '承壓';
    aiTip = 'AI 族群在休息，今天不適合硬碰硬。';
  }

  // ETF flow - based on overall market direction
  let etfScore = 50 + (isBullish ? 15 : isBearish ? -15 : 0) + (nasdaq > 0 ? 8 : nasdaq < 0 ? -8 : 0);
  etfScore = Math.min(100, Math.max(0, etfScore));
  let etfLabel = '平穩';
  let etfTip = 'ETF 資金流動正常，適合新手觀察大盤方向。';
  if (etfScore >= 65) {
    etfLabel = '流入';
    etfTip = '資金在往 ETF 流，代表大家在找安全感。你也可以。';
  } else if (etfScore <= 35) {
    etfLabel = '流出';
    etfTip = 'ETF 在失血，代表大家在跑。這時候更該問「為什麼」。';
  }

  // Panic index (VIX)
  let panicScore = Math.min(100, Math.max(0, vix * 3));
  let panicLabel = '冷靜';
  let panicTip = '市場沒什麼人在恐慌，風平浪靜不代表沒有暗流。';
  if (vix >= 25) {
    panicLabel = '警戒';
    panicTip = '市場開始緊張，波動可能變大。新手這幾天建議縮手。';
  } else if (vix >= 18) {
    panicLabel = '注意';
    panicTip = '市場有一點不安，但還不算恐慌。保持觀察。';
  } else if (vix <= 12) {
    panicLabel = '過冷';
    panicTip = '市場太冷靜了，有時候太冷靜反而是暴風雨前的寧靜。';
  }

  return [
    { name: '散戶情緒', score: retailScore, label: retailLabel, emoji: fearGreed >= 75 ? '🔥' : fearGreed <= 25 ? '❄️' : '👀', tip: retailTip },
    { name: '主力動向', score: smartScore, label: smartLabel, emoji: smartScore >= 70 ? '💰' : '📊', tip: smartTip },
    { name: '外資態度', score: foreignScore, label: foreignLabel, emoji: foreignScore >= 65 ? '🌍' : foreignScore <= 35 ? '🚪' : '🌐', tip: foreignTip },
    { name: 'AI 族群', score: aiScore, label: aiLabel, emoji: aiScore >= 70 ? '🚀' : aiScore <= 30 ? '😴' : '🤖', tip: aiTip },
    { name: 'ETF 資金', score: etfScore, label: etfLabel, emoji: etfScore >= 65 ? '📥' : etfScore <= 35 ? '📤' : '📈', tip: etfTip },
    { name: '恐慌指數', score: panicScore, label: panicLabel, emoji: vix >= 25 ? '⚠️' : vix >= 18 ? '👁️' : '😌', tip: panicTip },
  ];
}

function getScoreColor(score: number): string {
  if (score >= 70) return 'text-forest-400';
  if (score >= 55) return 'text-amber-400';
  if (score >= 40) return 'text-surface-400';
  if (score >= 25) return 'text-amber-400';
  return 'text-red-400';
}

function getBarColor(score: number): string {
  if (score >= 70) return 'bg-forest-500';
  if (score >= 55) return 'bg-amber-500';
  if (score >= 40) return 'bg-surface-400';
  if (score >= 25) return 'bg-amber-500';
  return 'bg-red-500';
}

function getBgGlow(score: number): string {
  if (score >= 70) return 'bg-forest-500/10';
  if (score >= 55) return 'bg-amber-500/10';
  if (score >= 40) return 'bg-surface-400/10';
  if (score >= 25) return 'bg-amber-500/10';
  return 'bg-red-500/10';
}

export default function EmotionRadar({ report }: Props) {
  const data = generateRadarData(report);

  return (
    <section className="w-full">
      <div className="mb-5">
        <p className="text-surface-500 text-[10px] uppercase tracking-widest font-semibold mb-1">Emotion Radar</p>
        <h2 className="text-navy-900 font-bold text-xl md:text-2xl">今天市場在想什麼？</h2>
        <p className="text-surface-500 text-sm mt-1">六個維度告訴你，市場裡的人在幹嘛</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
        {data.map((item) => (
          <div
            key={item.name}
            className={`relative bg-white border border-surface-200 rounded-xl p-4 md:p-5 overflow-hidden transition-colors hover:border-surface-300`}
          >
            {/* Score glow */}
            <div className={`absolute -top-4 -right-4 w-20 h-20 rounded-full blur-2xl opacity-40 ${getBgGlow(item.score)}`}></div>

            <div className="relative flex items-start gap-3">
              {/* Circular progress */}
              <div className="relative w-14 h-14 flex-shrink-0">
                <svg className="w-14 h-14 -rotate-90" viewBox="0 0 36 36">
                  <path
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    fill="none"
                    stroke="#f1f5f9"
                    strokeWidth="3"
                  />
                  <path
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeDasharray={`${item.score}, 100`}
                    className={getBarColor(item.score)}
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-[10px] font-bold text-navy-900">{item.score}</span>
                </div>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm">{item.emoji}</span>
                  <span className="text-navy-900 font-semibold text-sm">{item.name}</span>
                </div>
                <span className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-bold ${getBgGlow(item.score)} ${getScoreColor(item.score)}`}>
                  {item.label}
                </span>
                <p className="text-surface-500 text-xs leading-relaxed mt-2">
                  {item.tip}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
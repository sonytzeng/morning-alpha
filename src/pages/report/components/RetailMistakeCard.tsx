import type { Report } from '@/types/report';

interface RetailMistakeCardProps {
  report: Report | null;
}

function getMistakeText(report: Report | null): string {
  if (!report) {
    return '今天最容易犯的錯，是看到熱門族群開高後就急著追。\n市場偏多不代表每個位置都安全，真正該比的是耐心，不是速度。';
  }

  // Priority: avoid_today first item → ai_strategy_json.risk_warning → risk_factors_json first description
  const avoid = report.avoid_today;
  const strategy = report.ai_strategy_json;
  const risks = report.risk_factors_json;
  const bias = report.market_bias || '震盪';
  const score = report.confidence_score ?? 50;

  const lines: string[] = [];

  if (avoid && avoid.length > 0) {
    lines.push(avoid[0]);
  }

  if (strategy?.risk_warning && !lines.includes(strategy.risk_warning)) {
    lines.push(strategy.risk_warning);
  }

  if (lines.length < 2 && risks && risks.length > 0 && risks[0].description) {
    lines.push(risks[0].description);
  }

  if (lines.length === 0) {
    if (bias.includes('偏多') && score >= 75) {
      return '今天最容易犯的錯，是看到熱門族群開高後就急著追。\n市場情緒過熱時，追高的人往往在幫別人抬轎。';
    }
    if (bias.includes('偏空')) {
      return '今天最容易犯的錯，是恐慌時把該留的部位賣掉。\n底是走出來的，不是猜出來的，不要在情緒最低點做決定。';
    }
    return '今天最容易犯的錯，是市場沒方向就自己硬要找方向。\n沒有訊號也是一種訊號，保留現金不是懦弱，是智慧。';
  }

  // Ensure at least 2 lines
  if (lines.length === 1) {
    lines.push('記住：市場每天都有機會，但你的本金沒有第二次。今天不犯這個錯，比做了什麼更重要。');
  }

  return lines.slice(0, 4).join('\n');
}

export default function RetailMistakeCard({ report }: RetailMistakeCardProps) {
  const text = getMistakeText(report);

  return (
    <div className="relative bg-red-950/40 border border-red-500/20 rounded-2xl p-5 md:p-7 overflow-hidden">
      {/* Background glow */}
      <div className="absolute -top-10 -left-10 w-32 h-32 rounded-full blur-[60px] opacity-[0.08] bg-red-500 pointer-events-none"></div>

      <div className="relative">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-9 h-9 bg-red-500/15 rounded-xl flex items-center justify-center">
            <i className="ri-alarm-warning-line text-red-400 text-base"></i>
          </div>
          <div>
            <h2 className="text-red-300 font-bold text-base md:text-lg">散戶今天最容易犯的錯</h2>
            <p className="text-red-400/50 text-[10px] md:text-xs">這是 AI 軍師每天最想提醒你的事</p>
          </div>
        </div>

        <div className="bg-red-500/5 border border-red-500/10 rounded-xl p-4 md:p-5">
          {text.split('\n').map((line, i) => (
            <p key={i} className="text-white/90 text-sm md:text-base leading-relaxed font-medium">
              {line}
            </p>
          ))}
        </div>

        <div className="flex items-center gap-2 mt-4 text-red-400/40 text-[10px]">
          <i className="ri-shield-check-line"></i>
          <span>冷靜觀察比衝動行動更重要</span>
        </div>
      </div>
    </div>
  );
}
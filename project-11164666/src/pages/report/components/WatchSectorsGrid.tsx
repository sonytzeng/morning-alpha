import type { Report, WatchSector, ImportantNews } from '@/types/report';

interface WatchSectorsGridProps {
  report: Report | null;
}

function getSectorCards(report: Report | null) {
  if (!report) return getFallbackCards();

  const cards: {
    name: string;
    direction: string;
    reason: string;
    risk: string;
    directionColor: string;
  }[] = [];

  // From watch_sectors_json
  const sectors = report.watch_sectors_json;
  if (sectors?.length) {
    sectors.forEach((s: WatchSector) => {
      if (cards.length >= 6) return;
      const dir = s.direction || '觀察';
      cards.push({
        name: s.sector || '觀察族群',
        direction: dir,
        reason: s.reason || '持續觀察市場動向',
        risk: getRiskForDirection(dir),
        directionColor: getDirColor(dir),
      });
    });
  }

  // From focus_stock_json
  const focus = report.focus_stock_json;
  if (focus?.length) {
    focus.forEach((f) => {
      if (cards.length >= 6) return;
      const dir = f.direction || '觀察';
      if (!cards.find((c) => c.name === (f.group || '族群'))) {
        cards.push({
          name: f.group || '焦點族群',
          direction: dir,
          reason: f.reason || '值得關注的市場方向',
          risk: getRiskForDirection(dir),
          directionColor: getDirColor(dir),
        });
      }
    });
  }

  // From important_news_json
  const news = report.important_news_json;
  if (news?.length) {
    news.forEach((n: ImportantNews) => {
      if (cards.length >= 6) return;
      const sectors = n.sectors;
      if (sectors?.length && !cards.find((c) => c.name === sectors[0])) {
        cards.push({
          name: sectors[0],
          direction: n.impact?.includes('正面') || n.impact?.includes('偏多') ? '偏多' : '觀察',
          reason: n.summary || n.title || '受國際消息影響',
          risk: '國際消息變化快速，留意盤中突發',
          directionColor: n.impact?.includes('正面') || n.impact?.includes('偏多') ? 'text-forest-400' : 'text-amber-400',
        });
      }
    });
  }

  // From watch_sectors_detailed
  const detailed = report.watch_sectors_detailed;
  if (detailed?.length) {
    detailed.forEach((d) => {
      if (cards.length >= 6) return;
      if (!cards.find((c) => c.name === d.sector)) {
        cards.push({
          name: d.sector,
          direction: d.isSuitableToChase ? '偏多' : d.isOverheated ? '過熱' : '觀察',
          reason: d.aiObservation || '持續觀察',
          risk: d.riskLevel === 'high' ? '風險較高，不適合追價' : d.riskLevel === 'medium' ? '留意盤中震盪' : '風險相對較低',
          directionColor: d.isSuitableToChase ? 'text-forest-400' : d.isOverheated ? 'text-red-400' : 'text-amber-400',
        });
      }
    });
  }

  if (cards.length === 0) return getFallbackCards();
  return cards;
}

function getDirColor(dir: string): string {
  if (dir.includes('多') || dir.includes('bull') || dir.includes('漲')) return 'text-forest-400';
  if (dir.includes('空') || dir.includes('bear') || dir.includes('跌')) return 'text-red-400';
  if (dir.includes('熱') || dir.includes('high')) return 'text-red-400';
  return 'text-amber-400';
}

function getRiskForDirection(dir: string): string {
  if (dir.includes('多') || dir.includes('bull')) return '若開高過多，先等震盪再判斷';
  if (dir.includes('空') || dir.includes('bear')) return '不要恐慌殺低，觀察是否有承接';
  if (dir.includes('熱') || dir.includes('high')) return '過熱族群容易短線回檔';
  return '維持觀察，等待方向明確';
}

function getFallbackCards() {
  return [
    {
      name: 'AI / 半導體',
      direction: '偏多觀察',
      reason: '資金持續關注，但短線容易震盪',
      risk: '如果開高太多，先等震盪後再判斷',
      directionColor: 'text-forest-400',
    },
    {
      name: '高股息 ETF',
      direction: '穩健觀察',
      reason: '適合保守資金當作停泊參考',
      risk: 'ETF 也會跌，只是波動通常比個股低',
      directionColor: 'text-amber-400',
    },
    {
      name: '大型權值股',
      direction: '觀察',
      reason: '大盤方向指標，開盤先看是否續航',
      risk: '權值股量大時才代表資金認同',
      directionColor: 'text-amber-400',
    },
  ];
}

export default function WatchSectorsGrid({ report }: WatchSectorsGridProps) {
  const cards = getSectorCards(report);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-8 h-8 bg-navy-800 rounded-lg flex items-center justify-center">
          <i className="ri-focus-3-line text-amber-400 text-sm"></i>
        </div>
        <div>
          <h2 className="text-white font-bold text-base md:text-lg">今天 AI 最關注什麼</h2>
          <p className="text-white/40 text-[10px] md:text-xs">不只是 tag，是今天盤前值得觀察的名單</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
        {cards.map((card, i) => (
          <div
            key={i}
            className="bg-navy-900/60 border border-navy-800 rounded-2xl p-4 md:p-5 hover:border-white/10 transition-colors"
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-white font-semibold text-sm md:text-base">{card.name}</h3>
              <span className={`text-xs font-semibold ${card.directionColor}`}>{card.direction}</span>
            </div>

            <div className="space-y-2.5">
              <div className="flex items-start gap-2">
                <i className="ri-eye-line text-white/30 text-xs mt-0.5"></i>
                <p className="text-white/70 text-xs md:text-sm leading-relaxed">{card.reason}</p>
              </div>
              <div className="flex items-start gap-2">
                <i className="ri-alert-line text-red-400/60 text-xs mt-0.5"></i>
                <p className="text-white/50 text-xs leading-relaxed">{card.risk}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
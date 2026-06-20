import type { Report } from '@/types/report';

interface Props {
  report: Report | null;
}

interface HeatCard {
  name: string;
  direction: string;
  reason: string;
  riskLabel: string;
  tagColor: string;
  tagBg: string;
  tagBorder: string;
  iconColor: string;
  iconBg: string;
  stocks?: string;
}

// ===== 族群輔助個股映射 =====
function getSectorStocks(sectorName: string): string | undefined {
  if (!sectorName) return undefined;
  const lower = sectorName.toLowerCase();
  if (lower.includes('ai') || lower.includes('伺服器')) return 'NVDA、SMCI、廣達、緯創';
  if (lower.includes('半導體')) return 'TSMC、AMD、台積電、聯發科';
  if (lower.includes('金融')) return '富邦金、國泰金、中信金';
  if (lower.includes('記憶體')) return 'Micron、SK Hynix、南亞科';
  return undefined;
}

// ===== 方向轉樣式 =====
function getDirectionStyle(direction: string) {
  const d = direction.toLowerCase();
  if (d.includes('多') || d.includes('bull') || d.includes('漲') || d.includes('熱') || d.includes('強')) {
    return {
      tagColor: 'text-forest-400',
      tagBg: 'bg-forest-500/10',
      tagBorder: 'border-forest-500/20',
      iconColor: 'text-forest-400',
      iconBg: 'bg-forest-500/10',
    };
  }
  if (d.includes('空') || d.includes('bear') || d.includes('跌') || d.includes('弱') || d.includes('冷')) {
    return {
      tagColor: 'text-red-400',
      tagBg: 'bg-red-500/10',
      tagBorder: 'border-red-500/20',
      iconColor: 'text-red-400',
      iconBg: 'bg-red-500/10',
    };
  }
  return {
    tagColor: 'text-amber-400',
    tagBg: 'bg-amber-500/10',
    tagBorder: 'border-amber-500/20',
    iconColor: 'text-amber-400',
    iconBg: 'bg-amber-500/10',
  };
}

// ===== 從 direction 推斷風險等級 =====
function inferRiskLevel(direction: string): 'low' | 'medium' | 'high' {
  const d = direction.toLowerCase();
  if (d.includes('熱') || d.includes('high') || d.includes('過熱')) return 'high';
  if (d.includes('穩') || d.includes('低') || d.includes('safe') || d.includes('防禦')) return 'low';
  return 'medium';
}

// ===== 風險等級轉文字 =====
function buildRiskLabel(level: 'low' | 'medium' | 'high'): string {
  const map = {
    high: '高風險｜不適合追價',
    medium: '中風險｜留意震盪',
    low: '低風險｜可觀察',
  };
  return map[level];
}

// ===== Fallback 卡片（無資料時） =====
function getFallbackCards(): HeatCard[] {
  return [
    {
      name: '今日資料整理中',
      direction: '觀察',
      reason: '目前盤前資料正在整理，請稍後再回來查看今日熱區。',
      riskLabel: '等待更新',
      tagColor: 'text-white/50',
      tagBg: 'bg-white/5',
      tagBorder: 'border-white/10',
      iconColor: 'text-white/40',
      iconBg: 'bg-white/5',
    },
  ];
}

// ===== 主資料聚合邏輯 =====
function getHeatCards(report: Report | null): HeatCard[] {
  if (!report) return getFallbackCards();

  const cards: HeatCard[] = [];
  const seenNames = new Set<string>();

  // 1. 優先從 watch_sectors_detailed 取
  const detailed = report.watch_sectors_detailed;
  if (detailed && detailed.length > 0) {
    for (const d of detailed) {
      if (cards.length >= 4) break;
      const name = d.sector || '觀察族群';
      if (seenNames.has(name)) continue;
      seenNames.add(name);

      const direction = d.isOverheated ? '過熱' : d.isSuitableToChase ? '偏多' : '觀察';
      const reason = d.aiObservation || '持續觀察族群動向';
      const riskLevel = d.riskLevel || 'medium';
      const riskLabel = buildRiskLabel(riskLevel);
      const style = getDirectionStyle(direction);

      cards.push({
        name,
        direction,
        reason,
        riskLabel,
        ...style,
        stocks: getSectorStocks(name),
      });
    }
  }

  // 2. 從 watch_sectors_json 取
  const sectors = report.watch_sectors_json;
  if (sectors && sectors.length > 0) {
    for (const s of sectors) {
      if (cards.length >= 4) break;
      const name = s.sector || '觀察族群';
      if (seenNames.has(name)) continue;
      seenNames.add(name);

      const direction = s.direction || '觀察';
      const reason = s.reason || '持續觀察族群動向';
      const riskLevel = inferRiskLevel(direction);
      const riskLabel = buildRiskLabel(riskLevel);
      const style = getDirectionStyle(direction);

      cards.push({
        name,
        direction,
        reason,
        riskLabel,
        ...style,
        stocks: getSectorStocks(name),
      });
    }
  }

  // 3. 從 focus_stock_json 取
  const focus = report.focus_stock_json;
  if (focus && focus.length > 0) {
    for (const f of focus) {
      if (cards.length >= 4) break;
      const name = f.group || '焦點族群';
      if (seenNames.has(name)) continue;
      seenNames.add(name);

      const direction = f.direction || '觀察';
      const reason = f.reason || '值得關注的市場方向';
      const riskLevel = inferRiskLevel(direction);
      const riskLabel = buildRiskLabel(riskLevel);
      const style = getDirectionStyle(direction);

      cards.push({
        name,
        direction,
        reason,
        riskLabel,
        ...style,
        stocks: getSectorStocks(name),
      });
    }
  }

  if (cards.length === 0) return getFallbackCards();
  return cards;
}

export default function HeatRadar({ report }: Props) {
  const cards = getHeatCards(report);
  const hasRealData = !!(report?.watch_sectors_detailed?.length || report?.watch_sectors_json?.length || report?.focus_stock_json?.length);

  return (
    <section className="w-full">
      <div className="mb-5 md:mb-6">
        <p className="text-white/30 text-[10px] uppercase tracking-[0.3em] font-semibold mb-1">HEAT RADAR</p>
        <h2 className="text-white font-bold text-xl md:text-2xl">今日熱區雷達</h2>
        <p className="text-white/40 text-sm mt-1">不是推薦買賣，而是先看今天市場可能把注意力放在哪裡。</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        {cards.map((card) => (
          <div
            key={card.name}
            className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6 transition-all duration-300 hover:border-white/10 flex flex-col"
          >
            {/* Header: 族群名稱 + 觀察方向 */}
            <div className="flex items-start justify-between mb-3 md:mb-4">
              <div className="flex items-center gap-2.5">
                <div className={`w-8 h-8 ${card.iconBg} rounded-lg flex items-center justify-center border ${card.tagBorder} flex-shrink-0`}>
                  <i className={`ri-radar-line ${card.iconColor} text-sm`}></i>
                </div>
                <h3 className="text-white text-sm md:text-base font-semibold">{card.name}</h3>
              </div>
              <span className={`text-[10px] md:text-xs font-medium px-2.5 py-1 rounded-full border ${card.tagBorder} ${card.tagColor} whitespace-nowrap flex-shrink-0`}>
                {card.direction}
              </span>
            </div>

            {/* 今日原因 */}
            <div className="mb-3 flex-1">
              <p className="text-white/30 text-[10px] md:text-xs font-medium mb-1">今日原因</p>
              <p className="text-white/70 text-sm leading-relaxed">{card.reason}</p>
            </div>

            {/* 風險等級 */}
            <div className="mb-3">
              <p className="text-white/30 text-[10px] md:text-xs font-medium mb-1">風險等級</p>
              <p className="text-white/50 text-xs md:text-sm leading-relaxed">{card.riskLabel}</p>
            </div>

            {/* 輔助個股（若適用） */}
            {card.stocks && (
              <div className="pt-3 border-t border-navy-800">
                <p className="text-white/30 text-[10px] md:text-xs font-medium mb-1">相關個股</p>
                <p className="text-white/60 text-xs leading-relaxed">{card.stocks}</p>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Fallback 提示（資料不足時） */}
      {!hasRealData && (
        <div className="mt-4 md:mt-5 bg-amber-500/5 border border-amber-500/15 rounded-xl p-4 md:p-5">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 bg-amber-500/10 rounded-lg flex items-center justify-center flex-shrink-0">
              <i className="ri-information-line text-amber-400 text-sm"></i>
            </div>
            <div>
              <p className="text-amber-300 text-sm font-medium mb-1">目前市場焦點仍在整理中，先用市場情緒判斷今天節奏。</p>
              <p className="text-amber-400/60 text-xs leading-relaxed">資料不足時，更不要急著追熱點。</p>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
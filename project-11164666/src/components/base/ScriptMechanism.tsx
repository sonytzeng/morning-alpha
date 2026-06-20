import type { Report } from '@/types/report';

interface Props {
  report: Report | null;
}

interface Condition {
  text: string;
  checked: boolean;
}

function getValidConditions(report: Report | null): Condition[] {
  if (!report) {
    return [
      { text: '電子權值股續強', checked: false },
      { text: '主流熱區沒有快速退潮', checked: false },
      { text: '10:30 前成交量正常放大', checked: false },
    ];
  }

  const conditions: Condition[] = [];
  const bias = report.market_bias || '震盪';
  const score = report.confidence_score ?? 50;

  // 從 watch_sectors_json 推斷
  const sectors = report.watch_sectors_json;
  if (sectors && sectors.length > 0) {
    conditions.push({
      text: `${sectors[0].sector} 維持強勢`,
      checked: false,
    });
  }

  // 根據 bias 推斷
  if (bias.includes('偏多')) {
    conditions.push({ text: '電子權值股續強', checked: false });
    conditions.push({ text: '主流熱區沒有快速退潮', checked: false });
    if (score >= 70) {
      conditions.push({ text: '10:30 前成交量正常放大', checked: false });
    }
  } else if (bias.includes('偏空')) {
    conditions.push({ text: '避險族群有資金進駐', checked: false });
    conditions.push({ text: '恐慌指數沒有持續飆升', checked: false });
  } else {
    conditions.push({ text: '主流族群方向明確', checked: false });
    conditions.push({ text: '輪動速度不過快', checked: false });
  }

  return conditions.slice(0, 3);
}

function getInvalidConditions(report: Report | null): Condition[] {
  if (!report) {
    return [
      { text: '開高走低', checked: false },
      { text: 'AI 熱區快速降溫', checked: false },
      { text: '主流沒有擴散', checked: false },
    ];
  }

  const conditions: Condition[] = [];
  const bias = report.market_bias || '震盪';

  // 從 risk_factors_json 取
  const risks = report.risk_factors_json;
  if (risks && risks.length > 0) {
    risks.slice(0, 2).forEach((r) => {
      conditions.push({ text: r.title, checked: false });
    });
  }

  // 從 avoid_today 取
  const avoid = report.avoid_today;
  if (avoid && avoid.length > 0 && conditions.length < 3) {
    avoid.slice(0, 3 - conditions.length).forEach((item) => {
      conditions.push({ text: item, checked: false });
    });
  }

  // 根據 bias 推斷
  if (bias.includes('偏多')) {
    if (conditions.length < 3) conditions.push({ text: '開高走低', checked: false });
    if (conditions.length < 3) conditions.push({ text: '主流族群快速退潮', checked: false });
    if (conditions.length < 3) conditions.push({ text: '10:30 前量能未放大', checked: false });
  } else if (bias.includes('偏空')) {
    if (conditions.length < 3) conditions.push({ text: '持續下跌無承接', checked: false });
    if (conditions.length < 3) conditions.push({ text: '恐慌情緒擴散', checked: false });
    if (conditions.length < 3) conditions.push({ text: '避險族群也轉弱', checked: false });
  } else {
    if (conditions.length < 3) conditions.push({ text: '市場方向不明', checked: false });
    if (conditions.length < 3) conditions.push({ text: '主流族群輪動過快', checked: false });
    if (conditions.length < 3) conditions.push({ text: '量能萎縮', checked: false });
  }

  return conditions.slice(0, 3);
}

export default function ScriptMechanism({ report }: Props) {
  const validConditions = getValidConditions(report);
  const invalidConditions = getInvalidConditions(report);

  return (
    <section className="w-full">
      <div className="mb-5 md:mb-6">
        <div className="flex items-center gap-2 mb-2">
          <p className="text-white/30 text-[10px] uppercase tracking-[0.3em] font-semibold">
            SCENARIO SCRIPT
          </p>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-forest-500/10 text-forest-400 text-[10px] font-medium rounded-full border border-forest-500/20">
            <i className="ri-film-line"></i>
            劇本機制
          </span>
        </div>
        <h2 className="text-white font-bold text-xl md:text-2xl">今日劇本：不是預測，是情境</h2>
        <p className="text-white/40 text-sm mt-1">
          Morning Alpha 不做結果預測，而是做「情境劇本」。劇本成立時，維持觀察。劇本失效時，停下來確認。
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
        {/* 劇本成立條件 */}
        <div className="bg-navy-900/60 border border-navy-800 rounded-2xl overflow-hidden">
          <div className="px-5 md:px-6 py-4 border-b border-navy-800 bg-forest-500/[0.04]">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-forest-500/10 rounded-lg flex items-center justify-center border border-forest-500/20">
                <i className="ri-check-double-line text-forest-400 text-sm"></i>
              </div>
              <div>
                <p className="text-white text-sm font-semibold">劇本成立條件</p>
                <p className="text-white/30 text-[10px]">這些訊號出現時，維持今日盤前觀察</p>
              </div>
            </div>
          </div>
          <div className="p-4 md:p-5 space-y-2.5">
            {validConditions.map((cond, idx) => (
              <div
                key={idx}
                className="flex items-start gap-3 p-3 md:p-3.5 rounded-xl bg-forest-500/[0.03] border border-forest-500/10"
              >
                <div className="w-5 h-5 md:w-6 md:h-6 bg-forest-500/10 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 border border-forest-500/20">
                  <i className="ri-check-line text-forest-400 text-[10px]"></i>
                </div>
                <p className="text-white/70 text-sm leading-relaxed">{cond.text}</p>
              </div>
            ))}
          </div>
          <div className="px-4 md:px-5 py-3 bg-navy-950/50 border-t border-navy-800">
            <p className="text-forest-400/60 text-xs text-center">
              以上條件維持時，今日盤前判斷仍有效
            </p>
          </div>
        </div>

        {/* 劇本失效條件 */}
        <div className="bg-navy-900/60 border border-navy-800 rounded-2xl overflow-hidden">
          <div className="px-5 md:px-6 py-4 border-b border-navy-800 bg-red-500/[0.04]">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-red-500/10 rounded-lg flex items-center justify-center border border-red-500/20">
                <i className="ri-close-circle-line text-red-400 text-sm"></i>
              </div>
              <div>
                <p className="text-white text-sm font-semibold">劇本失效條件</p>
                <p className="text-white/30 text-[10px]">這些訊號出現時，盤前劇本可能需要修正</p>
              </div>
            </div>
          </div>
          <div className="p-4 md:p-5 space-y-2.5">
            {invalidConditions.map((cond, idx) => (
              <div
                key={idx}
                className="flex items-start gap-3 p-3 md:p-3.5 rounded-xl bg-red-500/[0.03] border border-red-500/10"
              >
                <div className="w-5 h-5 md:w-6 md:h-6 bg-red-500/10 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 border border-red-500/20">
                  <i className="ri-close-line text-red-400 text-[10px]"></i>
                </div>
                <p className="text-white/70 text-sm leading-relaxed">{cond.text}</p>
              </div>
            ))}
          </div>
          <div className="px-4 md:px-5 py-3 bg-navy-950/50 border-t border-navy-800">
            <p className="text-red-400/60 text-xs text-center">
              以上條件出現時，先停下來確認，不要急著操作
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
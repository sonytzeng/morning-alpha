import type { Report } from '@/types/report';

interface ScriptStep {
  label: string;
  value: string;
  icon: string;
}

interface ScriptTrackingData {
  mainScenario: string;
  validConditions: string[];
  invalidConditions: string[];
  currentStatus: string;
  nextCheckTime: string;
  nextCheckLabel: string;
}

function getScriptTracking(report: Report | null): ScriptTrackingData {
  if (!report) {
    return {
      mainScenario: '資料不足 · 觀察中',
      validConditions: [
        '電子權值股續強',
        '主流熱區沒有快速退潮',
        '10:30 前成交量正常放大',
      ],
      invalidConditions: [
        '開高走低',
        'AI 熱區退潮',
        '指數跌破昨收',
      ],
      currentStatus: '尚未確認',
      nextCheckTime: '10:30',
      nextCheckLabel: '主流確認',
    };
  }

  const bias = report.market_bias || '震盪';
  const score = report.confidence_score ?? 50;

  const validConditions: string[] = [];
  const invalidConditions: string[] = [];

  // 從 watch_sectors_json 取
  const sectors = report.watch_sectors_json;
  if (sectors && sectors.length > 0) {
    validConditions.push(`${sectors[0].sector} 維持強勢`);
  }

  // 從 risk_factors_json 取失效條件
  const risks = report.risk_factors_json;
  if (risks && risks.length > 0) {
    risks.slice(0, 2).forEach((r) => {
      invalidConditions.push(r.title);
    });
  }

  // 從 avoid_today 取失效條件
  const avoid = report.avoid_today;
  if (avoid && avoid.length > 0 && invalidConditions.length < 3) {
    invalidConditions.push(avoid[0]);
  }

  if (bias.includes('偏多')) {
    validConditions.push('電子權值股續強');
    validConditions.push('主流熱區沒有快速退潮');
    if (score >= 70) validConditions.push('10:30 前成交量正常放大');

    if (invalidConditions.length < 3) invalidConditions.push('開高走低');
    if (invalidConditions.length < 3) invalidConditions.push('主流族群快速退潮');
    if (invalidConditions.length < 3) invalidConditions.push('10:30 前量能未放大');
  } else if (bias.includes('偏空')) {
    validConditions.push('避險族群有資金進駐');
    validConditions.push('恐慌指數沒有持續飆升');

    if (invalidConditions.length < 3) invalidConditions.push('持續下跌無承接');
    if (invalidConditions.length < 3) invalidConditions.push('恐慌情緒擴散');
    if (invalidConditions.length < 3) invalidConditions.push('避險族群也轉弱');
  } else {
    validConditions.push('主流族群方向明確');
    validConditions.push('輪動速度不過快');

    if (invalidConditions.length < 3) invalidConditions.push('市場方向不明');
    if (invalidConditions.length < 3) invalidConditions.push('主流族群輪動過快');
    if (invalidConditions.length < 3) invalidConditions.push('量能萎縮');
  }

  return {
    mainScenario: bias,
    validConditions: validConditions.slice(0, 3),
    invalidConditions: invalidConditions.slice(0, 3),
    currentStatus: '尚未確認',
    nextCheckTime: '10:30',
    nextCheckLabel: '主流確認',
  };
}

export default function ScriptTracking({ report }: { report: Report | null }) {
  const data = getScriptTracking(report);

  return (
    <section className="w-full">
      <div className="mb-4 md:mb-5">
        <div className="flex items-center gap-2 mb-1">
          <p className="text-white/30 text-[10px] uppercase tracking-[0.3em] font-semibold">SCRIPT TRACKING</p>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-forest-500/10 text-forest-400 text-[10px] font-medium rounded-full border border-forest-500/20">
            <i className="ri-film-line"></i>
            劇本追蹤
          </span>
        </div>
        <h2 className="text-white font-bold text-base md:text-lg">今日劇本追蹤</h2>
        <p className="text-white/40 text-sm mt-1">
          盤前主情境已建立，但市場隨時會變。這裡記錄劇本成立與失效條件，以及下一個檢查時間。
        </p>
      </div>

      <div className="bg-navy-900/80 border border-navy-800 rounded-2xl overflow-hidden">
        {/* 頂部：盤前主情境 + 目前狀態 + 下一個檢查 */}
        <div className="px-5 md:px-6 py-4 md:py-5 border-b border-navy-800">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* 盤前主情境 */}
            <div>
              <p className="text-white/40 text-[10px] uppercase tracking-wider mb-1.5">盤前主情境</p>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-forest-400 animate-live-pulse"></div>
                <span className="text-white text-sm font-semibold">{data.mainScenario}</span>
              </div>
            </div>

            {/* 目前狀態 */}
            <div>
              <p className="text-white/40 text-[10px] uppercase tracking-wider mb-1.5">目前狀態</p>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></div>
                <span className="text-amber-300 text-sm font-medium">{data.currentStatus}</span>
              </div>
            </div>

            {/* 下一個檢查時間 */}
            <div>
              <p className="text-white/40 text-[10px] uppercase tracking-wider mb-1.5">下一個檢查時間</p>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-amber-500/10 rounded-md flex items-center justify-center border border-amber-500/20">
                  <span className="text-amber-400 text-[10px] font-mono font-bold">{data.nextCheckTime}</span>
                </div>
                <span className="text-white/60 text-sm">{data.nextCheckLabel}</span>
              </div>
            </div>
          </div>
        </div>

        {/* 劇本成立條件 */}
        <div className="px-5 md:px-6 py-4 md:py-5 border-b border-navy-800 bg-forest-500/[0.02]">
          <p className="text-white/40 text-[10px] uppercase tracking-wider mb-3">劇本成立條件</p>
          <div className="space-y-2">
            {data.validConditions.map((cond, idx) => (
              <div key={idx} className="flex items-start gap-2.5">
                <div className="w-5 h-5 bg-forest-500/10 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 border border-forest-500/20">
                  <i className="ri-check-line text-forest-400 text-[10px]"></i>
                </div>
                <p className="text-white/70 text-sm leading-relaxed">{cond}</p>
              </div>
            ))}
          </div>
        </div>

        {/* 劇本失效條件 */}
        <div className="px-5 md:px-6 py-4 md:py-5 bg-red-500/[0.02]">
          <p className="text-white/40 text-[10px] uppercase tracking-wider mb-3">劇本失效條件</p>
          <div className="space-y-2">
            {data.invalidConditions.map((cond, idx) => (
              <div key={idx} className="flex items-start gap-2.5">
                <div className="w-5 h-5 bg-red-500/10 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 border border-red-500/20">
                  <i className="ri-close-line text-red-400 text-[10px]"></i>
                </div>
                <p className="text-white/70 text-sm leading-relaxed">{cond}</p>
              </div>
            ))}
          </div>
          <p className="text-red-400/50 text-[10px] mt-3">
            以上條件出現時，代表盤前劇本可能需要修正。先停下來確認，不要急著操作。
          </p>
        </div>
      </div>
    </section>
  );
}
import type { Report } from '@/types/report';
import { Link } from 'react-router-dom';
import { trackEvent } from '@/utils/analytics';
import type { IntradayCheck } from '@/services/intradayCheckService';

interface ScenarioMetric {
  label: string;
  value: string;
  tone: 'positive' | 'neutral' | 'negative';
}

function getScenarioMetrics(report: Report | null): ScenarioMetric[] {
  if (!report) {
    return [
      { label: '市場溫度', value: '觀望中', tone: 'neutral' },
      { label: '市場穩定度', value: '待確認', tone: 'neutral' },
      { label: '主流延續性', value: '待觀察', tone: 'neutral' },
    ];
  }

  const score = report.confidence_score ?? 50;
  const bias = report.market_bias || '震盪';

  const tempMetric: ScenarioMetric =
    score >= 85
      ? { label: '市場溫度', value: '偏熱', tone: 'positive' }
      : score >= 65
        ? { label: '市場溫度', value: '溫暖', tone: 'positive' }
        : score >= 45
          ? { label: '市場溫度', value: '中性', tone: 'neutral' }
          : { label: '市場溫度', value: '偏冷', tone: 'negative' };

  const stabilityMetric: ScenarioMetric =
    score >= 85
      ? { label: '市場穩定度', value: '穩定', tone: 'positive' }
      : score >= 65
        ? { label: '市場穩定度', value: '穩定', tone: 'positive' }
        : score >= 45
          ? { label: '市場穩定度', value: '一般', tone: 'neutral' }
          : { label: '市場穩定度', value: '不穩', tone: 'negative' };

  const isBullish =
    bias.includes('偏多') || bias.includes('深濃偏多') || bias.includes('震盪偏多');
  const isBearish = bias.includes('偏空');

  const continuationMetric: ScenarioMetric = isBullish
    ? { label: '主流延續性', value: '偏強', tone: 'positive' }
    : isBearish
      ? { label: '主流延續性', value: '偏弱', tone: 'negative' }
      : { label: '主流延續性', value: '中性', tone: 'neutral' };

  return [tempMetric, stabilityMetric, continuationMetric];
}

function getCompanionTitle(bias: string, score: number | null, intraday?: IntradayCheck | null): string {
  // 如果有開盤雷達資料，優先使用
  if (intraday?.opening_status) {
    const status = intraday.opening_status;
    const taiex = intraday.taiex_change;
    if (status === 'strengthened') {
      return taiex !== null && taiex > 0
        ? `開盤後大盤上漲 ${taiex.toFixed(2)}%，盤前劇本被強化。`
        : '開盤後市場轉強，盤前劇本被強化。';
    }
    if (status === 'weakened') {
      return taiex !== null && taiex < 0
        ? `開盤後大盤下跌 ${Math.abs(taiex).toFixed(2)}%，盤前劇本被弱化。`
        : '開盤後市場轉弱，盤前劇本被弱化。';
    }
    if (status === 'confirmed') {
      return '開盤後市場表態與盤前劇本一致，劇本確認中。';
    }
    if (status === 'invalidated' || status === 'reversal') {
      return '開盤後市場表態與盤前劇本不一致，請以開盤雷達為準。';
    }
  }

  if (!score) return '盤前情境整理中';

  // Safety: never output 強勢偏多 or aggressive language
  const isBullish = bias.includes('偏多') || bias.includes('深濃偏多') || bias.includes('震盪偏多');
  const isBearish = bias.includes('偏空');
  const isInsufficient = bias.includes('資料不足');

  if (isInsufficient) {
    return '今天盤前核心資料不足，暫不做完整盤前判斷，目前僅作資訊觀察。';
  }

  if (isBullish && score >= 80) {
    return '今天情緒偏熱，但不要把熱度誤認成安全。';
  }
  if (isBullish && score >= 60) {
    return '今天市場有偏多氛圍，但記得確認主流有沒有延續。';
  }
  if (isBearish && score >= 60) {
    return '今天市場偏弱，但最危險的不是下跌，是恐慌時亂動。';
  }
  if (isBearish) {
    return '今天情緒偏冷，不要急著抄底，先看有沒有承接。';
  }
  return '今天市場方向不明，先觀察，不要先出手。';
}

function getCompanionDescription(bias: string, score: number | null, intraday?: IntradayCheck | null): string {
  if (intraday?.opening_status) {
    const status = intraday.opening_status;
    if (status === 'strengthened') {
      return '市場已用開盤表態轉強，現在重點是確認主流能否延續到中午。';
    }
    if (status === 'weakened') {
      return '開盤後盤勢轉弱，早盤重點是觀察權值股是否止穩。';
    }
    if (status === 'confirmed') {
      return '市場已用開盤表態確認盤前劇本，現在重點是確認主流能否延續到中午。';
    }
    if (status === 'invalidated' || status === 'reversal') {
      return '盤前劇本已出現重大偏移，請以開盤雷達校正為準。';
    }
  }

  if (!score) return '今日盤前情境尚未更新';

  const isBullish = bias.includes('偏多') || bias.includes('深濃偏多') || bias.includes('震盪偏多');
  const isBearish = bias.includes('偏空');
  const isInsufficient = bias.includes('資料不足');

  if (isInsufficient) {
    return '今天盤前核心資料不足，台股本地指標尚未完整，暫不做方向性判斷。目前僅作資訊觀察，不作完整盤勢結論。';
  }

  if (isBullish && score >= 80) {
    return '盤前訊號偏多，代表市場有機會延續主流，但真正要確認的是 10:30 前主流族群有沒有散掉。';
  }
  if (isBullish && score >= 60) {
    return '盤前訊號偏多，但把握度中等，記得 10:30 前回來確認主流是否延續。';
  }
  if (isBearish && score >= 60) {
    return '盤前訊號偏空，不代表一定會跌，而是提醒你今天不要急著進場。';
  }
  if (isBearish) {
    return '盤前訊號偏空，把握度偏低，這種時候觀望比操作更重要。';
  }
  return '盤前資料顯示方向尚未完全一致，需等待開盤後資金流向確認。';
}

function openingStatusToChinese(status: string | null): string {
  if (!status) return '觀察中';
  switch (status) {
    case 'confirmed': return '劇本成立';
    case 'strengthened': return '開盤轉強';
    case 'weakened': return '開盤轉弱';
    case 'invalidated': return '劇本失效';
    case 'reversal': return '市場反轉';
    case 'unknown': return '資料不足';
    default: return '觀察中';
  }
}

function openingStatusColor(status: string | null): string {
  if (!status) return 'text-white/40';
  switch (status) {
    case 'confirmed': return 'text-forest-400';
    case 'strengthened': return 'text-forest-400';
    case 'weakened': return 'text-amber-400';
    case 'invalidated': return 'text-red-400';
    case 'reversal': return 'text-red-400';
    case 'unknown': return 'text-amber-400';
    default: return 'text-white/40';
  }
}

function openingStatusBg(status: string | null): string {
  if (!status) return 'bg-white/5';
  switch (status) {
    case 'confirmed': return 'bg-forest-500/10';
    case 'strengthened': return 'bg-forest-500/10';
    case 'weakened': return 'bg-amber-500/10';
    case 'invalidated': return 'bg-red-500/10';
    case 'reversal': return 'bg-red-500/10';
    case 'unknown': return 'bg-amber-500/10';
    default: return 'bg-white/5';
  }
}

function openingStatusBorder(status: string | null): string {
  if (!status) return 'border-white/10';
  switch (status) {
    case 'confirmed': return 'border-forest-500/20';
    case 'strengthened': return 'border-forest-500/20';
    case 'weakened': return 'border-amber-500/20';
    case 'invalidated': return 'border-red-500/20';
    case 'reversal': return 'border-red-500/20';
    case 'unknown': return 'border-amber-500/20';
    default: return 'border-white/10';
  }
}

function getOpeningStatusMessage(status: string | null): string {
  if (!status) return '開盤雷達將於 09:15 更新，用來確認盤前劇本是否被市場驗證。';
  switch (status) {
    case 'confirmed': return '市場已用開盤表態確認盤前劇本，現在重點是確認主流能否延續到中午。';
    case 'strengthened': return '市場已用開盤表態轉強，現在重點是確認主流能否延續到中午。';
    case 'weakened': return '開盤後盤勢轉弱，早盤重點是觀察權值股是否止穩。';
    case 'invalidated': return '盤前劇本已出現重大偏移，請以開盤雷達校正為準。';
    case 'reversal': return '盤前劇本已出現重大偏移，請以開盤雷達校正為準。';
    case 'unknown': return '目前台股大盤或台指期資料不足，暫不判定劇本成立或失效。';
    default: return '開盤雷達更新中，等待市場確認盤前劇本。';
  }
}

interface Props {
  report: Report | null;
  showLink?: boolean;
  intradayCheck?: IntradayCheck | null;
}

export default function MainScenarioBlock({ report, showLink = true, intradayCheck: externalIntraday }: Props) {
  const bias = report?.market_bias || '觀望中';
  const score = report?.confidence_score ?? null;
  const metrics = getScenarioMetrics(report);

  const companionTitle = getCompanionTitle(bias, score, externalIntraday || null);
  const companionDescription = getCompanionDescription(bias, score, externalIntraday || null);

  const scoreColor =
    score && score >= 85
      ? 'text-amber-400'
      : score && score >= 65
        ? 'text-forest-400'
        : score && score >= 45
          ? 'text-white/60'
          : 'text-red-400';

  const scoreBarColor =
    score && score >= 85
      ? 'bg-amber-500'
      : score && score >= 65
        ? 'bg-forest-500'
        : score && score >= 45
          ? 'bg-white/30'
          : 'bg-red-500';

  const hasIntraday = !!externalIntraday;
  const openingStatus = externalIntraday?.opening_status ?? null;
  const openingMessage = getOpeningStatusMessage(openingStatus);
  const isCritical = openingStatus === 'invalidated' || openingStatus === 'reversal';
  const isUnknown = openingStatus === 'unknown';

  return (
    <section className="w-full">
      <div className="mb-4 md:mb-5">
        <div className="flex items-center gap-2 mb-2">
          <p className="text-white/30 text-[10px] uppercase tracking-[0.3em] font-semibold">
            MAIN SCENARIO
          </p>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-forest-500/10 text-forest-400 text-[10px] font-medium rounded-full border border-forest-500/20">
            <i className="ri-radar-line"></i>
            07:30 盤前劇本
          </span>
        </div>
      </div>

      <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
        {/* Top row: bias + score */}
        <div className="flex items-center justify-between mb-4 md:mb-5">
          <div>
            <h2 className="text-white font-bold text-lg md:text-xl">
              {hasIntraday ? '開盤雷達' : '07:30 盤前劇本'}：{bias}
              {score !== null && (
                <span className={`ml-2 text-base md:text-lg font-semibold ${scoreColor}`}>
                  {score}/100
                </span>
              )}
            </h2>
            <p className="text-white/40 text-sm mt-1">
              {companionDescription}
            </p>
          </div>
          {score !== null && (
            <div className="w-16 h-16 md:w-20 md:h-20 rounded-full border-4 border-navy-800 flex items-center justify-center flex-shrink-0">
              <div className="text-center">
                <span className={`block text-lg md:text-xl font-bold ${scoreColor}`}>{score}</span>
                <span className="text-white/30 text-[10px]">分</span>
              </div>
            </div>
          )}
        </div>

        {/* Companion reminder */}
        <div className="mb-4 md:mb-5 p-3 md:p-4 rounded-xl bg-forest-500/[0.04] border border-forest-500/10">
          <p className="text-forest-300 text-sm font-medium leading-relaxed">
            {companionTitle}
          </p>
        </div>

        {/* Score bar */}
        {score !== null && (
          <div className="mb-5 md:mb-6">
            <div className="h-2 bg-navy-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-1000 ${scoreBarColor}`}
                style={{ width: `${score}%` }}
              ></div>
            </div>
            <div className="flex justify-between mt-1.5">
              <span className="text-white/20 text-[10px]">0</span>
              <span className="text-white/20 text-[10px]">50</span>
              <span className="text-white/20 text-[10px]">100</span>
            </div>
            <p className="text-white/20 text-[10px] mt-1">
              分數代表劇本成立度，不代表漲跌保證
            </p>
          </div>
        )}

        {/* Metrics grid */}
        <div className="grid grid-cols-3 gap-2 md:gap-3">
          {metrics.map((m, idx) => {
            const toneColor =
              m.tone === 'positive'
                ? 'text-forest-400'
                : m.tone === 'negative'
                  ? 'text-red-400'
                  : 'text-white/50';
            const bgColor =
              m.tone === 'positive'
                ? 'bg-forest-500/5'
                : m.tone === 'negative'
                  ? 'bg-red-500/5'
                  : 'bg-white/[0.02]';
            const borderColor =
              m.tone === 'positive'
                ? 'border-forest-500/10'
                : m.tone === 'negative'
                  ? 'border-red-500/10'
                  : 'border-white/5';
            return (
              <div
                key={idx}
                className={`p-3 md:p-4 rounded-xl border ${borderColor} ${bgColor} text-center`}
              >
                <p className="text-white/30 text-[10px] uppercase tracking-wider mb-1">
                  {m.label}
                </p>
                <p className={`text-sm md:text-base font-semibold ${toneColor}`}>{m.value}</p>
              </div>
            );
          })}
        </div>

        {/* 09:15 開盤校正 */}
        {hasIntraday && (
          <div className={`mt-4 md:mt-5 pt-4 border-t border-navy-800`}>
            <div className="flex items-center gap-2 mb-3">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-500/10 text-amber-400 text-[10px] font-medium rounded-full border border-amber-500/20">
                <i className="ri-radar-line"></i>
                09:15 開盤校正
              </span>
              {isCritical && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-500/10 text-red-400 text-[10px] font-medium rounded-full border border-red-500/20">
                  <i className="ri-alert-line"></i>
                  劇本偏移
                </span>
              )}
              {isUnknown && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-500/10 text-amber-400 text-[10px] font-medium rounded-full border border-amber-500/20">
                  <i className="ri-information-line"></i>
                  資料不足
                </span>
              )}
            </div>
            <div className={`p-3 md:p-4 rounded-xl border ${openingStatusBorder(openingStatus)} ${openingStatusBg(openingStatus)}`}>
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-sm font-semibold ${openingStatusColor(openingStatus)}`}>
                  {openingStatusToChinese(openingStatus)}
                </span>
                {externalIntraday?.scenario_result && (
                  <span className="text-white/50 text-xs">· {externalIntraday.scenario_result}</span>
                )}
              </div>
              <p className="text-white/70 text-sm leading-relaxed">
                {openingMessage}
              </p>
              {externalIntraday?.ai_summary && (
                <p className="text-white/50 text-xs mt-2 leading-relaxed">
                  {externalIntraday.ai_summary}
                </p>
              )}
            </div>
          </div>
        )}

        {/* CTA to full report */}
        {showLink && (
          <div className="mt-4 md:mt-5 pt-4 border-t border-navy-800">
            <Link
              to="/report/today"
              onClick={() => trackEvent('click_full_report', { location: 'home_scenario' })}
              className="inline-flex items-center gap-2 text-forest-400 hover:text-forest-300 text-sm font-medium transition-colors"
            >
              查看完整今日盤前判斷
              <i className="ri-arrow-right-line"></i>
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
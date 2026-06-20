/**
 * Morning Alpha — Unified Market Tone Style Utility
 *
 * Taiwan stock market convention:
 * - Red   = 偏多 / bullish (台股紅漲綠跌)
 * - Green = 偏空 / bearish
 * - Amber = 震盪 / neutral / observing
 * - Slate = 資料不足 / data insufficient
 */

export type MarketTone = 'bullish' | 'bearish' | 'neutral' | 'data';

export interface MarketToneStyle {
  tone: MarketTone;
  textClass: string;
  bgClass: string;
  borderClass: string;
  dotClass: string;
  icon: string;
}

const TONE_MAP: Record<MarketTone, MarketToneStyle> = {
  bullish: {
    tone: 'bullish',
    textClass: 'text-red-400',
    bgClass: 'bg-red-500/10',
    borderClass: 'border-red-500/30',
    dotClass: 'bg-red-400',
    icon: 'ri-arrow-up-line',
  },
  bearish: {
    tone: 'bearish',
    textClass: 'text-emerald-400',
    bgClass: 'bg-emerald-500/10',
    borderClass: 'border-emerald-500/30',
    dotClass: 'bg-emerald-400',
    icon: 'ri-arrow-down-line',
  },
  neutral: {
    tone: 'neutral',
    textClass: 'text-amber-300',
    bgClass: 'bg-amber-500/10',
    borderClass: 'border-amber-500/30',
    dotClass: 'bg-amber-400',
    icon: 'ri-subtract-line',
  },
  data: {
    tone: 'data',
    textClass: 'text-slate-400',
    bgClass: 'bg-slate-500/10',
    borderClass: 'border-slate-600/40',
    dotClass: 'bg-slate-500',
    icon: 'ri-database-2-line',
  },
};

/**
 * Classify a market state display label into a tone.
 * Priority order: 資料相關 > 偏多/強 > 偏空/弱/風險 > 震盪/觀察/等待 > default gray
 */
export function classifyMarketTone(label: string): MarketTone {
  if (!label) return 'data';

  // Data insufficient checks (must match before direction checks)
  if (
    label.includes('資料不足') ||
    label.includes('暫缺') ||
    label.includes('未更新') ||
    label.includes('尚未產生') ||
    label.includes('等待資料') ||
    label.includes('無資料') ||
    label.includes('同步中') ||
    label.includes('待市場資料更新')
  ) {
    return 'data';
  }

  // Bullish / upside
  if (
    label.includes('偏多') ||
    label.includes('反彈') ||
    label.includes('轉強') ||
    label.includes('強勢') ||
    label.includes('多方') ||
    label.includes('正向') ||
    label.includes('偏強')
  ) {
    return 'bullish';
  }

  // Bearish / downside
  if (
    label.includes('偏空') ||
    label.includes('偏弱') ||
    label.includes('高風險') ||
    label.includes('轉弱') ||
    label.includes('空方') ||
    label.includes('防守觀察') ||
    label.includes('避開觀察') ||
    label.includes('風險未解除') ||
    label.includes('下跌')
  ) {
    return 'bearish';
  }

  // Neutral / observing / waiting
  if (
    label.includes('震盪') ||
    label.includes('觀察') ||
    label.includes('待驗證') ||
    label.includes('等待') ||
    label.includes('中性') ||
    label.includes('方向未明') ||
    label.includes('橫盤') ||
    label.includes('盤中追蹤')
  ) {
    return 'neutral';
  }

  // Data status labels (not market direction)
  if (
    label.includes('資料完整') ||
    label.includes('資料異常')
  ) {
    return 'data';
  }

  // Fallback: gray
  return 'data';
}

/**
 * Get the full style object for a market state label.
 * Falls back to 'data' tone if label is unrecognized.
 */
export function getMarketToneStyle(label: string): MarketToneStyle {
  const tone = classifyMarketTone(label);
  return TONE_MAP[tone];
}

/**
 * Get tone from riskTone string (used by marketStateEngine).
 * 'red'=bullish, 'green'=bearish, 'yellow'=neutral, 'gray'=data
 */
export function riskToneToStyle(riskTone: string): MarketToneStyle {
  switch (riskTone) {
    case 'red': return TONE_MAP.bullish;
    case 'green': return TONE_MAP.bearish;
    case 'yellow': return TONE_MAP.neutral;
    default: return TONE_MAP.data;
  }
}

/**
 * Taiwan convention color explanation — tiny footer text.
 */
export const TAIWAN_COLOR_CONVENTION = '顏色採台股慣例：紅＝偏多，綠＝偏空，黃＝觀察，不代表買賣建議。';
/**
 * V7.53: Market Bias Downgrade — Post-close auto-downgrade logic
 *
 * Rule: If TAIEX, TXF, 2330 all turn negative (all three weak),
 *       market_bias must be auto-downgraded.
 *
 * Downgrade chain:
 *   偏多 / 強勢偏多 → 偏多觀察
 *   偏多觀察 → 中性震盪
 *   中性震盪 → 偏空觀察
 *   偏空觀察 → 明顯偏弱 (already weakest, no further)
 */

export interface ThreeCoreData {
  taiexChange: number | null;
  txfChange: number | null;
  tsmc2330Change: number | null;
}

const DOWNGRADE_MAP: Record<string, string> = {
  '強勢偏多': '偏多觀察',
  '偏多': '偏多觀察',
  '偏多觀察': '中性震盪',
  '中性偏多': '中性震盪',
  '中性震盪': '偏空觀察',
  '偏弱觀察': '明顯偏弱',
  '明顯偏弱': '明顯偏弱',
};

/**
 * Check if all three core indicators (TAIEX, TXF, 2330) are negative
 */
export function isThreeCoreAllWeak(core: ThreeCoreData): boolean {
  const taiex = core.taiexChange;
  const txf = core.txfChange;
  const tsmc = core.tsmc2330Change;

  // Need all three to be non-null AND negative
  if (taiex === null || txf === null || tsmc === null) return false;
  return taiex < 0 && txf < 0 && tsmc < 0;
}

/**
 * Apply auto-downgrade to market_bias if three-core all weak.
 * Returns the (possibly downgraded) bias string.
 */
export function applyMarketBiasDowngrade(
  currentBias: string | null | undefined,
  core: ThreeCoreData,
): string | null {
  const bias = (currentBias || '').trim();
  if (!bias) return currentBias ?? null;
  if (!isThreeCoreAllWeak(core)) return currentBias ?? null;

  // Try exact match first
  if (DOWNGRADE_MAP[bias]) return DOWNGRADE_MAP[bias];

  // Partial match — check against all keys
  for (const [key, value] of Object.entries(DOWNGRADE_MAP)) {
    if (bias.includes(key)) return value;
  }

  return currentBias ?? null;
}

/**
 * Check if SOX or 2330 is weak enough to trigger AI/semiconductor downgrade
 */
export function isAISemiconductorWeak(core: ThreeCoreData, soxChange: number | null): boolean {
  const sox = soxChange ?? 0;
  const tsmc = core.tsmc2330Change ?? 0;
  return sox < -2 || tsmc < -1;
}

/**
 * AI/半导体 related keywords for stock filtering
 */
export const AI_SEMICONDUCTOR_KEYWORDS = [
  'ai', '半導體', '伺服器', '散熱', '封裝', 'cowos', '先進製程', 'hpc',
  '晶片', 'chip', 'gpu', 'asic', 'npu',
];

/**
 * Defense/high-dividend related keywords for stock prioritization
 */
export const DEFENSE_KEYWORDS = [
  '金融', '電信', '防禦', '高殖利率', '傳產', '航運', '塑化', '鋼鐵', '水泥', '營建',
  '食品', '醫療', '公用', '保險',
];

/**
 * Check if a stock belongs to AI/semiconductor by its group/name/reason
 */
export function isAIStock(item: { group?: string; sector?: string; category?: string; name?: string; reason?: string; thesis?: string }): boolean {
  const text = [
    item.group || '', item.sector || '', item.category || '',
    item.name || '', item.reason || '', item.thesis || '',
  ].join(' ').toLowerCase();
  return AI_SEMICONDUCTOR_KEYWORDS.some((kw) => text.includes(kw));
}
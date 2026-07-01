import { getIntradayBias } from '@/services/intradayBiasService';

/**
 * 今日盤勢分數推導
 *
 * 這是「今天市場環境好不好」的分數，不是「AI 有多確定」的把握度分數。
 * 與 reports.confidence_score（盤前判讀把握度）和
 * opening_market_radar.confidence_score（盤中雷達把握度）完全獨立，不可混用。
 *
 * 推導優先順序：opening_market_radar.radar_status > reports.market_bias > 觀察中
 */

export interface MarketHealthScore {
  score: number;
  range: string;
  label: string;
}

// ... existing code ...

export function deriveMarketHealthScore(
  radarStatus: string | undefined | null,
  radarMarketBias: string | undefined | null,
  reportMarketBias: string | undefined | null,
): MarketHealthScore {
  const status = radarStatus || radarMarketBias || reportMarketBias || '';

  // 高風險防守 → 最低分
  if (status.includes('高風險') || status === '防守') {
    return { score: 15, range: '10～20', label: '高風險防守・嚴格防守' };
  }

  // 明顯偏弱 → 大跌日
  if (status.includes('明顯偏弱')) {
    return { score: 25, range: '20～35', label: '明顯偏弱・防守觀察' };
  }

  // 盤中轉弱 / 偏弱觀察
  if (status.includes('盤中轉弱') || status.includes('偏弱')) {
    return { score: 40, range: '35～45', label: '偏弱觀察' };
  }

  // 中性震盪
  if (status.includes('中性') || status.includes('震盪')) {
    return { score: 53, range: '45～60', label: '中性震盪' };
  }

  // 偏多觀察（不包含「偏弱」的情況已在上面攔截）
  if (status.includes('偏多')) {
    return { score: 68, range: '60～75', label: '偏多觀察' };
  }

  // 強勢偏多
  if (status.includes('強勢')) {
    return { score: 83, range: '75～90', label: '強勢偏多' };
  }

  // ═══ 反彈驗證中 ═══
  // 檢查這個 case 要放在「劇本成立」「偏弱」「中性」之前，才能正確攔截
  if (status.includes('反彈驗證') || status.includes('驗證中')) {
    return { score: 58, range: '50～65', label: '反彈驗證中' };
  }

  // ═══ 劇本初步成立 ═══
  if (status.includes('劇本初步成立') || status.includes('初步成立')) {
    return { score: 65, range: '60～75', label: '劇本初步成立' };
  }

  // 劇本成立 → 偏正向，但不代表強勢
  if (status.includes('劇本成立')) {
    return { score: 65, range: '60～75', label: '劇本成立・偏多觀察' };
  }

  // 預設：觀察中
  return { score: 50, range: '45～60', label: '觀察中' };
}

/**
 * 根據盤勢分數回傳色調，供 UI 使用
 */
export function getMarketHealthColor(score: number): {
  progress: string;
  text: string;
  badge: string;
  bg: string;
} {
  if (score <= 20) {
    return {
      progress: 'text-red-500',
      text: 'text-red-400',
      badge: 'bg-red-500/10 text-red-400 border-red-500/20',
      bg: 'bg-red-500',
    };
  }
  if (score <= 35) {
    return {
      progress: 'text-red-400',
      text: 'text-red-400',
      badge: 'bg-red-500/10 text-red-400 border-red-500/20',
      bg: 'bg-red-400',
    };
  }
  if (score <= 45) {
    return {
      progress: 'text-amber-400',
      text: 'text-amber-400',
      badge: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
      bg: 'bg-amber-400',
    };
  }
  if (score <= 60) {
    return {
      progress: 'text-amber-300',
      text: 'text-amber-300',
      badge: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
      bg: 'bg-amber-300',
    };
  }
  return {
    progress: 'text-forest-400',
    text: 'text-forest-400',
    badge: 'bg-forest-500/10 text-forest-400 border-forest-500/20',
    bg: 'bg-forest-400',
  };
}

// ════════════════════════════════════════════
// 一眼看懂狀態系統
// ════════════════════════════════════════════

export interface DayStatus {
  stateLabel: string;
  mainSentence: string;
  actionAdvice: string;
  whatToWatch: string;
  whatToAvoid: string;
  badgeBg: string;
  badgeBorder: string;
  badgeText: string;
  dotColor: string;
}

/**
 * 從 opening_market_radar 狀態推導「一眼看懂」的今日狀態
 * 這是使用者第一眼就能理解的文字，不是分數或技術用語。
 *
 * @param radarStatus - opening_market_radar.radar_status
 * @param radarMarketBias - opening_market_radar.market_bias
 * @param reportMarketBias - reports.market_bias（盤前劇本方向，用於產生「盤前XX→盤中YY」的語句）
 * @param taiexChange - opening_market_radar.taiex_change
 * @param tsmcChange - opening_market_radar.tsmc_change
 */
export function getDayStatus(
  radarStatus: string | undefined | null,
  radarMarketBias: string | undefined | null,
  reportMarketBias: string | undefined | null,
  taiexChange?: number | null,
  tsmcChange?: number | null,
): DayStatus {
  const status = radarStatus || radarMarketBias || '';

  // ═══ 高風險防守 ═══
  if (status.includes('高風險') || status === '防守') {
    return {
      stateLabel: '高風險日',
      mainSentence: '盤勢急跌，優先控制風險。',
      actionAdvice: '避免追價、降低曝險、等止跌。',
      whatToWatch: '權值股是否止跌、台指期是否收斂、金融股是否拖累。',
      whatToAvoid: '追高、搶反彈、重倉押方向。',
      badgeBg: 'bg-red-500/15',
      badgeBorder: 'border-red-500/30',
      badgeText: 'text-red-300',
      dotColor: 'bg-red-400',
    };
  }

  // ═══ 明顯偏弱 ═══
  if (status.includes('明顯偏弱')) {
    const taiexStr = taiexChange != null ? `TAIEX ${taiexChange >= 0 ? '+' : ''}${taiexChange.toFixed(2)}%` : '';
    const tsmcStr = tsmcChange != null ? `2330 ${tsmcChange >= 0 ? '+' : ''}${tsmcChange.toFixed(2)}%` : '';
    const dataDetail = [taiexStr, tsmcStr].filter(Boolean).join('，');

    const premarketPart = reportMarketBias ? `盤前「${reportMarketBias}」劇本已降級。` : '盤前劇本已降級。';

    return {
      stateLabel: '防守日',
      mainSentence: `盤中明顯轉弱，${premarketPart}`,
      actionAdvice: `目前不適合追價，先觀察台積電、台指期與金融股是否止跌。${dataDetail ? `（${dataDetail}）` : ''}`,
      whatToWatch: '台積電是否止跌、台指期是否收斂、金融股是否拖累。',
      whatToAvoid: '追高、搶反彈、重倉押方向。',
      badgeBg: 'bg-red-500/15',
      badgeBorder: 'border-red-500/30',
      badgeText: 'text-red-300',
      dotColor: 'bg-red-400',
    };
  }

  // ═══ 盤中轉弱 / 偏弱觀察 ═══
  if (status.includes('盤中轉弱') || status.includes('偏弱')) {
    return {
      stateLabel: '偏防守',
      mainSentence: '盤勢轉弱，先保守觀察。',
      actionAdvice: '少追高、等訊號。',
      whatToWatch: '權值股走勢、市場量能變化。',
      whatToAvoid: '追高、重倉、搶短。',
      badgeBg: 'bg-amber-500/10',
      badgeBorder: 'border-amber-500/30',
      badgeText: 'text-amber-300',
      dotColor: 'bg-amber-400',
    };
  }

  // ═══ 中性震盪 ═══
  if (status.includes('中性') || status.includes('震盪')) {
    return {
      stateLabel: '等待日',
      mainSentence: '方向尚未確認，等待多空訊號。',
      actionAdvice: '不急著進攻。',
      whatToWatch: '開盤後量價結構、權值股方向。',
      whatToAvoid: '提前押注、重倉單一方向。',
      badgeBg: 'bg-white/10',
      badgeBorder: 'border-white/20',
      badgeText: 'text-white/70',
      dotColor: 'bg-white/40',
    };
  }

  // ═══ 偏多觀察 ═══
  if (status.includes('偏多')) {
    return {
      stateLabel: '觀察偏多',
      mainSentence: '風險偏好回升，強勢族群可觀察。',
      actionAdvice: '觀察主流族群延續性。',
      whatToWatch: '主流族群輪動、量能持續性。',
      whatToAvoid: '過度追價、忽略停損。',
      badgeBg: 'bg-forest-500/10',
      badgeBorder: 'border-forest-500/30',
      badgeText: 'text-forest-300',
      dotColor: 'bg-forest-400',
    };
  }

  // ═══ 強勢偏多 ═══
  if (status.includes('強勢')) {
    return {
      stateLabel: '進攻日',
      mainSentence: '多方結構較明確，但仍避免追高失控。',
      actionAdvice: '觀察強勢族群與權值股是否延續。',
      whatToWatch: '主流族群延續性、量能放大確認。',
      whatToAvoid: '過度樂觀、無停損追價。',
      badgeBg: 'bg-forest-500/10',
      badgeBorder: 'border-forest-500/30',
      badgeText: 'text-forest-300',
      dotColor: 'bg-forest-400',
    };
  }

  // ═══ 劇本成立（偏正向） ═══
  if (status.includes('劇本成立')) {
    return {
      stateLabel: '劇本成立',
      mainSentence: '開盤走勢驗證盤前假設，可依劇本操作。',
      actionAdvice: '依盤前策略執行，注意午盤變化。',
      whatToWatch: '午盤動能是否延續。',
      whatToAvoid: '因盤中震盪而恐慌。',
      badgeBg: 'bg-forest-500/10',
      badgeBorder: 'border-forest-500/30',
      badgeText: 'text-forest-300',
      dotColor: 'bg-forest-400',
    };
  }

  // ═══ 反彈驗證中 ═══
  // 這必須放在「劇本成立」之前，因為「反彈驗證中」也包含正向但尚未確認
  if (status.includes('反彈驗證') || status.includes('驗證中')) {
    return {
      stateLabel: '反彈驗證中',
      mainSentence: '台股開盤偏強，但 2330 / TXF 即時資料不足，先確認權值股承接。',
      actionAdvice: '不追高、不重倉，先看台積電、台指期與半導體族群是否補上確認訊號。',
      whatToWatch: '2330、台指期、半導體族群是否補上確認訊號。',
      whatToAvoid: '追高、重倉、單一方向過度押注。',
      badgeBg: 'bg-amber-500/10',
      badgeBorder: 'border-amber-500/30',
      badgeText: 'text-amber-300',
      dotColor: 'bg-amber-400',
    };
  }

  // ═══ 劇本初步成立 ═══
  if (status.includes('劇本初步成立') || status.includes('初步成立')) {
    return {
      stateLabel: '劇本初步成立',
      mainSentence: '開盤後走勢與盤前劇本一致，觀察量能與權值股延續性。',
      actionAdvice: '可依盤前策略執行，但需持續觀察量能變化。',
      whatToWatch: '量能持續性、權值股延續性、午盤動能。',
      whatToAvoid: '過早加倉、忽視午盤變化。',
      badgeBg: 'bg-forest-500/10',
      badgeBorder: 'border-forest-500/30',
      badgeText: 'text-forest-300',
      dotColor: 'bg-forest-400',
    };
  }

  // ═══ 預設：基於 TAIEX 數值判斷，不再只顯示「觀察中」 ═══
  const bias = getIntradayBias(taiexChange);
  return {
    stateLabel: bias.stateLabel,
    mainSentence: bias.mainText,
    actionAdvice: bias.biasLevel === 'mild_weak' || bias.biasLevel === 'weak_drop'
      ? '先降低追價與重倉風險，觀察權值股與台指期是否補上確認訊號。'
      : bias.biasLevel === 'mild_strong'
      ? '觀察台積電、台指期與半導體族群是否同步補上，不追高。'
      : '先觀察，不躁進。',
    whatToWatch: '開盤後量價結構、權值股方向。',
    whatToAvoid: '在方向未明前重倉。',
    badgeBg: bias.statusColor === 'red' ? 'bg-red-500/15' :
             bias.statusColor === 'amber' ? 'bg-amber-500/10' :
             bias.statusColor === 'green' ? 'bg-forest-500/10' :
             'bg-white/5',
    badgeBorder: bias.statusColor === 'red' ? 'border-red-500/30' :
                 bias.statusColor === 'amber' ? 'border-amber-500/30' :
                 bias.statusColor === 'green' ? 'border-forest-500/30' :
                 'border-white/10',
    badgeText: bias.statusColor === 'red' ? 'text-red-300' :
               bias.statusColor === 'amber' ? 'text-amber-300' :
               bias.statusColor === 'green' ? 'text-forest-300' :
               'text-white/50',
    dotColor: bias.statusColor === 'red' ? 'bg-red-400' :
              bias.statusColor === 'amber' ? 'bg-amber-400' :
              bias.statusColor === 'green' ? 'bg-forest-400' :
              'bg-white/30',
  };
}

/**
 * 根據 report.market_bias 推導盤前狀態（無 opening radar 時使用）
 */
export function getPremarketDayStatus(reportMarketBias: string | undefined | null): DayStatus {
  const bias = reportMarketBias || '';

  if (bias.includes('強勢')) {
    return {
      stateLabel: '盤前偏多',
      mainSentence: '盤前訊號偏多，等待開盤驗證。',
      actionAdvice: '開盤後確認動能再動作。',
      whatToWatch: '開盤量價結構、權值股方向。',
      whatToAvoid: '開盤前就追價。',
      badgeBg: 'bg-forest-500/10',
      badgeBorder: 'border-forest-500/30',
      badgeText: 'text-forest-300',
      dotColor: 'bg-forest-400',
    };
  }
  if (bias.includes('偏多')) {
    return {
      stateLabel: '等待開盤',
      mainSentence: '盤前訊號偏多，等待開盤確認。',
      actionAdvice: '等待 09:15 開盤雷達後再決策。',
      whatToWatch: '開盤後 TAIEX、2330、TXF。',
      whatToAvoid: '單看盤前報告就下單。',
      badgeBg: 'bg-amber-500/10',
      badgeBorder: 'border-amber-500/30',
      badgeText: 'text-amber-300',
      dotColor: 'bg-amber-400',
    };
  }
  if (bias.includes('中性') || bias.includes('震盪')) {
    return {
      stateLabel: '等待日',
      mainSentence: '盤前方向未定，今日先觀察。',
      actionAdvice: '等開盤後再判斷。',
      whatToWatch: '開盤後實際走勢。',
      whatToAvoid: '盤前就押注方向。',
      badgeBg: 'bg-white/10',
      badgeBorder: 'border-white/20',
      badgeText: 'text-white/70',
      dotColor: 'bg-white/40',
    };
  }
  if (bias.includes('偏弱') || bias.includes('轉弱')) {
    return {
      stateLabel: '盤前偏弱',
      mainSentence: '盤前訊號偏弱，保守以對。',
      actionAdvice: '等開盤確認，不急於進場。',
      whatToWatch: '開盤後跌勢是否擴大。',
      whatToAvoid: '逆勢追多。',
      badgeBg: 'bg-red-500/10',
      badgeBorder: 'border-red-500/30',
      badgeText: 'text-red-300',
      dotColor: 'bg-red-400',
    };
  }
  if (bias.includes('反彈驗證') || bias.includes('驗證日') || bias.includes('修復')) {
    return {
      stateLabel: '反彈驗證日',
      mainSentence: '盤前訊號顯示反彈驗證中，等待開盤確認實際走勢。',
      actionAdvice: '開盤後比對實際走勢與盤前劇本，確認反彈是否成立。',
      whatToWatch: '開盤後 TAIEX、2330、TXF 是否延續盤前正向訊號。',
      whatToAvoid: '開盤前過早追價、單看盤前報告就下單。',
      badgeBg: 'bg-amber-500/10',
      badgeBorder: 'border-amber-500/30',
      badgeText: 'text-amber-300',
      dotColor: 'bg-amber-400',
    };
  }

  return {
    stateLabel: '等待中',
    mainSentence: '等待盤前報告或開盤雷達更新。',
    actionAdvice: '先觀察，不躁進。',
    whatToWatch: '07:30 盤前劇本與 09:15 開盤雷達。',
    whatToAvoid: '在資訊不足時交易。',
    badgeBg: 'bg-white/5',
    badgeBorder: 'border-white/10',
    badgeText: 'text-white/50',
    dotColor: 'bg-white/30',
  };
}
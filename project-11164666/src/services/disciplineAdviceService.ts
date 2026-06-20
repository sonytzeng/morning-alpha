/**
 * Morning Alpha — Discipline Advice Service
 *
 * Generates "Today's Don't Do" advice based on marketState.
 * Free tier: single concise reminder
 * Premium tier: 3-5 detailed behavioral guardrails
 *
 * Advice is dynamically generated based on market state:
 * - High risk day: focus on risk control, not catching falling knives
 * - Range-bound / neutral: focus on not forcing trades, patience
 * - Bullish / rebound verification: focus on not chasing, confirming signals
 *
 * No buy/sell advice. No stock picks. No price predictions.
 * Pure behavioral discipline: helping users reduce emotional trading.
 */

export interface DisciplineAdvice {
  freeDontDo: string;
  premiumDontDos: string[];
}

interface MarketInput {
  marketPhase: string;
  intradayBias: string;
  riskTone: string;
  displayLabel: string;
}

/**
 * Generate discipline advice based on market state.
 * Rules are behavioral guardrails, not investment advice.
 */
export function generateDisciplineAdvice(state: MarketInput): DisciplineAdvice {
  const phase = state.marketPhase;
  const bias = state.intradayBias;
  const label = state.displayLabel;

  // ── 收盤資料不足（V44: 優先於 after_close_verified） ──
  if (label.includes('資料不足') || label.includes('收盤資料不足')) {
    return {
      freeDontDo: '不要硬做判斷，等完整收盤資料出現後再回測盤前假設。',
      premiumDontDos: [
        '不要在資料不足時推導方向性結論——缺口本身就是風險，不等於安全。',
        '不要因為想看到結論就忽略資料不足的事實，紀律比結果重要。',
        '不要用前一天或上週的資料來合理化今天的判斷——市場條件已經改變。',
        '等待核心資料補齊後再進行完整驗證，不急於一時。',
        '資料不足日是觀察日，不是交易判斷日，先以學習與回顧為主。',
      ],
    };
  }

  // ── 收盤驗證完成 ──
  if (phase === 'after_close_verified') {
    return {
      freeDontDo: '不要只看今天漲跌，回看盤前假設與盤中追蹤是否一致，才是累積判斷品質的關鍵。',
      premiumDontDos: [
        '不要只看收盤漲跌，忽略盤前假設是否成立——驗證的核心是「事前判斷 vs. 事後結果」。',
        '不要忽略盤中是否有及時修正訊號，那是判斷品質的關鍵轉折點。',
        '不要把單日成功或失敗當成長期準確率，市場判斷需要累積驗證。',
        '不要跳過收盤驗證，因為它是明天盤前判斷的基礎。',
        '不要用情緒解讀結果——回到系統流程檢討，哪裡對、哪裡錯、為什麼。',
      ],
    };
  }

  // ── 收盤待驗證 ──
  if (phase === 'after_close_pending') {
    return {
      freeDontDo: '不要急著下結論，等待收盤驗證完成後再回看今日判斷。',
      premiumDontDos: [
        '不要在收盤驗證完成前急著改寫今日盤前假設——先讓資料到位再判斷。',
        '不要因為盤中走勢改變就全盤否定盤前劇本，有些劇本需要收盤後才能驗證。',
        '不要忽略盤中追蹤訊號，它是今天判斷品質的關鍵線索，也是明天盤前的基礎。',
        '不要用收盤結果回頭合理化盤中的情緒交易——紀律比結果重要。',
      ],
    };
  }

  // ── 高風險日 / 風險迴避 / 明顯偏弱 ──
  if (bias === 'risk_off' || label.includes('明顯偏弱') || label.includes('高風險')) {
    return {
      freeDontDo: '不要看到開低就急著搶反彈——先確認賣壓是否集中在權值股，還是全面擴散。',
      premiumDontDos: [
        '不要看到急跌就重倉攤平——市場轉弱時，先控制部位節奏比搶反彈更重要。',
        '不要在台積電與台指期不同步時重倉押方向——方向不一致時風險最高。',
        '不要把盤前假設當成盤中事實——盤中走勢改變時，應降低盤前判斷權重。',
        '不要在資料不足時放大部位——缺口本身就是風險，不等於安全。',
        '不要追沒有量的反彈——無量反彈容易回吐，追價成本已不利。',
      ],
    };
  }

  // ── 偏弱觀察 ──
  if (bias === 'weak_watch') {
    return {
      freeDontDo: '不要過早判斷反彈成立——先看台積電與台指期是否同步確認方向。',
      premiumDontDos: [
        '不要在台指期與權值股未確認前，過早判定反彈成立。',
        '不要只看單一個股紅綠，忽略大盤與族群同步性——個股強不代表大盤轉強。',
        '不要在賣壓未消化完畢時進場——等待量縮止穩比搶低點更安全。',
        '不要把資料不足解讀成市場安全——缺口本身就是風險訊號。',
        '不要在偏弱環境中追高——弱勢中的反彈常常是陷阱而非機會。',
      ],
    };
  }

  // ── 偏強觀察 / 反彈驗證 ──
  if (bias === 'bullish_watch' || label.includes('反彈') || label.includes('轉強')) {
    return {
      freeDontDo: '不要追第一根急拉——先看量能與族群擴散是否跟上再動作。',
      premiumDontDos: [
        '不要追第一根急拉——開盤情緒不等於全日方向，等量能跟上再判斷。',
        '不要忽略台積電與台指期是否同步——單一指標不足以確認趨勢。',
        '不要在無量反彈中放大部位——量能不足的反彈容易回吐。',
        '不要追已經急漲的族群——進場成本已不利，等待拉回再觀察。',
        '不要把反彈驗證當成全面多頭——盤中轉強需要收盤確認才算數。',
      ],
    };
  }

  // ── 震盪觀察 / 中性 ──
  return {
    freeDontDo: '不要在沒有主線時硬找標的——震盪盤中，不做也是一種判斷。',
    premiumDontDos: [
      '不要在震盪盤頻繁追高殺低——來回被掃的成本比你想像的高。',
      '不要把短線拉抬誤判成主趨勢——震盪區間內的突破常有假訊號。',
      '不要在訊號不足時重倉押方向——等待多個指標同步確認後再行動。',
      '不要因為新聞標題就提前押方向——新聞與市場反應之間常有落差。',
      '不要把沒有方向當成沒有風險——震盪區間內仍可能有突發事件改變格局。',
    ],
  };
}

/**
 * Generate a situational "today's rhythm" description
 * that turns marketState into plain-language user guidance.
 */
export function generateRhythmDescription(state: MarketInput): string {
  const phase = state.marketPhase;

  if (phase === 'after_close_verified') {
    return '收盤驗證已完成。回看今日盤前假設與盤中追蹤，確認哪裡對、哪裡需要修正，為明天做好準備。';
  }

  if (phase === 'after_close_pending') {
    return '今日已收盤，等待收盤資料同步完成。先回看盤前劇本與盤中追蹤，收盤驗證結果將在資料同步後補上。';
  }

  if (phase === 'pre_market') {
    return '還在盤前階段，等待 09:00 開盤。盤前劇本只是假設，開盤後以實際資金流向為準。';
  }

  const bias = state.intradayBias;
  switch (bias) {
    case 'risk_off':
      return '台股盤中明顯轉弱，先以風險控管為主，不追空也不急著接刀。確認賣壓消化後再評估。';
    case 'weak_watch':
      return '台股盤中偏弱，短線先觀察權值股是否止穩，不宜過早判定反彈成立。';
    case 'bullish_watch':
      return '台股盤中轉強，但仍需確認權值股與半導體族群是否同步補上確認訊號，不追高是今天最好的策略。';
    default:
      return '台股盤中仍在震盪整理，等待明確方向表態。沒有方向時，觀察本身也是一種有價值的判斷。';
  }
}
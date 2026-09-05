const REASON_LABELS_ZH_TW: Record<string, string> = {
  FOREIGN_5D_ACCUMULATION: "外資近五日累計買超",
  FOREIGN_3D_BUYING: "外資連續三日買超",
  FOREIGN_5D_DISTRIBUTION: "外資近五日轉為賣超",
  FOREIGN_CROSS_SECTIONAL_STRENGTH: "外資買超強度位於資料完整標的前段",
  TRUST_5D_ACCUMULATION: "投信近五日累計買超",
  TRUST_3D_BUYING: "投信連續三日買超",
  TRUST_5D_DISTRIBUTION: "投信近五日轉為賣超",
  TRUST_CROSS_SECTIONAL_STRENGTH: "投信買超強度位於資料完整標的前段",
  INSTITUTIONAL_ALIGNMENT: "外資與投信方向一致",
  DEALER_HEDGE_RECORDED_SEPARATELY: "自營商避險部位已與方向性部位分開計算",
  MA_SHORT_TERM_ALIGNMENT: "短期均線呈多頭排列",
  MA20_UPTREND: "二十日均線維持向上",
  MACD_POSITIVE: "MACD 動能為正",
  RELATIVE_VOLUME_EXPANSION: "相對成交量放大",
  PRICE_20D_BREAKOUT: "價格突破近二十日區間",
  HIGHER_HIGH_HIGHER_LOW: "價格結構呈現高點與低點墊高",
  LOWER_HIGH_LOWER_LOW: "價格結構呈現高點與低點下移",
  HIGH_ATR_RISK: "近期波動風險偏高",
  TAIEX_MA20_ABOVE_MA60: "加權指數中期均線偏多",
  TAIEX_MA20_BELOW_MA60: "加權指數中期均線偏弱",
  TAIEX_ABOVE_MA20: "加權指數位於二十日均線之上",
  TAIEX_BELOW_MA20: "加權指數位於二十日均線之下",
  TAIEX_HIGH_VOLATILITY: "大盤年化波動率偏高",
  TAIEX_VOLUME_EXPANSION: "大盤成交量放大",
  MARKET_BREADTH_UNAVAILABLE: "市場廣度資料尚未完整",
};

export function translateReasonCode(code: string): string {
  return REASON_LABELS_ZH_TW[code] || code;
}

const ABSOLUTE_PRICE_LEVEL = /(?:守住|站穩|穩定在|站上|突破|跌破|高於|低於|回到|接近|落在)\s*(?:新台幣\s*)?[0-9][0-9,]*(?:\.[0-9]+)?\s*元?(?:以上|以下|附近)?/g;
const BARE_TWD_PRICE = /[0-9][0-9,]*(?:\.[0-9]+)?\s*元(?:以上|以下|附近)?/g;

function relativeLevelForPhrase(phrase: string): string {
  if (/跌破|低於/.test(phrase)) return '跌破前一交易日低點';
  if (/站上|突破|高於/.test(phrase)) return '突破前一交易日高點';
  if (/回到|接近|落在/.test(phrase)) return '回到前一交易日主要成交區';
  return '守住前一交易日收盤價';
}
export function sanitizeUnsupportedAbsolutePriceLevels(text: string): string {
  const relative = text.replace(ABSOLUTE_PRICE_LEVEL, (phrase) => relativeLevelForPhrase(phrase));
  return relative.replace(BARE_TWD_PRICE, '前一交易日收盤價');
}

import { formatTaipeiDate, getMarketStatus } from '@/utils/tradingDay';

export type FrontendMarketStatus = 'open' | 'closed';

export interface FrontendMarketDateState {
  today_date: string;
  market_status: FrontendMarketStatus;
  closed_reason: string | null;
}

export function getFrontendMarketDateState(date?: Date): FrontendMarketDateState {
  const today_date = formatTaipeiDate(date);
  const market = getMarketStatus(today_date);
  const closed = market.marketStatus !== 'trading';

  return {
    today_date,
    market_status: closed ? 'closed' : 'open',
    closed_reason: closed ? (market.holidayName || market.statusLabel || '休市') : null,
  };
}

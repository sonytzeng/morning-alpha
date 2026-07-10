import { formatTaipeiDate, resolveMarketStatus, type MarketStatusCode, type SessionType } from '@/utils/tradingDay';

export type FrontendMarketStatus = 'open' | 'closed';

export interface FrontendMarketDateState {
  today_date: string;
  market_status: FrontendMarketStatus;
  closed_reason: string | null;
  resolved_market_status: MarketStatusCode;
  market_message: string;
  next_trading_day: string;
  is_trading_day: boolean;
  session_type: SessionType;
}

export function getFrontendMarketDateState(date?: Date): FrontendMarketDateState {
  const today_date = formatTaipeiDate(date);
  const market = resolveMarketStatus(today_date);
  const closed = market.market_status !== 'OPEN';

  return {
    today_date,
    market_status: closed ? 'closed' : 'open',
    closed_reason: closed ? (market.closed_reason || market.market_message || '休市') : null,
    resolved_market_status: market.market_status,
    market_message: market.market_message,
    next_trading_day: market.next_trading_day,
    is_trading_day: market.is_trading_day,
    session_type: market.session_type,
  };
}

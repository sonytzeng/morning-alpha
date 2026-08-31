function normalizedMarketStatus(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

export function publicMarketCalendarIsConsistent({
  calendarIsTradingDay,
  providerIsTradingDay,
  providerMarketStatus,
} = {}) {
  if (typeof calendarIsTradingDay !== 'boolean' || typeof providerIsTradingDay !== 'boolean') return false;
  if (providerIsTradingDay !== calendarIsTradingDay) return false;

  const status = normalizedMarketStatus(providerMarketStatus);
  if (status !== 'OPEN' && status !== 'CLOSED') return false;

  // A canonical trading date is OPEN before its terminal close evidence and
  // CLOSED after that evidence is recorded. Non-trading dates must stay CLOSED.
  return calendarIsTradingDay || status === 'CLOSED';
}

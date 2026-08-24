function plausibleIsoFromMillis(millis) {
  if (!Number.isFinite(millis) || millis <= 0) return '';
  const parsed = new Date(millis);
  if (Number.isNaN(parsed.getTime())) return '';
  const year = parsed.getUTCFullYear();
  return year >= 2000 && year <= 2100 ? parsed.toISOString() : '';
}

export function normalizeProviderTimestamp(value) {
  if (typeof value === 'string' && value.trim()) {
    const trimmed = value.trim();
    if (!/^\d+(?:\.\d+)?$/.test(trimmed)) {
      const parsed = new Date(trimmed);
      const year = parsed.getUTCFullYear();
      if (!Number.isNaN(parsed.getTime()) && year >= 2000 && year <= 2100) return parsed.toISOString();
      return '';
    }
    value = Number(trimmed);
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '';

  // Current market timestamps are commonly seconds (1e9), milliseconds (1e12),
  // microseconds (1e15), or nanoseconds (1e18). Try the scale implied by magnitude
  // first, then safe fallbacks, and accept only a plausible calendar year.
  const preferred = value >= 1e17
    ? value / 1_000_000
    : value >= 1e14
      ? value / 1_000
      : value >= 1e11
        ? value
        : value * 1_000;
  const candidates = [preferred, value, value * 1_000, value / 1_000, value / 1_000_000];
  for (const millis of [...new Set(candidates.map((candidate) => Math.floor(candidate)))]) {
    const iso = plausibleIsoFromMillis(millis);
    if (iso) return iso;
  }
  return '';
}

export function normalizeConfiguredProxyQuote(quote, config = {}) {
  if (!quote) return null;
  const multiplier = Number(config.directionMultiplier) === -1 ? -1 : 1;
  if (!config.proxySemantics && multiplier === 1) return quote;
  return {
    ...quote,
    change: Number(quote.change || 0) * multiplier,
    changePercent: Number(quote.changePercent || 0) * multiplier,
    raw: {
      ...(quote.raw || {}),
      proxy_symbol: quote.sourceSymbol || null,
      proxy_semantics: config.proxySemantics || 'same_direction',
      direction_multiplier: multiplier,
    },
  };
}

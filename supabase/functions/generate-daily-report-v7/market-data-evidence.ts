export type NormalizedMarketIndicator = {
  symbol: string;
  name: string;
  market: string;
  value: number;
  change: number;
  changePercent: number;
  updatedAt: string;
  status: string;
  taiwanImpact: string;
  hasChangePercent: true;
  hasValue: true;
};

export type NormalizedMarketData = {
  marketData: NormalizedMarketIndicator[];
  latestDataTime: Date | null;
  isStale: boolean;
  dataCount: number;
  rawDataCount: number;
  invalidNumericSources: string[];
};

function marketRowTimestamp(row: Record<string, unknown>): number {
  const parsed = Date.parse(String(row.captured_at ?? row.created_at ?? row.updated_at ?? ''));
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function canonicalMarketRow(row: Record<string, unknown>): Record<string, unknown> {
  const changePercent = finiteNumericValue(row.change_percent);
  return {
    ...row,
    change: row.change_value ?? row.change,
    status: changePercent === null ? row.status : changePercent > 0 ? 'up' : changePercent < 0 ? 'down' : 'flat',
    canonical_source: 'market_quotes',
  };
}

/**
 * Canonical quotes are the production source of truth. Legacy market_data rows
 * remain a compatibility fallback only for symbols that do not yet have a
 * newer canonical observation.
 */
export function mergeCanonicalAndLegacyMarketRows(
  canonicalRows: Record<string, unknown>[],
  legacyRows: Record<string, unknown>[],
): Record<string, unknown>[] {
  const bySymbol = new Map<string, { row: Record<string, unknown>; timestamp: number; canonical: boolean }>();
  const candidates = [
    ...canonicalRows.map((row) => ({ row: canonicalMarketRow(row), canonical: true })),
    ...legacyRows.map((row) => ({ row, canonical: false })),
  ];

  for (const candidate of candidates) {
    const symbol = String(candidate.row.symbol ?? '').trim().toUpperCase();
    if (!symbol) continue;
    const timestamp = marketRowTimestamp(candidate.row);
    const current = bySymbol.get(symbol);
    if (!current || timestamp > current.timestamp || (timestamp === current.timestamp && candidate.canonical && !current.canonical)) {
      bySymbol.set(symbol, { ...candidate, timestamp });
    }
  }

  return Array.from(bySymbol.values())
    .sort((left, right) => right.timestamp - left.timestamp)
    .map(({ row }) => row);
}

function finiteNumericValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeMarketDataRows(
  rows: Record<string, unknown>[],
  now = Date.now(),
  staleAfterMs = 86_400_000,
): NormalizedMarketData {
  const marketData: NormalizedMarketIndicator[] = [];
  const invalidNumericSources = new Set<string>();
  let latestDataTime: Date | null = null;

  for (const row of rows) {
    const symbol = String(row.symbol ?? '').trim();
    const value = finiteNumericValue(row.value);
    const changePercent = finiteNumericValue(row.change_percent);
    const invalidFields: string[] = [];
    if (value === null) invalidFields.push('value');
    if (changePercent === null) invalidFields.push('change_percent');

    if (!symbol || value === null || changePercent === null) {
      invalidNumericSources.add(`${symbol || 'unknown'}:${invalidFields.length > 0 ? invalidFields.join('+') : 'symbol'}`);
      continue;
    }

    const updatedAt = String(row.captured_at ?? row.created_at ?? row.updated_at ?? '');
    const capturedAt = new Date(updatedAt);
    if (updatedAt && Number.isFinite(capturedAt.getTime()) && (!latestDataTime || capturedAt > latestDataTime)) {
      latestDataTime = capturedAt;
    }

    const explicitChange = finiteNumericValue(row.change);
    const change = explicitChange ?? value * changePercent / 100;
    marketData.push({
      symbol,
      name: String(row.name ?? ''),
      market: String(row.market ?? ''),
      value,
      change,
      changePercent,
      updatedAt,
      status: String(row.status ?? 'flat'),
      taiwanImpact: String(row.taiwan_impact ?? ''),
      hasValue: true,
      hasChangePercent: true,
    });
  }

  return {
    marketData,
    latestDataTime,
    isStale: !latestDataTime || now - latestDataTime.getTime() > staleAfterMs,
    dataCount: marketData.length,
    rawDataCount: rows.length,
    invalidNumericSources: Array.from(invalidNumericSources),
  };
}

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

    if (!symbol || invalidFields.length > 0) {
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

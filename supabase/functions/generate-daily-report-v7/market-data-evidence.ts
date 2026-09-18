import { CHECKPOINT_PROVIDER_KEYS } from '../_shared/fetch-checkpoint-evidence.mjs';

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
    if (!updatedAt || !Number.isFinite(capturedAt.getTime()) || capturedAt.getTime() > now) {
      invalidNumericSources.add(`${symbol}:invalid_or_future_timestamp`);
      continue;
    }
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

export const SECTOR_RECONSTRUCTION_VERSION = 'AUTHORITATIVE_CLOSE_MARKET_CHANGE_V1';
export const SECTOR_RECONSTRUCTION_SOURCE = 'authoritative_market_data_snapshots_v1';

export type AuthoritativeCloseRow = {
  symbol: string;
  change_percent: number | string | null;
  captured_at: string | null;
  committed_at: string | null;
  trading_date: string;
  checkpoint: string;
  phase: string;
  batch_id: string | null;
  provider_contract_version: string;
};

export type SectorEvidenceLineage = {
  origin: 'DERIVED_EVIDENCE_RECONSTRUCTION';
  source: typeof SECTOR_RECONSTRUCTION_SOURCE;
  business_date: string;
  checkpoint: '1430';
  batch_id: string;
  provider_contract_version: 'MARKET_CHECKPOINT_PROVIDER_V1';
  algorithm: typeof SECTOR_RECONSTRUCTION_VERSION;
  constituent_symbols: string[];
};

export type ReconstructedSectorRow = {
  sector: string;
  sub_sector: string;
  rotation_score: number;
  direction: 'positive' | 'negative' | 'neutral';
  signal_label: '轉強' | '轉弱' | '觀察' | '無明確優勢';
  leading_symbols: string[];
  lagging_symbols: string[];
  summary: string;
  score_date: string;
  lineage: SectorEvidenceLineage;
};

export type SectorReconstructionResult =
  | { status: 'RECONSTRUCTED'; rows: ReconstructedSectorRow[]; batch_id: string }
  | { status: 'UNAVAILABLE'; rows: []; reason: string };

const SECTORS = [
  { name: '半導體', symbols: ['2330', 'TSM', 'NVDA', 'SOX'] },
  { name: 'AI伺服器', symbols: ['NVDA', 'AMD', 'SMCI', '2382', '3231', '6669'] },
  { name: '電子權值', symbols: ['2330', '2317', '2454', '2308'] },
  { name: '金融', symbols: ['2881', '2882', '2884', '2886', '2891'] },
  { name: '航運', symbols: ['2603', '2609', '2615'] },
  { name: '觀光餐飲', symbols: ['2727', '2707', '2753'] },
  { name: '大盤', symbols: ['TAIEX', 'TXF', '^TWII'] },
] as const;

const unavailable = (reason: string): SectorReconstructionResult => ({ status: 'UNAVAILABLE', rows: [], reason });
const round = (value: number, digits = 1): number => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};

/** Research-only derivation. Never persists a historical score or treats it as
 * the sector-rotation producer's original published result. */
export function reconstructSectorRotationFromAuthoritativeClose(
  input: readonly AuthoritativeCloseRow[],
  businessDate: string,
): SectorReconstructionResult {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) return unavailable('INVALID_BUSINESS_DATE');
  if (input.length !== CHECKPOINT_PROVIDER_KEYS.length) return unavailable('CLOSE_BATCH_NOT_11');
  const expected = new Set<string>(CHECKPOINT_PROVIDER_KEYS);
  const bySymbol = new Map<string, { symbol: string; change: number }>();
  let batchId: string | null = null;
  let committedAt: number | null = null;
  for (const row of input) {
    const symbol = String(row.symbol || '').trim().toUpperCase();
    if (!expected.has(symbol) || bySymbol.has(symbol)) return unavailable('CLOSE_PROVIDER_SET_INVALID');
    if (row.trading_date !== businessDate || row.checkpoint !== '1430' || row.phase !== 'close'
      || row.provider_contract_version !== 'MARKET_CHECKPOINT_PROVIDER_V1' || !row.batch_id) {
      return unavailable('CLOSE_LINEAGE_INVALID');
    }
    if (batchId !== null && row.batch_id !== batchId) return unavailable('MIXED_CLOSE_BATCH');
    batchId = row.batch_id;
    const committed = Date.parse(String(row.committed_at || ''));
    const captured = Date.parse(String(row.captured_at || ''));
    if (!Number.isFinite(committed) || !Number.isFinite(captured) || captured > committed
      || (committedAt !== null && committedAt !== committed)) return unavailable('CLOSE_TIMESTAMP_INVALID');
    if (['TAIEX', '2330', 'TXF'].includes(symbol)
      && (captured < Date.parse(`${businessDate}T05:00:00Z`)
        || captured > Date.parse(`${businessDate}T07:30:00Z`))) {
      return unavailable('TAIWAN_CLOSE_EVIDENCE_STALE');
    }
    committedAt = committed;
    const change = row.change_percent === null || row.change_percent === '' ? NaN : Number(row.change_percent);
    if (!Number.isFinite(change)) return unavailable('CLOSE_CHANGE_INVALID');
    bySymbol.set(symbol, { symbol, change });
  }
  if (bySymbol.size !== expected.size || ![...expected].every(key => bySymbol.has(key))) {
    return unavailable('CLOSE_PROVIDER_SET_INVALID');
  }

  const rows: ReconstructedSectorRow[] = [];
  for (const sector of SECTORS) {
    const constituents = sector.symbols.flatMap(symbol => bySymbol.has(symbol) ? [bySymbol.get(symbol)!] : []);
    if (constituents.length === 0) continue;
    const average = constituents.reduce((sum, item) => sum + item.change, 0) / constituents.length;
    const sorted = [...constituents].sort((left, right) => right.change - left.change || left.symbol.localeCompare(right.symbol));
    const leading = sorted.filter(item => item.change >= average).map(item => item.symbol);
    const lagging = sorted.filter(item => item.change < average).map(item => item.symbol);
    const score = round(Math.max(0, Math.min(100, 50 + average * 10)));
    const direction = average >= 0.5 ? 'positive' : average <= -0.5 ? 'negative' : 'neutral';
    const signal = average >= 0.8 ? '轉強' : average <= -0.8 ? '轉弱'
      : Math.abs(average) >= 0.3 ? '觀察' : '無明確優勢';
    rows.push({
      sector: sector.name,
      sub_sector: sector.name,
      rotation_score: score,
      direction,
      signal_label: signal,
      leading_symbols: leading.length ? leading : [sorted[0].symbol],
      lagging_symbols: lagging,
      summary: `由 ${businessDate} 權威 14:30 收盤批次的 ${sorted.map(item => `${item.symbol} ${round(item.change, 2)}%`).join('、')} 重建研究用族群脈絡；平均漲跌幅 ${round(average, 2)}%，非當日正式 sector_rotation_scores。`,
      score_date: businessDate,
      lineage: {
        origin: 'DERIVED_EVIDENCE_RECONSTRUCTION',
        source: SECTOR_RECONSTRUCTION_SOURCE,
        business_date: businessDate,
        checkpoint: '1430',
        batch_id: batchId!,
        provider_contract_version: 'MARKET_CHECKPOINT_PROVIDER_V1',
        algorithm: SECTOR_RECONSTRUCTION_VERSION,
        constituent_symbols: sorted.map(item => item.symbol),
      },
    });
  }
  if (!rows.length) return unavailable('NO_MAPPED_SECTOR_EVIDENCE');
  rows.sort((left, right) => right.rotation_score - left.rotation_score || left.sector.localeCompare(right.sector));
  return { status: 'RECONSTRUCTED', rows, batch_id: batchId! };
}

type IntradayLike = Record<string, unknown> | null | undefined;

function taipeiParts(date: Date): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '00';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function firstString(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (value !== null && value !== undefined && String(value).trim()) return String(value).trim();
  }
  return '';
}

function parseTimestamp(value: string): Date | null {
  if (!value || /^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function hasPreviousCloseSource(radar: Record<string, unknown>, reportAI: Record<string, unknown>): boolean {
  const text = [
    radar.data_source,
    radar.source,
    radar.data_basis,
    radar.basis,
    radar.basis_date,
    reportAI.tw_core_date,
    reportAI.market_data_latest_date,
    reportAI.latest_trading_date,
  ].map((v) => String(v || '').toLowerCase()).join(' ');

  return text.includes('previous close')
    || text.includes('previous_close')
    || text.includes('reports.ai_strategy_json.opening_radar')
    || text.includes('ai_strategy_json.opening_radar')
    || text.includes('tw_core')
    || text.includes('latest_trading_date')
    || text.includes('latest trading')
    || text.includes('premarket');
}

export type IntradayFreshnessResult = {
  fresh: boolean;
  timestamp: string | null;
  timestampLabel: string | null;
  reason: string;
};

export function isFreshIntradayData(
  report: IntradayLike,
  radarInput: IntradayLike,
  nowTaipei: Date = new Date(),
): IntradayFreshnessResult {
  const rpt = asRecord(report);
  const ai = asRecord(rpt.ai_strategy_json);
  const radar = asRecord(radarInput);
  const today = taipeiParts(nowTaipei).date;
  const reportDate = String(rpt.report_date || radar.report_date || '');

  if (reportDate !== today) {
    return { fresh: false, timestamp: null, timestampLabel: null, reason: 'REPORT_DATE_NOT_TODAY' };
  }
  if (Object.keys(radar).length === 0) {
    return { fresh: false, timestamp: null, timestampLabel: null, reason: 'NO_INTRADAY_SOURCE' };
  }

  const timestamp = firstString(radar, ['checked_at', 'captured_at', 'updated_at', 'generated_at', 'created_at']);
  const parsed = parseTimestamp(timestamp);
  if (!parsed) {
    return { fresh: false, timestamp: null, timestampLabel: null, reason: 'NO_INTRADAY_TIMESTAMP' };
  }

  const parts = taipeiParts(parsed);
  if (parts.date !== today) {
    return { fresh: false, timestamp, timestampLabel: null, reason: 'INTRADAY_TIMESTAMP_NOT_TODAY' };
  }
  if (parts.minutes < 9 * 60) {
    return { fresh: false, timestamp, timestampLabel: `${parts.date} ${String(Math.floor(parts.minutes / 60)).padStart(2, '0')}:${String(parts.minutes % 60).padStart(2, '0')}`, reason: 'BEFORE_TAIWAN_OPEN' };
  }
  if (hasPreviousCloseSource(radar, ai)) {
    return { fresh: false, timestamp, timestampLabel: `${parts.date} ${String(Math.floor(parts.minutes / 60)).padStart(2, '0')}:${String(parts.minutes % 60).padStart(2, '0')}`, reason: 'PREVIOUS_CLOSE_SOURCE' };
  }

  return {
    fresh: true,
    timestamp,
    timestampLabel: `${parts.date} ${String(Math.floor(parts.minutes / 60)).padStart(2, '0')}:${String(parts.minutes % 60).padStart(2, '0')}`,
    reason: 'FRESH_INTRADAY_DATA',
  };
}

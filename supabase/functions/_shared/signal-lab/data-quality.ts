import type {
  CorporateActionInput,
  DataQualityIssue,
  DataQualityResult,
  InstitutionalFlowInput,
  OhlcvBar,
} from "./types.ts";
import { clamp, normalizeSymbol, round } from "./normalization.ts";

export interface DataQualityGateInput {
  signalTimestamp: string;
  bars: OhlcvBar[];
  institutionalFlows: InstitutionalFlowInput[];
  corporateActions?: CorporateActionInput[];
  eligibleSymbols: string[];
  completeSymbols: string[];
  requiredBars?: number;
  maximumInstitutionalAgeHours?: number;
  tradingCalendarStatus: "ready" | "unavailable";
  expectedTradingDates: string[];
}

function timestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function issue(code: string, severity: "warning" | "blocking", bar?: Pick<OhlcvBar, "symbol" | "tradingDate">): DataQualityIssue {
  return { code, severity, symbol: bar?.symbol, tradingDate: bar?.tradingDate };
}

export function runDataQualityGate(input: DataQualityGateInput): DataQualityResult {
  const issues: DataQualityIssue[] = [];
  const signalTime = timestamp(input.signalTimestamp);
  if (signalTime === null) issues.push(issue("INVALID_SIGNAL_TIMESTAMP", "blocking"));

  const seen = new Set<string>();
  const barsBySymbol = new Map<string, OhlcvBar[]>();
  for (const bar of input.bars) {
    const symbol = normalizeSymbol(bar.symbol);
    const key = `${symbol}:${bar.tradingDate}`;
    if (seen.has(key)) issues.push(issue("DUPLICATE_OHLCV_BAR", "blocking", bar));
    seen.add(key);

    const availableTime = timestamp(bar.availableAt);
    if (availableTime === null) issues.push(issue("INVALID_AVAILABLE_AT", "blocking", bar));
    else if (signalTime !== null && availableTime > signalTime) issues.push(issue("LOOK_AHEAD_INPUT", "blocking", bar));

    const values = [bar.open, bar.high, bar.low, bar.close, bar.volume];
    if (values.some((value) => !Number.isFinite(value))) issues.push(issue("NON_FINITE_OHLCV", "blocking", bar));
    if (bar.open <= 0 || bar.high <= 0 || bar.low <= 0 || bar.close <= 0) issues.push(issue("NON_POSITIVE_PRICE", "blocking", bar));
    if (bar.volume < 0) issues.push(issue("NEGATIVE_VOLUME", "blocking", bar));
    if (bar.high < Math.max(bar.open, bar.close, bar.low) || bar.low > Math.min(bar.open, bar.close, bar.high)) {
      issues.push(issue("IMPOSSIBLE_OHLC", "blocking", bar));
    }

    const rows = barsBySymbol.get(symbol) || [];
    rows.push(bar);
    barsBySymbol.set(symbol, rows);
  }

  const requiredBars = input.requiredBars ?? 60;
  for (const symbol of input.eligibleSymbols.map(normalizeSymbol)) {
    if ((barsBySymbol.get(symbol) || []).length < requiredBars) {
      issues.push({ code: "INSUFFICIENT_PRICE_HISTORY", severity: "blocking", symbol });
    }
  }

  if (input.tradingCalendarStatus !== "ready" || input.expectedTradingDates.length === 0) {
    issues.push(issue("TRADING_CALENDAR_UNAVAILABLE", "blocking"));
  } else {
    const expected = new Set(input.expectedTradingDates);
    for (const [symbol, bars] of barsBySymbol) {
      const dates = new Set(bars.map((bar) => bar.tradingDate));
      if ([...expected].some((date) => !dates.has(date))) {
        issues.push({ code: "MISSING_TRADING_DATE", severity: "blocking", symbol });
      }
    }
  }

  const institutionalKeys = new Set<string>();
  const latestInstitutionalAvailableAt = new Map<string, { time: number; flow: InstitutionalFlowInput }>();
  const maximumAgeMs = (input.maximumInstitutionalAgeHours ?? 36) * 60 * 60 * 1000;
  for (const flow of input.institutionalFlows) {
    const symbol = normalizeSymbol(flow.symbol);
    const key = `${symbol}:${flow.tradingDate}:${flow.institutionType}`;
    if (institutionalKeys.has(key)) {
      issues.push({ code: "DUPLICATE_INSTITUTIONAL_FLOW", severity: "blocking", symbol, tradingDate: flow.tradingDate });
    }
    institutionalKeys.add(key);
    const availableTime = timestamp(flow.availableAt);
    if (availableTime === null) {
      issues.push({ code: "INVALID_INSTITUTIONAL_AVAILABLE_AT", severity: "blocking", symbol, tradingDate: flow.tradingDate });
    } else if (signalTime !== null && availableTime > signalTime) {
      issues.push({ code: "LOOK_AHEAD_INSTITUTIONAL_INPUT", severity: "blocking", symbol, tradingDate: flow.tradingDate });
    } else {
      const seriesKey = `${symbol}:${flow.institutionType}`;
      const latest = latestInstitutionalAvailableAt.get(seriesKey);
      if (!latest || availableTime > latest.time) latestInstitutionalAvailableAt.set(seriesKey, { time: availableTime, flow });
    }
  }
  if (signalTime !== null) {
    for (const { time, flow } of latestInstitutionalAvailableAt.values()) {
      if (signalTime - time > maximumAgeMs) {
        issues.push({ code: "STALE_INSTITUTIONAL_DATA", severity: "blocking", symbol: normalizeSymbol(flow.symbol), tradingDate: flow.tradingDate });
      }
    }
  }
  const institutionalBySeries = new Map<string, InstitutionalFlowInput[]>();
  for (const flow of input.institutionalFlows) {
    const key = `${normalizeSymbol(flow.symbol)}:${flow.institutionType}`;
    const rows = institutionalBySeries.get(key) || [];
    rows.push(flow);
    institutionalBySeries.set(key, rows);
  }
  for (const symbol of input.eligibleSymbols.map(normalizeSymbol)) {
    for (const institutionType of ["foreign", "trust"] as const) {
      const rows = (institutionalBySeries.get(`${symbol}:${institutionType}`) || []).sort((a, b) => b.tradingDate.localeCompare(a.tradingDate));
      if (rows.length < 20) {
        issues.push({ code: "INSUFFICIENT_INSTITUTIONAL_HISTORY", severity: "blocking", symbol });
        continue;
      }
      const latest = rows[0];
      if (!Number.isFinite(latest.marketVolume) || (latest.marketVolume || 0) <= 0 || !Number.isFinite(latest.averageVolume20d) || (latest.averageVolume20d || 0) <= 0) {
        issues.push({ code: "INSTITUTIONAL_DENOMINATOR_MISSING", severity: "blocking", symbol, tradingDate: latest.tradingDate });
      }
    }
  }

  for (const action of input.corporateActions || []) {
    const availableTime = timestamp(action.availableAt);
    if (availableTime !== null && signalTime !== null && availableTime > signalTime) {
      issues.push({ code: "FUTURE_CORPORATE_ACTION_KNOWLEDGE", severity: "blocking", symbol: normalizeSymbol(action.symbol), tradingDate: action.actionDate });
    }
    if (!action.resolved) {
      issues.push({ code: "UNRESOLVED_CORPORATE_ACTION", severity: "blocking", symbol: normalizeSymbol(action.symbol), tradingDate: action.actionDate });
    }
  }

  const eligible = new Set(input.eligibleSymbols.map(normalizeSymbol));
  const complete = new Set(input.completeSymbols.map(normalizeSymbol).filter((symbol) => eligible.has(symbol)));
  const coverageRatio = eligible.size > 0 ? complete.size / eligible.size : 0;
  if (eligible.size === 0) issues.push(issue("UNIVERSE_UNAVAILABLE", "blocking"));
  if (coverageRatio < 0.7) issues.push(issue("COVERAGE_BELOW_MINIMUM", "blocking"));
  else if (coverageRatio < 0.9) issues.push(issue("COVERAGE_DEGRADED", "warning"));

  const blocking = issues.some((entry) => entry.severity === "blocking");
  const status = blocking ? "blocked" : issues.length > 0 ? "degraded" : "ready";
  return {
    status,
    eligibleUniverse: eligible.size,
    analyzedCount: barsBySymbol.size,
    completeCount: complete.size,
    coverageRatio: round(clamp(coverageRatio, 0, 1)),
    issues,
    reasonCodes: [...new Set(issues.map((entry) => entry.code))].sort(),
  };
}

export function assertPointInTime<T extends { availableAt: string }>(rows: T[], signalTimestamp: string): T[] {
  const signalTime = timestamp(signalTimestamp);
  if (signalTime === null) throw new Error("INVALID_SIGNAL_TIMESTAMP");
  return rows.filter((row) => {
    const availableTime = timestamp(row.availableAt);
    return availableTime !== null && availableTime <= signalTime;
  });
}

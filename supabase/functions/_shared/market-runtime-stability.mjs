function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asRows(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeSymbol(value) {
  return String(value || '').trim().toUpperCase();
}

function readStockSymbol(value) {
  const row = asRecord(value);
  return normalizeSymbol(row.symbol || row.ticker || row.stock_code || row.stock_id);
}

function readStockName(value) {
  const row = asRecord(value);
  return String(row.name || row.stock_name || row.company_name || '').trim();
}

function isTaiwanStockSymbol(symbol) {
  return /^\d{4,6}$/.test(symbol);
}

function uniqueSymbols(values) {
  return [...new Set(asRows(values).map(normalizeSymbol).filter(Boolean))];
}

function taipeiDateFromMillis(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const read = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${read('year')}-${read('month')}-${read('day')}`;
}

function taipeiMinutesFromMillis(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(value));
  const read = (type) => parts.find((part) => part.type === type)?.value || '';
  return Number(read('hour')) * 60 + Number(read('minute'));
}

export function sanitizeProviderError(value) {
  return String(value || '')
    .replace(/([?&](?:token|api[-_]?key|apiToken|access[-_]?token|key)=)[^&\s"']+/gi, '$1[REDACTED]')
    .replace(/((?:["']?)(?:token|api[-_]?key|apiToken|access[-_]?token)(?:["']?)\s*[:=]\s*["']?)[^"',}\s]+/gi, '$1[REDACTED]')
    .replace(/(bearer\s+)[A-Za-z0-9._~-]+/gi, '$1[REDACTED]')
    .replace(/(x-api-key["':=\s]+)[A-Za-z0-9._~-]+/gi, '$1[REDACTED]')
    .slice(0, 1000);
}

export function isV10BeneficiaryEnabled(ai) {
  const row = asRecord(ai);
  return row.v10_beneficiary_enabled === true || String(row.v10_beneficiary_enabled || '').toLowerCase() === 'true';
}

export function evaluateCheckpointFreshness(input = {}) {
  const capturedAt = String(input.captured_at || '').trim();
  const capturedMs = Date.parse(capturedAt);
  const evaluatedAt = String(input.evaluated_at || '').trim();
  const evaluatedMs = evaluatedAt ? Date.parse(evaluatedAt) : Date.now();
  const market = String(input.market || '').trim().toUpperCase();
  const phase = String(input.phase || '').trim().toLowerCase();
  const symbol = normalizeSymbol(input.symbol);
  const tradingDate = String(input.trading_date || '').trim();

  if (!capturedAt || !Number.isFinite(capturedMs) || !Number.isFinite(evaluatedMs)) {
    return { valid: false, status: 'invalid_timestamp', age_minutes: null, captured_session_date: null };
  }
  const ageMinutes = Math.round(((evaluatedMs - capturedMs) / 60_000) * 10) / 10;
  if (capturedMs > evaluatedMs + 10 * 60_000) {
    return { valid: false, status: 'future_timestamp', age_minutes: ageMinutes, captured_session_date: taipeiDateFromMillis(capturedMs) };
  }

  if (market === 'TW' && (phase === 'intraday' || phase === 'close')) {
    const capturedSessionDate = taipeiDateFromMillis(capturedMs);
    if (!tradingDate || capturedSessionDate !== tradingDate) {
      return { valid: false, status: 'cross_session_stale', age_minutes: ageMinutes, captured_session_date: capturedSessionDate };
    }
    if (['TAIEX', '2330', 'TXF'].includes(symbol)) {
      if (phase === 'close') {
        const capturedMinutes = taipeiMinutesFromMillis(capturedMs);
        const officialCloseFloor = symbol === 'TXF' ? 13 * 60 + 40 : 13 * 60 + 25;
        if (capturedMinutes < officialCloseFloor) {
          return { valid: false, status: 'pre_close_timestamp', age_minutes: ageMinutes, captured_session_date: capturedSessionDate };
        }
        return { valid: true, status: 'official_close', age_minutes: ageMinutes, captured_session_date: capturedSessionDate };
      }
      if (ageMinutes > 30) {
        return { valid: false, status: 'checkpoint_stale', age_minutes: ageMinutes, captured_session_date: capturedSessionDate };
      }
    }
    return { valid: true, status: 'fresh', age_minutes: ageMinutes, captured_session_date: capturedSessionDate };
  }

  return {
    valid: true,
    status: 'provider_returned',
    age_minutes: ageMinutes,
    captured_session_date: taipeiDateFromMillis(capturedMs),
  };
}

export function buildBeneficiaryBatchContract(ai, options = {}) {
  const row = asRecord(ai);
  const v10Enabled = isV10BeneficiaryEnabled(row);
  const sourceRows = v10Enabled
    ? asRows(row.today_beneficiary_stocks_v10)
    : [
      ...asRows(row.today_beneficiary_stocks),
      ...asRows(row.beneficiary_stocks),
      ...asRows(row.core_beneficiary_stocks),
    ];
  const existing = new Set(uniqueSymbols(options.existingSymbols));
  const seen = new Set();
  const maxSymbols = Math.max(0, Number(options.maxSymbols) || 12);
  const configs = [];
  let invalidRowCount = 0;

  for (const item of sourceRows) {
    const symbol = readStockSymbol(item);
    if (!symbol || !isTaiwanStockSymbol(symbol)) {
      invalidRowCount += 1;
      continue;
    }
    if (existing.has(symbol) || seen.has(symbol)) continue;
    seen.add(symbol);
    configs.push({
      finnhubSymbol: symbol,
      displaySymbol: symbol,
      name: readStockName(item) || symbol,
      market: 'TW',
      taiwanImpact: '今日受惠股收盤驗證資料',
    });
    if (configs.length >= maxSymbols) break;
  }

  const decisionMode = configs.length > 0
    ? 'recommendations'
    : v10Enabled && sourceRows.length === 0
      ? 'no_trade'
      : 'blocked';

  return {
    configs,
    decision_mode: decisionMode,
    contract_valid: decisionMode !== 'blocked',
    source_field: v10Enabled ? 'today_beneficiary_stocks_v10' : 'legacy_beneficiary_stocks',
    v10_enabled: v10Enabled,
    source_row_count: sourceRows.length,
    invalid_row_count: invalidRowCount,
  };
}

export function classifyProviderFailure(detail) {
  const failure = asRecord(detail);
  const status = Number(failure.status);
  const error = String(failure.error || '').toLowerCase();
  const subscriptionSignal = status === 402 || status === 403 ||
    /subscription|entitlement|not[ _-]?entitled|plan[ _-]?required|permission[ _-]?denied|insufficient[ _-]?scope/.test(error);
  let failureCode = 'UNKNOWN_PROVIDER_FAILURE';
  let retryable = false;

  if (error.includes('missing_api_key') || error.includes('not configured')) {
    failureCode = 'CONFIGURATION_MISSING';
  } else if (subscriptionSignal) {
    failureCode = 'BLOCKED_BY_SUBSCRIPTION';
  } else if (status === 401) {
    failureCode = 'AUTHENTICATION_FAILED';
  } else if (status === 429) {
    failureCode = 'RATE_LIMITED';
    retryable = true;
  } else if (status >= 500 && status <= 599) {
    failureCode = 'PROVIDER_UNAVAILABLE';
    retryable = true;
  } else if (error.includes('cannot_resolve_active_txf_contract')) {
    failureCode = 'CONTRACT_MAPPING_FAILED';
  } else if (error.includes('provider_timestamp') || error.includes('checkpoint_stale') || error.includes('cross_session_stale')) {
    failureCode = 'STALE_PROVIDER_DATA';
    retryable = true;
  } else if (error.includes('timeout') || error.includes('abort')) {
    failureCode = 'TIMEOUT';
    retryable = true;
  } else if (error.includes('all_zero_quote')) {
    failureCode = 'UNSUPPORTED_OR_EMPTY_SYMBOL';
  } else if (Number.isFinite(status) && status >= 400) {
    failureCode = 'PROVIDER_REQUEST_REJECTED';
  } else if (error) {
    failureCode = 'PROVIDER_TRANSPORT_ERROR';
    retryable = true;
  }

  return {
    ...failure,
    failure_code: failureCode,
    retryable,
  };
}

export function classifyProviderFailures(details) {
  return asRows(details).map(classifyProviderFailure);
}

export function buildBeneficiaryCloseStatus(input = {}) {
  const lookupStatus = String(input.lookup_status || 'not_requested');
  const decisionMode = String(input.decision_mode || 'blocked');
  const contractValid = input.contract_valid === true;
  const requested = uniqueSymbols(input.requested_symbols);
  const inserted = new Set(uniqueSymbols(input.inserted_symbols));
  const snapshots = new Set(uniqueSymbols(input.snapshot_symbols));
  const canonical = new Set(uniqueSymbols(input.canonical_symbols));
  const succeeded = requested.filter((symbol) => inserted.has(symbol) && snapshots.has(symbol) && canonical.has(symbol));
  const failed = requested.filter((symbol) => !succeeded.includes(symbol));

  if (lookupStatus === 'not_requested') {
    return {
      status: 'NOT_REQUESTED',
      complete: false,
      lookup_status: lookupStatus,
      decision_mode: decisionMode,
      contract_valid: contractValid,
      requested_count: 0,
      succeeded_count: 0,
      failed_count: 0,
      requested_symbols: [],
      succeeded_symbols: [],
      failed_symbols: [],
    };
  }

  if (lookupStatus !== 'loaded') {
    return {
      status: 'LOOKUP_FAILED',
      complete: false,
      lookup_status: lookupStatus,
      decision_mode: decisionMode,
      contract_valid: contractValid,
      requested_count: requested.length,
      succeeded_count: succeeded.length,
      failed_count: failed.length,
      requested_symbols: requested,
      succeeded_symbols: succeeded,
      failed_symbols: failed,
    };
  }

  if (decisionMode === 'no_trade' && contractValid) {
    return {
      status: 'NOT_APPLICABLE_NO_RECOMMENDATIONS',
      complete: true,
      lookup_status: lookupStatus,
      decision_mode: decisionMode,
      contract_valid: contractValid,
      requested_count: 0,
      succeeded_count: 0,
      failed_count: 0,
      requested_symbols: [],
      succeeded_symbols: [],
      failed_symbols: [],
    };
  }

  if (decisionMode === 'blocked' && contractValid) {
    return {
      status: 'NOT_APPLICABLE_BLOCKED_DECISION',
      complete: true,
      lookup_status: lookupStatus,
      decision_mode: decisionMode,
      contract_valid: contractValid,
      requested_count: 0,
      succeeded_count: 0,
      failed_count: 0,
      requested_symbols: [],
      succeeded_symbols: [],
      failed_symbols: [],
    };
  }

  if (decisionMode !== 'recommendations' || requested.length === 0 || !contractValid) {
    return {
      status: 'BLOCKED_INVALID_RECOMMENDATION_CONTRACT',
      complete: false,
      lookup_status: lookupStatus,
      decision_mode: decisionMode,
      contract_valid: contractValid,
      requested_count: requested.length,
      succeeded_count: succeeded.length,
      failed_count: failed.length,
      requested_symbols: requested,
      succeeded_symbols: succeeded,
      failed_symbols: failed,
    };
  }

  const complete = failed.length === 0;
  return {
    status: complete ? 'COMPLETE' : succeeded.length > 0 ? 'PARTIAL' : 'FAILED',
    complete,
    lookup_status: lookupStatus,
    decision_mode: decisionMode,
    contract_valid: contractValid,
    requested_count: requested.length,
    succeeded_count: succeeded.length,
    failed_count: failed.length,
    requested_symbols: requested,
    succeeded_symbols: succeeded,
    failed_symbols: failed,
  };
}

// One taxonomy for transport, adapters, health, retry and offline replay.
// Classification never includes response bodies, URLs with credentials, or tokens.
export const FAILURE_CONTRACT_VERSION = 'PROVIDER_FAILURE_V2';
const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
export function classifyCanonicalFailure(input = {}) {
  const row = record(input);
  const status = Number(row.status);
  const reason = [row.evidence_error, row.failure_code, row.error].filter(Boolean).join(' ').toUpperCase();
  let code = 'PROVIDER_INVALID_RESPONSE';
  let retryable = false;
  if ([401, 402, 403].includes(status) || /ENTITLEMENT|SUBSCRIPTION|AUTHENTICATION|INVALID_CREDENTIAL|CONFIGURATION_MISSING|MISSING_API_KEY/.test(reason)) {
    code = 'PROVIDER_ENTITLEMENT';
  } else if (status === 429 || /RATE_LIMIT/.test(reason)) {
    code = 'PROVIDER_RATE_LIMIT'; retryable = true;
  } else if ((status >= 500 && status <= 599) || /PROVIDER_HTTP_5XX/.test(reason)) {
    code = 'PROVIDER_HTTP_5XX'; retryable = true;
  } else if (/TIMEOUT|ABORT/.test(reason)) {
    code = 'PROVIDER_TIMEOUT'; retryable = true;
  } else if (status >= 400 && status < 500) {
    code = 'PROVIDER_INVALID_RESPONSE';
  } else if (/STALE|SESSION_DATE_MISMATCH|INVALID_CHECKPOINT_SOURCE_TIME/.test(reason)) {
    code = 'PROVIDER_STALE_SESSION';
  } else if (/PROVIDER_DATA_NOT_READY|TEMPORARY_MALFORMED_RESPONSE|PROVIDER_TRANSPORT_ERROR|PROVIDER_UNAVAILABLE/.test(reason)) {
    // A missing assembled row is a consequence of this observed transport
    // failure, never a replacement for it.
    retryable = !/FUTURE|INVALID_CREDENTIAL|CONTRACT_INVALID|SYMBOL_INVALID|RESOURCE_NOT_FOUND/.test(reason);
  } else if (/ATOMIC.*CARDINALITY/.test(reason) || (/ATOMIC_PROVIDER_RESULT_MISSING/.test(reason) && row.endpoint === 'atomic_checkpoint_assembly')) {
    code = 'ATOMIC_CARDINALITY';
  } else if (/ATOMIC/.test(reason)) {
    code = 'ATOMIC_ROW_CONTRACT';
  } else if (/RESEARCH/.test(reason)) {
    code = 'RESEARCH_QUALITY';
  } else if (/PUBLICATION|MARKET_REPORT_NOT_ELIGIBLE/.test(reason)) {
    code = 'PUBLICATION_CONTRACT';
  } else if (/LIFECYCLE|STATE_TRANSITION/.test(reason)) {
    code = 'LIFECYCLE_STATE';
  }
  return { ...row, failure_code: code, retryable, retry_class: retryable ? 'RETRYABLE' : 'NON_RETRYABLE',
    failure_contract: FAILURE_CONTRACT_VERSION };
}

/** @param {unknown[]} failures @param {string|null} secondary */
export function selectPrimaryFailure(failures, secondary = null) {
  const classified = (Array.isArray(failures) ? failures : []).map(classifyCanonicalFailure);
  const providers = classified.filter(row => String(row.failure_code).startsWith('PROVIDER_'));
  const primary = providers.find(row => !row.retryable) || providers[0] || classified[0];
  return { primary: primary?.failure_code || secondary, secondary: primary && secondary ? [secondary] : [] };
}

export function evaluateProviderRetryEntry({ phase, atomicBatchId, failures, observedAt, tradingDate }) {
  const ms = Date.parse(String(observedAt || ''));
  if (!Number.isFinite(ms)) return { waiting: false, state: 'NON_RETRYABLE' };
  const local = new Date(ms + 8 * 3600000).toISOString();
  const minutes = Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16));
  const classified = (Array.isArray(failures) ? failures : []).map(classifyCanonicalFailure);
  const providers = classified.filter(row => row.endpoint !== 'atomic_checkpoint_assembly');
  const failedSymbols = new Set(providers.map(row => row.symbol));
  const unexplainedAtomic = classified.some(row => row.endpoint === 'atomic_checkpoint_assembly' && !failedSymbols.has(row.symbol));
  const eligible = phase === 'premarket' && !atomicBatchId && local.slice(0, 10) === tradingDate &&
    providers.length > 0 && providers.every(row => row.retryable === true) && !unexplainedAtomic;
  return { waiting: eligible && minutes < 525, state: eligible ? minutes < 525 ? 'WAITING_FOR_PROVIDER_DATA' : 'FINAL_FAIL' : 'NON_RETRYABLE' };
}

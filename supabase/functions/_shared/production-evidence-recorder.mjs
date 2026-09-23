import {
  CHECKPOINT_PROVIDER_CONTRACT_VERSION,
  validateAtomicCheckpointEvidenceRows,
} from './fetch-checkpoint-evidence.mjs';
import {
  describeProductionResponseShape,
  REQUIRED_PROVIDER_CONTRACT_VERSION,
  sanitizeProductionMarketPayload,
  stableJson,
} from './provider-reliability-contract.mjs';
import {
  classifyRequiredProviderFailure,
  normalizeRequiredFinnhubQuote,
  normalizeRequiredFugleQuote,
  normalizeRequiredTaiwanCoreQuote,
  requiredProviderSlot,
  resolveRequiredTxfQuote,
  validateRequiredProviderEvidence,
} from './required-provider-validation.mjs';
import {
  resolveFugle2330Provider,
  resolveFugleTaiexProvider,
} from './fugle-taiex-provider.mjs';

export const PRODUCTION_EVIDENCE_RECORDER_VERSION = 'PRODUCTION_EVIDENCE_RECORDER_V1';
export const PRODUCTION_EVIDENCE_REPLAY_VERSION = 'PRODUCTION_PROVIDER_REPLAY_V1';
export const PRODUCTION_EVIDENCE_RETENTION_DAYS = 90;
export const PRODUCTION_EVIDENCE_MAX_ROWS = 11;
export const PRODUCTION_EVIDENCE_WRITE_TIMEOUT_MS = 1_500;

const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const finite = value => Number.isFinite(Number(value));
const secretKey = /authorization|cookie|secret|token|api[-_]?key|password|service[-_]?role|recipient|email|phone|member|profile|session[-_]?token/i;
const emailValue = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function boundedSafeValue(value, depth = 0) {
  if (depth > 5) return '[TRUNCATED]';
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    if (emailValue.test(value.trim())) return '[REDACTED]';
    return value.slice(0, 1_000);
  }
  if (Array.isArray(value)) return value.slice(0, 20).map(item => boundedSafeValue(item, depth + 1));
  const entries = Object.entries(record(value)).slice(0, 100)
    .filter(([key]) => !secretKey.test(key))
    .map(([key, entry]) => [key, boundedSafeValue(entry, depth + 1)]);
  return Object.fromEntries(entries);
}

export function sanitizeRecordedEvidence(value) {
  return boundedSafeValue(value);
}

export function recordedEvidenceContainsSensitiveData(value) {
  let found = false;
  const visit = input => {
    if (found || input === null || input === undefined) return;
    if (typeof input === 'string') {
      if (emailValue.test(input.trim())) found = true;
      return;
    }
    if (Array.isArray(input)) {
      input.forEach(visit);
      return;
    }
    for (const [key, entry] of Object.entries(record(input))) {
      if (secretKey.test(key)) {
        found = true;
        return;
      }
      visit(entry);
    }
  };
  visit(value);
  return found;
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function safeNormalizedQuote(quote) {
  const source = record(quote);
  if (!source.provider && !source.capturedAt && !finite(source.value)) return null;
  return sanitizeRecordedEvidence({
    value: finite(source.value) ? Number(source.value) : null,
    change: finite(source.change) ? Number(source.change) : null,
    changePercent: finite(source.changePercent) ? Number(source.changePercent) : null,
    capturedAt: source.capturedAt || null,
    provider: source.provider || null,
    sourceSymbol: source.sourceSymbol || null,
    raw: record(source.raw),
  });
}

function endpointAdapterKind(providerKey, provider, endpoint) {
  if (provider === 'finnhub') return 'FINNHUB_QUOTE';
  if (providerKey === 'TAIEX' || providerKey === '2330') {
    return provider === 'twse_mis' ? 'TWSE_MIS_QUOTE' : 'FUGLE_TAIWAN_CORE';
  }
  if (providerKey === 'TXF') return 'FUGLE_FUTOPT_QUOTE';
  return String(endpoint || '').includes('twse') ? 'TWSE_MIS_QUOTE' : 'NORMALIZED_QUOTE';
}

function normalizedSession(input, normalizedQuote) {
  const raw = record(record(normalizedQuote).raw);
  return String(raw.session || raw.tw_cash_phase || input.marketPhase || '').trim() || null;
}

/** Build one append-only, deidentified provider observation. */
export async function buildProductionProviderEvidence(input) {
  const rawPayload = sanitizeProductionMarketPayload(record(input.rawPayload));
  const normalizedQuote = safeNormalizedQuote(input.normalizedQuote);
  const normalizedRaw = record(record(normalizedQuote).raw);
  const evidence = record(input.evidence);
  const evidenceRow = record(evidence.row);
  const evidenceRaw = record(evidenceRow.raw);
  const contractResult = evidence.valid === true ? 'PASS'
    : input.expected === true ? 'EXPECTED' : input.waiting === true ? 'WAITING' : 'FAIL';
  const contractReason = evidence.valid === true ? null
    : String(input.contractReason || evidence.error || input.error || 'PROVIDER_REQUEST_REJECTED').slice(0, 300);
  const providerEnvelopeDate = String(
    input.providerEnvelopeDate || normalizedRaw.provider_envelope_date || record(rawPayload).date || '',
  );
  const evidenceSessionDate = String(
    input.evidenceSessionDate || normalizedRaw.evidence_session_date || evidenceRaw.captured_session_date || '',
  );
  const sourceTimestamp = String(input.sourceTimestamp || record(normalizedQuote).capturedAt || evidenceRow.source_timestamp || '');
  const provider = String(input.provider || record(normalizedQuote).provider || record(requiredProviderSlot(input.providerKey)).provider || 'unknown');
  const endpoint = String(input.endpoint || record(requiredProviderSlot(input.providerKey)).endpoint || 'unknown');
  const adapterKind = endpointAdapterKind(String(input.providerKey), provider, endpoint);
  const replayPayload = sanitizeRecordedEvidence({
    schema_version: PRODUCTION_EVIDENCE_REPLAY_VERSION,
    adapter_kind: adapterKind,
    provider_key: input.providerKey,
    source_symbol: input.symbol,
    endpoint,
    http_status: input.httpStatus ?? null,
    provider_error: input.error || null,
    provider_payload: rawPayload,
    normalized_quote: normalizedQuote,
    adapter_context: {
      provider_envelope_date: providerEnvelopeDate || null,
      evidence_session_date: evidenceSessionDate || null,
      source_timestamp: sourceTimestamp || null,
      session: normalizedRaw.session || null,
    },
    evidence_input: {
      phase: input.marketPhase,
      checkpoint: input.validationCheckpoint,
      tradingDate: input.businessDate,
      observedAt: input.observedAt,
      correlationId: input.correlationId,
    },
    expected_contract_result: contractResult,
    expected_contract_reason: contractReason,
  });
  if (recordedEvidenceContainsSensitiveData(replayPayload)) {
    throw new Error('PRODUCTION_EVIDENCE_SANITIZER_REJECTED_SENSITIVE_DATA');
  }
  return {
    business_date: input.businessDate,
    checkpoint: input.checkpoint,
    attempt: Math.max(1, Math.trunc(Number(input.attempt) || 1)),
    transport_attempt: Math.max(1, Math.trunc(Number(input.transportAttempt) || 1)),
    attempt_key: String(input.attemptKey || `${input.checkpoint}:${input.attempt || 1}:${input.transportAttempt || 1}:${input.correlationId}`),
    provider_key: String(input.providerKey),
    provider,
    symbol: String(input.symbol || record(requiredProviderSlot(input.providerKey)).sourceSymbol || input.providerKey),
    endpoint_class: endpoint,
    provider_envelope_date: /^\d{4}-\d{2}-\d{2}$/.test(providerEnvelopeDate) ? providerEnvelopeDate : null,
    evidence_session_date: /^\d{4}-\d{2}-\d{2}$/.test(evidenceSessionDate) ? evidenceSessionDate : null,
    source_timestamp: Number.isFinite(Date.parse(sourceTimestamp)) ? new Date(sourceTimestamp).toISOString() : null,
    normalized_session: normalizedSession(input, normalizedQuote),
    market_phase: input.marketPhase,
    freshness_result: String(evidenceRaw.freshness_status || (evidence.valid === true ? 'fresh' : 'invalid')),
    contract_result: contractResult,
    contract_reason: contractReason,
    adapter_version: String(input.adapterVersion || 'UNKNOWN_ADAPTER_VERSION'),
    contract_version: String(input.contractVersion || CHECKPOINT_PROVIDER_CONTRACT_VERSION),
    normalized_evidence: sanitizeRecordedEvidence({ quote: normalizedQuote, evidence_row: evidenceRow }),
    payload_shape: describeProductionResponseShape(rawPayload),
    raw_payload_hash: await sha256Hex(stableJson(rawPayload)),
    replay_payload: replayPayload,
    http_status: Number.isFinite(Number(input.httpStatus)) ? Number(input.httpStatus) : null,
    correlation_id: input.correlationId,
    source_function: String(input.sourceFunction),
    recorder_version: PRODUCTION_EVIDENCE_RECORDER_VERSION,
    retention_until: new Date(Date.parse(input.recordedAt || new Date().toISOString()) + PRODUCTION_EVIDENCE_RETENTION_DAYS * 86_400_000).toISOString(),
    recorded_at: input.recordedAt || new Date().toISOString(),
  };
}

async function replayQuote(replay, row) {
  const providerKey = String(replay.provider_key || row.provider_key || '');
  const payload = record(replay.provider_payload);
  const context = record(replay.adapter_context);
  const evidenceInput = record(replay.evidence_input);
  const endpoint = String(replay.endpoint || row.endpoint_class || '');
  if (replay.adapter_kind === 'FINNHUB_QUOTE') {
    return normalizeRequiredFinnhubQuote(payload, String(replay.source_symbol || row.symbol || ''));
  }
  if (replay.adapter_kind === 'FUGLE_TAIWAN_CORE') {
    const resolver = providerKey === 'TAIEX' ? resolveFugleTaiexProvider : resolveFugle2330Provider;
    const result = await resolver(async ({ endpoint: requestedEndpoint }) => requestedEndpoint === endpoint
      ? { status: Number(replay.http_status), payload, error: replay.provider_error || null }
      : { status: 503, payload: null, error: 'RECORDED_AUXILIARY_RESPONSE_NOT_RETAINED' }, {
      phase: evidenceInput.phase,
      tradingDate: evidenceInput.tradingDate,
      observedAt: evidenceInput.observedAt,
    });
    return normalizeRequiredTaiwanCoreQuote(result, providerKey);
  }
  if (replay.adapter_kind === 'FUGLE_FUTOPT_QUOTE') {
    const resolved = await resolveRequiredTxfQuote(async requestedEndpoint => requestedEndpoint === endpoint
      ? { status: Number(replay.http_status), payload, error: replay.provider_error || null }
      : { status: 404, payload: null, error: 'RECORDED_ENDPOINT_NOT_SELECTED' }, {
      phase: evidenceInput.phase,
      tradingDate: evidenceInput.tradingDate,
      observedAt: evidenceInput.observedAt,
    });
    return resolved.quote || null;
  }
  const stored = record(replay.normalized_quote);
  return stored.provider ? { ...stored, raw: record(stored.raw) } : null;
}

/** Re-run the current adapter and provider contract without external network I/O. */
export async function replayRecordedProviderEvidence(row) {
  const replay = record(row.replay_payload);
  const evidenceInput = record(replay.evidence_input);
  const providerKey = String(replay.provider_key || row.provider_key || '');
  const slot = requiredProviderSlot(providerKey);
  let quote = null;
  try {
    quote = await replayQuote(replay, row);
  } catch {
    quote = null;
  }
  const evidence = validateRequiredProviderEvidence(slot, quote, evidenceInput);
  const response = { status: replay.http_status, error: replay.provider_error };
  const contractResult = evidence.valid === true ? 'PASS' : 'FAIL';
  const contractReason = evidence.valid === true ? null
    : classifyRequiredProviderFailure(response, evidence.error || null);
  return {
    provider_key: providerKey,
    quote,
    evidence,
    contract_result: contractResult,
    contract_reason: contractReason,
    deterministic: contractResult === row.contract_result && (
      contractResult === 'PASS' || String(row.contract_reason || '').includes(String(evidence.error || contractReason || '')) ||
      String(row.contract_reason || '') === String(contractReason || '')
    ),
  };
}

export async function replayRecordedProviderEvidenceBatch(rows) {
  const replayed = await Promise.all(rows.map(replayRecordedProviderEvidence));
  const evidenceRows = replayed.filter(item => item.evidence.valid === true)
    .map(item => ({ ...item.evidence.row, provider_key: item.provider_key }));
  const atomic = validateAtomicCheckpointEvidenceRows(evidenceRows);
  return {
    replayed,
    deterministic: replayed.every(item => item.deterministic),
    atomic_candidate_valid: atomic.valid === true,
    atomic_error: atomic.valid ? null : atomic.error,
  };
}

function timeoutResult(timeoutMs) {
  return new Promise(resolve => setTimeout(() => resolve({ timeout: true }), timeoutMs));
}

async function boundedInsert(supabase, inputs, timeoutMs) {
  try {
    const rows = await Promise.all(inputs.slice(0, PRODUCTION_EVIDENCE_MAX_ROWS).map(buildProductionProviderEvidence));
    const insert = Promise.resolve(supabase.from('production_provider_evidence').insert(rows))
      .then(async result => {
        if (result?.error || typeof supabase.rpc !== 'function') return { result, cleanupError: null };
        try {
          const cleanup = await supabase.rpc('cleanup_expired_production_provider_evidence_v1', { p_limit: 1_000 });
          return { result, cleanupError: cleanup?.error || null };
        } catch {
          return { result, cleanupError: { message: 'RECORDER_CLEANUP_EXCEPTION' } };
        }
      });
    const settled = await Promise.race([insert, timeoutResult(timeoutMs)]);
    if (settled.timeout) {
      console.warn('PRODUCTION_EVIDENCE_RECORDER_TIMEOUT');
      return { ok: false, error: 'RECORDER_TIMEOUT' };
    }
    if (settled.result?.error) {
      console.warn('PRODUCTION_EVIDENCE_RECORDER_WRITE_FAILED', settled.result.error.message || 'unknown');
      return { ok: false, error: 'RECORDER_WRITE_FAILED' };
    }
    if (settled.cleanupError) console.warn('PRODUCTION_EVIDENCE_RECORDER_CLEANUP_FAILED');
    return { ok: true, inserted_count: rows.length };
  } catch (error) {
    console.warn('PRODUCTION_EVIDENCE_RECORDER_EXCEPTION', error instanceof Error ? error.message : String(error));
    return { ok: false, error: 'RECORDER_EXCEPTION' };
  }
}

/** Schedule recorder work without awaiting it in the business pipeline. */
export function scheduleProductionEvidenceRecording({
  supabase,
  inputs,
  scheduler = null,
  timeoutMs = PRODUCTION_EVIDENCE_WRITE_TIMEOUT_MS,
}) {
  if (!Array.isArray(inputs) || inputs.length === 0) return { scheduled: false, row_count: 0 };
  const task = Promise.resolve().then(() => boundedInsert(supabase, inputs, timeoutMs));
  try {
    if (scheduler) scheduler(task);
    else if (globalThis.EdgeRuntime && typeof globalThis.EdgeRuntime.waitUntil === 'function') {
      globalThis.EdgeRuntime.waitUntil(task);
    } else {
      void task;
    }
  } catch (error) {
    console.warn('PRODUCTION_EVIDENCE_RECORDER_SCHEDULER_FAILED', error instanceof Error ? error.message : String(error));
  }
  return { scheduled: true, row_count: Math.min(inputs.length, PRODUCTION_EVIDENCE_MAX_ROWS) };
}

export const PRODUCTION_PROVIDER_CONTRACT_VERSION = REQUIRED_PROVIDER_CONTRACT_VERSION;

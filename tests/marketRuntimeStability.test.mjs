import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBeneficiaryBatchContract,
  buildBeneficiaryCloseStatus,
  classifyProviderFailure,
  evaluateCheckpointFreshness,
  sanitizeProviderError,
} from '../supabase/functions/_shared/market-runtime-stability.mjs';

test('beneficiary close batch follows the V10 cutover contract without legacy fallback', () => {
  const contract = buildBeneficiaryBatchContract({
    v10_beneficiary_enabled: true,
    today_beneficiary_stocks_v10: [
      { symbol: '2308', name: '台達電' },
      { stock_code: '2382', stock_name: '廣達' },
      { symbol: '2308', name: 'duplicate' },
    ],
    today_beneficiary_stocks: [{ symbol: '2317', name: 'legacy must not leak' }],
  }, {
    existingSymbols: ['TAIEX', '2330'],
    maxSymbols: 12,
  });

  assert.equal(contract.v10_enabled, true);
  assert.equal(contract.source_field, 'today_beneficiary_stocks_v10');
  assert.equal(contract.decision_mode, 'recommendations');
  assert.deepEqual(contract.configs.map((item) => item.displaySymbol), ['2308', '2382']);
});

test('an explicit V10 no-trade decision is complete without inventing beneficiaries', () => {
  const contract = buildBeneficiaryBatchContract({
    v10_beneficiary_enabled: 'true',
    today_beneficiary_stocks_v10: [],
    beneficiary_stocks: [{ symbol: '2317' }],
  });
  assert.equal(contract.decision_mode, 'no_trade');
  assert.deepEqual(contract.configs, []);

  const status = buildBeneficiaryCloseStatus({
    lookup_status: 'loaded',
    decision_mode: contract.decision_mode,
    contract_valid: contract.contract_valid,
  });
  assert.equal(status.status, 'NOT_APPLICABLE_NO_RECOMMENDATIONS');
  assert.equal(status.complete, true);
});

test('beneficiary close is incomplete until legacy, snapshot, and canonical writes all succeed', () => {
  const partial = buildBeneficiaryCloseStatus({
    lookup_status: 'loaded',
    decision_mode: 'recommendations',
    contract_valid: true,
    requested_symbols: ['2308', '2382'],
    inserted_symbols: ['2308', '2382'],
    snapshot_symbols: ['2308', '2382'],
    canonical_symbols: ['2308'],
  });
  assert.equal(partial.status, 'PARTIAL');
  assert.equal(partial.complete, false);
  assert.deepEqual(partial.failed_symbols, ['2382']);

  const complete = buildBeneficiaryCloseStatus({
    lookup_status: 'loaded',
    decision_mode: 'recommendations',
    contract_valid: true,
    requested_symbols: ['2308', '2382'],
    inserted_symbols: ['2308', '2382'],
    snapshot_symbols: ['2308', '2382'],
    canonical_symbols: ['2308', '2382'],
  });
  assert.equal(complete.status, 'COMPLETE');
  assert.equal(complete.complete, true);
});

test('a missing report or invalid beneficiary contract fails closed', () => {
  assert.equal(buildBeneficiaryCloseStatus({
    lookup_status: 'report_not_found',
    decision_mode: 'blocked',
    contract_valid: false,
  }).complete, false);
  assert.equal(buildBeneficiaryCloseStatus({
    lookup_status: 'loaded',
    decision_mode: 'blocked',
    contract_valid: false,
  }).status, 'BLOCKED_INVALID_RECOMMENDATION_CONTRACT');
});

test('an explicit canonical blocked decision closes without fabricating stocks', () => {
  const status = buildBeneficiaryCloseStatus({
    lookup_status: 'loaded',
    decision_mode: 'blocked',
    contract_valid: true,
  });
  assert.equal(status.status, 'NOT_APPLICABLE_BLOCKED_DECISION');
  assert.equal(status.complete, true);
});

test('provider failures distinguish subscription, auth, rate, outage, and mapping failures', () => {
  assert.equal(classifyProviderFailure({ status: 401 }).failure_code, 'AUTHENTICATION_FAILED');
  assert.equal(
    classifyProviderFailure({ provider: 'fugle_futopt', status: 401, error: 'subscription entitlement expired' }).failure_code,
    'BLOCKED_BY_SUBSCRIPTION',
  );
  assert.equal(classifyProviderFailure({ status: 403 }).failure_code, 'BLOCKED_BY_SUBSCRIPTION');
  assert.equal(classifyProviderFailure({ status: 429 }).failure_code, 'RATE_LIMITED');
  assert.equal(classifyProviderFailure({ status: 503 }).failure_code, 'PROVIDER_UNAVAILABLE');
  assert.equal(classifyProviderFailure({ error: 'missing_api_key' }).failure_code, 'CONFIGURATION_MISSING');
  assert.equal(
    classifyProviderFailure({ error: 'cannot_resolve_active_txf_contract' }).failure_code,
    'CONTRACT_MAPPING_FAILED',
  );
  assert.equal(classifyProviderFailure({ error: 'provider_timestamp:cross_session_stale' }).failure_code, 'STALE_PROVIDER_DATA');
});

test('Taiwan checkpoint freshness rejects fabricated, cross-session, and stale core timestamps', () => {
  const base = {
    market: 'TW',
    phase: 'intraday',
    symbol: 'TAIEX',
    trading_date: '2026-08-24',
    evaluated_at: '2026-08-24T09:30:00+08:00',
  };
  assert.equal(evaluateCheckpointFreshness({ ...base, captured_at: '' }).status, 'invalid_timestamp');
  assert.equal(
    evaluateCheckpointFreshness({ ...base, captured_at: '2026-08-21T13:30:00+08:00' }).status,
    'cross_session_stale',
  );
  assert.equal(
    evaluateCheckpointFreshness({ ...base, captured_at: '2026-08-24T08:45:00+08:00' }).status,
    'checkpoint_stale',
  );
  assert.equal(
    evaluateCheckpointFreshness({ ...base, captured_at: '2026-08-24T09:29:00+08:00' }).valid,
    true,
  );
  assert.equal(evaluateCheckpointFreshness({
    ...base,
    phase: 'close',
    evaluated_at: '2026-08-24T14:30:00+08:00',
    captured_at: '2026-08-24T13:30:00+08:00',
  }).valid, true);
  assert.equal(evaluateCheckpointFreshness({
    ...base,
    phase: 'close',
    evaluated_at: '2026-08-24T15:45:00+08:00',
    captured_at: '2026-08-24T13:30:00+08:00',
  }).status, 'official_close');
  assert.equal(evaluateCheckpointFreshness({
    ...base,
    phase: 'close',
    evaluated_at: '2026-08-24T15:45:00+08:00',
    captured_at: '2026-08-24T12:59:00+08:00',
  }).status, 'pre_close_timestamp');
  assert.equal(evaluateCheckpointFreshness({
    ...base,
    phase: 'close',
    symbol: 'TXF',
    evaluated_at: '2026-08-24T15:45:00+08:00',
    captured_at: '2026-08-24T13:30:00+08:00',
  }).status, 'pre_close_timestamp');
  assert.equal(evaluateCheckpointFreshness({
    ...base,
    phase: 'close',
    symbol: 'TXF',
    evaluated_at: '2026-08-24T15:45:00+08:00',
    captured_at: '2026-08-24T13:45:00+08:00',
  }).status, 'official_close');
});

test('provider diagnostics redact query and header credentials', () => {
  const sanitized = sanitizeProviderError(
    'request https://example.test/feed?token=secret-token&apikey=second-secret&apiToken=third-secret&access_token=fourth-secret failed; Authorization: Bearer bearer-secret X-API-KEY: header-secret; {"apiKey":"json-secret"}',
  );
  assert.doesNotMatch(sanitized, /secret-token|second-secret|third-secret|fourth-secret|bearer-secret|header-secret|json-secret/);
  assert.match(sanitized, /\[REDACTED\]/);
});

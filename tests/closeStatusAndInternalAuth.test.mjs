import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasTerminalClosingEvidence,
  resolveCanonicalRuntimeMarketStatus,
} from '../supabase/functions/_shared/canonical-runtime-market-status.mjs';
import {
  buildInternalFunctionHeaders,
  hasValidInternalCredentials,
} from '../supabase/functions/_shared/internal-function-auth.mjs';

test('a trading day remains OPEN before terminal close evidence exists', () => {
  assert.equal(resolveCanonicalRuntimeMarketStatus({
    isTradingDay: true,
    tradingDayState: {
      current_state: 'CHECKPOINT_1300_CAPTURED',
      checkpoint_status: { '1300': { status: 'SUCCEEDED' } },
    },
  }), 'OPEN');
});

test('14:30 terminal evidence closes the runtime market status', () => {
  const tradingDayState = {
    current_state: 'CLOSE_1430_CAPTURED',
    checkpoint_status: { '1430': { status: 'SUCCEEDED' } },
  };
  assert.equal(hasTerminalClosingEvidence({ tradingDayState }), true);
  assert.equal(resolveCanonicalRuntimeMarketStatus({
    isTradingDay: true,
    tradingDayState,
  }), 'CLOSED');
});

test('closing verification and learning terminal states cannot regress to OPEN', () => {
  for (const currentState of ['CLOSING_VERIFIED', 'LEARNING_COMPLETED']) {
    assert.equal(resolveCanonicalRuntimeMarketStatus({
      isTradingDay: true,
      tradingDayState: { current_state: currentState },
    }), 'CLOSED');
  }
});

test('holidays remain CLOSED without runtime evidence', () => {
  assert.equal(resolveCanonicalRuntimeMarketStatus({ isTradingDay: false }), 'CLOSED');
});

test('internal function headers use apikey for service credentials', () => {
  const headers = buildInternalFunctionHeaders({
    cronSecret: 'cron-secret',
    serviceRoleKey: 'sb_secret_service-key',
    source: 'daily-delivery-orchestrator',
  });
  assert.equal(headers['x-cron-secret'], 'cron-secret');
  assert.equal(headers.apikey, 'sb_secret_service-key');
  assert.equal(headers['x-internal-call-source'], 'daily-delivery-orchestrator');
  assert.equal(Object.hasOwn(headers, 'Authorization'), false);
});

test('closing verification accepts either valid cron or service credentials', () => {
  const cronHeaders = new Headers({ 'x-cron-secret': 'cron-secret' });
  const serviceHeaders = new Headers({ apikey: 'service-key' });
  const invalidHeaders = new Headers({ 'x-cron-secret': 'wrong', apikey: 'wrong' });
  const credentials = { cronSecret: 'cron-secret', serviceRoleKey: 'service-key' };

  assert.equal(hasValidInternalCredentials(cronHeaders, credentials), true);
  assert.equal(hasValidInternalCredentials(serviceHeaders, credentials), true);
  assert.equal(hasValidInternalCredentials(invalidHeaders, credentials), false);
});

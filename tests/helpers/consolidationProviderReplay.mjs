// Component replay of the exact production provider declarations. No HTTP
// receiver, actual network fetch, database, time override or credential read.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isolatedFunction } from './isolatedEdgeLoader.mjs';
import { normalizeProviderTimestamp } from '../../supabase/functions/_shared/provider-normalization.mjs';
import { buildCheckpointEvidence, validRetainedCheckpointRow } from '../../supabase/functions/_shared/fetch-checkpoint-evidence.mjs';

const source = readFileSync(new URL('../../supabase/functions/fetch-market-data-v10/index.ts', import.meta.url), 'utf8');
const extractNumber = isolatedFunction(source, 'extractNumber');
const normalizeFugleQuote = isolatedFunction(source, 'normalizeFugleQuote', {
  extractNumber, normalizeTimestamp: normalizeProviderTimestamp,
});
const sha256 = value => createHash('sha256').update(value).digest('hex');

export async function replayProviderQuote(entry) {
  assert.ok(['finnhub', 'fugle'].includes(entry.provider), 'Unrecorded provider is not permitted');
  let requests = 0;
  const bytes = JSON.stringify(entry.response);
  let quote;
  if (entry.provider === 'fugle') {
    // Fugle's actual pure parser is tested; transport is explicitly not run.
    quote = normalizeFugleQuote(JSON.parse(bytes), entry.config.finnhubSymbol);
  } else {
    const fetchFinnhubQuote = isolatedFunction(source, 'fetchFinnhubQuote', {
      MAX_RETRIES: 0, FETCH_TIMEOUT_MS: 6000, AbortController, DOMException,
      setTimeout, clearTimeout, normalizeTimestamp: normalizeProviderTimestamp,
      sanitizeProviderError: () => 'offline-provider-error',
      console: { log() {}, error() {} },
      sleep: () => { throw new Error('Offline replay must not retry or sleep'); },
      fetch: async url => {
        const request = new URL(url);
        assert.equal(request.origin, 'https://finnhub.io');
        assert.equal(request.pathname, '/api/v1/quote');
        assert.equal(request.searchParams.get('symbol'), entry.config.finnhubSymbol);
        assert.equal(request.searchParams.get('token'), 'LOCAL_OFFLINE_PLACEHOLDER');
        requests++;
        return new Response(bytes, { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    quote = await fetchFinnhubQuote(entry.config.finnhubSymbol, 'LOCAL_OFFLINE_PLACEHOLDER', 'SYNTHETIC');
    assert.equal(requests, 1);
  }
  return { quote, boundary: 'OFFLINE_PROVIDER_SHAPE', response_sha256: sha256(bytes),
    parser_source_sha256: sha256(source), network_requests: 0 };
}

export async function replayCheckpointConstruction(fixture) {
  assert.equal(fixture.schema_version, 'CONSOLIDATION_PROVIDER_INPUT_V1');
  assert.equal(fixture.provenance.kind, 'SYNTHETIC_FAILURE_SHAPE');
  assert.equal(fixture.provenance.historical_capture, false);
  const observations = [];
  for (const entry of fixture.quotes) {
    const parsed = await replayProviderQuote(entry);
    const evidence = buildCheckpointEvidence(fixture.collection, parsed.quote, entry.config);
    observations.push({ symbol: entry.config.displaySymbol, parsed, evidence,
      // Missing real snapshot_version is deliberately not invented here.
      durable_readback_verified: evidence.valid
        ? validRetainedCheckpointRow(evidence.row, fixture.collection, entry.config) : false });
  }
  return { scope: 'PROVIDER_COMPONENT_CHAIN_ONLY', observations };
}

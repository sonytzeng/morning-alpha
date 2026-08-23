import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  contentLengthExceedsLimit,
  readBoundedBytes,
  readBoundedText,
} from '../supabase/functions/_shared/bounded-json.ts';
import { normalizeMarketDataRows } from '../supabase/functions/generate-daily-report-v7/market-data-evidence.ts';

const generatorSource = await readFile(new URL('../supabase/functions/generate-daily-report-v7/index.ts', import.meta.url), 'utf8');
const reportPayloadSource = await readFile(new URL('../supabase/functions/get-report-payload/index.ts', import.meta.url), 'utf8');
const lineWebhookSource = await readFile(new URL('../supabase/functions/line-webhook/index.ts', import.meta.url), 'utf8');

test('market evidence keeps real zeroes but rejects missing or non-finite numerics', () => {
  const normalized = normalizeMarketDataRows([
    { symbol: 'SPX', value: 0, change_percent: 0, captured_at: '2026-08-22T20:00:00.000Z' },
    { symbol: 'NVDA', value: null, change_percent: 1.2, captured_at: '2026-08-22T20:01:00.000Z' },
    { symbol: 'TSM', value: 250, change_percent: '', captured_at: '2026-08-22T20:02:00.000Z' },
    { symbol: 'SOX', value: 'Infinity', change_percent: -0.5, captured_at: '2026-08-22T20:03:00.000Z' },
  ], Date.parse('2026-08-22T21:00:00.000Z'));

  assert.equal(normalized.dataCount, 1);
  assert.equal(normalized.rawDataCount, 4);
  assert.deepEqual(normalized.marketData.map(({ symbol, value, changePercent }) => ({ symbol, value, changePercent })), [
    { symbol: 'SPX', value: 0, changePercent: 0 },
  ]);
  assert.deepEqual(normalized.invalidNumericSources.sort(), [
    'NVDA:value',
    'SOX:value',
    'TSM:change_percent',
  ]);
});

test('invalid numeric rows cannot advance market freshness', () => {
  const normalized = normalizeMarketDataRows([
    { symbol: 'SPX', value: 5000, change_percent: 0.2, captured_at: '2026-08-21T20:00:00.000Z' },
    { symbol: 'NVDA', value: null, change_percent: null, captured_at: '2026-08-22T20:00:00.000Z' },
  ], Date.parse('2026-08-22T21:00:00.000Z'));

  assert.equal(normalized.latestDataTime?.toISOString(), '2026-08-21T20:00:00.000Z');
  assert.equal(normalized.isStale, true);
});

test('bounded body reader accepts exact limit and cancels oversized streams', async () => {
  const encoder = new TextEncoder();
  assert.equal(await readBoundedText(new Response('12345').body, 5), '12345');
  await assert.rejects(
    readBoundedBytes(new Response('123456').body, 5),
    /REQUEST_TOO_LARGE/,
  );
  assert.equal(contentLengthExceedsLimit('6', 5), true);
  assert.equal(contentLengthExceedsLimit(String(encoder.encode('12345').byteLength), 5), false);
});

test('daily report fails closed instead of coercing missing market numerics to zero', () => {
  assert.match(generatorSource, /normalizeMarketDataRows\(data,Date\.now\(\),HOURS_24\)/);
  assert.match(generatorSource, /invalid_numeric_market_data:/);
  assert.match(generatorSource, /required_market_evidence_status:'insufficient'/);
  assert.match(generatorSource, /publish_ready:false/);
  assert.match(generatorSource, /if\(!requiredEvidenceAvailable\)aiStrategyJson=failClosedForMissingRequiredEvidence/);
  assert.doesNotMatch(generatorSource, /const v=hasValue\?Number\(rawValue\):0/);
  assert.doesNotMatch(generatorSource, /const cp=hasChangePercent\?Number\(rawChangePercent\):0/);
});

test('report payload bounds input and exposes component query failures for bridge rejection', () => {
  assert.match(reportPayloadSource, /MAX_BODY_BYTES = 32_768/);
  assert.match(reportPayloadSource, /readBoundedText\(req\.body, MAX_BODY_BYTES\)/);
  assert.match(reportPayloadSource, /component_query_status: componentFailureSources\.length > 0 \? "degraded" : "complete"/);
  assert.match(reportPayloadSource, /bridge_verification_status: componentFailureSources\.length > 0 \? "TOOL_DEGRADED" : "VERIFIED"/);
  assert.match(reportPayloadSource, /component_query_failures: ctx\.componentQueryFailures/);
  assert.doesNotMatch(reportPayloadSource, /await req\.json\(\)/);
});

test('LINE verifies only a bounded exact byte body', () => {
  assert.match(lineWebhookSource, /MAX_BODY_BYTES = 262_144/);
  assert.match(lineWebhookSource, /readBoundedBytes\(req\.body, MAX_BODY_BYTES\)/);
  assert.match(lineWebhookSource, /crypto\.subtle\.sign\('HMAC', key, bodyBytes\)/);
  assert.match(lineWebhookSource, /constantTimeEqual\(computedBase64, signature\)/);
  assert.doesNotMatch(lineWebhookSource, /await req\.text\(\)/);
});

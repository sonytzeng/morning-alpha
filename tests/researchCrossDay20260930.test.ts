import fixture from './fixtures/production-parity-v4/research-cross-day-20260930.json' with { type: 'json' };
import { reconstructSectorRotationFromCommittedClose } from '../supabase/functions/generate-daily-report-v7/market-data-evidence.ts';
import { filterPremiumNewsEvidence } from '../supabase/functions/_shared/premium-evidence.ts';
import { filterRecentNewsRows } from '../supabase/functions/generate-daily-report-v7/market-freshness.ts';

const assert = (condition: unknown, message: string): void => { if (!condition) throw Error(message); };
const batch = fixture.batches.filter(b => b.business_date === fixture.previous_date);
const rows = fixture.close_rows.map(row => ({ ...row, idempotency_key: batch[0].idempotency_key }));
const reconstruct = (r = rows, b = batch, i = fixture.integrity, date = fixture.previous_date) =>
  reconstructSectorRotationFromCommittedClose(r, b, i, date);
const now = Date.parse(fixture.replay_at);
const news = fixture.news_events.map(n => ({
  ...n, source: n.source_name, url: n.source_url,
  taiwan_impact_summary: n.raw_payload.taiwan_impact_summary || n.summary,
}));

Deno.test('9/29 real Atomic evidence survives failed report/lifecycle and reconstructs exact previous-day sectors', () => {
  assert(fixture.synthetic === false && fixture.history.prior_report_count === 0, 'real failed-day input required');
  assert(fixture.legacy_view_count === 0 && fixture.integrity.status === 'PASS', 'exact Production rejection must remain documented');
  const before = JSON.stringify(fixture);
  const result = reconstruct();
  assert(result.status === 'RECONSTRUCTED' && result.rows.length === 4, 'all four observed market sectors reconstruct');
  assert(result.rows.every(r => r.score_date === '2026-09-29'
    && r.lineage.source === 'authoritative_market_data_snapshots_v1'
    && r.lineage.source_table === 'market_checkpoint_snapshots'
    && r.lineage.reconstruction_basis === 'RECONSTRUCTED_FROM_AUTHORITATIVE_MARKET_EVIDENCE'
    && r.lineage.origin === 'DERIVED_EVIDENCE_RECONSTRUCTION'), 'do not impersonate historical published sector scores');
  assert(JSON.stringify(fixture) === before, 'immutable evidence must remain byte-identical');
});

Deno.test('missing/partial prior evidence remains unavailable; never reuse another date or mixed batch', () => {
  assert(reconstruct([]).status === 'UNAVAILABLE', 'empty batch');
  assert(reconstruct(rows.slice(1)).status === 'UNAVAILABLE', 'partial batch');
  assert(reconstruct(rows, batch, fixture.integrity, '2026-09-28').status === 'UNAVAILABLE', 'wrong lookup date');
  assert(reconstruct(rows, [...batch, ...batch]).status === 'UNAVAILABLE', 'duplicate batch');
  for (const key of ['batch_id', 'correlation_id', 'idempotency_key', 'provider_key', 'market_session', 'checkpoint']) {
    const changed = structuredClone(rows) as Record<string, unknown>[];
    changed[0][key] = 'INVALID';
    assert(reconstructSectorRotationFromCommittedClose(changed, batch, fixture.integrity, fixture.previous_date).status === 'UNAVAILABLE', key);
  }
});

Deno.test('unchanged Atomic integrity proof is required, not merely HTTP success or eleven arbitrary rows', () => {
  for (const key of ['status', 'contract', 'business_date', 'batch_id', 'correlation_id', 'payload_hash', 'canonical_row_count', 'mixed_batch_revision_count', 'compatibility_mismatch_count']) {
    assert(reconstructSectorRotationFromCommittedClose(rows, batch, {...fixture.integrity, [key]: 'INVALID'}, fixture.previous_date).status === 'UNAVAILABLE', key);
  }
  assert(reconstructSectorRotationFromCommittedClose(rows, batch, {}, fixture.previous_date).status === 'UNAVAILABLE', 'missing proof');
});

Deno.test('provider session timestamp, not ingestion time, controls reconstructed close freshness', () => {
  for (const timestamp of ['2026-09-28T05:30:00Z', '2026-09-30T05:30:00Z', 'invalid']) {
    const changed = structuredClone(rows);
    changed.find(r => r.symbol === '2330')!.source_timestamp = timestamp;
    assert(reconstruct(changed).status === 'UNAVAILABLE', 'stale/future/invalid provider timestamp');
  }
});

Deno.test('9/30 real six tagged news yield exactly five accepted and one correctly rejected', () => {
  const recent = filterRecentNewsRows(news, now, 48);
  const review = filterPremiumNewsEvidence(recent, now);
  assert(recent.length === 6 && review.verified.length === 5 && review.rejected.length === 1, 'same Production counts');
  assert(review.rejected[0].reason_codes.join('|') === 'taiwan_market_relevance_unproven|decision_catalyst_missing', 'same actual rejection');
  assert(new Set(news.map(n => n.fingerprint)).size === 6, 'canonical dedup identity');
  assert(fixture.news_event_tags.every(t => news.some(n => n.fingerprint === t.news_key)), 'all news have real tags');
});

Deno.test('rolling 48 clock hours is unchanged: no timestamp substitution or stale/future news admission', () => {
  assert(filterRecentNewsRows(news, now + 48 * 3600000, 48).length === 0, 'all expire by elapsed clock time');
  assert(filterRecentNewsRows(news, now - 72 * 3600000, 48).length === 0, 'future publication is excluded');
  assert(filterPremiumNewsEvidence([], now).verified.length === 0, 'missing news stays missing');
  const expired = filterPremiumNewsEvidence(news, now + 48 * 3600000);
  assert(expired.verified.length === 0, 'quality filter also rejects stale news');
});

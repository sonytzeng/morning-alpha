// Pure validation of selected actual persistent output, not another DB run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { assertHistoricalIsolationProof } from './helpers/coreConsolidationHistoricalIsolationProof.mjs';
const bytes = readFileSync(new URL('./fixtures/consolidation-v1/content-os/fresh13-20260930-isolation.json', import.meta.url));
const fixture = () => JSON.parse(bytes);
test('exact actual 102-record output proves earlier five-company exclusion and persistent market-only completion', () => {
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '84e7838c61c7c56138ea10d72407ae8e5efbeded3009a3209b40738aae5479b1');
  assert.equal(assertHistoricalIsolationProof(fixture()).original_five_symbols_excluded_at_universe, true);
});
for (const [label, mutate] of [
  ['result swapped', v => v.source_result.sha256 = '0'.repeat(64)],
  ['readback swapped', v => v.source_readback.sha256 = '0'.repeat(64)],
  ['historical date relabeled', v => v.report_date = '2026-09-09'],
  ['missing original company', v => v.company_candidates.pop()],
  ['company promoted', v => v.company_candidates[0].eligibility = true],
  ['unresolved source', v => v.company_candidates[0].related_evidence[0].evidence_id = 'FOREIGN'],
  ['invented company citation', v => { const id = v.company_candidates[0].related_evidence[0].evidence_id; const e = v.referenced_evidence_index.find(row => row.evidence_id === id); e.evidence_type = 'market_news'; e.title = v.company_candidates[0].symbol + ' ' + v.company_candidates[0].name + ' reported company revenue'; e.summary = e.title; }],
  ['fake phase1 five', v => v.phase1.candidate_count = 5],
  ['fake original76', v => v.admission.source_coverage = 76],
  ['fake later admission rejection', v => v.admission.rejected_recommendations.push({ symbol: '3034' })],
  ['stock output leaked', v => v.market.public_recommendations.push({ symbol: '3034' })],
  ['checkpoint dropped', v => v.checkpoint_records.pop()],
  ['lineage unverified', v => v.checkpoint_records[0].producer_readback_verified = false],
  ['export detached', v => v.public_export_records[0].revision_id = 'other'],
  ['closing detached', v => v.downstream_records.find(row => row.stage === 'durable-closing').opening_publication_revision_id = 'other'],
  ['learning retry omitted', v => v.downstream_records.find(row => row.stage === 'durable-learning').raw_whole_set_retry_verified = false],
  ['LINE not sent', v => v.line_outbox[0].status = 'PENDING'],
  ['natural day falsely claimed', v => v.acceptance.automatic_stable_day = true],
  ['historical vendor replay falsely claimed', v => v.historical_dates_replayed = true],
]) test('actual-output proof rejects ' + label, () => {
  assert.doesNotThrow(() => assertHistoricalIsolationProof(fixture()));
  const value = fixture(); mutate(value); assert.throws(() => assertHistoricalIsolationProof(value));
});

// Actual assembler and publication evaluator; in-memory counterfactuals only.
// No provider, database, LINE or Production execution evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isolatedFunction } from './helpers/isolatedEdgeLoader.mjs';
import { assembleCanonicalMarketResearch } from '../supabase/functions/generate-daily-report-v7/research-master-v2.ts';
import { buildCanonicalMarketState, canonicalMarketDocument, canonicalMarketSourceRefs } from '../supabase/functions/_shared/canonical-market-state.ts';
import { evaluateMarketReportGate } from '../supabase/functions/_shared/market-report-gate.ts';
import { evaluatePublishedMarketDelivery } from '../supabase/functions/_shared/market-publication-contract.ts';
import { validateOpeningPublication } from '../supabase/functions/_shared/closing-learning-contract.ts';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const fixture = isolatedFunction(read('tests/consolidationPublicationConsumers.test.mjs'), 'fixture', {
  isolatedFunction, read, assert, structuredClone, assembleCanonicalMarketResearch,
  buildCanonicalMarketState, canonicalMarketSourceRefs, evaluateMarketReportGate,
});
const state = f => f.snapshot.generated_text.canonical_market_state;
const claims = f => state(f).document.quality.coverage_audit.claims;
const evaluate = f => evaluatePublishedMarketDelivery(f.report, f.snapshot, f.member,
  evaluateMarketReportGate(f.report.ai_strategy_json, f.report.report_date), {
    todayDate: f.report.report_date, now: f.report.report_date + 'T16:00:00+08:00', publicationRun: f.publicationRun,
  });
function sourceContext(f, freshness, source) {
  const id = claims(f)[0].sources[0].evidence_id;
  for (const claim of claims(f)) for (const row of claim.sources) if (row.evidence_id === id) {
    row.freshness = freshness;
    if (source) row.source = source;
    if (source === 'reports' || source === 'sector_rotation_scores') row.source_date = '2026-07-13';
  }
  f.snapshot.source_refs = canonicalMarketSourceRefs(f.snapshot.generated_text);
}

for (const [freshness, source] of [['fresh', 'market_data'], ['recent', 'market_news'],
  ['previous_trading_day', 'sector_rotation_scores'], ['previous_report', 'reports']]) {
  test(`actual producer freshness context remains valid: ${freshness}/${source}`, () => {
    const f = fixture(); assert.equal(evaluate(f).eligible, true);
    sourceContext(f, freshness, source);
    assert.equal(buildCanonicalMarketState(canonicalMarketDocument(f.snapshot.generated_text)).status, 'READY');
    assert.equal(evaluate(f).eligible, true);
  });
}

for (const [name, mutate] of [
  ['missing state IDs', f => { delete state(f).evidence_ids; }],
  ['empty state IDs', f => { state(f).evidence_ids = []; }],
  ['foreign state IDs', f => { state(f).evidence_ids = ['FOREIGN_ID']; }],
  ['duplicate state IDs', f => { state(f).evidence_ids.push(state(f).evidence_ids[0]); }],
  ['duplicate snapshot source tuple', f => { f.snapshot.source_refs.push(structuredClone(f.snapshot.source_refs[0])); }],
  ['invalid state ID type', f => { state(f).evidence_ids[0] = null; }],
  ['claim ID missing from sources', f => {
    claims(f)[0].evidence_ids = ['FOREIGN_ID'];
    state(f).evidence_ids = [...new Set(claims(f).flatMap(claim => claim.evidence_ids))];
  }],
  ['source ID missing from claims', f => { claims(f)[0].sources[0].evidence_id = 'FOREIGN_ID';
    f.snapshot.source_refs = canonicalMarketSourceRefs(f.snapshot.generated_text); }],
  ['blank source ID', f => { claims(f)[0].sources[0].evidence_id = ' '; }],
  ['blank freshness', f => sourceContext(f, '')],
  ['unknown freshness', f => sourceContext(f, 'unknown')],
  ['null freshness', f => sourceContext(f, null)],
  ['invented freshness', f => sourceContext(f, 'verified')],
  ['stale freshness', f => sourceContext(f, 'stale')],
  ['market source cannot claim prior sector context', f => sourceContext(f, 'previous_trading_day', 'market_data')],
  ['news source cannot claim prior report context', f => sourceContext(f, 'previous_report', 'market_news')],
  ['sector context cannot claim current freshness', f => sourceContext(f, 'fresh', 'sector_rotation_scores')],
  ['previous report cannot claim current freshness', f => sourceContext(f, 'recent', 'reports')],
  ['prior report date cannot be the current report date', f => {
    sourceContext(f, 'previous_report', 'reports');
    for (const claim of claims(f)) for (const row of claim.sources) if (row.source === 'reports') row.source_date = f.report.report_date;
    f.snapshot.source_refs = canonicalMarketSourceRefs(f.snapshot.generated_text);
  }],
]) test(`quality100 and exact durable publication cannot waive malformed evidence: ${name}`, () => {
  const f = fixture(); assert.equal(evaluate(f).eligible, true, 'real baseline must pass first');
  mutate(f);
  assert.equal(state(f).document.quality.evidence_coverage, 100, 'No lowering or rewriting quality to force the negative');
  assert.equal(evaluate(f).eligible, false, name);
});

test('state evidence ordering is not authority, but its exact unique union is', () => {
  const f = fixture(); state(f).evidence_ids.reverse();
  assert.equal(evaluate(f).eligible, true);
  assert.deepEqual([...state(f).evidence_ids].sort(), [...new Set(claims(f).flatMap(claim => claim.evidence_ids))].sort());
});

test('a valid later publication cannot lend its healthy CMS to a corrupt frozen opening', () => {
  for (const mutate of [
    f => sourceContext(f, 'unknown'),
    f => { state(f).evidence_ids = []; },
    f => { claims(f)[0].sources[0].evidence_id = 'FOREIGN_ID';
      f.snapshot.source_refs = canonicalMarketSourceRefs(f.snapshot.generated_text); },
  ]) {
    const f = fixture(), date = f.report.report_date, current = structuredClone(f.snapshot);
    Object.assign(current, { id: 'later-published-revision', version: 2,
      created_at: date + 'T15:00:00+08:00', valid_from: date + 'T15:00:00+08:00' });
    const member = { ...f.member, decision_snapshot_id: current.id, decision_snapshot_version: current.version };
    const currentRun = structuredClone(f.publicationRun);
    currentRun.id = 'later-run'; currentRun.completed_at = date + 'T15:01:00+08:00';
    currentRun.provider_status.result.decision_snapshot_id = current.id;
    f.report.ai_strategy_json.revision_id = current.id;
    Object.assign(f.report.ai_strategy_json.market_publication_contract, { revision_id: current.id, publication_run_id: currentRun.id });
    f.report.ai_strategy_json.canonical_market_state = current.generated_text.canonical_market_state;
    const options = { todayDate: date, now: date + 'T16:00:00+08:00', publicationRun: currentRun };
    const currentProof = () => evaluatePublishedMarketDelivery(f.report, current, member,
      evaluateMarketReportGate(f.report.ai_strategy_json, date), options);
    const openingProof = () => validateOpeningPublication({ report: f.report, snapshot: f.snapshot,
      publicationRun: f.publicationRun, now: Date.parse(options.now) });
    assert.equal(currentProof().eligible, true); assert.equal(openingProof().status, 'PUBLISHED');
    mutate(f);
    assert.equal(currentProof().eligible, true, 'The later independent market publication stays valid');
    assert.equal(openingProof().status, 'BLOCKED', 'Frozen opening must pass the same actual market audit itself');
  }
});

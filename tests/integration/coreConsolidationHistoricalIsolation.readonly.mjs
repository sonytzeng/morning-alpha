// Optional actual-file provenance check. Only reads exact saved local output;
// does not connect to Docker, DB, Auth, providers, or a business handler.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { assertHistoricalIsolationProof, HISTORICAL_COMPANY_SYMBOLS } from '../helpers/coreConsolidationHistoricalIsolationProof.mjs';
const root = '/private/tmp/ma-consolidation-v1-20260909200000';
const hash = value => createHash('sha256').update(value).digest('hex');
const raw = readFileSync(root + '/final-persistent-readback.json');
const recordsRaw = readFileSync(root + '-evidence/result.json');
assert.equal(hash(raw), '35d2cc283ced1d28e733fa6feb069a5647aa26b5c2a8b26184edf416c9076d76');
assert.equal(hash(recordsRaw), 'fa0fcc81bf14a4a83b3acc38b29e2e6895eb329e4096ef5d560c277bb82a5838');
const db = JSON.parse(raw), result = JSON.parse(recordsRaw), report = db.tables.reports[0];
const ai = report.ai_strategy_json, debug = ai.v10_analysis_debug;
const path = new URL('../fixtures/consolidation-v1/content-os/fresh13-20260930-isolation.json', import.meta.url);
const bytes = readFileSync(path), view = JSON.parse(bytes);
assert.equal(hash(bytes), '84e7838c61c7c56138ea10d72407ae8e5efbeded3009a3209b40738aae5479b1');
assert.equal(view.scope, db.scope); assert.equal(view.report_id, report.id);
assert.equal(view.source_result.run_id, result.run_id); assert.equal(view.source_result.records, result.records.length);
const publication = result.records.find(row => row.stage === 'durable-publication');
for (const key of ['revision_id', 'member_revision_id', 'publication_run_id']) assert.equal(view[key], publication[key]);
const candidates = debug.candidate_universe.candidates.filter(row => HISTORICAL_COMPANY_SYMBOLS.includes(row.symbol));
const selected = candidates.map(row => JSON.parse(JSON.stringify({ symbol: row.symbol, name: row.name, aliases: row.aliases,
  eligibility: row.eligibility, excluded_reason: row.excluded_reason, trigger_tags: row.trigger_tags, related_evidence: row.related_evidence })));
assert.deepEqual(view.company_candidates, selected);
const ids = new Set(candidates.flatMap(row => row.related_evidence.map(ref => ref.evidence_id)));
assert.deepEqual(view.referenced_evidence_index, debug.evidence_index.filter(row => ids.has(row.evidence_id)));
assert.equal(view.universe_count, debug.candidate_universe.candidates.length);
assert.deepEqual(view.phase1, { candidate_count: debug.beneficiary_phase1.candidate_count, recommendations: debug.beneficiary_phase1.today_beneficiary_stocks_v10 });
assert.deepEqual(view.admission, { source_coverage: ai.research_generation_audit.source_quality.evidence_coverage,
  source_unsupported_claims: ai.research_generation_audit.source_quality.unsupported_claims,
  rejected_recommendations: ai.research_generation_audit.rejected_recommendations });
assert.deepEqual(view.market, { cms_status: ai.canonical_market_state.status, coverage: ai.canonical_market_state.document.quality.evidence_coverage,
  decision_mode: publication.opening.decision_mode, content_score: publication.observed_market_gate.content_score,
  recommendation_available: publication.recommendation_available, public_recommendations: ai.today_beneficiary_stocks_v10,
  canonical_stocks: ai.canonical_market_state.document.sections.representative_stocks });
assert.deepEqual(view.checkpoint_records, result.records.filter(row => row.stage === 'persisted-checkpoint'));
assert.deepEqual(view.public_export_records, result.records.filter(row => row.stage.startsWith('actual-public-export-')));
assert.deepEqual(view.downstream_records, result.records.filter(row => ['durable-closing', 'durable-learning', 'actual-manual-terminal-handler'].includes(row.stage)));
assert.deepEqual(view.handler_http, result.records.filter(row => row.stage.startsWith('handler:') && row.http !== undefined)
  .map(row => JSON.parse(JSON.stringify({ stage: row.stage, http: row.http, business_success: row.business_success }))));
assert.deepEqual(view.line_outbox, db.tables.line_delivery_outbox.map(row => JSON.parse(JSON.stringify({ id: row.id,
  status: row.status, report_date: row.report_date, report_id: row.report_id, sent_count: row.sent_count }))));
const acceptance = result.records.findLast(row => row.stage === 'actual-acceptance');
assert.deepEqual(view.acceptance, JSON.parse(JSON.stringify({ id: acceptance.id, verdict: acceptance.verdict, business_date: acceptance.business_date,
  automatic_stable_day: acceptance.evidence.automatic_stable_day, manual_intervention: acceptance.evidence.manual_intervention,
  content_handoff_evidence_scope: acceptance.evidence.content_handoff_evidence_scope })));
const output = { status: 'PASS', scope: db.scope, proof: assertHistoricalIsolationProof(view),
  result_sha256: hash(recordsRaw), readback_sha256: hash(raw), selected_view_sha256: hash(bytes),
  source_sha256: hash(readFileSync(new URL(import.meta.url))), reads_saved_outputs_only: true,
  business_requests: 0, new_e2e_execution: false, production_requests: 0 };
const receiptPath = root + '/historical-isolation-readonly-proof.json';
writeFileSync(receiptPath, JSON.stringify(output, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ ...output, path: receiptPath }));

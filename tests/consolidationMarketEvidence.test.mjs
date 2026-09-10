import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isolatedFunction } from './helpers/isolatedEdgeLoader.mjs';
import { assembleResearchMasterV2, assembleCanonicalMarketResearch, validateResearchMasterV2 } from '../supabase/functions/generate-daily-report-v7/research-master-v2.ts';
import { buildCanonicalMarketState, canonicalMarketDocument } from '../supabase/functions/_shared/canonical-market-state.ts';
import { evaluateMarketReportGate } from '../supabase/functions/_shared/market-report-gate.ts';
import { evaluateResearchQualityGate } from '../supabase/functions/_shared/research-quality-gate.ts';
import { canonicalReportProjection } from '../supabase/functions/_shared/research-pipeline-contract.ts';

// Reproducible counterfactual failure shape, NOT a reconstructed Production day.
// Source facts use the existing synthetic evidence fixture. The original
// 2026-09-09 observed 76% / five unsupported claims remains a separate capture.
function fixture() {
  const source = readFileSync(new URL('../supabase/functions/generate-daily-report-v7/research-master-v2.test.ts', import.meta.url), 'utf8');
  const input = isolatedFunction(source, 'completeFixture')();
  const ai = input.legacy;
  ai.today_quote = 'SOX 上漲帶動半導體風險偏好，09:30 先確認台積電與 TAIEX 是否同向；未確認前不追價，若權值轉弱就撤回偏多假設。';
  ai.v8_daily_sentence = { sentence: ai.today_quote };
  ai.free_summary = { one_sentence: ai.today_quote };
  ai.member_research_note_v2.today_core_thesis = ai.today_quote;
  ai.today_beneficiary_stocks_v10 = ['3034','3529','5274','3131','4763'].map(symbol => ({ symbol, name: `synthetic-${symbol}`, reason: '只有產業行情，沒有該公司的支持證據', evidence_refs: ['SEC001'] }));
  ai.data_quality = 'complete'; ai.missing_sources = []; ai.v10_beneficiary_enabled = true;
  ai.content_evidence_quality = { contract_version: 'PREMIUM_EVIDENCE_V1', verified_market_count: 3, verified_news_count: 1, blank_market_change_count: 0, all_news_traceable: true };
  const research = assembleResearchMasterV2(input);
  research.quality = validateResearchMasterV2(research, input).quality;
  // Captured summary remains a private rejected input; this number is never
  // used to fabricate the independently recomputed market document's quality.
  research.quality.evidence_coverage = 76;
  research.quality.publish_status = 'degraded';
  ai.stock_research = { schema_version: 'STOCK_RESEARCH_V1', report_date: input.reportDate, document: research };
  const market = assembleCanonicalMarketResearch(input);
  ai.canonical_market_state = buildCanonicalMarketState(market);
  ai.research_master_v2 = market;
  return { input, ai, research, market };
}

test('9/9 failure shape: five unsupported company claims cannot block independently audited market publication', () => {
  const { input, ai, research, market } = fixture();
  assert.equal(evaluateResearchQualityGate(research).eligible, false);
  assert.equal(research.quality.evidence_coverage, 76);
  assert.equal(market.sections.representative_stocks.length, 0);
  assert.equal(ai.canonical_market_state.status, 'READY', JSON.stringify(ai.canonical_market_state.reason_codes));
  const gate = evaluateMarketReportGate(ai, input.reportDate);
  assert.equal(gate.eligible, true, JSON.stringify(gate));
  assert.equal(gate.report_status, 'READY');
  assert.equal(gate.decision_mode, 'market_only');
  assert.equal(gate.recommendation_gate.status, 'BLOCKED');
  assert.equal(gate.recommendation_gate.universe_evaluation_complete, false);
  assert.notEqual(gate.recommendation_status, 'NO_QUALIFIED_OPPORTUNITY');
  const projected = canonicalReportProjection(ai, { decision_mode: gate.decision_mode, action: 'WAIT',
    generated_text: { market_report_gate: gate, daily_sentence: market.sections.core_thesis.statement, recommendations: [] } });
  assert.deepEqual(projected.today_beneficiary_stocks_v10, []);
  assert.equal(projected.stock_research.document.quality.evidence_coverage, 76, 'private failure is never overwritten');
  assert.equal(projected.opportunity_score, undefined);
  assert.ok(market.quality.coverage_audit.claims.every(claim => claim.scope === 'market' && claim.supported));
  assert.equal(market.quality.coverage_audit.numerator, market.quality.coverage_audit.denominator);
});

test('market scope does not forgive unsupported, missing, stale or contradictory market evidence', () => {
  for (const mutate of [
    input => { input.evidenceIndex[0].freshness = 'stale'; },
    input => { input.evidenceIndex[0].published_at = null; input.evidenceIndex[0].data_as_of = null; },
    input => { input.evidenceIndex[0].published_at = '2099-01-01T00:00:00Z'; },
    input => { input.legacy.missing_sources = ['market_data']; input.legacy.data_quality = 'insufficient'; },
  ]) {
    const { input, ai } = fixture(); mutate(input);
    const market = assembleCanonicalMarketResearch(input);
    ai.canonical_market_state = buildCanonicalMarketState(market); ai.research_master_v2 = market;
    assert.equal(evaluateMarketReportGate(ai, input.reportDate).eligible, false);
  }
  const { input, ai, market } = fixture();
  market.quality.unsupported_claims.push('actual unsupported market assertion');
  ai.canonical_market_state = buildCanonicalMarketState(market);
  assert.equal(evaluateMarketReportGate(ai, input.reportDate).eligible, false);
});

test('canonical market identity mismatch never falls back to a valid legacy research alias', () => {
  const { input, ai } = fixture();
  ai.canonical_market_state.report_date = '2026-07-13';
  assert.deepEqual(canonicalMarketDocument(ai), {});
  assert.equal(evaluateMarketReportGate(ai, input.reportDate).eligible, false);
});

test('removing a stock row is not permission to hide its assertion in a market claim ledger', () => {
  const { market } = fixture();
  market.quality.coverage_audit.claims[0].scope = 'stock';
  const result = buildCanonicalMarketState(market);
  assert.equal(result.status, 'INSUFFICIENT_EVIDENCE');
  assert.ok(result.reason_codes.includes('market_claim_ledger_incomplete'));
});

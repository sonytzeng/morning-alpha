import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalDecisionAction } from '../supabase/functions/_shared/canonical-decision-contract.mjs';
import { buildCanonicalDecisionContract, buildCanonicalMemberResearchRevision, evaluateCanonicalSemanticCoherenceGate } from '../supabase/functions/_shared/production-architecture-core.mjs';

// Synthetic local contract fixtures only. No production rows, provider evidence,
// generated reports, or real subscriber identities are used by these tests.
function marketFixture() {
  const reportDate = '2026-09-08';
  const marketGate = { contract_version: 'MARKET_REPORT_GATE_V2', report_date: reportDate,
    eligible: true, status: 'READY_MARKET_ONLY', report_status: 'READY', decision_mode: 'market_only', reason_codes: [],
    recommendation_status: 'BLOCKED', recommendation_gate: { eligible: false, status: 'BLOCKED',
      universe_evaluation_complete: false, screening: { status: 'INCOMPLETE', universe_count: 3, evaluated_count: 0, rejected: [] } } };
  const snapshot = { id: 'synthetic-market-published', version: 8, report_date: reportDate,
    decision_mode: 'market_only', action: canonicalDecisionAction('market_only'), source_refs: ['synthetic:market:sox', 'synthetic:market:vix'],
    generated_text: { daily_sentence: '合成市場證據：半導體偏多假設等待市場廣度確認。', recommendations: [], market_report_gate: marketGate } };
  const ai = { data_quality: 'complete', v10_data_quality_status: 'insufficient',
    member_research_note_v2: { data_status: 'insufficient', today_core_thesis: '未發布 QA 草稿', representative_stocks: [{ symbol: 'TEST-OLD' }] },
    today_beneficiary_stocks_v10: [{ symbol: 'TEST-OLD' }],
    research_master_v2: { report_date: reportDate, today_date: reportDate, provenance: { source_status: 'complete' }, sections: {
      core_thesis: { statement: snapshot.generated_text.daily_sentence },
      transmission_narrative: { narrative: '合成市場證據：半導體風險偏好傳導至台灣市場，仍需廣度同步。',
        path: [{ stage: 'industry', subject: '半導體' }], primary_validation_axis: '半導體與市場廣度同向' },
      decision_guide: { first_watch: '市場廣度是否同步', next_checkpoint_time: '09:30' },
      failure_scenario: { triggers: [{ condition: '若市場廣度轉弱則撤回偏多假設' }] },
      timeline: [{ time: '09:30', expected_signal: '市場廣度同步確認' }],
    } } };
  const contract = buildCanonicalDecisionContract({ snapshot, ai });
  const member = buildCanonicalMemberResearchRevision({ canonical_contract: contract, snapshot, ai });
  const semantic = { canonical_contract: contract, recommendations: [],
    sections: { public_thesis: snapshot.generated_text.daily_sentence, member_thesis: member.today_core_thesis, taiwan_transmission: member.taiwan_transmission },
    quality_inputs: [ai.data_quality, ai.research_master_v2.provenance.source_status],
    quality_counters: { unsupported_claim_count: 0, contradiction_count: 0, duplicate_claim_count: 0, missing_section_count: 0 },
    evidence_coverage: 100, content_score: 95, checked_at: '2026-09-08T00:00:00Z' };
  return { ai, snapshot, contract, member, semantic };
}

test('market-only is WAIT, not STOP or a claimed completed no-opportunity assessment', () => {
  const { contract, member, semantic } = marketFixture();
  assert.equal(canonicalDecisionAction('market_only'), 'WAIT');
  assert.equal(contract.action, 'WAIT');
  assert.equal(contract.decision_mode, 'market_only');
  assert.equal(contract.market_report_gate.recommendation_gate.status, 'BLOCKED');
  assert.equal(member.action, 'WAIT');
  assert.deepEqual(contract.primary_symbols, []);
  assert.deepEqual(member.representative_stocks, []);
  assert.deepEqual(member.beneficiary_candidates, []);
  assert.doesNotMatch(JSON.stringify(member), /TEST-OLD|未發布 QA/);
  assert.equal(evaluateCanonicalSemanticCoherenceGate(semantic).status, 'PASSED');
});

test('complete market semantic contract remains complete independently of insufficient private stock QA', () => {
  const { contract, member, semantic } = marketFixture();
  assert.equal(contract.data_quality_status, 'complete');
  assert.equal(member.source_member_data_status, 'insufficient', 'Private deficiency stays visible as provenance, never upgraded');
  assert.deepEqual(member.intraday_validation, contract.validation_signals);
  assert.deepEqual(member.invalidation_conditions, contract.invalidation_conditions);
  assert.deepEqual(member.source_refs, contract.evidence_refs);
  assert.equal(evaluateCanonicalSemanticCoherenceGate(semantic).eligible, true);
  assert.equal(evaluateCanonicalSemanticCoherenceGate({ ...semantic, quality_inputs: ['insufficient'] }).eligible, false, 'Actual market source deficiency is not exempted');
});

test('market-only keeps mandatory real evidence, invalidation, 100% coverage and editorial 90 floor', () => {
  const { semantic } = marketFixture();
  for (const field of ['evidence_refs', 'invalidation_conditions', 'validation_signals']) {
    const result = evaluateCanonicalSemanticCoherenceGate({ ...semantic, canonical_contract: { ...semantic.canonical_contract, [field]: [] } });
    assert.equal(result.status, 'BLOCKED', field);
    assert.ok(result.conflicting_fields.includes(field), field);
  }
  for (const change of [{ content_score: 89 }, { evidence_coverage: 99 }, { quality_counters: { ...semantic.quality_counters, unsupported_claim_count: 1 } }]) {
    assert.equal(evaluateCanonicalSemanticCoherenceGate({ ...semantic, ...change }).eligible, false, JSON.stringify(change));
  }
});

test('market-only rejects forged publication proof, cross-date gate, failed source and injected stocks', () => {
  const { contract, semantic } = marketFixture();
  for (const patch of [{ eligible: false }, { report_date: '2026-09-06' }, { status: 'PARTIAL' }, { contract_version: null },
    { reason_codes: ['MARKET_EVIDENCE_MISSING'] }, { recommendation_gate: { eligible: true, status: 'QUALIFIED' } }]) {
    const result = evaluateCanonicalSemanticCoherenceGate({ ...semantic, canonical_contract: { ...contract, market_report_gate: { ...contract.market_report_gate, ...patch } } });
    assert.equal(result.eligible, false, JSON.stringify(patch));
    assert.ok(result.reason_codes.includes('MARKET_PUBLICATION_PROOF_INVALID'));
  }
  for (const patch of [{ recommendations: [{ symbol: 'TEST-NEW' }] }, { canonical_contract: { ...contract, primary_symbols: ['TEST-NEW'] } }]) {
    const result = evaluateCanonicalSemanticCoherenceGate({ ...semantic, ...patch });
    assert.ok(result.reason_codes.includes('MARKET_ONLY_RECOMMENDATIONS_FORBIDDEN'));
  }
});

test('market-only NO_QUALIFIED still requires positive complete universe proof and no rejected evidence', () => {
  const { contract, semantic } = marketFixture();
  const recommendation = { eligible: false, status: 'NO_QUALIFIED_OPPORTUNITY', universe_evaluation_complete: true,
    screening: { status: 'COMPLETE', universe_count: 3, evaluated_count: 3, rejected: [] } };
  const evaluate = value => evaluateCanonicalSemanticCoherenceGate({ ...semantic, canonical_contract: { ...contract,
    market_report_gate: { ...contract.market_report_gate, recommendation_status: value.status, recommendation_gate: value } } });
  assert.equal(evaluate(recommendation).eligible, true);
  for (const patch of [{ universe_evaluation_complete: false }, { screening: { ...recommendation.screening, evaluated_count: 2 } },
    { screening: { ...recommendation.screening, rejected: ['MISSING_EVIDENCE'] } }, { screening: { ...recommendation.screening, universe_count: 0, evaluated_count: 0 } }]) {
    assert.equal(evaluate({ ...recommendation, ...patch }).eligible, false, JSON.stringify(patch));
  }
});

test('legacy no_trade WAIT and its existing canonical semantics are unchanged', () => {
  const snapshot = { id: 'synthetic-legacy-no-trade', report_date: '2026-09-08', version: 2, decision_mode: 'no_trade',
    action: canonicalDecisionAction('no_trade'), source_refs: ['synthetic:market:verified'],
    generated_text: { daily_sentence: '完整評估後等待市場條件改善', recommendations: [], next_checkpoint: '09:30', reasons: ['市場條件尚未同步'] } };
  const contract = buildCanonicalDecisionContract({ snapshot, ai: { data_quality: 'complete' } });
  assert.equal(contract.action, 'WAIT');
  assert.equal(contract.decision_mode, 'no_trade');
  assert.equal(contract.primary_taiwan_theme, '不建立受惠股');
  assert.deepEqual(contract.invalidation_conditions, []);
  const { semantic } = marketFixture();
  const result = evaluateCanonicalSemanticCoherenceGate({ ...semantic, canonical_contract: contract, sections: {}, recommendations: [] });
  assert.equal(result.status, 'PASSED', JSON.stringify(result));
});

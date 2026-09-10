import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { URL } from 'node:url';
import { isolatedFunction } from './helpers/isolatedEdgeLoader.mjs';
import { evaluateMarketReportGate } from '../supabase/functions/_shared/market-report-gate.ts';
import { evaluatePublishedMarketDelivery, readPublishedMarketDecision, readPublishedMemberRevision } from '../supabase/functions/_shared/market-publication-contract.ts';
import { validateOpeningPublication, resolveOpeningPublicationIdentity, resolveClosingReceiptPointer, evaluateClosingContract } from '../supabase/functions/_shared/closing-learning-contract.ts';
import { buildCanonicalMarketState, canonicalMarketSourceRefs } from '../supabase/functions/_shared/canonical-market-state.ts';
import { evaluatePremiumContentGate } from '../supabase/functions/_shared/premium-content-gate.ts';
import { resolveMarketStatus } from '../supabase/functions/_shared/market-status.ts';
import { buildCanonicalIntradaySyncStatus } from '../supabase/functions/_shared/runtime-report-state.ts';
import { resolveCanonicalRuntimeMarketStatus } from '../supabase/functions/_shared/canonical-runtime-market-status.mjs';
import { resolveCanonicalDataQuality } from '../supabase/functions/_shared/production-architecture-core.mjs';
import { canonicalAdminReaderProjection } from '../supabase/functions/_shared/research-pipeline-contract.ts';
import { assembleCanonicalMarketResearch, assembleResearchMasterV2, validateResearchMasterV2 } from '../supabase/functions/generate-daily-report-v7/research-master-v2.ts';
import { createSubscriberState, getSubscriberReportProjection, parseSubscriberState, INCOMPLETE_ANALYSIS_MESSAGE, RECOMMENDATION_INSUFFICIENT_MESSAGE } from '../shared/subscriber-state-contract.ts';

const source = readFileSync(new URL('../supabase/functions/get-report-payload/index.ts', import.meta.url), 'utf8');
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const deps = { readPublishedMarketDecision, readPublishedMemberRevision, asObject: object, asArray: v => Array.isArray(v) ? v : [],
  toStringValue: v => typeof v === 'string' && v.trim() ? v : null,
  toNumberValue: v => typeof v === 'number' ? v : null,
  getAi: r => object(r.ai_strategy_json), getReportDate: r => r.report_date };

function database(tables, trace) {
  return { from(table) {
    const filters = [], orders = []; let limit = Infinity;
    const q = { select() { return q; }, eq(k,v) { filters.push([k,v]); return q; },
      order(k,{ascending,referencedTable}) { if (!referencedTable) orders.push([k,ascending]); return q; },
      limit(n,{referencedTable}={}) { if (!referencedTable) limit=n; return q; },
      async maybeSingle() {
        trace.push({table,filters});
        const rows = (tables[table] || []).filter(row => filters.every(([k,v])=>row[k]===v));
        for (const [k,asc] of orders.reverse()) rows.sort((a,b)=>(a[k]<b[k]?-1:a[k]>b[k]?1:0)*(asc?1:-1));
        return {data:rows.slice(0,limit)[0] || null,error:null};
      } };
    return q;
  } };
}

test('published pointer wins over newer internal QA and includes an intraday revision', async () => {
  const query = isolatedFunction(source,'publishedDecisionQuery',deps);
  const trace=[];
  const report={id:'report-today',report_date:'2026-09-08',ai_strategy_json:{revision_id:'published-intraday'}};
  const db=database({decision_snapshots:[
    {id:'draft',report_id:report.id,report_date:report.report_date,session_type:'PREMARKET',version:99,is_current:true,status:'PARTIAL'},
    {id:'published-intraday',report_id:report.id,report_date:report.report_date,session_type:'INTRADAY',version:8,is_current:false,status:'READY'},
    {id:'holiday',report_id:'old',report_date:'2026-09-06',session_type:'PREMARKET',version:100,is_current:true,status:'READY'},
  ]},trace);
  const result=await query(db,report);
  assert.equal(result.data.id,'published-intraday');
  assert.equal(result.data.report_date,'2026-09-08');
  assert.deepEqual(trace[0].filters,[['report_date','2026-09-08'],['report_id','report-today'],['id','published-intraday']]);
  assert.equal((await query(db,{...report,ai_strategy_json:{revision_id:'missing'}})).data,null,'Missing pinned revision must not silently fall back to QA or Sunday');
  assert.equal((await query(db,{...report,ai_strategy_json:{}})).data,null,'Absent publication pointer must not select latest private QA');
});

test('published member content is pinned independently and requires real matching semantic result',async()=>{
  const query=isolatedFunction(source,'publishedMemberQuery',deps);
  const eligible=isolatedFunction(source,'isCanonicalMemberRevisionEligible',deps);
  const report={id:'r',report_date:'2026-09-08',ai_strategy_json:{revision_id:'d',canonical_member_revision_id:'m'}};
  const decision={id:'d',report_id:'r',report_date:report.report_date,version:8};
  const member={id:'m',report_id:'r',report_date:report.report_date,decision_snapshot_id:'d',decision_snapshot_version:8,revision:8,status:'PASSED'};
  const trace=[];
  const tables={member_content_revisions:[{...member,semantic_coherence_reviews:[{member_content_revision_id:'m',canonical_snapshot_id:'d',canonical_snapshot_version:8,status:'PASSED',reason_codes:[],checked_at:'2026-09-08T02:00:00Z'}]},
    {...member,id:'qa',revision:99,status:'BLOCKED'}]};
  const r=await query(database(tables,trace),report);
  assert.equal(r.data.id,'m');
  assert.equal(eligible({decisionSnapshot:decision,memberContentRevision:r.data}),true);
  assert.equal((await query(database(tables,[]),{...report,ai_strategy_json:{revision_id:'d'}})).data,null,'Missing member pointer cannot fall back to current QA');
  tables.member_content_revisions[0].semantic_coherence_reviews[0].canonical_snapshot_version=99;
  assert.equal((await query(database(tables,[]),report)).data.semantic_status,null,'Wrong semantic revision cannot qualify the published member row');
  tables.member_content_revisions[0].semantic_coherence_reviews[0].canonical_snapshot_version=8;
  for(const change of [{semantic_status:'BLOCKED'},{semantic_reason_codes:['UNSUPPORTED']},{semantic_reason_codes:null},
    {decision_snapshot_id:'other'},{decision_snapshot_version:9},{report_date:'2026-09-06'},{report_id:'other'}, {status:'BLOCKED'}]) {
    assert.equal(eligible({decisionSnapshot:decision,memberContentRevision:{...r.data,...change}}),false,JSON.stringify(change));
  }
  tables.member_content_revisions[0].semantic_coherence_reviews=[];
  assert.equal(eligible({decisionSnapshot:decision,memberContentRevision:(await query(database(tables,[]),report)).data}),false);
});

test('market publication eligibility has no Premium/QA gate dependency; recommendation counts remain separately gated',()=>{
  const publicBody=source.slice(source.indexOf('function buildPublicPayload('),source.indexOf('function buildMemberPayload('));
  assert.match(publicBody,/marketPublished = subscriberProjection\.analysisAvailable/);
  assert.match(publicBody,/subscriberProjection = getSubscriberReportProjection/);
  assert.match(publicBody,/publicationVerified = !ctx\.publicationEvidence\?\.queryBoundExceeded && delivered\.eligible/);
  assert.match(publicBody,/evaluatePublishedMarketDelivery\(readerReport/);
  assert.match(publicBody,/publicationVerified, marketEvidenceReady: publicationVerified/);
  assert.doesNotMatch(publicBody,/publicationVerified: publicationAligned|marketEvidenceReady: marketGate\.eligible/);
  assert.match(publicBody,/analysisStatus: ctx\.decisionSnapshot\?\.status/);
  assert.match(publicBody,/overall_status: marketPublished \? "eligible" : "blocked"/);
  assert.doesNotMatch(publicBody,/overall_status:.*semanticEligible/);
  assert.match(publicBody,/recommendationsEligible = premiumEligible && marketPublished && subscriberProjection\.recommendation\.available/);
  assert.match(publicBody,/one_teaser_stock: recommendationsEligible \?/);
  assert.match(publicBody,/recommendation_count: recommendationsEligible \? premiumGate\.recommendation_count : 0/);
  assert.match(source,/companyContentAllowed:[\s\S]*?asObject\(publicMetadata\.recommendation_gate\)\.eligible === true/);
});

test('latest reader is bounded by server Taipei today and never queries history after a same-day alignment failure',()=>{
  const handler=source.slice(source.indexOf('Deno.serve('));
  assert.match(handler,/timeZone: "Asia\/Taipei"/);
  assert.match(handler,/\.lte\("report_date", todayDate\)/);
  assert.match(handler,/today_date: todayDate/);
  const retry=handler.slice(handler.indexOf('if (!isPublishedReadAligned(report, context))'),handler.indexOf('const publicMetadata'));
  assert.match(retry,/\.eq\("id", report.id\)\.eq\("report_date", getReportDate\(report\)\)/);
  assert.match(retry,/REPORT_REVISION_CHANGED/);
  assert.doesNotMatch(retry,/lt\("report_date"|previous|history|latest_report/);
});

// These are the actual product functions and their pure dependency graph. Only
// report/database rows below are synthetic local fixtures; no gate is mocked.
const projectionNames = ['asObject', 'asArray', 'parseAi', 'toStringValue', 'toNumberValue', 'isValidDate', 'getAi',
  'normalizeClosingOutcome', 'buildAuthoritativeClosingVerification', 'sanitizeRuntimeCompletionEvidence', 'getEffectiveAi', 'normalizeDataQualityToken',
  'getCanonicalPayloadQuality', 'isCanonicalMemberRevisionEligible', 'getImportantNews', 'buildPublicNews',
  'buildPublicOpeningRadar', 'buildPublicValidationSkeleton', 'getReportDate', 'getMarketBias', 'getConfidenceScore',
  'getConfidenceBand', 'getTodayQuote', 'getGeneratedAt', 'getMarketDate', 'toIsoTimestamp', 'getDataAsOf',
  'getCanonicalMarketMetadata', 'getReportMode', 'getConfidenceLabel', 'getBeneficiaryArrays', 'isV10BeneficiaryEnabled',
  'getBeneficiaryCount', 'buildCanonicalTeaserStock', 'buildClosingVerdict', 'buildClosingSummary', 'buildCanonicalDecision',
  'isPublishedReadAligned', 'projectMarketOnlyMemberNote', 'buildPublicPayload', 'buildMemberPayload', 'buildVipPayload', 'buildAdminPayload', 'buildHistoryClosingVerdict', 'buildHistorySummary'];
const projections = {};
const projectionDeps = { evaluateMarketReportGate, evaluatePremiumContentGate, resolveMarketStatus,
  evaluatePublishedMarketDelivery, validateOpeningPublication, resolveOpeningPublicationIdentity, resolveClosingReceiptPointer, evaluateClosingContract,
  buildCanonicalIntradaySyncStatus, resolveCanonicalRuntimeMarketStatus, resolveCanonicalDataQuality, canonicalAdminReaderProjection,
  createSubscriberState, getSubscriberReportProjection, INCOMPLETE_ANALYSIS_MESSAGE, RECOMMENDATION_INSUFFICIENT_MESSAGE,
  ...Object.fromEntries(projectionNames.map(name => [name, (...args) => projections[name](...args)])) };
for (const name of projectionNames) projections[name] = isolatedFunction(source, name, projectionDeps);

function verifiedHistoryFixture() {
  const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
  return isolatedFunction(read('tests/consolidationPerformanceHistory.test.mjs'), 'fixture', {
    isolatedFunction, read, assert, structuredClone, assembleCanonicalMarketResearch, buildCanonicalMarketState,
    canonicalMarketSourceRefs, evaluateMarketReportGate,
  })();
}

test('merged checkpoint completion rejects previous-day overlays without rewriting their evidence', () => {
  const at = '2026-09-07T12:05:42.55516+00:00';
  const original = { report_date: '2026-09-08', current_state: 'CLOSE_1410_CAPTURED', state_rank: 90,
    captured_at: at, last_checked_at: at, ledger_guarantee: true, lifecycle_complete: true,
    warning: '已完成 5 個盤中驗證節點。', windows: {
      '1410': { status: 'completed', completed_at: at, real_checkpoint_observation: true,
        evidence: { source: 'trading_day_state', state: 'CLOSE_1410_CAPTURED', canonical_complete: true } },
    } };
  const before = JSON.stringify(original);
  const result = projections.sanitizeRuntimeCompletionEvidence(original, '2026-09-08', Date.parse('2026-09-08T04:30:00Z'));
  assert.equal(result.windows['1410'].status, 'insufficient');
  assert.equal(result.windows['1410'].completed_at, null);
  assert.equal(result.windows['1410'].real_checkpoint_observation, false);
  assert.equal(result.windows['1410'].diagnostic.original_completed_at, at);
  assert.ok(result.windows['1410'].diagnostic.reason_codes.includes('CHECKPOINT_COMPLETION_DATE_MISMATCH'));
  assert.equal(result.current_state, null); assert.equal(result.state_rank, null);
  assert.equal(result.captured_at, null); assert.equal(result.last_checked_at, null);
  assert.equal(result.lifecycle_complete, false); assert.equal(result.ledger_guarantee, false);
  assert.match(result.warning, /^已完成 0 個/); assert.doesNotMatch(result.warning, /已完成 5 個/);
  assert.equal(JSON.stringify(original), before, 'Read projection must never alter the persisted object');
});

test('future completion timestamps and future scheduled checkpoints cannot appear completed', () => {
  const result = projections.sanitizeRuntimeCompletionEvidence({ report_date: '2026-09-08', windows: {
    '1300': { status: 'completed', completed_at: '2026-09-08T05:01:00Z', evidence: { source: 'local-synthetic' } },
    '1410': { status: 'completed', completed_at: '2026-09-08T02:00:00Z', evidence: { source: 'local-synthetic' } },
  } }, '2026-09-08', Date.parse('2026-09-08T04:30:00Z'));
  for (const key of ['1300', '1410']) {
    assert.equal(result.windows[key].status, 'insufficient');
    assert.ok(result.windows[key].diagnostic.reason_codes.includes('FUTURE_RUNTIME_EVIDENCE'));
  }
});

test('missing invalid or timezone-less completion timestamp stays insufficient even with structured evidence', () => {
  for (const completed_at of [undefined, null, '', 'not-a-date', '2026-09-08', '2026-09-08T09:01:00', 123]) {
    const result = projections.sanitizeRuntimeCompletionEvidence({ report_date: '2026-09-08', windows: {
      '0900': { status: 'completed', completed_at, real_checkpoint_observation: true, evidence: { source: 'local-synthetic' } },
    } }, '2026-09-08', Date.parse('2026-09-08T04:30:00Z'));
    assert.equal(result.windows['0900'].status, 'insufficient', String(completed_at));
    assert.ok(result.windows['0900'].diagnostic.reason_codes.includes('CHECKPOINT_COMPLETION_TIMESTAMP_INVALID'));
  }
  const legacyString = projections.sanitizeRuntimeCompletionEvidence({ report_date: '2026-09-08',
    checkpoint: '0900', checkpoint_status: 'completed', captured_at: '2026-09-07T01:00:00Z',
    last_checked_at: '2026-09-07T01:00:00Z', windows: { '0900': 'completed' },
  }, '2026-09-08', Date.parse('2026-09-08T04:30:00Z'));
  assert.equal(legacyString.windows['0900'].status, 'insufficient', 'Legacy string window cannot reuse sync timestamps as completed evidence');
});

test('valid same-day completions are retained and summaries count only the retained evidence', () => {
  const original = { report_date: '2026-09-08', windows: {
    '0900': { status: 'completed', completed_at: '2026-09-08T09:00:10+08:00', evidence: { state: 'MARKET_OPEN_CAPTURED' } },
    '0930': { status: 'completed', completed_at: '2026-09-08T01:31:00Z', evidence: { state: 'CHECKPOINT_0930_CAPTURED' } },
    '1030': { status: 'completed', completed_at: '2026-09-07T02:31:00Z', evidence: { state: 'CHECKPOINT_1030_CAPTURED' } },
  } };
  const result = projections.sanitizeRuntimeCompletionEvidence(original, '2026-09-08', Date.parse('2026-09-08T04:30:00Z'));
  assert.equal(result.windows['0900'], original.windows['0900']);
  assert.equal(result.windows['0930'], original.windows['0930']);
  assert.equal(result.windows['1030'].status, 'insufficient');
  assert.equal(result.checkpoint, '0930'); assert.equal(result.current_state, 'CHECKPOINT_0930_CAPTURED');
  assert.equal(result.captured_at, '2026-09-08T01:31:00Z'); assert.match(result.warning, /^已完成 2 個/);
  const validOnly = { report_date: original.report_date, windows: { '0900': original.windows['0900'] } };
  assert.equal(projections.sanitizeRuntimeCompletionEvidence(validOnly, '2026-09-08', Date.parse('2026-09-08T04:30:00Z')), validOnly);
});

test('sanitizing after the real overlay merge prevents an unrecognized filtered ledger status from reviving stale completion', () => {
  const old = { report_date: '2026-09-08', windows: { '1410': {
    status: 'completed', completed_at: '2026-09-07T12:05:42.55516+00:00',
    real_checkpoint_observation: true, evidence: { source: 'trading_day_state', state: 'CLOSE_1410_CAPTURED' },
  } } };
  const ledger = { trading_date: '2026-09-08', current_state: 'CLOSE_1410_CAPTURED',
    checkpoint_status: { '1410': { status: 'INSUFFICIENT_DATA', metadata: { error_code: 'FUTURE_RUNTIME_EVIDENCE' } } } };
  const merged = buildCanonicalIntradaySyncStatus(old, ledger);
  assert.equal(merged.windows['1410'].status, 'completed', 'Demonstrates the preserved-overlay hazard; producer is not modified');
  const { report, ctx } = projectionFixture();
  report.ai_strategy_json.intraday_sync_status = old;
  ctx.tradingDayState = ledger;
  const result = projections.getEffectiveAi(report, ctx);
  assert.equal(result.intraday_sync_status.windows['1410'].status, 'insufficient');
  assert.equal(result.intraday_sync_status.current_state, null);
  assert.equal(report.ai_strategy_json.intraday_sync_status.windows['1410'].status, 'completed');
});

function projectionFixture() {
  const fixtureSource = readFileSync(new URL('./premiumContentGate.test.mjs', import.meta.url), 'utf8');
  const ai = isolatedFunction(fixtureSource, 'validAi')();
  ai.missing_sources = []; // This complete market fixture has no missing measured source.
  // A subscriber publication test needs the real complete research contract,
  // not the old Premium-only fixture's incomplete master stub.
  const masterFixtureSource = readFileSync(new URL('../supabase/functions/generate-daily-report-v7/research-master-v2.test.ts', import.meta.url), 'utf8');
  const masterInput = isolatedFunction(masterFixtureSource, 'completeFixture')();
  masterInput.reportDate = '2026-09-08'; masterInput.todayDate = masterInput.reportDate;
  masterInput.generatedAt = '2026-09-08T00:01:00Z'; masterInput.dataAsOf = '2026-09-08T00:00:00Z';
  for (const row of masterInput.evidenceIndex) row.published_at = row.published_at.replace('2026-07-13', '2026-09-07');
  const marketSentence = 'SOX 上漲帶動半導體風險偏好，09:30 先確認台積電與 TAIEX 是否同向；未確認前不追價，若權值轉弱就撤回偏多假設。';
  Object.assign(masterInput.legacy, { today_quote: marketSentence, v8_daily_sentence: { sentence: marketSentence },
    free_summary: { one_sentence: marketSentence }, today_beneficiary_stocks_v10: [] });
  masterInput.legacy.member_research_note_v2.today_core_thesis = marketSentence;
  const master = assembleCanonicalMarketResearch(masterInput);
  ai.research_master_v2 = master;
  ai.canonical_market_state = buildCanonicalMarketState(structuredClone(master));
  const report = { id: 'synthetic-report', report_date: '2026-09-08', created_at: '2026-09-08T00:00:00Z',
    summary: 'OLD_SYNTHETIC_QA', ai_strategy_json: { ...ai, revision_id: 'synthetic-published', canonical_member_revision_id: 'synthetic-member' } };
  const decisionSnapshot = { id: 'synthetic-published', report_id: report.id, report_date: report.report_date, version: 8,
    status: 'READY', action: 'WAIT', decision_mode: 'recommendations', market_regime: '中性觀察',
    content_score: evaluateMarketReportGate(ai, report.report_date).content_score, coverage_score: 100,
    created_at: masterInput.generatedAt, source_refs: canonicalMarketSourceRefs(ai),
    generated_text: { daily_sentence: master.sections.executive_summary.text, recommendations: [],
      canonical_market_state: structuredClone(ai.canonical_market_state),
      content_evidence_quality: structuredClone(ai.content_evidence_quality), data_quality: ai.data_quality,
      missing_sources: structuredClone(ai.missing_sources) } };
  const ctx = { openingRadar: null, sectorRotationRows: [], marketDataSnapshots: [], decisionSnapshot,
    closingDecisionSnapshot: null, closeMarketReview: null, learningRun: null, learningMetricCorrection: null,
    tradingDayState: null, componentQueryFailures: [], evaluatedAt: '2026-09-08T07:30:00Z', todayDate: '2026-09-08',
    memberContentRevision: { id: 'synthetic-member', report_id: report.id, report_date: report.report_date,
      decision_snapshot_id: decisionSnapshot.id, decision_snapshot_version: decisionSnapshot.version,
      status: 'PASSED', semantic_status: 'PASSED', semantic_reason_codes: [], member_content: {
        ...ai.member_research_note_v2, representative_stocks: [{ symbol: 'SYNTHETIC-LEGACY-STOCK' }],
        beneficiary_candidates: [{ symbol: 'SYNTHETIC-LEGACY-STOCK' }],
        first_beneficiary_stock: { symbol: 'SYNTHETIC-LEGACY-STOCK' },
        taiwan_impact_map: { affected_stocks: ['SYNTHETIC-LEGACY-STOCK'] },
        canonical_contract: { primary_symbols: ['SYNTHETIC-LEGACY-STOCK'] },
      } } };
  assert.equal(evaluatePremiumContentGate(ai, 0).eligible, true, 'Fixture retains independent paid-content eligibility');
  assert.equal(evaluateMarketReportGate(ai, report.report_date).eligible, true, JSON.stringify(evaluateMarketReportGate(ai, report.report_date)));
  assert.equal(evaluateMarketReportGate(ai, report.report_date).recommendation_gate.status, 'BLOCKED', 'No fresh audited company evidence fixture');
  assert.equal(projections.isCanonicalMemberRevisionEligible(ctx), true);
  return { report, ctx };
}

test('blocked recommendation gate with otherwise eligible Premium and semantic revision withholds every legacy note stock path', () => {
  const { report, ctx } = projectionFixture();
  for (const name of ['buildMemberPayload', 'buildVipPayload']) {
    const payload = projections[name](report, ctx);
    assert.equal(payload.premium_content_status, 'blocked');
    assert.ok(payload.premium_content_reason_codes.includes('RECOMMENDATION_NOTE_NOT_PUBLISHED'));
    assert.equal(payload.canonical_decision.daily_sentence, ctx.decisionSnapshot.generated_text.canonical_market_state.document.sections.executive_summary.text);
    assert.equal(payload.canonical_decision.recommendations, undefined);
    assert.equal(payload.one_teaser_stock, null);
    assert.equal(payload.recommendation_count, 0);
    assert.doesNotMatch(JSON.stringify(payload), /SYNTHETIC-LEGACY-STOCK/);
  }
});

test('explicit market-only note projects only canonical market fields; unknown stock aliases and VIP legacy prose remain private', () => {
  const { report, ctx } = projectionFixture();
  const note = ctx.memberContentRevision.member_content;
  note.representative_stocks = []; note.beneficiary_candidates = [];
  note.canonical_contract = { decision_mode: 'market_only', primary_symbols: [], market_report_gate: { eligible: true },
    primary_causal_chain: ['合成市場敘事'], validation_signals: ['合成市場驗證'], invalidation_conditions: ['合成市場失效條件'], evidence_refs: ['synthetic:market'] };
  note.today_core_thesis = '合成市場敘事'; note.strategy_summary = '合成市場敘事';
  note.source_refs = ['synthetic:market']; note.intraday_validation = ['合成市場驗證']; note.invalidation_conditions = ['合成市場失效條件'];
  for (const field of ['fund_flow_scenario', 'market_mispricing', 'institutional_behavior', 'tomorrow_extension_watch']) {
    note[field] = 'SYNTHETIC-LEGACY-STOCK'; report.ai_strategy_json[field] = 'SYNTHETIC-LEGACY-STOCK';
  }
  const member = projections.buildMemberPayload(report, ctx);
  assert.equal(member.premium_content_status, 'eligible');
  assert.equal(member.member_research_note_v2.today_core_thesis, '合成市場敘事');
  assert.equal(member.member_research_note_v2.first_beneficiary_stock, undefined);
  assert.equal(member.member_research_note_v2.taiwan_impact_map, undefined);
  assert.doesNotMatch(JSON.stringify(member), /SYNTHETIC-LEGACY-STOCK/);
  const vip = projections.buildVipPayload(report, ctx);
  assert.equal(vip.recommendation_gate.eligible, false);
  for (const field of ['fund_flow_scenario', 'market_mispricing', 'institutional_behavior', 'tomorrow_extension_watch']) assert.equal(vip[field], undefined, field);
  assert.doesNotMatch(JSON.stringify(vip), /SYNTHETIC-LEGACY-STOCK/);
});

test('public summary and daily sentence are allowlisted rather than spreading raw stock-bearing aliases', () => {
  const { report, ctx } = projectionFixture();
  for (const field of ['public_summary', 'free_summary', 'v8_daily_sentence']) {
    report.ai_strategy_json[field] = { sentence: 'OLD_SYNTHETIC_QA', daily_sentence: 'OLD_SYNTHETIC_QA',
      recommendations: [{ symbol: 'SYNTHETIC-LEAK' }], beneficiary_candidates: [{ symbol: 'SYNTHETIC-LEAK' }], internal_qa: 'PRIVATE_SYNTHETIC_QA' };
  }
  const payload = projections.buildPublicPayload(report, ctx);
  assert.deepEqual(Object.keys(payload.public_summary).sort(), ['daily_sentence', 'one_sentence']);
  assert.equal(payload.public_summary.daily_sentence, ctx.decisionSnapshot.generated_text.canonical_market_state.document.sections.executive_summary.text);
  assert.deepEqual(Object.keys(payload.v8_daily_sentence), ['sentence']);
  assert.doesNotMatch(JSON.stringify(payload), /SYNTHETIC-LEAK|PRIVATE_SYNTHETIC_QA|OLD_SYNTHETIC_QA/);
});

test('admin raw diagnostics remain only in admin_source_report, never a nested subscriber content source', () => {
  const { report, ctx } = projectionFixture();
  report.ai_strategy_json.decision_v1 = { stock_opportunities: [{ symbol: 'SYNTHETIC-RAW' }] };
  report.ai_strategy_json.research_master_v2.sections.representative_stocks = [{ symbol: 'SYNTHETIC-RAW' }];
  const payload = projections.buildAdminPayload(report, ctx);
  assert.equal(payload.admin_source_report, report);
  assert.match(JSON.stringify(payload.admin_source_report), /SYNTHETIC-RAW/);
  const subscriber = { ...payload }; delete subscriber.admin_source_report;
  assert.equal(subscriber.summary, ctx.decisionSnapshot.generated_text.canonical_market_state.document.sections.executive_summary.text);
  assert.equal(subscriber.ai_strategy_json.summary, subscriber.summary);
  assert.equal(subscriber.ai_strategy_json.decision_v1, undefined);
  assert.equal(subscriber.ai_strategy_json.research_master_v2, undefined);
  assert.doesNotMatch(JSON.stringify(subscriber), /SYNTHETIC-RAW|SYNTHETIC-LEGACY-STOCK|OLD_SYNTHETIC_QA/);
});

test('real assembled same-day market evidence publishes despite recommendation BLOCKED and private QA/Premium failure', () => {
  const fixtureSource = readFileSync(new URL('../supabase/functions/generate-daily-report-v7/research-master-v2.test.ts', import.meta.url), 'utf8');
  const input = isolatedFunction(fixtureSource, 'completeFixture')();
  input.reportDate = '2026-09-08'; input.todayDate = input.reportDate;
  input.generatedAt = '2026-09-08T00:01:00.000Z'; input.dataAsOf = '2026-09-08T00:00:00.000Z';
  for (const row of input.evidenceIndex) row.published_at = row.published_at.replace('2026-07-13', '2026-09-07');
  const ai = input.legacy;
  const sentence = 'SOX 上漲帶動半導體風險偏好，09:30 先確認台積電與 TAIEX 是否同向；未確認前不追價，若權值轉弱就撤回偏多假設。';
  ai.today_quote = sentence; ai.v8_daily_sentence = { sentence }; ai.free_summary = { one_sentence: sentence };
  ai.member_research_note_v2.today_core_thesis = sentence;
  ai.today_beneficiary_stocks_v10 = []; ai.v10_beneficiary_enabled = true;
  ai.v10_data_quality_status = 'insufficient_positive_evidence'; ai.data_quality = 'complete'; ai.missing_sources = []; ai.member_value_score = 0;
  ai.content_evidence_quality = { contract_version: 'PREMIUM_EVIDENCE_V1', verified_market_count: 3, verified_news_count: 1, blank_market_change_count: 0, all_news_traceable: true };
  const master = assembleCanonicalMarketResearch(input);
  ai.research_master_v2 = master; ai.canonical_market_state = buildCanonicalMarketState(master);
  ai.research_generation_audit = { report_date: '2026-09-06', source_quality: { publish_status: 'blocked' } };
  const marketGate = evaluateMarketReportGate(ai, input.reportDate);
  assert.equal(marketGate.eligible, true, JSON.stringify(marketGate));
  assert.equal(marketGate.recommendation_gate.status, 'BLOCKED');
  assert.equal(evaluatePremiumContentGate(ai, 1).eligible, false, 'Paid quality remains independent and blocked');
  const { report, ctx } = projectionFixture();
  report.report_date = input.reportDate;
  report.ai_strategy_json = { ...ai, revision_id: ctx.decisionSnapshot.id, canonical_member_revision_id: ctx.memberContentRevision.id,
    market_publication_contract: { schema_version: 'CORE_MARKET_PUBLICATION_V1', status: 'PUBLISHED', report_date: report.report_date,
      revision_id: ctx.decisionSnapshot.id, opening_publication_revision_id: ctx.decisionSnapshot.id } };
  report.ai_strategy_json.intraday_sync_status = { report_date: input.reportDate, windows: {
    '1410': { status: 'completed', completed_at: '2026-09-07T12:05:42Z', evidence: { source: 'local-synthetic' } },
  } };
  ctx.memberContentRevision.status = 'BLOCKED';
  ctx.decisionSnapshot.source_freshness = { status: 'complete' };
  ctx.decisionSnapshot.source_refs = canonicalMarketSourceRefs(ai);
  ctx.decisionSnapshot.generated_text = { daily_sentence: sentence, recommendations: [], market_report_gate: marketGate,
    canonical_market_state: structuredClone(ai.canonical_market_state),
    content_evidence_quality: structuredClone(ai.content_evidence_quality), data_quality: ai.data_quality,
    missing_sources: structuredClone(ai.missing_sources) };
  ctx.publicationEvidence = { snapshots: new Map([[ctx.decisionSnapshot.id, ctx.decisionSnapshot]]), members: new Map(), runs: [{
    id: 'synthetic-actual-publication', trading_date: report.report_date, status: 'SUCCEEDED',
    idempotency_key: 'research-input:synthetic', completed_at: '2026-09-08T00:02:00Z', provider_status: { result: {
      success: true, report_id: report.id, report_date: report.report_date, decision_snapshot_id: ctx.decisionSnapshot.id,
      member_content_revision_id: ctx.memberContentRevision.id, semantic_status: 'PASSED' } } }] };
  const payload = projections.buildPublicPayload(report, ctx);
  assert.equal(payload.report_date, '2026-09-08');
  assert.equal(payload.revision_id, ctx.decisionSnapshot.id);
  assert.equal(payload.daily_sentence, sentence);
  assert.equal(payload.content_publish_gate.overall_status, 'eligible');
  assert.equal(payload.report_status, 'READY');
  assert.equal(payload.premium_content_status, 'blocked');
  assert.equal(payload.recommendation_status, 'BLOCKED');
  assert.equal(payload.recommendation_message, '推薦評估證據不足，今日暫不發布正式個股推薦');
  assert.equal(payload.one_teaser_stock, null);
  assert.equal(payload.recommendation_count, 0);
  assert.equal(payload.v10_data_quality_status, 'complete');
  assert.equal(payload.intraday_sync_status.windows['1410'].status, 'insufficient', 'Invalid checkpoint evidence must not block the separately published market report');
  assert.doesNotMatch(JSON.stringify(payload), /NO_QUALIFIED_OPPORTUNITY|2026-09-06/);
});

test('actual reader masks unpublished PARTIAL QA STOP/100/closing across public, member, VIP and admin aliases', () => {
  const { report, ctx } = projectionFixture();
  delete report.ai_strategy_json.revision_id;
  delete report.ai_strategy_json.canonical_member_revision_id;
  report.confidence_score = 100; report.ai_strategy_json.confidence_score = 100;
  ctx.decisionSnapshot.status = 'PARTIAL'; ctx.decisionSnapshot.action = 'STOP'; ctx.decisionSnapshot.confidence_score = 100;
  ctx.decisionSnapshot.generated_text = { daily_sentence: 'QA 原劇本已失效', recommendations: [{ symbol: 'PRIVATE-QA-STOCK' }] };
  report.ai_strategy_json.closing_verification_v2 = { report_date: report.report_date,
    opening_decision_snapshot_id: ctx.decisionSnapshot.id, verified_at: '2026-09-08T06:30:00Z',
    status: 'completed', data_status: 'complete', prediction_result: 'miss', missing_data: [],
    actual_taiex_change: -1, actual_2330_close: { change_percent: -2 }, actual_txf_close: { change_percent: -1.5 } };
  report.ai_strategy_json.intraday_sync_status = { lifecycle_complete: true, current_state: 'DAY_COMPLETED', windows: {
    '1410': { status: 'completed', completed_at: '2026-09-08T06:10:30Z', evidence: { source: 'synthetic-close' } },
    '0930': { status: 'failed', failed_at: '2026-09-08T01:31:00Z', evidence: { source: 'synthetic-failure' } },
  } };
  const before = JSON.stringify({ report, ctx });
  for (const name of ['buildPublicPayload', 'buildMemberPayload', 'buildVipPayload', 'buildAdminPayload']) {
    const payload = projections[name](report, ctx);
    for (const reader of [payload, ...(payload.ai_strategy_json ? [payload.ai_strategy_json] : [])]) {
      assert.equal(reader.report_date, report.report_date); assert.equal(reader.revision_id, ctx.decisionSnapshot.id);
      assert.equal(reader.subscriber_state.publication, 'UNPUBLISHED'); assert.equal(reader.subscriber_state.analysis, 'PARTIAL');
      assert.equal(parseSubscriberState(reader.subscriber_state, reader).analysis, 'PARTIAL');
      assert.equal(reader.confidence_score, null); assert.equal(reader.canonical_decision.confidence_score, null);
      assert.equal(reader.canonical_decision.action, 'WAIT'); assert.equal(reader.daily_sentence, INCOMPLETE_ANALYSIS_MESSAGE);
      assert.equal(reader.closing_verification, null); assert.equal(reader.closing_verification_v2, null);
      assert.equal(reader.runtime_lifecycle_complete, false); assert.equal(reader.intraday_sync_status.lifecycle_complete, false);
      assert.ok(Object.values(reader.intraday_sync_status.windows).every(row => row.status === 'insufficient'));
      assert.equal(reader.one_teaser_stock, null); assert.equal(reader.recommendation_count, 0);
      assert.equal(reader.recommendation_status, 'BLOCKED'); assert.equal(reader.premium_content_status, 'blocked');
    }
    if (name === 'buildAdminPayload') assert.equal(payload.admin_source_report.ai_strategy_json.confidence_score, 100, 'Preserve raw Owner diagnostics only in the explicit private namespace');
  }
  assert.equal(JSON.stringify({ report, ctx }), before, 'Read mapping never changes stored input evidence');
});

test('published confidence is canonical-only and missing confidence cannot reuse raw or radar 100', () => {
  const { report, ctx } = projectionFixture();
  report.confidence_score = 100; report.ai_strategy_json.confidence_score = 100;
  ctx.openingRadar = { confidence_score: 100, report_date: report.report_date };
  for (const confidence_score of [undefined, null, '', ' ', Infinity]) {
    ctx.decisionSnapshot.confidence_score = confidence_score;
    const payload = projections.buildPublicPayload(report, ctx);
    assert.equal(payload.subscriber_state.publication, 'PUBLISHED'); assert.equal(payload.confidence_score, null);
    assert.equal(payload.canonical_decision.confidence_score, null); assert.equal(payload.opening_radar.confidence_score, undefined);
  }
  ctx.decisionSnapshot.confidence_score = 73;
  assert.equal(projections.buildPublicPayload(report, ctx).confidence_score, 73);
});

test('subscriber sentence aliases cannot restore confidence prose suppressed by the canonical projection', () => {
  const { report, ctx } = projectionFixture();
  ctx.decisionSnapshot.confidence_score = null;
  for (const sentence of ['模型信心 100/100，市場趨勢尚待驗證。', 'TAIEX 與台積電同向；模型信心 100/100；未確認前不追價']) {
    ctx.decisionSnapshot.generated_text.daily_sentence = sentence;
    for (const name of ['buildPublicPayload', 'buildMemberPayload', 'buildVipPayload', 'buildAdminPayload']) {
      const payload = projections[name](report, ctx);
      const expected = payload.subscriber_projection.marketDecision.summary ?? payload.subscriber_projection.statusLabel;
      assert.equal(payload.subscriber_state.publication, 'PUBLISHED', name);
      assert.equal(payload.subscriber_projection.analysisAvailable, true, name);
      assert.equal(payload.confidence_score, null, name);
      for (const alias of [payload.daily_sentence, payload.today_quote, payload.v8_daily_sentence.sentence,
        payload.public_summary.daily_sentence, payload.public_summary.one_sentence, payload.canonical_decision.daily_sentence]) {
        assert.equal(alias, expected, name); assert.doesNotMatch(alias, /100\s*\/\s*100/, name);
      }
      assert.equal(expected, ctx.decisionSnapshot.generated_text.canonical_market_state.document.sections.executive_summary.text,
        'Unverified snapshot copy cannot replace the audited summary or inject confidence prose');
    }
    const f = verifiedHistoryFixture();
    f.snapshot.confidence_score = null; f.report.confidence_score = 100;
    const history = projections.buildHistorySummary(f.report, f.snapshot, f.now, f.evidence);
    const expectedHistory = history.subscriber_projection.marketDecision.summary ?? history.subscriber_projection.statusLabel;
    assert.equal(history.subscriber_state.publication, 'PUBLISHED');
    assert.equal(history.summary, expectedHistory); assert.equal(history.today_quote, expectedHistory);
    assert.doesNotMatch(history.summary, /100\s*\/\s*100/); assert.equal(history.confidence_score, null);
  }
});

test('projection preserves the audited canonical market summary and refuses unaudited legacy copy fallback', () => {
  const { report, ctx } = projectionFixture();
  ctx.decisionSnapshot.confidence_score = null;
  const sentence = ctx.decisionSnapshot.generated_text.canonical_market_state.document.sections.executive_summary.text;
  ctx.decisionSnapshot.generated_text.daily_sentence = '市場量能尚待確認；先觀察權值與指數是否同向';
  const publicPayload = projections.buildPublicPayload(report, ctx);
  const f = verifiedHistoryFixture(); f.snapshot.confidence_score = null;
  const history = projections.buildHistorySummary(f.report, f.snapshot, f.now, f.evidence);
  assert.equal(publicPayload.daily_sentence, sentence);
  assert.equal(history.summary, history.subscriber_projection.marketDecision.summary);
  assert.equal(history.subscriber_projection.analysisAvailable, true);
  assert.doesNotMatch(history.summary, /100\s*\/\s*100/);
  assert.equal(publicPayload.subscriber_projection.marketDecision.summary, sentence);
  delete ctx.decisionSnapshot.generated_text.daily_sentence;
  report.today_quote = '指數待驗證；模型信心 100/100；不得追價';
  const fallback = projections.buildPublicPayload(report, ctx);
  assert.equal(fallback.daily_sentence, sentence, 'The real audited document remains the source; raw legacy prose cannot replace it');
  assert.doesNotMatch(fallback.daily_sentence, /100\s*\/\s*100/);
  assert.equal(fallback.canonical_decision.daily_sentence, fallback.daily_sentence);
  assert.equal(fallback.subscriber_projection.analysisAvailable, true);
  assert.equal(fallback.confidence_score, null);
});

test('a genuinely published READY market STOP remains STOP; only unpublished QA STOP is withheld', () => {
  const { report, ctx } = projectionFixture();
  ctx.decisionSnapshot.action = 'STOP';
  const result = projections.buildPublicPayload(report, ctx);
  assert.equal(result.subscriber_state.publication, 'PUBLISHED'); assert.equal(result.subscriber_state.analysis, 'READY');
  assert.equal(result.canonical_decision.action, 'STOP'); assert.equal(result.content_publish_gate.overall_status, 'eligible');
  assert.equal(result.recommendation_status, 'BLOCKED'); assert.equal(result.one_teaser_stock, null);
});

test('actual payload Closing COMPLETE retains date and three-core lineage; NOT_DUE and wrong revision expose no outcome', () => {
  const { report, ctx } = projectionFixture();
  const close = { report_date: report.report_date, opening_decision_snapshot_id: ctx.decisionSnapshot.id,
    status: 'completed', data_status: 'complete', verified_at: '2026-09-08T06:30:00Z', prediction_result: 'hit', missing_data: [],
    actual_taiex_change: 1, actual_2330_close: { change_percent: 2 }, actual_txf_close: { change_percent: 1.5 } };
  report.ai_strategy_json.closing_verification_v2 = close;
  const complete = projections.buildPublicPayload(report, ctx);
  assert.equal(complete.subscriber_state.closing, 'COMPLETE');
  assert.equal(complete.closing_verification.report_date, report.report_date);
  assert.equal(complete.closing_verification.opening_decision_snapshot_id, ctx.decisionSnapshot.id);
  assert.equal(complete.closing_verification.actual_2330_close.change_percent, 2);
  assert.equal(complete.closing_verification.actual_txf_close.change_percent, 1.5);
  for (const patch of [{ status: 'NOT_DUE' }, { opening_decision_snapshot_id: 'synthetic-other' }, { status: 'direction_completed_data_degraded' }]) {
    report.ai_strategy_json.closing_verification_v2 = { ...close, ...patch };
    const result = projections.buildPublicPayload(report, ctx);
    assert.notEqual(result.subscriber_state.closing, 'COMPLETE'); assert.equal(result.closing_verification, null);
  }
});

test('VIP closing prose cannot bypass the same NOT_DUE and evidence gate; genuine completed prose is preserved', () => {
  const { report, ctx } = projectionFixture(), ai = report.ai_strategy_json;
  ai.important_news = [{ title: '2330 台積電先進封裝需求', summary: '合成公司來源，僅供隔離測試。',
    source: 'isolated company source', url: 'https://example.invalid/fixture', published_at: '2026-09-07T23:00:00Z' }];
  ai.research_master_v2.sections.representative_stocks = [{ symbol: '2330', evidence_refs: ['SYNTHETIC-COMPANY-NEWS'] }];
  ctx.memberContentRevision.member_content.representative_stocks = ai.today_beneficiary_stocks_v10;
  ctx.decisionSnapshot.generated_text.recommendations = ai.today_beneficiary_stocks_v10;
  assert.equal(evaluateMarketReportGate(ai, report.report_date).recommendation_gate.eligible, true, 'Real gate evaluates the synthetic company source');
  const close = { report_date: report.report_date, opening_decision_snapshot_id: ctx.decisionSnapshot.id,
    status: 'completed', data_status: 'complete', verified_at: '2026-09-08T06:30:00Z', prediction_result: 'miss', missing_data: [],
    actual_taiex_change: -1, actual_2330_close: { change_percent: -2 }, actual_txf_close: { change_percent: -1.5 },
    miss_reason: '合成有效收盤錯誤原因', failed_assumptions: ['合成失敗條件'], lessons_learned: ['合成收盤結論'], tomorrow_watch_points: ['合成明日觀察'] };
  for (const status of ['NOT_DUE', 'direction_completed_data_degraded']) {
    ai.closing_verification_v2 = { ...close, status };
    const result = projections.buildVipPayload(report, ctx);
    assert.equal(result.premium_content_status, 'eligible'); assert.equal(result.subscriber_state.recommendation, 'QUALIFIED');
    assert.equal(result.failure_analysis.miss_reason, null); assert.equal(result.failure_analysis.failed_assumptions.length, 0);
    assert.equal(result.failure_analysis.lessons_learned.length, 0); assert.equal(result.tomorrow_extension_watch, null);
  }
  ai.closing_verification_v2 = close;
  const complete = projections.buildVipPayload(report, ctx);
  assert.equal(complete.subscriber_state.closing, 'COMPLETE');
  assert.equal(complete.failure_analysis.miss_reason, close.miss_reason);
  // A real CORE publication receipt, not a legacy alignment-only assertion,
  // preserves the published market when today's private semantic QA fails.
  ai.market_publication_contract = { schema_version: 'CORE_MARKET_PUBLICATION_V1', status: 'PUBLISHED', report_date: report.report_date,
    revision_id: ctx.decisionSnapshot.id, opening_publication_revision_id: ctx.decisionSnapshot.id };
  ctx.decisionSnapshot.source_freshness = { status: 'complete' };
  ctx.publicationEvidence = { snapshots: new Map([[ctx.decisionSnapshot.id, ctx.decisionSnapshot]]), members: new Map(), runs: [{
    id: 'synthetic-vip-publication', trading_date: report.report_date, status: 'SUCCEEDED', idempotency_key: 'research-input:synthetic',
    completed_at: '2026-09-08T00:02:00Z', provider_status: { result: { success: true, report_id: report.id, report_date: report.report_date,
      decision_snapshot_id: ctx.decisionSnapshot.id, member_content_revision_id: ctx.memberContentRevision.id, semantic_status: 'PASSED' } } }] };
  ctx.memberContentRevision.semantic_status = 'BLOCKED';
  const blocked = projections.buildPublicPayload(report, ctx);
  assert.equal(blocked.subscriber_state.publication, 'PUBLISHED'); assert.equal(blocked.subscriber_state.recommendation, 'BLOCKED');
  assert.equal(blocked.recommendation_gate.eligible, false); assert.equal(blocked.one_teaser_stock, null);
});

test('closing revision B cannot borrow outcome, timestamp or actuals from an unbound review or legacy revision A', () => {
  const { report, ctx } = projectionFixture(), ai = report.ai_strategy_json;
  const complete = { report_date: report.report_date, opening_decision_snapshot_id: ctx.decisionSnapshot.id,
    status: 'completed', data_status: 'complete', verified_at: '2026-09-08T06:30:00Z', prediction_result: 'hit', missing_data: [],
    actual_taiex_change: 1, actual_2330_close: { change_percent: 2 }, actual_txf_close: { change_percent: 1.5 } };
  ai.closing_verification = { ...complete, opening_decision_snapshot_id: 'synthetic-revision-A', prediction_result: 'miss' };
  ctx.closeMarketReview = { id: 'synthetic-unbound-review-A', report_date: report.report_date, verification_result: '未命中',
    data_quality: '高可信', missing_data: [], taiex_change: -1, tsmc_change: -2, txf_change: -1.5, updated_at: '2026-09-08T07:00:00Z' };
  ctx.closingDecisionSnapshot = { report_date: report.report_date, status: 'FINAL', created_at: '2026-09-08T06:30:00Z',
    generated_text: { opening_decision_snapshot_id: ctx.decisionSnapshot.id, prediction_result: 'hit' } };
  for (const receipt of [
    { ...complete, actual_2330_close: undefined },
    { ...complete, verified_at: undefined },
    { ...complete, status: 'NOT_DUE' },
  ]) {
    ai.closing_verification_v2 = receipt;
    const payload = projections.buildPublicPayload(report, ctx);
    assert.notEqual(payload.subscriber_state.closing, 'COMPLETE'); assert.equal(payload.closing_verification, null);
  }
  ai.closing_verification_v2 = complete;
  const valid = projections.buildPublicPayload(report, ctx);
  assert.equal(valid.subscriber_state.closing, 'COMPLETE');
  assert.equal(valid.closing_verification.prediction_result, 'hit', 'Date-only review A cannot replace B outcome');
  assert.equal(valid.closing_verification.verified_at, complete.verified_at);
  assert.equal(valid.closing_verification.actual_taiex_change, 1);
  delete ai.closing_verification_v2; delete ai.closing_verification;
  assert.notEqual(projections.buildPublicPayload(report, ctx).subscriber_state.closing, 'COMPLETE', 'Partial snapshot B plus unbound complete review A is still insufficient');
});

test('actual public and history readers carry the committed frozen opening contract into the shared closing projection', () => {
  const f = verifiedHistoryFixture(), report = f.report, ai = report.ai_strategy_json, date = report.report_date;
  const opening = f.snapshot, closing = f.closingSnapshot.generated_text.closing_verification_v2;
  opening.id = 'synthetic-frozen-opening'; opening.confidence_score = 61;
  opening.generated_text.market_bias = 'synthetic-opening-bearish';
  f.publicationRun.provider_status.result.decision_snapshot_id = opening.id;
  f.closingSnapshot.generated_text.opening_decision_snapshot_id = opening.id;
  closing.opening_decision_snapshot_id = opening.id; closing.opening_bias = 'synthetic-opening-bearish'; closing.opening_confidence = 61;
  const decision = { ...opening, id: 'synthetic-current-publication', version: 2, session_type: 'INTRADAY',
    created_at: `${date}T15:00:00+08:00`, valid_from: `${date}T15:00:00+08:00`, confidence_score: 73,
    generated_text: { ...opening.generated_text, market_bias: 'synthetic-current-bullish' } };
  f.member.decision_snapshot_id = decision.id; f.member.decision_snapshot_version = decision.version;
  const currentRun = structuredClone(f.publicationRun); currentRun.id = 'synthetic-current-run';
  currentRun.completed_at = `${date}T15:01:00+08:00`; currentRun.provider_status.result.decision_snapshot_id = decision.id;
  ai.revision_id = decision.id;
  ai.closing_contract.opening_publication_revision_id = opening.id;
  const ctx = { evaluatedAt: `${date}T15:30:00+08:00`, todayDate: date, decisionSnapshot: decision,
    closingDecisionSnapshot: f.closingSnapshot, memberContentRevision: f.member, componentQueryFailures: [],
    openingRadar: null, sectorRotationRows: [], marketDataSnapshots: [], closeMarketReview: null,
    publicationEvidence: { snapshots: new Map([[opening.id, opening], [decision.id, decision], [f.closingSnapshot.id, f.closingSnapshot]]),
      members: new Map([[f.member.id, f.member]]), runs: [f.publicationRun, currentRun] } };
  ai.market_bias = 'synthetic-current-bullish';
  ai.market_publication_contract = { schema_version: 'CORE_MARKET_PUBLICATION_V1', status: 'PUBLISHED',
    report_date: date, revision_id: decision.id, opening_publication_revision_id: opening.id, publication_run_id: currentRun.id };
  ai.closing_verification_v2 = { ...closing, actual_taiex_change: 99 };
  const readers = [
    () => projections.buildPublicPayload(report, ctx),
    () => projections.buildMemberPayload(report, ctx),
    () => projections.buildVipPayload(report, ctx),
    () => projections.buildAdminPayload(report, ctx),
  ];
  for (const read of readers) {
    const result = read();
    assert.equal(result.subscriber_state.closing, 'COMPLETE');
    assert.deepEqual(result.market_publication_contract, ai.market_publication_contract);
    assert.equal(getSubscriberReportProjection(result).closing.state, 'COMPLETE');
    assert.equal(getSubscriberReportProjection(result).closing.result.opening_decision_snapshot_id, 'synthetic-frozen-opening');
    assert.deepEqual(getSubscriberReportProjection(result).closing.openingDecision, {
      revisionId: 'synthetic-frozen-opening', bias: 'synthetic-opening-bearish', confidence: 61, summary: null,
    });
    assert.equal(getSubscriberReportProjection(result).marketDecision.bias, 'synthetic-current-bullish');
    assert.equal(getSubscriberReportProjection(result).confidence.value, 73);
  }
  const history = projections.buildHistorySummary(report, ctx.decisionSnapshot, ctx.evaluatedAt);
  assert.equal(history.subscriber_projection.closing.complete, false,
    'Raw aliases alone cannot replace actual opening publication and durable CLOSING receipts in history');
  assert.equal(history.report_date, report.report_date);
  const valid = structuredClone(ai.market_publication_contract);
  for (const patch of [{ revision_id: 'synthetic-unbound-current' }, { report_date: '2026-09-07' },
    { status: 'READY' }, { schema_version: 'unknown' }, { opening_publication_revision_id: null },
    { opening_publication_revision_id: 'synthetic-wrong-opening' }]) {
    ai.market_publication_contract = { ...valid, ...patch };
    for (const read of readers) {
      const invalid = read();
      assert.notEqual(invalid.subscriber_state.closing, 'COMPLETE', JSON.stringify(patch));
      assert.equal(invalid.closing_verification_v2, null, 'Invalid core identity cannot expose a completed outcome');
    }
  }
  ai.market_publication_contract = valid;
  delete closing.opening_bias; delete closing.opening_confidence;
  for (const read of readers) assert.deepEqual(getSubscriberReportProjection(read()).closing.openingDecision, {
    revisionId: 'synthetic-frozen-opening', bias: null, confidence: null, summary: null,
  });
  ctx.decisionSnapshot.status = 'PARTIAL';
  for (const read of readers) {
    const result = read();
    assert.equal(result.subscriber_state.analysis, 'PARTIAL');
    assert.equal(result.subscriber_state.closing, 'INSUFFICIENT_EVIDENCE');
  }
});

test('one captured request time keeps public envelope and later member/admin projection on the same closing state', () => {
  const { report, ctx } = projectionFixture();
  ctx.evaluatedAt = '2026-09-08T06:09:59Z';
  report.ai_strategy_json.closing_verification_v2 = { report_date: report.report_date,
    opening_decision_snapshot_id: ctx.decisionSnapshot.id, status: 'completed', data_status: 'complete',
    verified_at: '2026-09-08T06:10:01Z', prediction_result: 'hit', missing_data: [], actual_taiex_change: 1,
    actual_2330_close: { change_percent: 2 }, actual_txf_close: { change_percent: 1.5 } };
  const envelope = projections.buildPublicPayload(report, ctx);
  assert.equal(envelope.subscriber_state.closing, 'NOT_DUE');
  for (const name of ['buildPublicPayload', 'buildMemberPayload', 'buildVipPayload', 'buildAdminPayload']) {
    const later = projections[name](report, ctx);
    assert.deepEqual(later.subscriber_state, envelope.subscriber_state);
    if (later.ai_strategy_json) assert.deepEqual(later.ai_strategy_json.subscriber_state, envelope.subscriber_state);
  }
  ctx.evaluatedAt = '2026-09-08T06:10:02Z';
  assert.equal(projections.buildPublicPayload(report, ctx).subscriber_state.closing, 'COMPLETE', 'Only a subsequent request may observe later evidence');
});

test('pinned fc127b0 frontend cannot revive closing completion through the legacy 1430 fallback', () => {
  // Execute the actual pre-fix reader, not a rewritten approximation. CI uses
  // fetch-depth: 0 to retain this immutable, known deployment candidate.
  const base = 'fc127b0cbb1169974d44df3fc43fa009e1e5740f';
  const readBase = file => execFileSync('git', ['show', `${base}:${file}`], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  const load = (text, names, externals = {}) => {
    const functions = {};
    const dependencies = { exports: {}, ...externals, ...Object.fromEntries(names.map(name => [name, (...args) => functions[name](...args)])) };
    for (const name of names) functions[name] = isolatedFunction(text, name, dependencies);
    return functions;
  };
  const closing = load(readBase('src/lib/closingVerificationState.ts'), ['asRecord', 'normalizedText', 'firstNormalizedText',
    'numberOrNull', 'closingCandidate', 'hasNamedDirection', 'resolveClosingVerificationState', 'isClosingVerificationComplete']);
  const checkpoint = load(readBase('src/lib/decisionEvidence.ts'), ['record', 'exactStatus', 'hasStructuredEvidence',
    'normalizeCheckpointKey', 'getRuntimeCheckpointState']);
  const timeline = load(readBase('src/lib/runtimeDecisionTimeline.ts'), ['checkpointMinutes', 'reconcileRuntimeTimeline',
    'record', 'timelineStatus', 'openingCompleted', 'buildRuntimeDecisionTimeline'], { ...closing, ...checkpoint });
  const { report, ctx } = projectionFixture();
  ctx.evaluatedAt = '2026-09-08T07:00:00Z';
  const close = { report_date: report.report_date, opening_decision_snapshot_id: ctx.decisionSnapshot.id,
    status: 'completed', data_status: 'complete', verified_at: '2026-09-08T06:30:00Z', prediction_result: 'hit', missing_data: [],
    actual_taiex_change: 1, actual_2330_close: { change_percent: 2 }, actual_txf_close: { change_percent: 1.5 } };
  report.ai_strategy_json.intraday_sync_status = { report_date: report.report_date, current_state: 'DAY_COMPLETED', state_rank: 100,
    lifecycle_complete: true, checkpoint: '1430', checkpoint_status: 'completed', captured_at: close.verified_at,
    last_checked_at: close.verified_at, windows: { '1430': { status: 'completed', completed_at: close.verified_at,
      real_checkpoint_observation: true, evidence: { dispatch_id: 'synthetic-dispatch-not-closing-proof' } } } };
  const closingNode = ai => timeline.buildRuntimeDecisionTimeline({ ai, hasReport: true, reportRevisionId: ctx.decisionSnapshot.id,
    isTradingDay: true, taipeiMinutes: 15 * 60 }).find(node => node.time === '14:30');
  assert.equal(closingNode(report.ai_strategy_json).status, 'completed', 'Control reproduces the real old-reader fallthrough');
  for (const receipt of [{ ...close, status: 'NOT_DUE' }, { ...close, actual_2330_close: undefined }, null]) {
    report.ai_strategy_json.closing_verification_v2 = receipt;
    const before = JSON.stringify({ report, ctx });
    for (const name of ['buildPublicPayload', 'buildMemberPayload', 'buildVipPayload', 'buildAdminPayload']) {
      const payload = projections[name](report, ctx);
      for (const projected of [payload, ...(payload.ai_strategy_json ? [payload.ai_strategy_json] : [])]) {
        assert.equal(projected.subscriber_state.publication, 'PUBLISHED');
        assert.notEqual(projected.subscriber_state.closing, 'COMPLETE');
        assert.notEqual(closingNode(projected).status, 'completed');
        assert.equal(projected.intraday_sync_status.lifecycle_complete, false);
        assert.equal(projected.intraday_sync_status.current_state, null);
        assert.equal(projected.intraday_sync_status.windows['1430'].completed_at, null);
      }
    }
    assert.equal(JSON.stringify({ report, ctx }), before, 'No stored checkpoint or lifecycle evidence is changed');
  }
  report.ai_strategy_json.closing_verification_v2 = close;
  const valid = projections.buildPublicPayload(report, ctx);
  assert.equal(valid.subscriber_state.closing, 'COMPLETE'); assert.equal(closingNode(valid).status, 'completed');
  assert.equal(valid.intraday_sync_status.windows['1430'].completed_at, close.verified_at);
});

test('history summary requires the same published report/revision/READY/market proof and never copies QA confidence', () => {
  const f = verifiedHistoryFixture(), report = f.report, decision = f.snapshot;
  decision.action = 'STOP'; decision.confidence_score = 67;
  report.confidence_score = 100; report.ai_strategy_json.confidence_score = 100;
  report.summary = 'QA 原劇本已失效';
  const evaluate = (row, snapshot) => projections.buildHistorySummary(row, snapshot, f.now, f.evidence);
  const valid = evaluate(report, decision);
  assert.equal(valid.subscriber_state.publication, 'PUBLISHED'); assert.equal(valid.subscriber_state.analysis, 'READY');
  assert.equal(valid.confidence_score, 67);
  assert.equal(valid.summary, decision.generated_text.canonical_market_state.document.sections.executive_summary.text);
  assert.equal(valid.revision_id, decision.id);
  for (const [row, snapshot] of [
    [report, { ...decision, status: 'PARTIAL', confidence_score: 100 }],
    [report, { ...decision, report_id: 'other-report' }],
    [report, { ...decision, report_date: '2026-09-06' }],
    [report, { ...decision, id: 'other-revision' }],
    [report, null],
    [{ ...report, ai_strategy_json: { ...report.ai_strategy_json, revision_id: undefined } }, decision],
    [report, { ...decision, generated_text: { ...decision.generated_text, canonical_market_state: null } }],
  ]) {
    const history = evaluate(row, snapshot);
    assert.equal(history.report_date, report.report_date); assert.equal(history.confidence_score, null);
    assert.equal(history.subscriber_state.publication, 'UNPUBLISHED');
    assert.equal(history.market_bias, '分析尚未完成'); assert.equal(history.summary, INCOMPLETE_ANALYSIS_MESSAGE);
    assert.equal(history.today_quote, INCOMPLETE_ANALYSIS_MESSAGE);
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { evaluateDecisionV1 } from './fixtures/legacy-decision-evaluator.ts';
import { normalizeDecisionSymbol, actionTone } from '../src/features/decision-v1/engine.ts';
import { applyPublishedDecisionGate, decisionFromReport, intradayAnswer, opportunitySummary } from '../src/features/decision-v1/presentation.ts';
import { summarizeForwardValidation, closingDataComplete } from '../src/features/decision-v1/forwardValidation.ts';
import { LEARNING_TERMS } from '../src/features/learning/learningGlossary.ts';
import { LEARNING_USAGE } from '../src/features/learning/learningUsage.ts';
import { DAY, decisionFixture } from './fixtures/decision-v1.mjs';
const evaluate = (input) => evaluateDecisionV1(input, DAY);

test('four scores stay separate: direction 85, confidence 88, entry 35, opportunity 80; bullish is not buy', () => {
  const input = decisionFixture(); input.price_state = 'EXTENDED';
  Object.values(input.entry).forEach(m => { m.value = .35; });
  const d = evaluate(input);
  assert.equal(d.action, 'DO_NOT_CHASE');
  assert.equal(d.direction_probability.value, 85); assert.equal(d.model_confidence.value, 88);
  assert.equal(d.entry_environment_score.value, 35); assert.equal(d.stock_opportunities[0].opportunity_score.value, 80);
  for (const score of [d.direction_probability, d.model_confidence, d.entry_environment_score, d.stock_opportunities[0].opportunity_score]) {
    assert.equal(score.score_version, 'ma-decision-v1.0'); assert.ok(score.calculation && score.evidence_ids.length && Object.keys(score.inputs).length);
  }
});
test('LLM confidence cannot masquerade as calibrated direction or a measured quality index', () => {
  const input = decisionFixture(); input.direction_model.method = 'llm'; input.confidence.source_agreement.method = 'llm';
  const d = evaluate(input); assert.equal(d.direction_probability, null); assert.equal(d.model_confidence, null); assert.equal(d.action, 'INSUFFICIENT_DATA');
});
test('missing calibration never fabricates probability from old confidence_score', () => {
  const input = decisionFixture(); input.direction_model = null; input.confidence_score = 90;
  assert.equal(evaluate(input).direction_probability, null);
  assert.equal(evaluate(input).action, 'INSUFFICIENT_DATA');
  input.stock_opportunities=[];
  assert.equal(evaluate(input).action, 'INSUFFICIENT_DATA');
  assert.equal(evaluate({confidence_score: 90}).action, 'INSUFFICIENT_DATA');
});
test('future/leaking calibration cannot count as out-of-sample calibration', () => {
  const input = decisionFixture(); input.direction_model.calibration_end = input.data_as_of;
  assert.equal(evaluate(input).direction_probability, null);
});
for (const bad of [null, undefined, '', '0.8', NaN, Infinity, -1, 2]) test(`invalid measured factor ${String(bad)} fails closed`, () => {
  const input = decisionFixture(); input.entry.risk_reward.value = bad;
  assert.equal(evaluate(input).action, 'INSUFFICIENT_DATA'); assert.equal(evaluate(input).entry_environment_score, null);
});
test('missing evidence penalty lowers confidence without touching probability', () => {
  const input = decisionFixture(); input.confidence.missing_evidence_penalty.value = .2;
  assert.equal(evaluate(input).model_confidence.value, 68); assert.equal(evaluate(input).direction_probability.value, 85);
});
test('zero completeness is incomplete data, not a successful no-opportunity screening', () => {
  const input = decisionFixture(); input.confidence.completeness.value = 0; input.stock_opportunities = [];
  assert.equal(evaluate(input).action, 'INSUFFICIENT_DATA');
});
test('published WAIT/STOP and Premium isolation cannot be overridden by a new model', () => {
  const d=evaluate(decisionFixture());
  assert.equal(applyPublishedDecisionGate(d,'WAIT',true).action,'WAIT_FOR_CONFIRMATION');
  assert.equal(applyPublishedDecisionGate(d,'WAIT',true).stock_opportunities.length,0);
  assert.equal(applyPublishedDecisionGate(d,'STOP',true).action,'DEFENSIVE');
  assert.equal(applyPublishedDecisionGate(d,'ACT',false).stock_opportunities.length,0);
  assert.equal(applyPublishedDecisionGate(d,'ACT',true).stock_opportunities.length,1);
  assert.match(opportunitySummary(applyPublishedDecisionGate(d,'ACT',false),0,true),/尚未開放/);
});
test('company action cannot outrun the market no-chase, risk or incomplete gate', () => {
  for (const [field,value,expected] of [['price_state','EXTENDED','DO_NOT_CHASE'],['market_regime','RISK_OFF','DEFENSIVE']]) {
    const input=decisionFixture();input[field]=value;
    assert.equal(evaluate(input).action,expected);
    assert.equal(evaluate(input).stock_opportunities[0].action,expected);
  }
  const input=decisionFixture();input.stock_opportunities.push({...input.stock_opportunities[0],symbol:'2317',evidence_ids:[]});
  assert.equal(evaluate(input).action,'INSUFFICIENT_DATA');
  assert.equal(evaluate(input).stock_opportunities.length,0);
});
test('fundamental damage dominates deep decline; no automatic buy', () => {
  const input = decisionFixture(), o = input.stock_opportunities[0]; o.price_state = 'SELLOFF'; o.transmission.fundamental_impact = 'DAMAGED';
  const d = evaluate(input); assert.equal(d.stock_opportunities[0].action, 'AVOID'); assert.equal(d.action, 'AVOID');
});
test('damage and risk-off are not diluted into an amber price-extension warning', () => {
  const input=decisionFixture(); input.price_state='EXTENDED'; input.stock_opportunities[0].transmission.fundamental_impact='DAMAGED';
  assert.equal(evaluate(input).action,'AVOID');
  input.stock_opportunities[0].transmission.fundamental_impact='INTACT';input.market_regime='RISK_OFF';
  assert.equal(evaluate(input).action,'DEFENSIVE');
});
test('conflicting duplicate evidence IDs are rejected instead of trusting the first copy', () => {
  const input=decisionFixture();input.evidence.push({...input.evidence[0],summary:'conflicting evidence'});
  assert.equal(evaluate(input).action,'INSUFFICIENT_DATA');
});
test('intact broad selloff is only a mispricing candidate waiting for confirmation', () => {
  const input = decisionFixture(); input.stock_opportunities[0].price_state = 'SELLOFF';
  const o = evaluate(input).stock_opportunities[0]; assert.equal(o.classification, 'MISPRICING_CANDIDATE'); assert.equal(o.action, 'WAIT_FOR_CONFIRMATION');
});
test('missing any company/fundamental review never turns decline into mispricing', () => {
  for (const key of ['revenue_exposure', 'supply_chain', 'guidance', 'sector_demand', 'institutional', 'valuation', 'price_reaction']) {
    const input = decisionFixture(); input.stock_opportunities[0].price_state = 'SELLOFF'; input.stock_opportunities[0].checks[key] = false;
    assert.equal(evaluate(input).action, 'INSUFFICIENT_DATA', key); assert.equal(evaluate(input).stock_opportunities.length, 0);
  }
});
test('price extension or already-priced-in disallows active watch', () => {
  for (const mode of ['EXTENDED', 'PRICED_IN']) {
    const input = decisionFixture(); if (mode === 'EXTENDED') input.stock_opportunities[0].price_state = mode; else input.stock_opportunities[0].priced_in_score.value = .9;
    assert.equal(evaluate(input).stock_opportunities[0].action, 'DO_NOT_CHASE');
  }
});
test('evidence and invalidation are mandatory, with no-qualified distinct from incomplete', () => {
  const missing = decisionFixture(); missing.stock_opportunities[0].invalidation_conditions = [];
  assert.equal(evaluate(missing).action, 'INSUFFICIENT_DATA');
  const none = decisionFixture(); none.stock_opportunities = [];
  assert.equal(evaluate(none).action, 'NO_QUALIFIED_OPPORTUNITY');
  none.screening.status = 'INCOMPLETE'; assert.equal(evaluate(none).action, 'INSUFFICIENT_DATA');
  assert.doesNotMatch(opportunitySummary(evaluate(none), 0), /沒有符合/);
});
test('full transmission is required; a sector label alone is not company exposure', () => {
  for (const field of ['cause', 'market_impact', 'company_exposure', 'fundamental_explanation', 'priced_in', 'risk_reward']) {
    const input = decisionFixture(); input.stock_opportunities[0].transmission[field] = '';
    assert.equal(evaluate(input).stock_opportunities.length, 0, field);
  }
});
test('natural-language ready/confirmed/failed cannot upgrade checkpoint', () => {
  for (const value of ['ready', '成立', 'confirmed', '跌破', '停止']) {
    const input = decisionFixture(); input.stock_opportunities[0].confirmation = value;
    assert.equal(evaluate(input).action, 'INSUFFICIENT_DATA');
  }
  const noEvidence = decisionFixture(); noEvidence.stock_opportunities[0].confirmation_evidence_ids = [];
  assert.equal(evaluate(noEvidence).action, 'INSUFFICIENT_DATA');
});
test('same-day same-revision fresh evidence required; no future or stale evidence', () => {
  for (const patch of [{report_date:'2026-09-06'}, {revision_id:'other'}, {observed_at:'2026-09-08T00:00:00Z'}, {observed_at:'2026-09-01T00:00:00Z'}]) {
    const input = decisionFixture(); Object.assign(input.evidence[0], patch);
    assert.equal(evaluate(input).action, 'INSUFFICIENT_DATA');
  }
  const input = decisionFixture(); input.report_date = '2026-09-06'; assert.equal(evaluate(input).action, 'INSUFFICIENT_DATA');
});
test('nested assessment cannot select another published identity', () => {
  const input = decisionFixture(); const identity = {report_date:DAY,revision_id:'synthetic-v1',generated_at:input.generated_at};
  // Precomputed fixture result, never untrusted factor inputs in React.
  const output = { ...evaluate(input), schema_version: 'decision-evidence-v1', calibration_status: 'INSUFFICIENT_HISTORY', direction_probability: null };
  assert.equal(decisionFromReport({decision_engine_v1:output}, identity, DAY).action, 'ACTIVE_WATCH');
  assert.equal(decisionFromReport({decision_engine_v1:input}, identity, DAY).action, 'INSUFFICIENT_DATA');
  assert.equal(decisionFromReport({decision_engine_v1:input}, {...identity,revision_id:'different'}, DAY).action, 'INSUFFICIENT_DATA');
});
test('non-trading day never presents a pending opportunity', () => {
  const input = decisionFixture(); input.is_trading_day = false;
  assert.equal(evaluate(input).action, 'NOT_APPLICABLE'); assert.equal(evaluate(input).stock_opportunities.length, 0);
});
test('symbol normalization merges evidence and invalidation; conflicts cannot select optimistic copy', () => {
  assert.equal(normalizeDecisionSymbol('TWSE:2344'), '2344'); assert.equal(normalizeDecisionSymbol('2344.TW'), '2344');
  const input = decisionFixture(), other = structuredClone(input.stock_opportunities[0]); other.symbol = '2344.TW'; other.invalidation_conditions = ['第二項合成風險']; input.stock_opportunities.push(other);
  assert.equal(evaluate(input).stock_opportunities.length, 1); assert.equal(evaluate(input).stock_opportunities[0].invalidation_conditions.length, 2);
  other.transmission.fundamental_impact = 'DAMAGED'; assert.equal(evaluate(input).action, 'INSUFFICIENT_DATA');
});
test('intraday completed is not confirmed; actual failure/partial/confirmed evidence are distinct', () => {
  const base = {status:'completed',runtimeFailure:false,confirmedEvidence:false,closing:''};
  assert.equal(intradayAnswer(base).tone,'amber');
  assert.equal(intradayAnswer({...base,status:'confirmed',confirmedEvidence:true}).tone,'green');
  assert.equal(intradayAnswer({...base,runtimeFailure:true}).tone,'red');
  assert.equal(intradayAnswer({...base,closing:'partial'}).tone,'amber');
  assert.equal(intradayAnswer({...base,closing:'miss'}).tone,'red');
});
test('all 33 stable glossary identities have six meaningful sections and reliable sources', () => {
  assert.equal(LEARNING_TERMS.length,33); assert.equal(Object.keys(LEARNING_USAGE).length,33);
  for (const term of LEARNING_TERMS) {
    for (const field of ['plainExplanation','example','whyItMatters','todayUsage','misconception','riskReminder']) assert.ok(term[field].length > 10, `${term.slug}.${field}`);
    assert.match(term.source.url,/^(https:\/\/|\/faq$)/);
  }
  const page = readFileSync(new URL('../src/pages/learn/page.tsx',import.meta.url),'utf8');
  const order = ['白話先懂','生活化例子','Morning Alpha 為什麼看','今天怎麼用','常見誤解','風險提醒'].map(s=>page.indexOf(s));
  assert.ok(order.every((v,i)=>v>=0 && (!i||v>order[i-1])));
});
test('navigation preserves decision priority before Learn on desktop and mobile', () => {
  const nav = readFileSync(new URL('../src/components/feature/Navbar.tsx',import.meta.url),'utf8');
  const indices = ['/report/today','/war-room','/verification','/performance','/learn'].map(s=>nav.indexOf(`to: '${s}'`));
  assert.ok(indices.every((v,i)=>v>=0&&(!i||v>indices[i-1])));
  assert.equal(actionTone('DO_NOT_CHASE'),'amber'); assert.equal(actionTone('AVOID'),'red'); assert.equal(actionTone('NOT_APPLICABLE'),'blue');
});
test('closing insufficient_data cannot coexist with a valid performance denominator', () => {
  for (const status of ['insufficient_data','insufficient','degraded','pending','','unknown']) assert.equal(closingDataComplete('completed',status,true),false);
  assert.equal(closingDataComplete('completed','complete',true),true); assert.equal(closingDataComplete('completed','complete',false),false);
});
test('forward validation excludes recovery, not-due, missing evidence and conflicting duplicates', () => {
  const row = {decision_revision:'frozen',symbol:'2344',category:'MISPRICING',horizon:5,decision_at:'2026-09-01T01:00:00Z',frozen_at:'2026-09-01T01:00:00Z',due_at:'2026-09-08T05:30:00Z',observed_at:'2026-09-08T05:31:00Z',is_trading_day:true,data_status:'complete',evidence_ids:['close'],outcome:'hit',execution:'NATURAL'};
  assert.equal(summarizeForwardValidation([row], '2026-09-07T00:00:00Z').valid_count,0);
  const at='2026-09-09T00:00:00Z'; assert.equal(summarizeForwardValidation([row,row],at).valid_count,1);
  for(const patch of [{execution:'RECOVERY'},{execution:'REPLAY'},{data_status:'insufficient_data'},{is_trading_day:false},{evidence_ids:[]},{frozen_at:'2026-09-02T01:00:00Z'}]) assert.equal(summarizeForwardValidation([{...row,...patch}],at).valid_count,0);
  assert.equal(summarizeForwardValidation([row,{...row,outcome:'miss'}],at).valid_count,0);
  assert.equal(summarizeForwardValidation([row],at).hit_rate,null);
});

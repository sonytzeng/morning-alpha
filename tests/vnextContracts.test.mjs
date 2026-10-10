import test from 'node:test';
import assert from 'node:assert/strict';
import {HORIZONS,FROZEN_V1_REF,snapshotHash,validTime} from '../src/features/vnext/contracts.ts';
import {evidenceIssues,eventTimeline,supplyRelationStatus,evaluateObservation,publicationGate,projectObservation,lockObservation,validationReadiness} from '../src/features/vnext/engine.ts';
import {fixture,fixtureHash,cutoff} from './fixtures/vnext.mjs';

test('separate evidence families and locked outcome horizons, never one technical score',()=>{
 assert.deepEqual(Object.values(HORIZONS).map(h=>h.outcomes),[[1,5,10],[20,40,60],[120,180,250]]);
 const f=fixture();for(const horizon of Object.keys(HORIZONS)){
  const o={...f.observation,horizon,evidence_ids:f.evidence.filter(e=>HORIZONS[horizon].required.includes(e.kind)).map(e=>e.id)};
  o.confirmation_conditions[0].evidence_ids=[o.evidence_ids[0]];o.invalidation_conditions[0].evidence_ids=[o.evidence_ids[0]];
  assert.equal(evaluateObservation(o,f.evidence,cutoff).eligible,true);
 }
 assert.ok(evaluateObservation({...f.observation,horizon:'LONG'},f.evidence,cutoff).issues.includes('MISSING_EPS'));
});
for(const [name,mutate,reason] of [
 ['future',e=>e.available_at='2026-10-09T00:00:00Z','POINT_IN_TIME_INVALID'],
 ['first seen later',e=>e.first_seen_at='2026-10-08T01:00:00Z','POINT_IN_TIME_INVALID'],
 ['published before as of',e=>e.as_of='2026-10-08T01:00:00Z','POINT_IN_TIME_INVALID'],
 ['stale',e=>e.valid_until=cutoff,'STALE_EVIDENCE'],
 ['bad time',e=>e.available_at='not-time','TIME_INVALID'],
 ['quality',e=>e.quality='INSUFFICIENT','QUALITY_REJECTED'],
 ['relevance',e=>e.relevant=false,'RELEVANCE_REJECTED'],
 ['secret URL',e=>e.source_ref='https://example.com/?token=test','SOURCE_LINEAGE_INVALID'],
 ['HTTP',e=>e.source_ref='http://example.com','SOURCE_LINEAGE_INVALID'],
 ['hash',e=>e.snapshot_hash='bad','SOURCE_LINEAGE_INVALID'],
])test('evidence fails closed: '+name,()=>{const e=fixture().evidence[0];mutate(e);assert.ok(evidenceIssues(e,cutoff).includes(reason));});
test('state priority expiry, invalidation, confirmation, unknown; missing never ready',()=>{
 const f=fixture(),evaluate=o=>evaluateObservation(o,f.evidence,cutoff);
 assert.equal(evaluate(f.observation).state,'CONDITION_MET');
 const o=structuredClone(f.observation);o.invalidation_conditions[0].state='UNKNOWN';assert.equal(evaluate(o).state,'WATCHING');
 o.invalidation_conditions[0].state='CONFIRMED';assert.equal(evaluate(o).state,'INVALIDATED');
 o.expires_at=cutoff;assert.equal(evaluate(o).state,'EXPIRED');
 assert.equal(evaluate({...f.observation,evidence_ids:[]}).eligible,false);
 assert.equal(evaluate({...f.observation,confirmation_conditions:[]}).eligible,false);
});
test('inference/news claim cannot satisfy required fact gate',()=>{
 const f=fixture();f.evidence[2].classification='REPORTED_CLAIM';assert.ok(evaluateObservation(f.observation,f.evidence,cutoff).issues.includes('MISSING_NEWS'));
});
test('unique symbol-linked evidence, no silently mixed revisions',()=>{
 const f=fixture();f.evidence[0].symbol='OTHER';assert.equal(evaluateObservation(f.observation,f.evidence,cutoff).eligible,false);
 f.evidence.push(f.evidence[1]);assert.ok(evaluateObservation(f.observation,f.evidence,cutoff).issues.includes('EVIDENCE_ID_INVALID'));
});
const event=()=>({event_id:'event-1',revision:1,source:'TEST',source_event_id:'announcement-1',published_at:'2026-10-07T22:00:00Z',first_seen_at:'2026-10-07T22:00:01Z',available_at:'2026-10-07T22:00:02Z',last_verified_at:'2026-10-07T22:01:00Z',title:'SYNTHETIC_EVENT',evidence_ids:['synthetic-0'],affected_companies:['TEST'],expected_horizons:['SHORT'],invalidation:'更正公告後重新驗證',classification:'CONFIRMED_FACT',snapshot_hash:fixtureHash});
test('event identity, update timeline and idempotency do not multiply catalysts',()=>{
 const a=event(),b={...a,revision:2,title:'SYNTHETIC_CORRECTION',available_at:'2026-10-07T23:00:00Z',last_verified_at:'2026-10-07T23:01:00Z'};
 const rows=eventTimeline([b,a,a],cutoff);assert.equal(rows.length,1);assert.equal(rows[0].timeline.length,2);assert.equal(rows[0].distinct_event_count,1);
 assert.equal(eventTimeline([a,b],'2026-10-07T22:30:00Z')[0].current.revision,1);
 assert.throws(()=>eventTimeline([a,{...a,title:'overwrite'}],cutoff),/IMMUTABLE/);
 assert.throws(()=>eventTimeline([a,{...b,source_event_id:'collision'}],cutoff),/COLLISION/);
});
test('supply relation requires time-valid evidence and never promises price benefit',()=>{
 const f=fixture(),r={id:'relation',from:'TEST',to:'OTHER',type:'SUPPLIER',source:'TEST',evidence_ids:['synthetic-0'],valid_from:'2026-10-01T00:00:00Z',valid_to:null,observed_at:'2026-10-07T22:00:00Z',available_at:'2026-10-07T22:00:00Z',confidence:'DOCUMENTED',revenue_exposure:null,verification_status:'VERIFIED'};
 r.source=f.evidence[0].source;
 assert.equal(supplyRelationStatus(r,f.evidence,cutoff),'SUPPORTED_RELATION_NOT_PRICE_FORECAST');
 for(const patch of [{evidence_ids:[]},{revenue_exposure:2},{verification_status:'UNVERIFIED'},{available_at:'2026-10-09T00:00:00Z'}])assert.equal(supplyRelationStatus({...r,...patch},f.evidence,cutoff),'UNKNOWN');
});
test('publication includes specific commercial and redistribution rights, immutable approval, no historical promotion',()=>{
 const f=fixture(),gate=()=>publicationGate(f.observation,f.evidence,f.licenses,f.policy);
 assert.equal(gate().allowed,true);
 f.licenses[0].redistribution=false;assert.ok(gate().issues.includes('LICENSE_NOT_CLEARED'));
 f.licenses[0].redistribution=true;f.observation.mode='HISTORICAL_REPLAY';assert.ok(gate().issues.includes('RESEARCH_CLASSIFICATION_REQUIRED'));
 f.observation.mode='FORWARD_SHADOW';f.policy.approved_snapshot_hash='b'.repeat(64);assert.ok(gate().issues.includes('PUBLICATION_NOT_APPROVED'));
});
test('misleading copy and overdue review block publication',()=>{
 const f=fixture();f.observation.reason='保證獲利';assert.ok(publicationGate(f.observation,f.evidence,f.licenses,f.policy).issues.includes('MISLEADING_COPY'));
 assert.ok(evaluateObservation(f.observation,f.evidence,'2026-10-09T00:00:00Z').issues.includes('REVIEW_OVERDUE'));
});
test('canonical snapshot key order stable and immutable lock checks actual evidence',async()=>{
 assert.equal(await snapshotHash({b:2,a:1}),await snapshotHash({a:1,b:2}));await assert.rejects(()=>snapshotHash({x:NaN}));
 const f=fixture(),{snapshot_hash,...payload}=f.observation;
 f.observation.snapshot_hash=await snapshotHash({observation:payload,evidence:f.evidence.filter(e=>f.observation.evidence_ids.includes(e.id)).sort((a,b)=>a.id.localeCompare(b.id))});
 assert.equal((await lockObservation(f.observation,f.evidence)).symbol,'TEST');
 f.evidence[0].summary='tampered';await assert.rejects(()=>lockObservation(f.observation,f.evidence),/SNAPSHOT/);
});
test('invalid calendar timestamps cannot be normalized into valid evidence',()=>{
 for(const value of ['2026-02-29T00:00:00Z','2026-04-31T00:00:00Z','2026-10-08T24:00:00Z','2026-10-08T00:60:00Z'])assert.equal(validTime(value),false);
 assert.equal(validTime('2024-02-29T08:00:00+08:00'),true);
});
test('event classification and graph endpoint/source must be verified, not merely any evidence id',()=>{
 assert.throws(()=>eventTimeline([{...event(),classification:'RUMOR_AS_FACT'}],cutoff),/EVENT_INVALID/);
 const f=fixture(),r={id:'relation',from:'TEST',to:'OTHER',type:'SUPPLIER',source:'TEST',evidence_ids:['synthetic-0'],valid_from:'2026-10-01T00:00:00Z',valid_to:null,observed_at:'2026-10-07T22:00:00Z',available_at:'2026-10-07T22:00:00Z',confidence:'DOCUMENTED',revenue_exposure:null,verification_status:'VERIFIED'};
 r.source=f.evidence[0].source;
 for(const patch of [{from:'UNRELATED',to:'UNRELATED2'},{source:'WRONG_SOURCE'},{type:'KEYWORD_MATCH'}])assert.equal(supplyRelationStatus({...r,...patch},f.evidence,cutoff),'UNKNOWN');
});
test('member projection contains no raw evidence hashes or internal policy',()=>{
 const f=fixture(),p=projectObservation(f.observation,f.evidence,'WATCHING');
 for(const key of ['snapshot_hash','license_id','strategy_version','publication_status'])assert.equal(p[key],undefined);
 assert.equal(p.evidence[0].snapshot_hash,undefined);
});
test('120 days cannot validate long horizon; backtest contract never invents performance',()=>{
 const c={point_in_time:false,historical_universe:false,corporate_actions:false,executable_prices:false,cost_model_version:null,regimes:[],frozen_v1_ref:FROZEN_V1_REF,available_sessions:120,train_end:'2020-01-01T00:00:00Z',validation_start:'2021-01-01T00:00:00Z',validation_end:'2022-01-01T00:00:00Z',oos_start:'2023-01-01T00:00:00Z',oos_end:'2024-01-01T00:00:00Z',frozen_at:'2025-01-01T00:00:00Z',baselines:[],walk_forward:false};
 const r=validationReadiness('LONG',c);assert.equal(r.BACKTEST_VALIDITY,'INSUFFICIENT');assert.equal(r.SIGNAL_EDGE,'UNPROVEN');assert.equal(r.metrics,null);assert.ok(r.issues.includes('HISTORY_INSUFFICIENT'));assert.ok(r.issues.includes('SPLIT_LEAKAGE'));
});

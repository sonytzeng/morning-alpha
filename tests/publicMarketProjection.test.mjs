import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildPublicMarketReadModel,parsePublicMarketReadModel,PUBLIC_REGIMES,PUBLIC_CHECKPOINTS} from '../src/lib/publicMarketReadModel.ts';
import {publicMarketInput} from '../supabase/functions/_shared/public-market-projection.ts';
import {getSubscriberReportProjection} from '../src/lib/subscriberReportContract.ts';
import {runCapturedContentOs} from './helpers/coreContentOsCapturedReplay.mjs';
import {publicProjectionCapsule,publicHandoffCapsule,recordPublicProjection} from '../supabase/functions/_shared/public-projection-recorder.ts';
import {measureHandoffReferences,replayHandoffReferences} from '../supabase/functions/_shared/public-handoff-evidence.ts';
const capture=JSON.parse(readFileSync(new URL('./fixtures/public-projection/production-20261002.json',import.meta.url)));
const clone=x=>structuredClone(x),snapshot=capture.tables.decision_snapshots.find(x=>x.session_type==='PREMARKET');
export const input=()=>publicMarketInput(capture.public_response.payload,snapshot,capture.tables.member_content_revisions[0],capture.tables.learning_runs[0],
 {batches:capture.tables.market_checkpoint_batches,proofs:capture.atomic_proofs.map(x=>x.proof)},'2026-10-02T12:30:00Z');
const project=i=>buildPublicMarketReadModel(i);
test('10/2 real frozen evidence produces one canonical read model, not the secondary assessment',()=>{
 const m=project(input());assert(m);assert.equal(m.market_regime,'range');assert.equal(PUBLIC_REGIMES[m.market_regime],'震盪／盤整');
 assert.equal(m.market_direction,'中性偏多');assert.equal(m.action,'WAIT');assert.equal(m.report_level,'DEGRADED');
 assert.equal(m.recommendation_status,'BLOCKED');assert.equal(m.closing_status,'PASS');assert.equal(m.learning_status,'PASS');
 assert.equal(m.latest_completed_checkpoint,'1430');assert.equal(m.next_checkpoint,'DAY_COMPLETED');
 assert.equal(m.evidence_completeness.intraday,66);assert.equal(m.evidence_completeness.completed_checkpoints,6);
 assert.deepEqual(project(clone(input())),m);assert(m.projection_revision.length<=512);
 const p={...capture.public_response.payload,public_market_read_model:m,canonical_member_revision_id:m.member_revision};
 const shapes=[p,{report_date:p.report_date,ai_strategy_json:p},{...capture.public_response,payload:p}];
 for(const shape of shapes){const v=getSubscriberReportProjection(shape);assert.equal(v.analysisAvailable,true);assert.equal(v.marketDecision.action,'WAIT');
  assert.equal(v.marketDecision.bias,'中性偏多');assert.equal(v.runtime.newIntradayEvidence,true);assert.equal(v.closing.outcome,'partial');
  for(const k of PUBLIC_CHECKPOINTS)assert.equal(v.runtime.checkpoints[k].status,'completed');assert.deepEqual(v.publicMarket,m);}
});
test('FULL/DEGRADED, recommendation READY/NONE/BLOCKED and three canonical regimes stay independent',()=>{
 for(const market_regime of ['range','trend_up','trend_down'])for(const report_level of ['FULL','DEGRADED'])for(const recommendation_status of ['READY','NONE','BLOCKED']){
  const m=project({...input(),market_regime,report_level,recommendation_status});assert(m);assert.equal(m.market_regime,market_regime);
  assert.equal(m.market_direction,'中性偏多');assert.equal(m.service_availability,'AVAILABLE');assert.equal(m.recommendation_status,recommendation_status);}
});
test('checkpoint projection increases only on authoritative atomic batches; Closing is separate',()=>{
 for(let n=0;n<=6;n++){const i=clone(input()),keys=['PREMARKET',...PUBLIC_CHECKPOINTS.slice(0,n)];
  i.batches=i.batches.filter(b=>keys.includes(b.checkpoint));i.proofs=i.proofs.filter(p=>keys.includes(p.checkpoint));
  i.closing_status='PENDING';i.closing_at=null;i.learning_status='DEGRADED';i.learning_at=null;
  const m=project(i);assert(m);assert.equal(m.evidence_completeness.intraday,n*11);
  assert.equal(m.latest_completed_checkpoint,n?PUBLIC_CHECKPOINTS[n-1]:'PREMARKET');assert.equal(m.next_checkpoint,n===6?'CLOSING':PUBLIC_CHECKPOINTS[n]);}
});
for(const [name,mutate]of Object.entries({
 wrong_revision:i=>i.member_snapshot_id='wrong',wrong_date:i=>i.business_date='2026-10-01',missing_canonical:i=>i.canonical_revision='',
 mixed_revision:i=>i.proofs[0].mixed_batch_revision_count=1,duplicate_batch:i=>i.batches.push(clone(i.batches[0])),
 future:i=>i.batches[0].committed_at='2026-10-03T00:00:00Z',missing_proof:i=>i.proofs=[],wrong_correlation:i=>i.proofs[0].correlation_id='wrong',
 no_publication:i=>i.publication_verified=false,partial:i=>i.batches[0].committed_provider_count=10,
}))test('public projection fail-closed: '+name,()=>{const i=clone(input());mutate(i);assert.equal(project(i),null);});
test('malformed/stale/mixed public model cannot fall back to permissive raw aliases',()=>{
 const m=project(input());for(const patch of [{business_date:'2026-09-11'},{canonical_revision:'other'},{updated_at:'2026-10-01T00:00:00Z'},{next_checkpoint:'1430'}]){
  const p={...capture.public_response.payload,public_market_read_model:{...m,...patch}};
  assert.equal(parsePublicMarketReadModel(p.public_market_read_model,{report_date:p.report_date,revision_id:p.revision_id}),null);
  assert.equal(getSubscriberReportProjection(p).analysisAvailable,false);}
});
test('10/2 actual Content OS handler accepts canonical market ledger without fabricating news URLs',async()=>{
 const tables=clone(capture.tables),r=await runCapturedContentOs(tables,{now:'2026-10-02T12:30:00Z'});
 assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.public_topic.kind,'market_brief');
 assert.equal(r.body.morning_brief.market_regime,'range');assert.equal(r.body.morning_brief.market_direction,'中性偏多');
 assert.equal(r.body.morning_brief.action,'WAIT');assert.equal(r.body.report_level,'DEGRADED');
 assert.equal(r.body.recommendation_status,'BLOCKED');assert.equal(r.body.opportunities.length,0);
 assert(r.body.facts.length>0);for(const ref of r.body.facts){assert.equal(ref.reference_type,'IMMUTABLE_MARKET_LEDGER');assert.equal(ref.url,undefined);}
 assert.equal(r.incidentTrace.filter(x=>x.name==='record_content_os_incident_v1').length,0);
});
test('actual public payload handler uses canonical model even when auxiliary assessment has no inputs',async()=>{
 const tables=clone(capture.tables);for(const name of ['market_quotes','news_events','institutional_flows','earnings_events','sector_stock_map','catalyst_tw_mappings','research_catalysts','model_evaluations'])tables[name]=[];
 const capsules=[];
 const r=await runCapturedContentOs(tables,{entrypoint:'get-report-payload',method:'POST',headers:{'content-type':'application/json'},
  requestBody:{report_date:'2026-10-02'},now:'2026-10-02T12:30:00Z',rpc:async(name,body)=>{
   if(name==='public_market_checkpoint_inputs_v1')return {batches:tables.market_checkpoint_batches,proofs:capture.atomic_proofs.map(x=>x.proof)};
   assert.equal(name,'record_critical_contract_evidence_v1');capsules.push(body.p_capsule);return null;
  }});
 assert.equal(r.status,200,JSON.stringify(r.body));const p=r.body.payload;
 assert(p.public_market_read_model,'shared model is mandatory for operational publication');
 assert.equal(p.public_market_read_model.market_regime,'range');assert.equal(p.public_market_read_model.action,'WAIT');
 assert.equal(p.public_market_read_model.next_checkpoint,'DAY_COMPLETED');assert.equal(p.subscriber_projection.publicMarket.market_direction,'中性偏多');
 assert.equal(capsules.length,1);assert.deepEqual(buildPublicMarketReadModel(capsules[0].input),capsules[0].expected);
});
test('Recorder retains only typed canonical input and can replay independently; failure is non-blocking',async()=>{
 const i=input(),capsule=publicProjectionCapsule({...i,Authorization:'Bearer forbidden',email:'never@example.invalid'});
 assert.equal(capsule.input.Authorization,undefined);assert.equal(capsule.input.email,undefined);
 assert.deepEqual(buildPublicMarketReadModel(capsule.input),capsule.expected);
 let attempted=0;recordPublicProjection({rpc:async()=>{attempted++;throw Error('OFFLINE');}},i);
 await new Promise(resolve=>setTimeout(resolve,5));assert.equal(attempted,1);assert.equal(project(i).service_availability,'AVAILABLE');
});
test('handoff actual selector input/result is replayable, sanitized and fails closed on a non-frozen reference',()=>{
 const i={business_date:snapshot.report_date,canonical_revision:snapshot.id,decision_version:snapshot.version,
  member_revision:capture.tables.member_content_revisions[0].id,source_revision:'candidate-v14',operational_ready:true,
  references:measureHandoffReferences(snapshot.source_refs,snapshot.source_refs),Authorization:'never-record'};
 const cap=publicHandoffCapsule(i);assert.equal(cap.input.Authorization,undefined);
 assert.equal(cap.expected.status,'PASS');assert.deepEqual(replayHandoffReferences(cap.input),cap.expected);
 const bad={...i,references:i.references.map(r=>({...r,frozen_match:false}))};
 assert.equal(replayHandoffReferences(bad).status,'CONFLICT');
 assert.equal(replayHandoffReferences({...i,operational_ready:false}).status,'CONFLICT');
 assert.throws(()=>publicHandoffCapsule({...i,source_revision:'secret@example.invalid'}),/UNSAFE/);
});

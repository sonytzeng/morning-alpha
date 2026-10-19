// Actual materialized entrypoints and SDK versions; explicitly synthetic data.
// No HTTP listener, Provider, gateway Auth, SQL persistence or Production E2E.
import test from 'node:test';
import assert from 'node:assert/strict';
import {materializedRuntime,invokeMaterialized,syntheticSavedReport,BUSINESS_DATE,CORRELATION,PRODUCER_NOW,
 SYNTHETIC_INTERNAL,SYNTHETIC_TOKEN} from './helpers/ownerQuarterLiveRuntimeHarness.mjs';
const internal={'x-cron-secret':SYNTHETIC_INTERNAL},authenticated={authorization:'Bearer '+SYNTHETIC_TOKEN};
const producerBody={business_date:BUSINESS_DATE,correlation_id:CORRELATION,scope:'UNIVERSE_72'};
const receipt='RECOMMENDATION_OWNER_QUARTER_RECEIPT_V1';
const capsulePath='supabase/functions/_shared/recommendation-owner-quarter-capsule.ts';
const plain=value=>JSON.parse(JSON.stringify(value));
let proofPromise;
function freshProof(){
 proofPromise??=(async()=>{const h=await materializedRuntime('producer');try{const result=await invokeMaterialized(h,{headers:internal,body:producerBody});assert.equal(result.status,200);assert.equal(result.body.transport_result_status,200);return result.body;}finally{await h.close();}})();
 return proofPromise.then(plain);
}
async function readProof(proof,options={}){
 const fixture=syntheticSavedReport(proof,{mutate:options.mutate}),before=JSON.stringify(fixture.report),h=await materializedRuntime(options.variant??'reader',{fixture,...options});
 try{const result=await invokeMaterialized(h,{headers:options.anonymous?{}:authenticated,body:{report_date:BUSINESS_DATE,tier:'admin',owner:true}});
  assert.equal(JSON.stringify(fixture.report),before,'SAVED_REPORT_MUST_NOT_BE_MUTATED');assert.equal(result.status,200,JSON.stringify(result.body));
  return {...result,trace:plain(h.trace),graph:h.graph()};
 }finally{await h.close();}
}
test('the required preload blocks real fetch and all four materialized graphs retain their actual SDK',async()=>{
 assert.throws(()=>globalThis.fetch('https://must-not-open.invalid'),/C_WORKER_TEST_NETWORK_DENIED/);
 for(const[variant,count]of [['producer',251],['producer-recovery',247],['reader',246],['reader-recovery',242]]){
  const h=await materializedRuntime(variant);try{
   assert.equal(h.payload.files.length,count);assert.equal(h.payload.verify_jwt,variant.startsWith('producer'));assert(!Object.hasOwn(h.payload,'import_map_path'));
   const graph=h.graph();assert.deepEqual(graph.remote,[]);assert(graph.local.includes(h.payload.entrypoint_path));
   const sdk=variant.startsWith('producer')?'_fixed_c_worker_sdk/f406ade7c66bd35e87d75f47674ac01aed5cfb8e3b822496f8db870f2d596a03.mjs':'_fixed_reader_sdk/83a913f210c2e9de5b06514e2a349a50e1f054af950bd1331cc4bb5d577b099e.mjs';
   assert(graph.local.some(name=>name.endsWith(sdk)));assert.equal(h.trace.length,0);h.assertClean();
  }finally{await h.close();}
 }
});
test('actual Producer rejects method, wrong internal Auth and unapproved scope before any RPC or Provider',async()=>{
 const h=await materializedRuntime('producer');try{
  for(const[input,status]of [[{method:'GET'},405],[{body:producerBody},401],[{headers:{'x-cron-secret':'SYNTHETIC_WRONG'},body:producerBody},401],
   [{headers:internal,body:{...producerBody,scope:'ANY_SYMBOL'}},422],[{headers:internal,body:{...producerBody,url:'https://forbidden.invalid'}},422],
   [{headers:internal,body:{...producerBody,business_date:'2026-10-19'}},422]])assert.equal((await invokeMaterialized(h,input)).status,status);
  assert.equal(h.trace.length,0);
 }finally{await h.close();}
});
test('actual Producer CACHED acquisition attaches four retained quarters without Provider, cache finish or business writes',async()=>{
 const cached={business_date:BUSINESS_DATE,acquisition_cutoff:PRODUCER_NOW,captures:[],officialActuals:[],companyEvents:[],acquired:{fugle:[],publicSources:[],benchmark_history:[]}},before=JSON.stringify(cached);
 const h=await materializedRuntime('producer',{cachedBundle:cached});try{
  const result=await invokeMaterialized(h,{headers:internal,body:producerBody}),proof=result.body;
  assert.equal(result.status,200);assert.equal(proof.transport_result_status,200);assert.deepEqual(proof.business_writes,[]);
  const candidate=proof.acquisition.foundation_candidate;assert.equal(candidate.contract,receipt);assert.equal(candidate.quarter_actuals.source_pack.rows.length,4);
  assert.equal(candidate.formal_evaluator_changed,false);assert.equal(candidate.member_publication_approved,false);
  assert.deepEqual(candidate.quarter_actuals.source_pack.quarter_window,['2025-Q4','2026-Q1','2026-Q2','2026-Q3']);
  assert.equal(proof.decision.screening.universe_count,72);assert.equal(proof.decision.screening.evaluated_count,0);
  assert.equal(JSON.stringify(cached),before);assert.equal(h.trace.filter(call=>call.path.endsWith('/claim_recommendation_v2_acquisition')).length,1);
  assert(h.trace.every(call=>call.method==='GET'||call.path.endsWith('/claim_recommendation_v2_acquisition')));
 }finally{await h.close();}
});
test('actual Producer recovery preserves formal result and omits only the new Owner capsule',async()=>{
 const proof=await freshProof(),h=await materializedRuntime('producer-recovery');try{
  const recovered=(await invokeMaterialized(h,{headers:internal,body:producerBody})).body;
  assert.equal(recovered.transport_result_status,200);assert.equal(recovered.acquisition.foundation_candidate,undefined);
  const expected=plain(proof);delete expected.acquisition.foundation_candidate;assert.deepEqual(recovered,expected);
 }finally{await h.close();}
});
test('actual published Reader permits four saved quarters only after real SDK Auth and literal Owner predicate',async()=>{
 const proof=await freshProof(),allowed=await readProof(proof),denied=await readProof(proof,{owner:false}),payload=allowed.body.payload;
 assert.equal(allowed.body.tier,'admin');assert.equal(allowed.body.subscriber_state.publication,'PUBLISHED');
 const study=payload.owner_market_foundation_candidate;assert.equal(study.candidate_only,true);assert.equal(study.member_publication_approved,false);
 assert.equal(study.quarter_actuals.rows.length,4);assert.equal(study.quarter_actuals.status,'ACTUALS_4_OF_4_V1_BLOCKED');
 assert.equal(study.decision_engine_v1.screening.evaluated_count,0);
 assert.equal(payload.admin_source_report.ai_strategy_json.recommendation_stock_evidence.foundation_candidate.contract,receipt);
 assert.deepEqual(payload.decision_engine_v1,denied.body.payload.decision_engine_v1);
 assert.deepEqual(allowed.body.subscriber_projection,denied.body.subscriber_projection);
 const predicate=allowed.trace.filter(call=>call.path.endsWith('/is_research_owner_v1'));assert.equal(predicate.length,1);
 assert.deepEqual(predicate[0],{path:'/rest/v1/rpc/is_research_owner_v1',method:'POST',key:'ANON',authorization:'REQUEST',body:{}});
 assert(allowed.trace.some(call=>call.path==='/auth/v1/user'&&call.key==='ANON'&&call.authorization==='REQUEST'));
 assert.equal(denied.body.payload.owner_market_foundation_candidate,undefined);assert(!JSON.stringify(denied.body).includes(receipt));
 assert.equal(denied.body.payload.admin_source_report.ai_strategy_json.legacy_diagnostic.keep,'SYNTHETIC_UNRELATED_DIAGNOSTIC');
});
test('admin metadata and nonboolean Owner predicates cannot expose either the projection or raw private ancestor',async()=>{
 const proof=await freshProof();
 for(const owner of [false,'true',1,{owner:true},[true],null]){
  const result=await readProof(proof,{owner});assert.equal(result.body.tier,'admin');
  assert.equal(result.body.payload.owner_market_foundation_candidate,undefined);assert(!JSON.stringify(result.body).includes(receipt));
  assert.equal(result.trace.filter(call=>call.path.endsWith('/is_research_owner_v1')).length,1);
 }
 const mismatch=await readProof(proof,{authId:'00000000-0000-4000-8000-000000000002'});
 assert(!JSON.stringify(mismatch.body).includes(receipt));assert(!mismatch.trace.some(call=>call.path.endsWith('/is_research_owner_v1')));
 const failure=await readProof(proof,{ownerFailure:true});assert.equal(failure.body.payload.owner_market_foundation_candidate,undefined);
 assert(!JSON.stringify(failure.body).includes(receipt));assert.equal(failure.trace.filter(call=>call.path.endsWith('/is_research_owner_v1')).length,1);
});
test('anonymous tier spoof and ordinary member never start Owner checks or receive private quarter evidence',async()=>{
 const proof=await freshProof();
 for(const options of [{anonymous:true},{profileRole:'member'}]){
  const result=await readProof(proof,options);assert.equal(result.body.tier,options.anonymous?'free':'member');
  assert.equal(result.body.payload.owner_market_foundation_candidate,undefined);assert(!JSON.stringify(result.body).includes(receipt));
  assert(!result.trace.some(call=>call.key==='ANON'||call.path.endsWith('/is_research_owner_v1')));
 }
});
test('strip-only Reader recovery removes private raw evidence even for Owner without adding an Owner RPC',async()=>{
 const proof=await freshProof(),normal=await readProof(proof),recovered=await readProof(proof,{variant:'reader-recovery'});
 assert.equal(recovered.body.tier,'admin');assert.equal(recovered.body.subscriber_state.publication,'PUBLISHED');
 assert(!JSON.stringify(recovered.body).includes(receipt));assert.equal(recovered.body.payload.owner_market_foundation_candidate,undefined);
 assert.equal(recovered.body.payload.admin_source_report.ai_strategy_json.legacy_diagnostic.keep,'SYNTHETIC_UNRELATED_DIAGNOSTIC');
 assert.deepEqual(recovered.body.payload.decision_engine_v1,normal.body.payload.decision_engine_v1);
 assert(!recovered.trace.some(call=>call.path.endsWith('/is_research_owner_v1')||call.key==='ANON'));
});
test('both stored Report JSON copies strip the private capsule for nonOwner admin and privacy recovery',async()=>{
 const proof=await freshProof();
 for(const stringValue of [false,true]){
  const mutate=report=>{
   const raw={...plain(report.ai_strategy_json),raw_diagnostic:'SYNTHETIC_UNRELATED_RAW_DIAGNOSTIC'};
   report.raw_ai_json=stringValue?JSON.stringify(raw):raw;
  };
  for(const options of [{owner:false},{variant:'reader-recovery'}]){
   const result=await readProof(proof,{...options,mutate});
   assert(!JSON.stringify(result.body).includes(receipt),'BOTH_STORED_JSON_PRIVATE_ANCESTORS_MUST_BE_STRIPPED');
   const raw=result.body.payload.admin_source_report.raw_ai_json,document=typeof raw==='string'?JSON.parse(raw):raw;
   assert.equal(document.raw_diagnostic,'SYNTHETIC_UNRELATED_RAW_DIAGNOSTIC');
   assert.equal(document.recommendation_stock_evidence.foundation_candidate,undefined);
  }
  const owner=await readProof(proof,{mutate}),raw=owner.body.payload.admin_source_report.raw_ai_json;
  assert.equal((typeof raw==='string'?JSON.parse(raw):raw).recommendation_stock_evidence.foundation_candidate.contract,receipt);
 }
});
test('actual Reader method, malformed body and content limit fail before SQL transport; history skips Owner check',async()=>{
 const proof=await freshProof(),fixture=syntheticSavedReport(proof),h=await materializedRuntime('reader',{fixture});try{
  assert.equal((await invokeMaterialized(h,{method:'GET'})).status,405);
  assert.equal((await invokeMaterialized(h,{body:'{'})).status,400);
  assert.equal((await invokeMaterialized(h,{body:{},headers:{'content-length':'32769'}})).status,413);assert.equal(h.trace.length,0);
  const history=await invokeMaterialized(h,{headers:authenticated,body:{history_limit:1}});assert.equal(history.status,200);assert.equal(history.body.reports.length,1);
  assert(!JSON.stringify(history.body).includes(receipt));assert(!h.trace.some(call=>call.key==='ANON'||call.path.endsWith('/is_research_owner_v1')));
 }finally{await h.close();}
});
test('materialized capsule rejects wrong revision, cutoff, source hash and extra market-flow field without formal mutation',async()=>{
 const proof=await freshProof(),h=await materializedRuntime('reader');try{
  const api=h.namespace(capsulePath),data=h.namespace('supabase/functions/_shared/decision-v1-data.ts').emptyEvidenceData();
  const ai={revision_id:'synthetic-snapshot',correlation_id:CORRELATION,generated_at:proof.decision.generated_at,decision_v1:proof.decision,recommendation_stock_evidence:proof.acquisition};
  const identity={report_date:BUSINESS_DATE,today_date:BUSINESS_DATE,revision_id:ai.revision_id,generated_at:'2026-10-19T23:06:00.000Z',data_as_of:PRODUCER_NOW,is_trading_day:true};
  const good=await api.persistedOwnerQuarterInput(data,identity,ai,{ownerAuthorized:true});assert.equal(good.quarterActuals.rows.length,4);assert.equal(good.data.earnings.length,4);
  const again=await api.persistedOwnerQuarterInput(good.data,identity,ai,{ownerAuthorized:true});assert.equal(again.data.earnings.length,4);
  for(const mutate of [v=>v.correlation_id='other',v=>v.recommendation_stock_evidence.foundation_candidate.evidence_cutoff='2099-01-01T00:00:00Z',
   v=>v.recommendation_stock_evidence.foundation_candidate.quarter_actuals.source_pack_sha256='0'.repeat(64),v=>v.recommendation_stock_evidence.foundation_candidate.market_flow={}]){
   const bad=plain(ai);mutate(bad);const result=await api.persistedOwnerQuarterInput(data,identity,bad,{ownerAuthorized:true});assert.equal(result.quarterActuals,undefined);assert.equal(result.data.earnings.length,0);assert(result.data.failures.length>0);
  }
  const member=await api.persistedOwnerQuarterInput(data,identity,ai,{ownerAuthorized:false});assert.equal(member.quarterActuals,undefined);assert.equal(member.data.earnings.length,0);
  const old=plain(ai);delete old.recommendation_stock_evidence.foundation_candidate;assert.equal((await api.persistedOwnerQuarterInput(data,identity,old,{ownerAuthorized:true})).quarterActuals,undefined);
  assert.equal(data.earnings.length,0);assert.equal(h.trace.length,0);
 }finally{await h.close();}
});
test('actual Producer keeps PREMARKET scope and cannot attach the new pack to the old 10/19 early Report',async()=>{
 const intraday=await materializedRuntime('producer',{now:'2026-10-20T01:00:00.000Z'});try{
  const result=await invokeMaterialized(intraday,{headers:internal,body:producerBody});
  assert.equal(result.status,200);assert.equal(result.body.transport_result_status,200);
  assert.equal(result.body.acquisition.foundation_candidate,undefined);
 }finally{await intraday.close();}
 const proof=await freshProof(),h=await materializedRuntime('producer');try{
  const api=h.namespace(capsulePath),old=plain(proof);delete old.acquisition.foundation_candidate;
  const at='2026-10-18T23:06:00.000Z',date='2026-10-19';
  old.decision.report_date=date;old.decision.generated_at=at;old.acquisition.business_date=date;old.acquisition.cutoff=at;
  const identity={report_date:date,today_date:date,revision_id:CORRELATION,generated_at:at,data_as_of:at,is_trading_day:true};
  const result=await api.attachOwnerQuarterCapsule(old,identity,at);
  assert.equal(result,old);assert.equal(result.acquisition.foundation_candidate,undefined);
  assert.equal(h.trace.length,0);
 }finally{await h.close();}
});

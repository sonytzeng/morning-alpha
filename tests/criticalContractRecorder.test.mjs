import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isolatedFunction} from './helpers/isolatedEdgeLoader.mjs';
import {buildCriticalContractCapsule,replayCriticalContract,recordCriticalContract} from '../supabase/functions/_shared/critical-contract-recorder.ts';
import {validateOpeningPublication,evaluateClosingContract} from '../supabase/functions/_shared/closing-learning-contract.ts';
import {observeCriticalClientFactory} from '../supabase/functions/_shared/critical-rpc-observer.ts';

// Reuse the existing audited synthetic close/learning fixtures, not new
// production evidence and not direct writes to a business result.
const source=readFileSync(new URL('./closingLearningContract.test.mjs',import.meta.url),'utf8');
const date='2026-09-08',now=Date.parse(`${date}T15:00:00+08:00`);
const openingFixture=isolatedFunction(source,'openingFixture',{date,now});
const quote=isolatedFunction(source,'quote',{date});
const closingFixture=isolatedFunction(source,'closingFixture',{date,quote});
const durableClosingFixture=isolatedFunction(source,'durableClosingFixture',{date,closingFixture});
const learningFixture=isolatedFunction(source,'learningFixture',{date,now,quote,openingFixture,durableClosingFixture,validateOpeningPublication,evaluateClosingContract});
const research=()=>({report_date:date,today_date:date,timezone:'Asia/Taipei',data_as_of:`${date}T07:00:00+08:00`,
  provenance:{generated_at:`${date}T07:10:00+08:00`},sections:{representative_stocks:[]},quality:{
    publish_status:'ready',evidence_coverage:100,unsupported_claims:[],duplicate_claims:[],contradictions:[],missing_sections:[],
    coverage_audit:{contract_version:'CLAIM_EVIDENCE_LEDGER_V1',denominator:1,numerator:1,claims:[{
      scope:'market',supported:true,evidence_ids:['close-evidence'],reason_codes:[],sources:[{
        evidence_id:'close-evidence',source:'authoritative_market_data_snapshots_v1',source_date:'2026-09-07',freshness:'previous_trading_day',
      }],
    }]},
  }});
const inputs={RESEARCH:research,PUBLICATION:research,OPENING:openingFixture,
  CLOSING:()=>({opening:validateOpeningPublication(openingFixture()),closingSnapshot:durableClosingFixture(),now}),
  LEARNING:learningFixture};

for(const [kind,fixture] of Object.entries(inputs)){
  test(`${kind}: capsule executes actual validator with equal positive and negative decisions`,()=>{
    const original=fixture();
    for(const input of [original,kind==='RESEARCH'||kind==='PUBLICATION'?{...original,quality:{}}:
      kind==='OPENING'?{...original,publicationRun:null}:kind==='CLOSING'?{...original,closingSnapshot:null}:{...original,outcomes:[]}]){
      const capsule=buildCriticalContractCapsule(kind,input);
      assert.deepEqual(replayCriticalContract(kind,capsule.input),replayCriticalContract(kind,input));
      // Expected result is only an assertion, never an input to the validator.
      capsule.expected={forged:'PASS'};
      assert.deepEqual(replayCriticalContract(kind,capsule.input),replayCriticalContract(kind,input));
    }
  });
}
test('unknown provenance, future evidence, malformed counters and source timestamps keep rejection reasons',()=>{
  for(const mutate of [r=>r.quality.coverage_audit.claims[0].sources[0].freshness='unknown',
    r=>r.quality.coverage_audit.claims[0].sources[0].source_date='2099-01-01',
    r=>r.quality.unsupported_claims=['不能發布的未支持敘述'],r=>r.quality.evidence_coverage='100']){
    const input=research();mutate(input);
    const capsule=buildCriticalContractCapsule('PUBLICATION',input);
    assert.deepEqual(replayCriticalContract('PUBLICATION',capsule.input),replayCriticalContract('PUBLICATION',input));
  }
  for(const source_at of [null,'','bad','2026-09-07T14:30:00+08:00']){
    const input=inputs.CLOSING();input.closingSnapshot.generated_text.closing_verification_v2.actual_taiex_close.source_at=source_at;
    const capsule=buildCriticalContractCapsule('CLOSING',input);
    assert.deepEqual(replayCriticalContract('CLOSING',capsule.input),replayCriticalContract('CLOSING',input));
  }
});
test('capsule excludes personal data, report prose, credentials and free-form fields',()=>{
  const input={...research(),Authorization:'Bearer sensitive',email:'person@example.com',member:{id:'secret-member'},title:'Private prose'};
  const capsule=buildCriticalContractCapsule('PUBLICATION',input);
  assert.doesNotMatch(JSON.stringify(capsule),/sensitive|person@example|secret-member|Private prose|Authorization/);
});
test('recorder schedules locally, tolerates failed storage and cannot change business decision',async()=>{
  let task,calls=0;
  globalThis.EdgeRuntime={waitUntil:value=>{task=value;}};
  try{
    const input=research(),before=replayCriticalContract('PUBLICATION',input);
    assert.equal(recordCriticalContract({rpc:async()=>{calls++;throw Error('isolated failure');}},'PUBLICATION',date,input),undefined);
    assert.deepEqual(replayCriticalContract('PUBLICATION',input),before);
    await task;assert.equal(calls,1);
  }finally{delete globalThis.EdgeRuntime;}
});
test('SQL rejection capsule is recorded outside the rejected transaction; original error identity is unchanged',async()=>{
  const calls=[],tasks=[];
  const error={code:'P0001',message:'lifecycle_predecessor_not_satisfied',details:JSON.stringify({stage:'LIFECYCLE',business_date:date,
    critical_contract_capsule:{contract_version:'CRITICAL_CONTRACT_REPLAY_V1',args:{p_state:'CLOSE_1410_CAPTURED'},expected:{sqlstate:'P0001'}}})};
  const result={data:null,error};
  const factory=observeCriticalClientFactory(()=>({rpc(name,args){calls.push({name,args});return Promise.resolve(name==='advance_trading_day_state_v1'?result:{data:null,error:{code:'RECORDER_DOWN'}});}}));
  globalThis.EdgeRuntime={waitUntil:task=>tasks.push(task)};
  try{
    const returned=await factory().rpc('advance_trading_day_state_v1',{});
    assert.equal(returned,result);assert.equal(returned.error,error);
    await Promise.all(tasks);
    assert.deepEqual(calls.map(c=>c.name),['advance_trading_day_state_v1','record_critical_contract_evidence_v1']);
    const untouched=await factory().rpc('other_business_rpc',{});assert.equal(untouched.error.code,'RECORDER_DOWN');
  }finally{delete globalThis.EdgeRuntime;}
});
test('ordinary SQL errors are never scraped as replay input',async()=>{
  let calls=0;
  const factory=observeCriticalClientFactory(()=>({rpc(){calls++;return Promise.resolve({data:null,error:{details:'Authorization: Do not capture'}});}}));
  await factory().rpc('advance_trading_day_state_v1',{});assert.equal(calls,1);
});

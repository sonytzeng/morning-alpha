import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {withRetainedSecDailyFinancials,parseRetainedSecDailyRegistry,mergeRetainedSecDailyFacts,
 SEC_RETAINED_SOURCE_SEAL,SEC_RETAINED_REPLAY_GAPS} from '../../../research/sec-daily-financial-replay.candidate.ts';

const registry=JSON.parse(await readFile(new URL('./sealed-registry.json',import.meta.url),'utf8'));
const current='2026-10-31T10:00:00.000001Z';
const baseline=()=>Array.from({length:72},(_,i)=>({symbol:i===0?'2330':String(1000+i),company:'測試公司',
 cutoff:'2026-10-31T09:00:00Z',through:'2026-10-30',next_session:'2026-11-02',expected_sessions:[],bars:[],facts:[],
 v1_missing:{SHORT:[],MEDIUM:[],LONG:[]}}));
const financial=inputs=>({inputs,cutoff:'2026-10-31T09:59:00Z',additionalGaps:['ORIGINAL_LIMITATION'],
 gapsBySymbol:Object.fromEntries(inputs.map(s=>[s.symbol,['FOUR_CONSECUTIVE_SINGLE_QUARTER_EPS_SERIES_NOT_ESTABLISHED_BY_NEW_OPEN_DATA']])),
 receipts:[],removed:[],proof:{schema:'DAILY_AI_FINANCIAL_REFRESH_V1',observed_at:'2026-10-31T09:59:00Z',
  responses:[],additions:[],removals:[],company_names:[]}});
const request=inputs=>({inputs,businessDate:'2026-10-31',fetcher:()=>{throw Error('UNEXPECTED_HTTP');},clock:()=>current,signal:new AbortController().signal});

test('actual sealed registry remains private and replays 12 unchanged facts through the financial port',async()=>{
 const inputs=baseline(),before=structuredClone(inputs),base=financial(inputs),proofBefore=structuredClone(base.proof);let calls=0;
 const wrapped=withRetainedSecDailyFinancials(async()=>base,async(args,signal)=>{
  calls++;assert.deepEqual(args,{p_source_seal:SEC_RETAINED_SOURCE_SEAL,p_cutoff:current});assert(!signal.aborted);return registry;
 });
 const result=await wrapped(request(inputs));
 assert.equal(calls,1);assert.deepEqual(inputs,before);assert.deepEqual(base.proof,proofBefore);
 assert.equal(result.inputs.length,72);assert.deepEqual(result.inputs[0].facts,registry.facts);
 assert(result.inputs.slice(1).every(s=>s.facts.length===0));
 assert(result.inputs[0].facts.every(f=>f.available_at.startsWith('2026-10-31T08:54:')&&f.published_at===null));
 assert(result.inputs[0].facts.every(f=>f.source_admitted===false&&f.member_publication_approved===false));
 assert.deepEqual(result.proof.responses,proofBefore.responses);assert.deepEqual(result.proof.additions,proofBefore.additions);
 assert.deepEqual(result.proof.sec_replay.fact_ids,registry.facts.map(f=>f.id).sort());
 assert.equal(result.proof.sec_replay.source_refetched,false);assert.equal(result.proof.sec_replay.source_admitted,false);
 for(const gap of SEC_RETAINED_REPLAY_GAPS)assert(result.gapsBySymbol['2330'].includes(gap));
 assert(!result.gapsBySymbol['2330'].includes('FOUR_CONSECUTIVE_SINGLE_QUARTER_EPS_SERIES_NOT_ESTABLISHED_BY_NEW_OPEN_DATA'));
 assert(result.gapsBySymbol['1001'].includes('FOUR_CONSECUTIVE_SINGLE_QUARTER_EPS_SERIES_NOT_ESTABLISHED_BY_NEW_OPEN_DATA'));
 const next=await withRetainedSecDailyFinancials(async()=>({...result,cutoff:'2026-11-01T09:59:00Z'}),async()=>registry)(
  {...request(result.inputs),businessDate:'2026-11-01',clock:()=> '2026-11-01T10:00:00Z'});
 assert.deepEqual(next.inputs[0].facts,registry.facts);assert.equal(next.inputs[0].facts.length,12);
 assert.equal(next.inputs[0].cutoff,'2026-11-01T10:00:00Z');
});

test('registry rejects any fact, source receipt, permission, seal or exact-time drift',async()=>{
 for(const mutate of [
  r=>{r.facts[0].values.value=999;},r=>{r.facts[0].source_admitted=true;},r=>{r.facts[0].member_publication_approved=true;},
  r=>{r.facts[0].available_at=current;},r=>{r.source_documents[0].sha256='0'.repeat(64);},
  r=>{r.source_seal_sha256='0'.repeat(64);},r=>{r.source_admitted=true;},r=>{r.facts.push(r.facts[0]);},
 ]){
  const changed=structuredClone(registry);mutate(changed);
  await assert.rejects(()=>parseRetainedSecDailyRegistry(changed,current),/REGISTRY_INVALID/);
 }
 await assert.rejects(()=>parseRetainedSecDailyRegistry(registry,'2026-10-31T08:54:52.081315Z'),/REGISTRY_INVALID/);
 const same=structuredClone(registry);same.facts=same.facts.map(f=>Object.fromEntries(Object.entries(f).reverse()));
 assert.deepEqual((await parseRetainedSecDailyRegistry(same,current)).facts,registry.facts);
});

test('existing observations survive a registry transport failure; cancellation does not become fallback success',async()=>{
 const base=financial(baseline());base.inputs[0].facts=structuredClone(registry.facts);
 const wrapped=withRetainedSecDailyFinancials(async()=>base,async()=>{throw Error('DB_UNAVAILABLE');});
 const result=await wrapped(request(base.inputs));
 assert.deepEqual(result.inputs,base.inputs);assert.deepEqual(result.proof,base.proof);
 assert(result.additionalGaps.includes('SEC_RETAINED_SOURCE_REPLAY_UNAVAILABLE'));
 const controller=new AbortController();
 const aborted=withRetainedSecDailyFinancials(async()=>base,async()=>{controller.abort();throw Error('ABORT');});
 await assert.rejects(()=>aborted({...request(base.inputs),signal:controller.signal}),/REPLAY_ABORTED/);
});

test('a replay cannot replace conflicting quarter data or hide SEC facts on another issuer',async()=>{
 const good={...baseline()[0],cutoff:current,facts:structuredClone(registry.facts)};
 const changed=structuredClone(good);changed.facts[0].values.unit='USD_PER_ADR';
 await assert.rejects(()=>mergeRetainedSecDailyFacts(changed,registry.facts),/REPLAY_DRIFT/);
 const conflicting={...good,facts:[{...registry.facts[0],id:'other-source'}]};
 await assert.rejects(()=>mergeRetainedSecDailyFacts(conflicting,registry.facts),/REPLAY_DRIFT|REPLAY_CONFLICT/);
 await assert.rejects(()=>mergeRetainedSecDailyFacts({...good,symbol:'2454'},registry.facts),/REPLAY_SCOPE/);
});

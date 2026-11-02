/** Portable synthetic boundary tests. No retained source values or provider calls. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseInstitutionalDailyRegistry,mergeInstitutionalDailyFacts,withRetainedInstitutionalDailyFinancials} from '../research/institutional-daily-financial-replay.ts';
import {parseIssuer16DailyRegistry,mergeIssuer16DailyFacts,requireIssuer16QuarantineContext,withRetainedIssuer16DailyFinancials} from '../research/issuer16-daily-financial-replay.ts';
import {INSTITUTIONAL_SOURCE_SEAL,INSTITUTIONAL_FACTS_SHA256,INSTITUTIONAL_REGISTRY_CUTOFF,INSTITUTIONAL_FACT_IDS,INSTITUTIONAL_SYMBOLS} from '../research/institutional-registry.constants.ts';
import {ISSUER16_SOURCE_SEAL,ISSUER16_FACTS_SHA256,ISSUER16_REGISTRY_CUTOFF,ISSUER16_FACT_IDS} from '../research/issuer16-registry.constants.ts';

const at=new Date(Math.max(Date.parse(INSTITUTIONAL_REGISTRY_CUTOFF),Date.parse(ISSUER16_REGISTRY_CUTOFF))+1000).toISOString();
const signal=()=>new AbortController().signal;
const trace=(id,period)=>({id,period,source:'https://synthetic.example/research',published_at:null,
 first_seen_at:at,available_at:at,as_of:at,evidence_hash:'a'.repeat(64)});
const inputs=()=>INSTITUTIONAL_SYMBOLS.map(symbol=>({symbol,company:'Synthetic '+symbol,cutoff:at,through:'2026-10-30',next_session:'2026-11-02',
 expected_sessions:[],bars:[],facts:[{...trace('INSTITUTIONAL-synthetic-'+symbol,'2026-10-15'),kind:'INSTITUTIONAL',basis:'SHARES',values:{net_shares:1}}],
 v1_missing:{SHORT:[],MEDIUM:[],LONG:[]}}));
const result=r=>({inputs:structuredClone(r.inputs),cutoff:r.clock(),additionalGaps:[],gapsBySymbol:{},receipts:[],removed:[],
 proof:{schema:'DAILY_AI_FINANCIAL_REFRESH_V1',observed_at:r.clock(),responses:[],additions:[],removals:[],company_names:[]}});
const request=()=>({inputs:inputs(),businessDate:'2026-11-02',clock:()=>at,fetcher:()=>{throw Error('FETCH_FORBIDDEN');},signal:signal()});

test('invented registry values cannot borrow a pinned seal or declared facts hash',async()=>{
 const institutional={schema:'DAILY_AI_OFFICIAL_INSTITUTIONAL_REGISTRY_V1',source_seal_sha256:INSTITUTIONAL_SOURCE_SEAL,
  facts_sha256:INSTITUTIONAL_FACTS_SHA256,registry_cutoff:INSTITUTIONAL_REGISTRY_CUTOFF,source_admitted:false,member_publication_approved:false,
  facts:INSTITUTIONAL_FACT_IDS.map((id,i)=>({...trace(id,'2026-10-29'),symbol:INSTITUTIONAL_SYMBOLS[i%72],kind:'INSTITUTIONAL',basis:'SHARES',values:{net_shares:1}}))};
 const native={schema:'DAILY_AI_ISSUER16_REGISTRY_V1',source_seal_sha256:ISSUER16_SOURCE_SEAL,facts_sha256:ISSUER16_FACTS_SHA256,
  registry_cutoff:ISSUER16_REGISTRY_CUTOFF,source_admitted:false,member_publication_approved:false,
  facts:ISSUER16_FACT_IDS.map(id=>({...trace(id,'2026-Q1'),symbol:'3006',kind:'EPS',basis:'SINGLE_QUARTER',values:{value:1}}))};
 await assert.rejects(parseInstitutionalDailyRegistry(institutional,at),/INSTITUTIONAL_REPLAY_INVALID/);
 await assert.rejects(parseIssuer16DailyRegistry(native,at),/ISSUER16_REPLAY_INVALID/);
 for(const parse of [parseInstitutionalDailyRegistry,parseIssuer16DailyRegistry]){
  await assert.rejects(parse(null,at),/REPLAY_INVALID/);
  await assert.rejects(parse({...native,source_admitted:true},at),/REPLAY_INVALID/);
 }
});

test('load failure preserves owned inputs and original generic institutional observations',async()=>{
 for(const wrap of [withRetainedInstitutionalDailyFinancials,withRetainedIssuer16DailyFinancials]){
  let release,seen,calls=0;const pending=new Promise((_,reject)=>{release=()=>reject(Error('SYNTHETIC_LOADER_UNAVAILABLE'));});
  const req=request(),original=structuredClone(req.inputs);
  const operation=wrap(async r=>{calls++;seen=structuredClone(r.inputs);return result(r);},async()=>pending)(req);
  req.inputs[0].facts[0].values.net_shares=999;req.clock=()=>{throw Error('MUTATED_CLOCK');};release();
  const financial=await operation;assert.equal(calls,1);assert.deepEqual(seen,original);assert.deepEqual(financial.inputs,original);
  assert.equal(financial.cutoff,at);assert.ok(financial.additionalGaps.some(g=>g.endsWith('UNAVAILABLE_NOT_APPLIED')));
  assert.equal(financial.proof.institutional_replay,undefined);assert.equal(financial.proof.issuer16_replay,undefined);
 }
});

test('already-present native facts cannot use an outage fallback without the complete old quarantine',async()=>{
 const req=request();req.inputs[0].facts.push({...trace(ISSUER16_FACT_IDS[0],'2026-Q1'),kind:'EPS',basis:'SINGLE_QUARTER',values:{value:1}});
 let loads=0,bases=0;
 await assert.rejects(withRetainedIssuer16DailyFinancials(async r=>{bases++;return result(r);},async()=>{loads++;throw Error('OUTAGE');})(req),/ISSUER16_REPLAY_INVALID/);
 assert.equal(loads,0);assert.equal(bases,0);
 await assert.rejects(requireIssuer16QuarantineContext(req.inputs),/ISSUER16_REPLAY_INVALID/);
});

test('cancellation and invalid universes stop before loader or financial work',async()=>{
 for(const wrap of [withRetainedInstitutionalDailyFinancials,withRetainedIssuer16DailyFinancials]){
  let calls=0;const run=wrap(async r=>{calls++;return result(r);},async()=>{calls++;throw Error('NO_LOAD');});
  const controller=new AbortController();controller.abort();await assert.rejects(run({...request(),signal:controller.signal}),/REPLAY_ABORTED/);
  const short=request();short.inputs.pop();await assert.rejects(run(short),/REPLAY_INVALID/);
  const duplicate=request();duplicate.inputs[1].symbol=duplicate.inputs[0].symbol;await assert.rejects(run(duplicate),/REPLAY_INVALID/);
  assert.equal(calls,0);
 }
});

test('institutional merge is exact, idempotent and keeps shares separate from currency',async()=>{
 const req=request(),input=req.inputs[0],symbol=input.symbol;
 const facts=['2026-10-29','2026-10-30'].map((period,i)=>({...trace(INSTITUTIONAL_FACT_IDS[i],period),symbol,kind:'INSTITUTIONAL',basis:'SHARES',unit:'SHARES',
  not_currency:true,source_received_at:at,source_sha256:'b'.repeat(64),source_bytes:100,source_admitted:false,member_publication_approved:false,values:{net_shares:i+1}}));
 const merged=await mergeInstitutionalDailyFacts(input,facts),again=await mergeInstitutionalDailyFacts(merged,facts);
 assert.deepEqual(again,merged);assert.deepEqual(input,req.inputs[0]);assert.equal(merged.facts[0].id,'INSTITUTIONAL-synthetic-'+symbol);
 assert.ok(merged.facts.slice(-2).every(f=>f.basis==='SHARES'&&f.unit==='SHARES'&&f.not_currency===true));
 const changed=structuredClone(merged);changed.facts.at(-1).values.net_shares=999;
 await assert.rejects(mergeInstitutionalDailyFacts(changed,facts),/REPLAY_INVALID/);
 const conflict=structuredClone(input);conflict.facts.push({...facts[0],id:'INSTITUTIONAL-another-unreviewed-source'});
 await assert.rejects(mergeInstitutionalDailyFacts(conflict,facts),/REPLAY_INVALID/);
});

test('native merge refuses a different same-quarter EPS series and owns both inputs',async()=>{
 const input={...inputs().find(i=>i.symbol==='3006'),facts:[]};
 const facts=[{...trace(ISSUER16_FACT_IDS[0],'2026-Q1'),symbol:'3006',kind:'EPS',basis:'SINGLE_QUARTER',values:{value:1,measurement_basis:'BASIC'}}];
 const first=await mergeIssuer16DailyFacts(input,facts),operation=mergeIssuer16DailyFacts(first,facts);
 facts[0].values.value=999;first.facts[0].values.value=999;
 const stable=await operation;assert.equal(stable.facts[0].values.value,1);assert.equal(input.facts.length,0);
 const conflict={...input,facts:[{...trace('synthetic-diluted','2026-Q1'),kind:'EPS',basis:'SINGLE_QUARTER',values:{value:1,measurement_basis:'DILUTED'}}]};
 await assert.rejects(mergeIssuer16DailyFacts(conflict,stable.facts),/REPLAY_INVALID/);
});

/** Synthetic boundaries. No retained source values, database or HTTP calls. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePortalMarginDailyRegistry,withRetainedPortalMarginDailyFinancials} from '../research/portal-margin-daily-financial-replay.ts';
import {PORTAL_MARGIN_SOURCE_SEAL,PORTAL_MARGIN_FACTS_SHA256,PORTAL_MARGIN_REGISTRY_CUTOFF,
 REQUIRED_NATIVE_MARGINS_SHA256,PORTAL_MARGIN_FACT_IDS} from '../research/portal-margin-registry.constants.ts';
const at=new Date(Date.parse(PORTAL_MARGIN_REGISTRY_CUTOFF)+1000).toISOString();
const input=()=>Array.from({length:72},(_,i)=>({symbol:String(1000+i),company:'Synthetic '+i,
 cutoff:at,through:'2026-10-30',next_session:'2026-11-02',expected_sessions:[],bars:[],facts:[],v1_missing:{SHORT:[],MEDIUM:[],LONG:[]}}));
const request=()=>({inputs:input(),businessDate:'2026-11-02',clock:()=>at,signal:new AbortController().signal,
 fetcher:()=>{throw Error('NO_FETCH');}});
const result=r=>({inputs:structuredClone(r.inputs),cutoff:r.clock(),additionalGaps:[],gapsBySymbol:{},receipts:[],removed:[],
 proof:{schema:'DAILY_AI_FINANCIAL_REFRESH_V1',observed_at:r.clock(),responses:[],additions:[],removals:[],company_names:[]}});

test('invented facts cannot borrow the exact portal seal or declared facts hash',async()=>{
 const invented={schema:'DAILY_AI_PORTAL_MARGIN_REGISTRY_V1',source_seal_sha256:PORTAL_MARGIN_SOURCE_SEAL,
  facts_sha256:PORTAL_MARGIN_FACTS_SHA256,registry_cutoff:PORTAL_MARGIN_REGISTRY_CUTOFF,
  required_native_margins_sha256:REQUIRED_NATIVE_MARGINS_SHA256,required_native_margins:[],
  facts:PORTAL_MARGIN_FACT_IDS.map(id=>({id,kind:'MARGIN',period:'2026-Q1',basis:'SINGLE_QUARTER',values:{value:1}})),
  source_admitted:false,member_publication_approved:false};
 await assert.rejects(parsePortalMarginDailyRegistry(invented,at),/PORTAL_MARGIN_REPLAY_INVALID/);
 await assert.rejects(parsePortalMarginDailyRegistry(null,at),/PORTAL_MARGIN_REPLAY_INVALID/);
 await assert.rejects(parsePortalMarginDailyRegistry({...invented,source_admitted:true},at),/PORTAL_MARGIN_REPLAY_INVALID/);
});

test('initial registry outage preserves ordinary owned inputs without a replay proof',async()=>{
 let release,seen;const pending=new Promise((_,reject)=>{release=()=>reject(Error('SYNTHETIC_OUTAGE'));});
 const req=request(),original=structuredClone(req.inputs);
 const run=withRetainedPortalMarginDailyFinancials(async r=>{seen=structuredClone(r.inputs);return result(r);},async()=>pending)(req);
 req.inputs.pop();req.clock=()=>{throw Error('CALLER_MUTATION');};release();
 const financial=await run;assert.deepEqual(seen,original);assert.deepEqual(financial.inputs,original);
 assert.equal(financial.proof.portal_margin_replay,undefined);
 assert.ok(financial.additionalGaps.includes('PORTAL_MARGIN_FIXED_REGISTRY_UNAVAILABLE_NOT_APPLIED'));
});

test('cancellation and invalid universe fail before loader or base financial work',async()=>{
 let calls=0;const operation=withRetainedPortalMarginDailyFinancials(async r=>{calls++;return result(r);},async()=>{calls++;throw Error('NO_LOAD');});
 const c=new AbortController();c.abort();await assert.rejects(operation({...request(),signal:c.signal}),/PORTAL_MARGIN_REPLAY_ABORTED/);
 const short=request();short.inputs.pop();await assert.rejects(operation(short),/PORTAL_MARGIN_REPLAY_INVALID/);
 const duplicate=request();duplicate.inputs[1].symbol=duplicate.inputs[0].symbol;await assert.rejects(operation(duplicate),/PORTAL_MARGIN_REPLAY_INVALID/);
 assert.equal(calls,0);
});

test('unregistered portal comparison or ratio cannot enter an outage fallback',async()=>{
 let calls=0;const operation=withRetainedPortalMarginDailyFinancials(async r=>{calls++;return result(r);},async()=>{calls++;throw Error('NO_LOAD');});
 for(const kind of ['MARGIN','PORTAL_MARGIN_COMPARISON','PORTAL_MARGIN_INDIVIDUAL']){
  const req=request();req.inputs[0].facts.push({id:'SYNTHETIC_UNKNOWN_PORTAL',kind,period:'2026-Q1',basis:'SINGLE_QUARTER',
   values:{value:1,measurement_basis:'OFFICIAL_PORTAL_CALCULATED_GROSS_MARGIN'}});
  await assert.rejects(operation(req),/PORTAL_MARGIN_REPLAY_INVALID/);
 }
 assert.equal(calls,0);
});

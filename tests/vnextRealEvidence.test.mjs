import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,chmodSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {factIssues,researchCard,buildRealResearch,verifyResearchLock} from '../src/features/vnext/realResearch.ts';
import {sourceFact,persistResearchLock} from '../scripts/vnext/real-evidence.mjs';
import {readOwnerResearch} from '../scripts/vnext/owner-research-server.mjs';
const at='2026-10-08T06:33:01.624Z',before='2026-10-08T06:00:00.000Z';
// Explicit SYNTHETIC controls only. Real replay runs offline outside Git/CI.
const fact=(kind='PRICE_VOLUME')=>({id:'SYNTHETIC-'+kind,symbol:'2330',kind,source:'https://example.com/test',evidence_hash:'a'.repeat(64),
 published_at:before,first_seen_at:before,available_at:before,as_of:before,period:'SYNTHETIC',summary:'SYNTHETIC_TEST_ONLY',values:{close:100,mean20:90,low20:80,volume_ratio20:1.2},limitations:[]});
const stock=()=>({symbol:'2330',company:'SYNTHETIC_TEST_ONLY',sector:'TEST',facts:[fact()],coverage:{20:{complete:true,valid:20,reason:null}}});
const input=()=>({business_date:'2026-10-08',cutoff:at,source_lock_at:'2026-10-08T06:34:00Z',input_hash:'b'.repeat(64),
 stocks:Array.from({length:72},(_,i)=>{const s=stock();s.symbol=String(1000+i);s.facts=s.facts.map(f=>({...f,symbol:s.symbol}));return s;}),events:[]});
test('missing publication is not filled from a receipt',()=>{
 const f=sourceFact({symbol:'2330',kind:'EPS',source:'https://example.com/test',raw:{value:1},firstSeen:before,available:before,summary:'SYNTHETIC',values:{eps:1}});
 assert.equal(f.published_at,null);assert.equal(f.as_of,null);assert(factIssues(f,at).includes('MISSING_PUBLISHED_AT'));
});
test('all six provenance fields remain present even when unknown',()=>{
 const f=fact();for(const k of ['published_at','first_seen_at','available_at','as_of','source','evidence_hash'])assert(k in f);
});
test('future event, first receipt and as-of each fail PIT',()=>{
 for(const k of ['published_at','first_seen_at','available_at','as_of']){const f=fact();f[k]='2026-10-09T00:00:00Z';assert(factIssues(f,at).some(x=>x.startsWith('FUTURE_')));const s=stock();s.facts=[f];assert.equal(researchCard(s,'SHORT',at).known.length,0);}
});
test('conflicting symbol cannot feed a stock card',()=>{const s=stock();s.facts[0].symbol='9999';assert.equal(researchCard(s,'SHORT',at).known.length,0);});
test('single technical evidence cannot authorize any horizon',()=>{
 for(const h of ['SHORT','MEDIUM','LONG'])assert.equal(researchCard(stock(),h,at).status,'INSUFFICIENT_EVIDENCE');
 assert.match(researchCard(stock(),'MEDIUM',at).reason,/訂單/);assert.match(researchCard(stock(),'LONG',at).reason,/競爭優勢/);
});
test('short descriptive reference retains exact numeric prices, not fabricated buy price',()=>{const c=researchCard(stock(),'SHORT',at);assert(c.known[0].includes('100'));assert(c.invalidation.includes('80'));assert(c.invalidation.includes('不能直接當停損價'));});
test('missing numeric values never become zero',()=>{const s=stock();s.facts[0].values={};assert.deepEqual(researchCard(s,'SHORT',at).known,[]);assert.match(researchCard(s,'SHORT',at).invalidation,/尚無可靠/);});
test('medium EPS and long revenue context retain their own source, not horizon substitution',()=>{
 const s=stock(),eps=fact('EPS'),revenue=fact('REVENUE');eps.values={eps:2};revenue.values={revenue_yoy:0.1,revenue_mom:0.02};s.facts.push(eps,revenue);
 const medium=researchCard(s,'MEDIUM',at),long=researchCard(s,'LONG',at);
 assert(medium.evidence.some(e=>e.kind==='EPS'));assert(long.evidence.some(e=>e.kind==='REVENUE'));
 assert(medium.known.some(x=>x.includes('單季或累計口徑尚待核對')));
 assert.equal(medium.status,'INSUFFICIENT_EVIDENCE');assert.equal(long.status,'INSUFFICIENT_EVIDENCE');
});
test('news record without retained body stays insufficient, not bullish',()=>{const f=fact('NEWS');f.limitations=['ANNOUNCEMENT_BODY_NOT_RETAINED','IMPACT_REVIEW_REQUIRED'];assert.equal(factIssues(f,at).length,2);});
test('counterfactual complete short families never leak into medium or long',()=>{const s=stock();s.facts=['PRICE_VOLUME','INSTITUTIONAL','NEWS','TECHNICAL_STRUCTURE'].map(fact);assert.equal(researchCard(s,'SHORT',at).status,'WAIT_CONFIRMATION');assert.equal(researchCard(s,'MEDIUM',at).status,'INSUFFICIENT_EVIDENCE');assert.equal(researchCard(s,'LONG',at).status,'INSUFFICIENT_EVIDENCE');});
test('historical deterministic report has zero forward and outcomes',async()=>{const i=input(),r=await buildRealResearch(i);assert.deepEqual(r,await buildRealResearch(structuredClone(i)));assert.equal(r.mode,'HISTORICAL_REPLAY');assert.equal(r.forward_sample,0);assert.equal(r.outcome_sample,0);assert.equal(r.supply_chain,'UNKNOWN');assert(await verifyResearchLock(r));r.cards[0].reason+='tamper';assert.equal(await verifyResearchLock(r),false);});
test('future source lock, duplicate universe, bad hash rejected',async()=>{for(const mutate of [i=>i.source_lock_at=before,i=>i.stocks[1]=i.stocks[0],i=>i.input_hash='bad']){const i=input();mutate(i);await assert.rejects(()=>buildRealResearch(i));}});
test('no future event accepted or duplicated as a synthetic price forecast',async()=>{const i=input();i.events=[{id:'e',symbol:'1000',source:'https://example.com/test',published_at:before,available_at:'2026-10-09T00:00:00Z',evidence_hash:'a'.repeat(64),title:null}];assert.equal((await buildRealResearch(i)).events.length,0);});
test('local evidence lock is append-only and idempotent',async()=>{const d=mkdtempSync(join(tmpdir(),'vnext-lock-test-'));chmodSync(d,0o700);try{const r=await buildRealResearch(input());assert.equal(persistResearchLock(r,d).state,'CREATED');assert.equal(persistResearchLock(r,d).state,'ALREADY_LOCKED');assert.throws(()=>persistResearchLock({...r,mode:'FORWARD_SHADOW'},d),/IMMUTABLE_LOCK_CONFLICT/);}finally{rmSync(d,{recursive:true});}});
test('missing identity and writes do not call even local verifier',async()=>{const no=()=>{throw Error('SHOULD_NOT_CALL');};assert.equal((await readOwnerResearch({method:'GET'},[],no)).status,401);assert.equal((await readOwnerResearch({method:'POST'},[],no)).status,405);});
test('server role rejects free, premium and forged client role; owner accepted only from existing RPC',async()=>{
 for(const tier of ['free','premium','owner']){const call=async(url,options)=>{assert.equal(url,'http://127.0.0.1:55633/rpc/get_vnext_observations_v1');assert.equal(options.body,'{}');return new Response(JSON.stringify({schema:'VNEXT_PROJECTION_V1',research_only:true,tier}));};
 const r=await readOwnerResearch({method:'GET',authorization:'Bearer SYNTHETIC_TOKEN',tier:'owner'},['PRIVATE_TEST_DATA'],call);assert.equal(r.status,tier==='owner'?200:403);if(tier!=='owner')assert(!JSON.stringify(r).includes('PRIVATE_TEST_DATA'));}
});
test('expired, wrong identity and unavailable verifier fail closed',async()=>{for(const code of [401,403,500])assert.notEqual((await readOwnerResearch({method:'GET',authorization:'Bearer SYNTHETIC_TOKEN'},[],async()=>new Response('{}',{status:code}))).status,200);assert.equal((await readOwnerResearch({method:'GET',authorization:'Bearer SYNTHETIC_TOKEN'},[],async()=>{throw Error('offline');})).status,503);});
test('real private source never appears in client bundle or Production router',()=>{const router=readFileSync(new URL('../src/router/config.tsx',import.meta.url),'utf8');assert(!router.includes('vnext'));const page=readFileSync(new URL('../src/pages/vnext/RealResearch.tsx',import.meta.url),'utf8');assert(!page.includes('service_role'));assert(page.includes('access.signal.aborted'));assert(page.includes('verifyResearchLock'));});

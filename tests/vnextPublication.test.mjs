import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {OPEN_DATA_RIGHTS,sourceRights,publicationDossier} from '../src/features/vnext/publicationReadiness.ts';
import {readOwnerResearch} from '../scripts/vnext/owner-research-server.mjs';
import {incrementalPlan} from '../scripts/vnext/foundation-validation.mjs';
const at='2026-10-10T12:00:00.000Z';
// Synthetic protocol controls ONLY, never investment efficacy or member content.
const fact={id:'SYNTHETIC',symbol:'2330',kind:'REVENUE',source:OPEN_DATA_RIGHTS[2].api,evidence_hash:'a'.repeat(64),published_at:at,first_seen_at:at,available_at:at,as_of:at,period:'202609',summary:'SYNTHETIC_PROTOCOL_ONLY',values:{},limitations:[]};
const stock={symbol:'2330',company:'協定測試，非真實研究',sector:'',facts:[fact],coverage:{}};
test('six specifically mapped datasets allow conditional OGL use, not publication approval',()=>{
 assert.equal(OPEN_DATA_RIGHTS.length,6);for(const r of OPEN_DATA_RIGHTS){assert.equal(sourceRights(r.api).status,'OPEN_DATA_WITH_ATTRIBUTION');assert.equal(sourceRights(r.resource).grant.id,r.id);assert(r.attribution);}
 assert.equal(publicationDossier(stock,at)[1].member_eligible,false);
});
test('same domain, other dataset, query, historical endpoint and lookalike host do not inherit rights',()=>{
 for(const url of [OPEN_DATA_RIGHTS[0].api+'?date=20200101',OPEN_DATA_RIGHTS[0].api+'/extra',OPEN_DATA_RIGHTS[0].api.replace('twse.com.tw','twse.com.tw.evil.test'),'https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&stockNo=2330','https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes'])assert.equal(sourceRights(url).status,'LICENSING_UNVERIFIED');
});
test('Fugle subscription, official company copyright and unsafe sources are not publication grants',()=>{
 assert.equal(sourceRights('https://api.fugle.tw/marketdata/v1.0/stock/historical/candles/2330').status,'RESTRICTED_CONTRACT_REQUIRED');
 for(const u of ['https://pr.tsmc.com/english/news/3274','https://example.com?token=secret','javascript:alert(1)'])assert.equal(sourceRights(u).status,'LICENSING_UNVERIFIED');
});
test('unknown/future timestamps stay in audit although rejected from display; no laundering by dropping facts',()=>{
 for(const changed of [{published_at:null},{available_at:'2026-10-11T00:00:00Z'},{first_seen_at:null}]){
  const r=publicationDossier({...stock,facts:[{...fact,...changed}]},at)[1];assert(r.evidence_issues.length);assert.equal(r.rights.length,1);assert(r.blockers.includes('MISSING_REVENUE'));assert.equal(r.member_eligible,false);
 }
});
test('dossiers never manufacture a forward prediction or public approval',()=>{
 for(const c of publicationDossier(stock,at)){assert.equal(c.mode,'REVIEW_DOSSIER_NOT_PREDICTION');assert(c.blockers.includes('PREDICTION_NOT_CREATED'));assert(c.blockers.includes('PUBLICATION_REVIEW_REQUIRED'));assert(c.confirmation&&c.invalidation&&c.next_review);}
 assert.throws(()=>publicationDossier({...stock,facts:[fact,fact]},at));assert.throws(()=>publicationDossier(stock,'invalid'));
});
test('optional EPS/revenue context is audited, even when its time or redistribution rights fail',()=>{
 for(const [horizon,kind] of [['MEDIUM','EPS'],['LONG','REVENUE']]){
  const cards=publicationDossier({...stock,facts:[{...fact,id:'context',kind,source:'https://api.fugle.tw/data',published_at:null}]},at);
  const c=cards.find(c=>c.horizon===horizon);assert.equal(c.rights.length,1);assert(c.blockers.includes('RESTRICTED_CONTRACT_REQUIRED'));assert(c.evidence_issues.some(i=>i.reason==='MISSING_PUBLISHED_AT'));assert.equal(c.evidence_ready,false);
 }
});
test('unsafe source remains a rejection reason, never a clickable Owner link',()=>{
 const c=publicationDossier({...stock,facts:[{...fact,source:'javascript:alert(1)'}]},at)[1];assert(c.blockers.includes('LICENSING_UNVERIFIED'));
 const ui=readFileSync(new URL('../src/pages/vnext/PublicationReadiness.tsx',import.meta.url),'utf8');assert(ui.includes('sourceSafe(r.source)?<a href={r.source}'));assert(ui.includes('來源網址無法安全開啟'));
});
test('Owner audit cannot leak to free, premium, anonymous or failed identity service',async()=>{
 const payload={secret_free_research:'SYNTHETIC_PRIVATE_AUDIT'};
 for(const tier of ['free','premium']){const r=await readOwnerResearch({method:'GET',authorization:'Bearer local-test'},[],async()=>new Response(JSON.stringify({schema:'VNEXT_PROJECTION_V1',tier,research_only:true})),null,payload);assert.equal(r.status,403);assert(!JSON.stringify(r).includes('SYNTHETIC_PRIVATE_AUDIT'));}
 assert.equal((await readOwnerResearch({method:'GET'},[],fetch,null,payload)).status,401);
 assert.equal((await readOwnerResearch({method:'GET',authorization:'Bearer local-test'},[],async()=>{throw Error('DOWN');},null,payload)).status,503);
});
test('background acquisition proposal is bounded, resumable and never a Core dependency',()=>{
 const stocks=Array.from({length:72},(_,i)=>({symbol:String(1000+i),exchange:i<61?'TWSE':'TPEX'}));
 for(const [coreComplete,coreBusy] of [[false,false],[true,true]])assert.deepEqual(incrementalPlan({completedSession:'2026-10-08',coreComplete,coreBusy,stocks}).jobs,[]);
 const base={completedSession:'2026-10-08',coreComplete:true,coreBusy:false,stocks},one=incrementalPlan(base),two=incrementalPlan({...base,cursor:one.next_cursor});
 assert.equal(one.enabled,false);assert.equal(one.core_awaits_research,false);assert(one.jobs.length<=12);assert.equal(one.concurrency,1);assert(one.jobs.every(j=>j.attempts===3&&j.timeout_ms===20000&&j.minimum_interval_ms===2200));
 assert(!two.jobs.some(j=>one.jobs.some(o=>o.id===j.id)));assert.equal(one.advance_watermark,'ONLY_AFTER_VALIDATED_IMMUTABLE_COMMIT');
 const skipped=incrementalPlan({...base,watermarks:Object.fromEntries(one.jobs.map(j=>[j.id,'2026-10-08']))});assert.equal(skipped.jobs.length,0);assert.equal(skipped.next_cursor,one.next_cursor);
});

import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateResearch,traceIssues,publicationEligibility,usageRights,projectQualifiedResearch,RESEARCH_FUNNEL_VERSION,summarizeFunnel} from '../src/features/vnext/researchFunnel.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {OPEN_DATA_RIGHTS} from '../src/features/vnext/publicationReadiness.ts';
import {retainedSessionScope} from '../scripts/vnext/research-funnel.mjs';
import {readOwnerResearch} from '../scripts/vnext/owner-research-server.mjs';
// SYNTHETIC CONTROL DATA: not a real equity, performance, or publication.
const at='2026-10-10T12:00:00.000Z',source='https://example.test/controlled-data';
const trace=id=>({id,source,evidence_hash:'a'.repeat(64),published_at:'2026-10-08T06:00:00Z',first_seen_at:at,available_at:at,as_of:'2026-10-08T06:00:00Z'});
const dates=Array.from({length:20},(_,i)=>new Date(Date.UTC(2026,8,19+i)).toISOString().slice(0,10));
function input(){return {symbol:'9999',company:'隔離合成控制，非真實股票',cutoff:at,through:dates.at(-1),next_session:'2026-10-12',expected_sessions:dates,
 bars:dates.map((date,i)=>({...trace('bar'+i),date,as_of:date+'T13:30:00+08:00',open:100,low:99,high:105,close:i===19?104:100,volume:10000,amount:i===19?2000000:1000000,session_scope:'SYNTHETIC_DAILY'})),facts:[],v1_missing:{SHORT:['MISSING_NEWS'],MEDIUM:['MISSING_ORDERS'],LONG:['MISSING_DEMAND']}};}
const fact=(kind,period,values,basis)=>({...trace(kind+period),kind,period,values,basis});
function medium(){const i=input();i.facts=[...['2026-05','2026-06','2026-07'].map(p=>fact('REVENUE',p,{yoy_percent:12},'MONTHLY')),...dates.slice(-10).map(p=>fact('INSTITUTIONAL',p,{net_shares:100},'SHARES'))];return i;}
function long(){const i=input();i.facts=[...['EPS','MARGIN','CAPEX'].flatMap(k=>['2025-Q4','2026-Q1','2026-Q2','2026-Q3'].map(p=>fact(k,p,{value:10},'SINGLE_QUARTER'))),...['DEMAND','MOAT','VALUATION'].map(k=>fact(k,'2026-Q3',{verdict:'SUPPORTED'},'DOCUMENTED_REVIEW'))];return i;}
const grant={source,document_url:'https://example.test/grant',reviewed_at:at,expires_at:null,storage:true,commercial:true,raw_redistribution:false,fact_publication:false,derived_publication:true,attribution:'SYNTHETIC grant; not a real license'};
const policy=hash=>({now:at,audience:'premium',server_entitlement_verified:true,input_hash:hash,approved_hash:hash,approved_at:at,quality_reviewed:true,methodology_approved:true,use:'OWN_ANALYSIS',grants:[grant]});
async function row(i=input(),h='SHORT'){const research=evaluateResearch(i,h),input_hash=await snapshotHash({version:RESEARCH_FUNNEL_VERSION,research});return {research,input_hash,publication:publicationEligibility(research,policy(input_hash))};}
test('short activity hypothesis has no long financial/supply-chain dependency and V1 stays separate',()=>{
 const r=evaluateResearch(input(),'SHORT');assert.equal(r.state,'QUALIFIED');assert.equal(r.v1.state,'INSUFFICIENT');assert(r.warnings.includes('RAW_ACTIVITY_ONLY_NOT_ADJUSTED_TREND'));assert.equal(r.used.length,20);
});
test('medium requires real revenue continuity/institutional direction, not orders or supply chain',()=>{
 const r=evaluateResearch(medium(),'MEDIUM');assert.equal(r.state,'QUALIFIED');assert.equal(r.used.length,13);assert(!r.used.some(e=>e.kind==='SUPPLY_CHAIN'));
});
test('long is independent of short price/volume and retains necessary financial guards',()=>{
 const i=long();i.bars=[];assert.equal(evaluateResearch(i,'LONG').state,'QUALIFIED');i.facts=i.facts.filter(f=>f.kind!=='EPS');assert.equal(evaluateResearch(i,'LONG').state,'INSUFFICIENT');
});
test('evaluated rejection is distinct from missing evidence',()=>{
 const i=input();i.bars.at(-1).amount=1000000;let r=evaluateResearch(i,'SHORT');assert.equal(r.state,'REJECTED');assert.equal(r.evaluated,true);
 i.bars.pop();r=evaluateResearch(i,'SHORT');assert.equal(r.state,'INSUFFICIENT');assert.equal(r.evaluated,false);
});
test('invalid stocks do not become qualified through unrelated gate removal',()=>{
 for(const change of [{close:99},{amount:1000000},{high:120}]){const i=input();Object.assign(i.bars.at(-1),change);assert.notEqual(evaluateResearch(i,'SHORT').state,'QUALIFIED');}
});
test('future/absent availability and invalid source/hash remain rejected',()=>{
 for(const change of [{available_at:null},{available_at:'2026-10-11T00:00:00Z'},{source:'javascript:bad'},{evidence_hash:'fake'},{first_seen_at:null}]){const i=input();Object.assign(i.bars.at(-1),change);assert.equal(evaluateResearch(i,'SHORT').state,'INSUFFICIENT');}
});
test('missing original publication timestamp is never backfilled but receipt-time research is distinct',async()=>{
 const i=input();i.bars.forEach(b=>b.published_at=null);const r=await row(i);assert.equal(r.research.state,'QUALIFIED');assert(r.research.used.every(e=>e.published_at===null));assert.equal(r.publication.eligible,false);assert(r.publication.reasons.includes('PUBLICATION_TIME_UNVERIFIED'));
});
test('old cutoff does not admit freshly obtained 250D data',()=>{
 const i=input();i.cutoff='2026-10-07T06:00:00Z';const r=evaluateResearch(i,'SHORT');assert.equal(r.state,'INSUFFICIENT');assert(r.reasons.includes('FUTURE_EVIDENCE'));
});
test('duplicate, wrong session, partial and mixed-scope prices fail closed',()=>{
 for(const mode of ['duplicate','scope','missing','as_of','invalid']){const i=input();if(mode==='duplicate')i.bars.push(i.bars[0]);if(mode==='scope')i.bars[0].session_scope='OTHER';if(mode==='missing')i.bars.shift();if(mode==='as_of')i.bars[0].as_of=at;if(mode==='invalid')i.bars[0].volume=NaN;assert.equal(evaluateResearch(i,'SHORT').state,'INSUFFICIENT');}
});
test('medium missing months, bad units and future evidence are not financial continuity',()=>{
 for(const mode of ['gap','unit','missing','future']){const i=medium();if(mode==='gap')i.facts[0].period='2026-03';if(mode==='unit')i.facts.at(-1).basis='TWD';if(mode==='missing')i.facts.shift();if(mode==='future')i.facts[0].available_at='2027-01-01T00:00:00Z';assert.equal(evaluateResearch(i,'MEDIUM').state,'INSUFFICIENT');}
});
test('medium and long negative observations remain rejected, not relabeled as missing',()=>{
 const m=medium();m.facts[0].values.yoy_percent=-2;assert.equal(evaluateResearch(m,'MEDIUM').state,'REJECTED');const l=long();l.facts[0].values.value=-1;assert.equal(evaluateResearch(l,'LONG').state,'REJECTED');
});
test('long cumulative EPS and mismatched periods cannot pass',()=>{
 for(const mode of ['cumulative','period']){const i=long();if(mode==='cumulative')i.facts[0].basis='UNKNOWN_CUMULATIVE';else i.facts[4].period='2024-Q4';assert.equal(evaluateResearch(i,'LONG').state,'INSUFFICIENT');}
});
test('future financial period cannot hide behind an old receipt timestamp',()=>{
 const m=medium();m.facts[2].period='2027-01';assert.equal(evaluateResearch(m,'MEDIUM').state,'INSUFFICIENT');
 const l=long();l.facts.filter(f=>['EPS','MARGIN','CAPEX'].includes(f.kind)).forEach(f=>f.period=f.period.replace('2026','2027'));assert(evaluateResearch(l,'LONG').reasons.includes('FINANCIAL_PERIOD_NOT_AVAILABLE'));
});
test('research qualification does not depend on licensing; publication does',async()=>{
 const r=await row();assert.equal(r.research.state,'QUALIFIED');const p=publicationEligibility(r.research,{...policy(r.input_hash),grants:[]});assert.equal(p.eligible,false);assert(p.categories.includes('LICENSING'));
});
test('unqualified rows do not enter publication denominator',()=>{
 const i=input();i.bars=[];const r=evaluateResearch(i,'SHORT'),p=publicationEligibility(r,policy('a'.repeat(64)));assert.equal(p.checked,false);assert.deepEqual(p.reasons,[]);
});
test('explicit derived-only grant is not raw-data permission; neither direction inferred',()=>{
 assert.equal(usageRights(source,'OWN_ANALYSIS',at,[grant]).allowed,true);assert.equal(usageRights(source,'RAW_DATA',at,[grant]).allowed,false);
 assert.equal(usageRights(source,'OWN_ANALYSIS',at,[{...grant,raw_redistribution:true,derived_publication:false}]).allowed,false);
 assert.equal(usageRights(source,'OFFICIAL_FACT',at,[]).allowed,false);
});
test('exact open dataset allows facts/analysis with attribution but not adjacent endpoint',()=>{
 for(const use of ['RAW_DATA','OFFICIAL_FACT','OWN_ANALYSIS']){const r=usageRights(OPEN_DATA_RIGHTS[2].api,use,at);assert.equal(r.allowed,true);assert(r.attribution);}
 assert.equal(usageRights(OPEN_DATA_RIGHTS[2].api+'?other=1','OWN_ANALYSIS',at).allowed,false);
});
test('expired, future, duplicate and wrong source grants fail closed',()=>{
 for(const grants of [[{...grant,expires_at:at}],[{...grant,reviewed_at:'2027-01-01T00:00:00Z'}],[grant,grant],[{...grant,source:'https://other.test'}]])assert.equal(usageRights(source,'OWN_ANALYSIS',at,grants).allowed,false);
});
test('publication separately classifies stale, review and permission issues',async()=>{
 const r=await row(),p=publicationEligibility(r.research,{...policy(r.input_hash),now:'2026-10-12T06:00:00Z',methodology_approved:false,approved_hash:null,server_entitlement_verified:false});assert.deepEqual(p.categories,['APPROVAL','EXPIRED','PERMISSION','QUALITY']);
});
test('content tampering cannot reuse approved snapshot',async()=>{
 const r=await row();r.research.reason='tampered';await assert.rejects(()=>projectQualifiedResearch([r],()=>policy(r.input_hash)),/LOCK_MISMATCH/);
});
test('server free projection excludes Premium details, caps distinct symbols globally',async()=>{
 const rows=await Promise.all(Array.from({length:5},(_,i)=>row({...input(),symbol:String(9000+i)})));
 const free=await projectQualifiedResearch(rows,r=>({...policy(r.input_hash),audience:'free'}));assert.equal(free.length,3);assert(free.every(r=>!Object.hasOwn(r,'evidence')&&!Object.hasOwn(r,'confirmation')));
 const premium=await projectQualifiedResearch(rows,r=>policy(r.input_hash));assert.equal(premium.length,5);assert(premium.every(r=>r.evidence.length===20));
});
test('anonymous, unverified client tier and missing grants yield a truthful empty projection',async()=>{
 const r=await row();for(const change of [{audience:'anonymous'},{server_entitlement_verified:false},{grants:[]},{approved_hash:null}])assert.deepEqual(await projectQualifiedResearch([r],()=>({...policy(r.input_hash),...change})),[]);
});
test('counts obey partitions; reasons overlap but never inflate stock totals',async()=>{
 const a=await row(),i=input();i.bars=[];const b=await row(i);const j=input();j.bars.at(-1).amount=1000000;const c=await row(j);const s=summarizeFunnel([a,b,c]);assert.equal(s.scanned,3);assert.equal(s.evaluated,2);assert.equal(s.qualified,1);assert.equal(s.rejected,1);assert.equal(s.insufficient,1);assert.equal(s.publication_checked,1);
});
test('legacy session label only maps exact matching official resource, never a lookalike or wrong symbol',()=>{
 const b={date:'2026-10-08',source_ref:'https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=20261001&stockNo=2330'};assert.equal(retainedSessionScope(b,'2330'),'OFFICIAL_STOCK_DAY');assert.equal(retainedSessionScope(b,'2454'),'');assert.equal(retainedSessionScope({...b,source_ref:b.source_ref.replace('twse.com.tw','evil.test')},'2330'),'');
});
test('new funnel uses existing server Owner guard, no browser role bypass',async()=>{
 for(const tier of ['free','premium']){const r=await readOwnerResearch({method:'GET',authorization:'Bearer isolated'},[],async()=>new Response(JSON.stringify({schema:'VNEXT_PROJECTION_V1',tier,research_only:true})),null,null,{private_funnel:true});assert.equal(r.status,403);assert(!JSON.stringify(r).includes('private_funnel'));}
 assert.equal((await readOwnerResearch({method:'GET'},[],fetch,null,null,{})).status,401);
});
test('funnel is unmounted from Production, defaults collapsed, remains research-only',()=>{
 const root=new URL('../',import.meta.url);assert(!readFileSync(new URL('src/router/config.tsx',root),'utf8').includes('ResearchFunnel'));
 const ui=readFileSync(new URL('src/pages/vnext/ResearchFunnel.tsx',root),'utf8');assert(!/<details[^>]*\bopen/.test(ui));assert(ui.includes('不是買進推薦'));assert(ui.includes('新版研究假設'));
});
test('raw source publication after availability and malformed cutoffs fail',()=>{
 assert(traceIssues({...trace('x'),published_at:'2026-10-11T00:00:00Z'},at).includes('FUTURE_EVIDENCE'));assert.throws(()=>evaluateResearch({...input(),cutoff:'bad'},'SHORT'));
});

/** Synthetic source controls and real sealed packets. No production writes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {assembleDaily,sessionsBefore} from '../src/features/vnext/dailyAdapter.ts';
import {evaluateResearch} from '../src/features/vnext/researchFunnel.ts';
import {mergeIssuerFinancialBatch} from '../src/features/vnext/issuerFinancialIntake.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {RECOMMENDATION_UNIVERSE} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';
import {retainedIssuerFinancialReleases as releases} from '../supabase/functions/_shared/retained-issuer-financials.ts';
const date='2026-11-03',cutoff='2026-11-03T00:30:00.000Z',source='https://www.twse.com.tw/retained-fact-control';
const companies=RECOMMENDATION_UNIVERSE.map(symbol=>({symbol,company:symbol,exchange:'TWSE',industry:'24'}));
const periods=Array.from({length:12},(_,i)=>new Date(Date.UTC(2025,9+i,1)).toISOString().slice(0,7));
const dates=sessionsBefore(date).slice(-20);
const trace=(symbol,kind,period,as_of,values,basis)=>({symbol,kind,period,as_of,values,basis,id:kind+'-'+symbol+'-'+period,
 source,published_at:null,first_seen_at:cutoff,available_at:cutoff,evidence_hash:'a'.repeat(64)});
async function receipt(kind,rows){const payload={rows};return {task:{key:'b'.repeat(64),kind,url:source,format:'json',scope:date,
 symbols:[...RECOMMENDATION_UNIVERSE],max_age_days:1,...(kind==='FINANCIAL_YTD'?{financial_response_contract:'MOPS_RESPONSE_PERIOD_V1',year:2026,quarter:3}:{})},
 first_seen_at:cutoff,available_at:cutoff,published_at:null,as_of:cutoff,version:'VNEXT_DAILY_OFFICIAL_1',raw_hash:'c'.repeat(64),
 payload_hash:await snapshotHash(payload),payload,status:'OK',reason:null};}
async function fixture(){
 const revenue=companies.flatMap(c=>periods.map(period=>trace(c.symbol,'REVENUE',period,
  new Date(Date.UTC(Number(period.slice(0,4)),Number(period.slice(5)),0)).toISOString().slice(0,10)+'T23:59:59+08:00',
  {yoy_percent:10,mom_percent:2},'MONTHLY')));
 const institutional=companies.flatMap(c=>dates.map(d=>trace(c.symbol,'INSTITUTIONAL',d,d+'T13:30:00+08:00',{net_shares:10},'SHARES')));
 const financial=[{...trace('1504','FINANCIAL_YTD','2026-Q3','2026-09-30T23:59:59+08:00',{eps:3},'AS_REPORTED_YTD'),
  source_period:{year:2026,quarter:3},period_verification:'RESPONSE_REPORT_HEADING_MATCHED_REQUEST',standalone_quarter_actual:false}];
 const sources=[await receipt('REVENUE',revenue),await receipt('INSTITUTIONAL',institutional),await receipt('FINANCIAL_YTD',financial)];
 return {sources,allFacts:[...revenue,...institutional,...financial]};
}
async function originalInput(projected,allFacts){
 const inputs=projected.inputs.map(({omitted_fact_ids,...i})=>{void omitted_fact_ids;return {...i,facts:allFacts.filter(f=>f.symbol===i.symbol)};});
 const body={...projected,inputs,entry:{...projected.entry,source_evidence_hash:await snapshotHash(inputs)}};delete body.snapshot_hash;
 return {...body,snapshot_hash:await snapshotHash(body)};
}
async function rehash(a){const {snapshot_hash,...body}=a;void snapshot_hash;a.snapshot_hash=await snapshotHash(body);return a;}

test('fact windows preserve all216 research decisions, selected evidence, financial facts and every retained packet observation',async()=>{
 const f=await fixture(),sources=structuredClone(f.sources),projected=await assembleDaily(date,companies,f.sources,cutoff),original=await originalInput(projected,f.allFacts);
 for(const [n,input]of projected.inputs.entries()){
  assert.equal(input.facts.filter(f=>f.kind==='REVENUE').length,3);assert.equal(input.facts.filter(f=>f.kind==='INSTITUTIONAL').length,10);
  for(const h of ['SHORT','MEDIUM','LONG'])assert.deepEqual(evaluateResearch(input,h),evaluateResearch(original.inputs[n],h));
  assert.deepEqual(new Set(input.omitted_fact_ids),new Set(original.inputs[n].facts.filter(f=>!input.facts.some(k=>k.id===f.id)).map(f=>f.id)));
 }
 assert.deepEqual(projected.inputs[0].facts.find(f=>f.kind==='FINANCIAL_YTD'),f.allFacts.find(f=>f.kind==='FINANCIAL_YTD'));
 const [full,small]=await Promise.all([mergeIssuerFinancialBatch(original,releases),mergeIssuerFinancialBatch(projected,releases)]);
 const packetIds=new Set(releases.flatMap(r=>r.packet.facts.map(f=>f.id)));
 for(let n=0;n<72;n++){
  assert.deepEqual(small.inputs[n].facts.filter(f=>packetIds.has(f.id)),full.inputs[n].facts.filter(f=>packetIds.has(f.id)));
  for(const h of ['SHORT','MEDIUM','LONG'])assert.deepEqual(evaluateResearch(small.inputs[n],h),evaluateResearch(full.inputs[n],h));
 }
 assert.deepEqual(small.source_issues,full.source_issues);assert.deepEqual(f.sources,sources);
});

test('an otherwise valid EPS packet that reuses an omitted old revenue ID is still refused',async()=>{
 const f=await fixture(),projected=await assembleDaily(date,companies,f.sources,cutoff),original=await originalInput(projected,f.allFacts);
 const packet=structuredClone(releases[0].packet),fact=packet.facts.find(f=>f.kind==='EPS');packet.facts=[fact];
 const input=projected.inputs.find(i=>i.symbol===fact.symbol);fact.id=input.omitted_fact_ids[0];
 const binding={packet,expectedHash:await snapshotHash(packet)},before=structuredClone(projected);
 await assert.rejects(()=>mergeIssuerFinancialBatch(original,[binding]),/EXISTING_ID_CONFLICT/);
 await assert.rejects(()=>mergeIssuerFinancialBatch(projected,[binding]),/EXISTING_ID_CONFLICT/);
 assert.deepEqual(projected,before);
 for(const manifest of ['bad-manifest',['duplicate','duplicate'],[17]]){
  const bad=structuredClone(projected);bad.inputs[0].omitted_fact_ids=manifest;await rehash(bad);
  await assert.rejects(()=>mergeIssuerFinancialBatch(bad,releases),/INPUT_SCOPE/);
 }
});

test('removed facts retain the original future/lineage veto and duplicate latest periods remain insufficient',async()=>{
 const f=await fixture();f.sources[0].payload.rows[0].first_seen_at='2026-11-03T01:00:00.000Z';
 f.sources[0].payload_hash=await snapshotHash(f.sources[0].payload);
 await assert.rejects(()=>assembleDaily(date,companies,f.sources,cutoff),/POINT_IN_TIME_INVALID/);
 const g=await fixture(),latest=g.sources[0].payload.rows.find(r=>r.symbol===companies[0].symbol&&r.period===periods.at(-1));
 const duplicate={...structuredClone(latest),id:'duplicate-latest-period'};g.sources[0].payload.rows.push(duplicate);g.allFacts.push(duplicate);
 g.sources[0].payload_hash=await snapshotHash(g.sources[0].payload);
 const projected=await assembleDaily(date,companies,g.sources,cutoff),original=await originalInput(projected,g.allFacts);
 assert.deepEqual(evaluateResearch(projected.inputs[0],'MEDIUM'),evaluateResearch(original.inputs[0],'MEDIUM'));
 assert(evaluateResearch(projected.inputs[0],'MEDIUM').reasons.includes('REVENUE:DUPLICATE_PERIOD'));
});

test('a newer FINANCIAL_YTD period still blocks a stale retained issuer series after projection',async()=>{
 const f=await fixture(),packet=structuredClone(releases[0].packet);
 packet.facts=[packet.facts.find(x=>x.symbol==='2330'&&x.kind==='EPS'&&x.period<'2026-Q3')];
 const newer={...structuredClone(f.sources[2].payload.rows[0]),symbol:'2330',id:'newer-financial-period'};
 f.sources[2].payload.rows.push(newer);f.allFacts.push(newer);f.sources[2].payload_hash=await snapshotHash(f.sources[2].payload);
 const projected=await assembleDaily(date,companies,f.sources,cutoff),original=await originalInput(projected,f.allFacts);
 const bindings=[{packet,expectedHash:await snapshotHash(packet)}];
 const [small,full]=await Promise.all([mergeIssuerFinancialBatch(projected,bindings),mergeIssuerFinancialBatch(original,bindings)]);
 assert.deepEqual(small.source_issues,full.source_issues);
 assert(small.source_issues.some(i=>i.key==='2330'&&i.reason==='NEWER_FINANCIAL_PERIOD_REQUIRES_REVIEW'));
 assert(!small.inputs.find(i=>i.symbol==='2330').facts.some(f=>f.kind==='EPS'));
 assert.deepEqual(small.inputs.find(i=>i.symbol==='2330').facts.find(f=>f.id===newer.id),newer);
});

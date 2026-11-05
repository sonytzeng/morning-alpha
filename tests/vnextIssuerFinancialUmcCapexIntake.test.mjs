/** Real retained quarterly spending, synthetic acquisition controls. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {mergeIssuerFinancialBatch} from '../src/features/vnext/issuerFinancialIntake.ts';
import {evaluateResearch} from '../src/features/vnext/researchFunnel.ts';
import {RECOMMENDATION_UNIVERSE} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';
import {retainedIssuerFinancialUmcCapexSupplement as binding,retainedIssuerFinancialReleases as releases} from '../supabase/functions/_shared/retained-issuer-financials.ts';
const {packet,expectedHash}=binding,clone=v=>structuredClone(v);
const at=(offset=1)=>new Date(Date.parse(packet.created_at)+offset).toISOString();
async function acquired(cutoff=at(),extra=[]){
 const body={inputs:RECOMMENDATION_UNIVERSE.map(symbol=>({symbol,company:symbol,cutoff,through:'2026-11-02',next_session:'2026-11-03',
  expected_sessions:[],bars:[],facts:clone(extra.filter(f=>f.symbol===symbol)),v1_missing:{SHORT:['NOT_EVALUATED'],MEDIUM:['NOT_EVALUATED'],LONG:['NOT_EVALUATED']}})),entry:null,evidence_cutoff:cutoff};
 return {...body,snapshot_hash:await snapshotHash(body)};
}
const umc=a=>a.inputs.find(i=>i.symbol==='2303');
async function rebind(p){
 for(const f of p.facts){const {id,evidence_hash,...body}=f;void id;void evidence_hash;f.evidence_hash=await snapshotHash(body);}
 return {packet:p,expectedHash:await snapshotHash(p)};
}

test('sixth release restores four exact original USD quarterly CAPEX sentences without conversion or publication',async()=>{
 assert.equal(releases.length,6);assert.equal(releases[5],binding);assert.equal(await snapshotHash(packet),expectedHash);
 assert.equal(packet.max_age_days,7);assert.equal(packet.facts.length,4);
 assert.deepEqual(packet.facts.map(f=>f.period),['2025-Q4','2026-Q1','2026-Q2','2026-Q3']);
 assert.deepEqual(packet.facts.map(f=>f.values.value),[501,416,308,373]);
 for(const f of packet.facts){
  const {id,evidence_hash,...body}=f;assert.equal(evidence_hash,await snapshotHash(body));
  assert.equal(id,`umc-ir-direct:2303:${f.period}:CAPEX:${f.source_sha256}`);
  assert.equal(f.values.unit,'USD_MILLION');assert.equal(f.values.currency,'USD');assert.equal(f.values.scale,1000000);
  assert.equal(f.values.conversion_to_twd,'NOT_PERFORMED');assert.equal(f.values.scope,'ACTUAL_QUARTER_SPENDING_NOT_ANNUAL_BUDGET_OR_PPE');
  assert.equal(f.source_locator.page,9);assert.equal(f.source_locator.column,'CURRENT_QUARTER_SPENDING_SENTENCE_NOT_BUDGET');
  assert.equal(f.source_admitted,false);assert.equal(f.member_publication_approved,false);assert.equal(f.published_at,null);
 }
 const input=await acquired(),before=clone(input),out=await mergeIssuerFinancialBatch(input,releases);
 assert.deepEqual(input,before);assert.equal(out.inputs.flatMap(i=>i.facts).length,329);
 assert.deepEqual(umc(out).facts.filter(f=>f.kind==='CAPEX'),packet.facts);
 assert.deepEqual(await mergeIssuerFinancialBatch(out,releases),out);
 const long=evaluateResearch(umc(out),'LONG');
 assert.deepEqual(long.reasons,['MISSING_DEMAND_1','MISSING_MOAT_1','MISSING_VALUATION_1']);
 assert.equal(long.state,'INSUFFICIENT');assert.equal(long.evaluated,false);
});

test('USD admission rejects another company, changed source, numeric conversion, budget or PPE even after all caller hashes rebound',async()=>{
 for(const change of [f=>f.symbol='2330',f=>f.source=f.source.replace('umc.com','example.com'),
  f=>f.values.value*=32,f=>f.values.unit='TWD',f=>f.values.currency='TWD',f=>f.values.scale=1,
  f=>f.values.measurement_basis='ISSUER_REPORTED_CASH_OUTFLOW_MAGNITUDE',
  f=>f.values.scope='ANNUAL_CAPEX_BUDGET',f=>f.source_locator.page=8,
  f=>f.first_seen_at='2026-11-01T13:00:00Z']){
  const p=clone(packet);p.facts=[p.facts[0]];change(p.facts[0]);const b=await rebind(p),input=await acquired(),before=clone(input);
  await assert.rejects(()=>mergeIssuerFinancialBatch(input,[b]),/CAPEX_UNIT/);assert.deepEqual(input,before);
 }
});

test('mixed currency or scale in an existing company CAPEX series cannot join the original USD values',async()=>{
 for(const values of [{unit:'TWD',currency:'TWD',scale:1},{unit:'USD_MILLION',currency:'USD',scale:1}]){
  const old={...clone(packet.facts[0]),period:'2025-Q3',id:'synthetic-old-capex',values:{...packet.facts[0].values,...values}};
  const input=await acquired(at(),[old]),before=clone(input);
  await assert.rejects(()=>mergeIssuerFinancialBatch(input,[binding]),/CAPEX_BASIS/);assert.deepEqual(input,before);
  const repeated=await acquired(at(),[...packet.facts,old]);
  await assert.rejects(()=>mergeIssuerFinancialBatch(repeated,[binding]),/CAPEX_BASIS/);
 }
});

test('native CAPEX release keeps its own new review availability and exact expiry without extending old packets',async()=>{
 for(const [offset,n,reason]of [[-1,0,'RETAINED_PACKET_NOT_YET_AVAILABLE'],[7*86400000-1,4,null],[7*86400000,0,'RETAINED_PACKET_REVIEW_EXPIRED']]){
  const out=await mergeIssuerFinancialBatch(await acquired(at(offset)),[binding]);assert.equal(umc(out).facts.length,n);
  if(reason)assert(out.source_issues.some(i=>i.key===expectedHash&&i.reason===reason));
 }
 const newest={...clone(packet.facts[0]),kind:'FINANCIAL_YTD',basis:'AS_REPORTED_YTD',period:'2026-Q4',id:'synthetic-new-financial-period'};
 const out=await mergeIssuerFinancialBatch(await acquired(at(),[newest]),[binding]);
 assert.deepEqual(umc(out).facts,[newest]);
 assert(out.source_issues.some(i=>i.key==='2303'&&i.reason==='NEWER_FINANCIAL_PERIOD_REQUIRES_REVIEW'));
 const withAll=await mergeIssuerFinancialBatch(await acquired(at(7*86400000-1)),releases);
 assert.equal(withAll.inputs.flatMap(i=>i.facts).length,4,'new CAPEX review cannot renew any earlier release');
});

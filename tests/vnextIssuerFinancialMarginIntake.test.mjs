/** Real retained margins; synthetic intake controls, not natural daily execution. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {mergeIssuerFinancialBatch} from '../src/features/vnext/issuerFinancialIntake.ts';
import {RECOMMENDATION_UNIVERSE} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';
import {retainedIssuerFinancialMarginSupplement as binding,retainedIssuerFinancialReleases as allReleases} from '../supabase/functions/_shared/retained-issuer-financials.ts';
const releases=allReleases.slice(0,5);
const {packet,expectedHash}=binding,clone=v=>structuredClone(v);
const portal=f=>f.source==='https://mopsfin.twse.com.tw/compare/data';
const at=(offset=1000)=>new Date(Date.parse(packet.created_at)+offset).toISOString();
async function acquired(cutoff=at()){
 const body={inputs:RECOMMENDATION_UNIVERSE.map(symbol=>({symbol,company:symbol,cutoff,through:'2026-11-02',next_session:'2026-11-03',
  expected_sessions:[],bars:[],facts:[],v1_missing:{SHORT:['NOT_EVALUATED'],MEDIUM:['NOT_EVALUATED'],LONG:['NOT_EVALUATED']}})),entry:null,evidence_cutoff:cutoff};
 return {...body,snapshot_hash:await snapshotHash(body)};
}
async function changedPortal(change,choose=f=>portal(f)){
 const p=clone(packet),f=p.facts.find(choose);p.facts=[f];change(f,p);
 const {id,evidence_hash,...body}=f;void id;void evidence_hash;f.evidence_hash=await snapshotHash(body);
 return {packet:p,expectedHash:await snapshotHash(p)};
}
const facts=a=>a.inputs.flatMap(i=>i.facts),margins=a=>facts(a).filter(f=>f.kind==='MARGIN');

test('fifth release pins236 real margins with223 original portal locators and13 native source pages',async()=>{
 const bytes=readFileSync(new URL('../supabase/functions/_shared/retained-issuer-financials-20261103-margin.json',import.meta.url));
 assert.equal(bytes.length,735637);assert.equal(createHash('sha256').update(bytes).digest('hex'),'f531a0d0f38e040e593e13a6715d849398c701a5ae4874b7b48e0552207ee0d3');
 assert.deepEqual(JSON.parse(bytes),packet);assert.equal(await snapshotHash(packet),expectedHash);
 assert.equal(expectedHash,'6464fc192100e38265605b5dd5b98042a6c8300238ac3389716cca7b3a8c1745');
 assert.equal(packet.created_at,'2026-11-02T23:01:57.672Z');assert.equal(packet.max_age_days,7);assert.equal(packet.facts.length,236);
 assert.equal(releases.length,5);assert.equal(releases[4],binding);assert.equal(packet.facts.filter(portal).length,223);assert.equal(packet.facts.filter(f=>!portal(f)).length,13);
 const nativeBy=Object.fromEntries(['2379','3006','3711','2303'].map(symbol=>[symbol,packet.facts.filter(f=>!portal(f)&&f.symbol===symbol).length]));
 assert.deepEqual(nativeBy,{'2379':1,'3006':4,'3711':4,'2303':4});
 for(const key of ['source_admitted','member_publication_approved','methodology_promoted'])assert.equal(packet[key],false);
 for(const f of packet.facts){
  const {id,evidence_hash,...body}=f;assert.equal(evidence_hash,await snapshotHash(body));assert.equal(f.kind,'MARGIN');assert.equal(f.basis,'SINGLE_QUARTER');assert.equal(f.values.unit,'PERCENT');
  assert.equal(f.source_admitted,false);assert.equal(f.member_publication_approved,false);assert.equal(f.published_at,null);assert(Date.parse(f.available_at)<=Date.parse(packet.created_at));
  if(portal(f)){
   assert(!Object.hasOwn(f.source_locator,'page'));assert.equal(f.values.measurement_basis,'OFFICIAL_PORTAL_CALCULATED_GROSS_MARGIN');
   assert.equal(f.direct_single_quarter,false);assert.equal(f.interpretation_only,true);assert.equal(f.ttm_established,false);
   assert.deepEqual(f.source_locator.point,[f.source_locator.axis_index,f.values.value,'C']);assert.equal(f.source_locator.period_label,f.period.replace('-',''));
   assert.equal(f.source_candidate_id,`official-portal-calculated-margin:${f.symbol}:${f.period}:${f.source_sha256}`);
   assert.equal(f.id,`portal-margin-verified:${f.symbol}:${f.period}:${f.source_sha256}`);
   assert.equal(f.first_seen_at,f.source_received_at);assert.equal(f.available_at,f.derived_at);
   assert.equal(f.values.single_quarter_amount_basis,f.period.endsWith('Q4')?'OFFICIAL_PORTAL_FY_CUMULATIVE_MINUS_Q3_CUMULATIVE':'ISSUER_REPORTED_SINGLE_QUARTER_AMOUNTS_PER_SOURCE_TERMS');
  }else assert(f.source_locator.page>0);
 }
});

test('five releases join325 facts, preserve16 original margins and expose only61 full and2 partial margin series',async()=>{
 const input=await acquired(),before=clone(input),out=await mergeIssuerFinancialBatch(input,releases);
 assert.deepEqual(input,before);assert.equal(facts(out).length,325);assert.deepEqual(await mergeIssuerFinancialBatch(out,releases),out);
 const prior=releases.slice(0,4).flatMap(r=>r.packet.facts.filter(f=>f.kind==='MARGIN'));assert.equal(prior.length,16);
 for(const f of prior)assert.deepEqual(out.inputs.find(i=>i.symbol===f.symbol).facts.find(x=>x.id===f.id),f);
 const all=margins(out);assert.equal(all.length,252);
 const groups=[...new Set(all.map(f=>f.symbol))].map(symbol=>({symbol,rows:all.filter(f=>f.symbol===symbol).sort((a,b)=>a.period.localeCompare(b.period)).slice(-4)}));
 assert.equal(groups.length,63);assert.equal(groups.filter(g=>g.rows.length===4).length,61);
 assert.deepEqual(groups.filter(g=>g.rows.length===3).map(g=>g.symbol).sort(),['2610','3450']);
 assert.equal(groups.reduce((n,g)=>n+g.rows.length,0),250);
 for(const g of groups.filter(g=>g.rows.length===4)){
  const indexes=g.rows.map(f=>Number(f.period.slice(0,4))*4+Number(f.period.at(-1)));
  assert(indexes.every((v,i)=>i===0||v===indexes[i-1]+1));
 }
 for(const symbol of ['2610','3450'])assert(!all.some(f=>f.symbol===symbol&&f.period==='2026-Q2'),'unreconciled quarter remains held out');
 assert.equal(all.find(f=>f.symbol==='2208'&&f.period==='2025-Q3').values.value,-2.02);
 assert.equal(all.find(f=>f.symbol==='2208'&&f.period==='2026-Q2').values.value,-11.71);
 const ase=all.find(f=>f.symbol==='3711'&&f.period==='2026-Q2');assert.equal(ase.values.value,21.012111244279737);assert(!portal(ase));
});

test('portal axis, point, company, period basis, private flags and fake pages stay vetoed after both hashes are rebound',async()=>{
 const changes=[
  f=>f.source_locator.page=1,
  f=>f.source_locator.axis_index++,
  f=>f.source_locator.point[0]++,
  f=>f.source_locator.point[1]+=1,
  f=>f.source_locator.point[2]='A',
  f=>f.symbol='2881',
  f=>f.id='unbound-company-record',
  f=>f.source_locator.series_company_label='',
  f=>f.values.measurement_basis='DIRECTLY_REPORTED_GROSS_MARGIN',
  f=>f.values.single_quarter_amount_basis='OFFICIAL_PORTAL_FY_CUMULATIVE_MINUS_Q3_CUMULATIVE',
  f=>f.direct_single_quarter=true,
  f=>f.source_admitted=true,
  f=>f.member_publication_approved=true,
 ];
 for(const change of changes){
  const b=await changedPortal(change),input=await acquired(),before=clone(input);
  await assert.rejects(()=>mergeIssuerFinancialBatch(input,[b]),/FACT_SCOPE/);assert.deepEqual(input,before);
 }
});

test('portal numeric availability and dependent source times cannot be relabelled earlier or beyond the review cutoff',async()=>{
 const changes=[
  f=>f.first_seen_at=new Date(Date.parse(f.source_received_at)-1).toISOString(),
  f=>f.available_at=f.source_received_at,
  (f,p)=>f.source_candidate_available_at=new Date(Date.parse(p.created_at)+1).toISOString(),
  f=>f.source_terms_evidence.received_at=new Date(Date.parse(f.derived_at)+1).toISOString(),
 ];
 for(const change of changes){
  const b=await changedPortal(change),input=await acquired();await assert.rejects(()=>mergeIssuerFinancialBatch(input,[b]),/FACT_SCOPE/);
 }
});

test('negative genuine margins remain valid while over100 or wrong-unit native facts remain invalid',async()=>{
 const out=await mergeIssuerFinancialBatch(await acquired(),[binding]);assert.equal(margins(out).length,236);
 assert(margins(out).some(f=>f.symbol==='2208'&&f.values.value===-11.71));
 for(const change of [f=>f.values.value=100.01,f=>f.values.unit='RATIO']){
  const p=clone(packet),f=p.facts.find(f=>!portal(f));p.facts=[f];change(f);const {id,evidence_hash,...body}=f;void id;void evidence_hash;f.evidence_hash=await snapshotHash(body);
  const b={packet:p,expectedHash:await snapshotHash(p)},input=await acquired();await assert.rejects(()=>mergeIssuerFinancialBatch(input,[b]),/MARGIN_UNIT/);
 }
});

test('margin packet retains its own availability and seven-day expiry, and unusable-time packets cannot skip source validation',async()=>{
 for(const [offset,n,reason]of [[-1,0,'RETAINED_PACKET_NOT_YET_AVAILABLE'],[7*86400000-1,236,null],[7*86400000,0,'RETAINED_PACKET_REVIEW_EXPIRED']]){
  const input=await acquired(at(offset)),out=await mergeIssuerFinancialBatch(input,[binding]);assert.equal(margins(out).length,n);
  if(reason)assert(out.source_issues.some(i=>i.key===expectedHash&&i.reason===reason));
 }
 const bad=await changedPortal(f=>f.source_locator.point[1]+=1);
 for(const cutoff of [at(-1),at(8*86400000)]){const input=await acquired(cutoff);await assert.rejects(()=>mergeIssuerFinancialBatch(input,[bad]),/FACT_SCOPE/);}
});

/** Real issuer originals, synthetic acquisition wiring. Not a natural daily run. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {mergeIssuerFinancials} from '../src/features/vnext/issuerFinancialIntake.ts';
import {RECOMMENDATION_UNIVERSE} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';
import {retainedIssuerFinancials,retainedIssuerFinancialSupplement,retainedIssuerFinancialPartialSupplement,retainedIssuerFinancialReleases} from '../supabase/functions/_shared/retained-issuer-financials.ts';
const release=retainedIssuerFinancialPartialSupplement;
const {packet,expectedHash}=release;
const clone=v=>structuredClone(v);
const at=(delta=1000)=>new Date(Date.parse(packet.created_at)+delta).toISOString();
async function acquired(cutoff=at()){
 const body={inputs:RECOMMENDATION_UNIVERSE.map(symbol=>({symbol,company:symbol,cutoff,through:'2026-11-02',next_session:'2026-11-03',expected_sessions:[],bars:[],facts:[],v1_missing:{SHORT:['NOT_EVALUATED'],MEDIUM:['NOT_EVALUATED'],LONG:['NOT_EVALUATED']}})),entry:null,evidence_cutoff:cutoff};
 return {...body,snapshot_hash:await snapshotHash(body)};
}
async function rehash(a){const {snapshot_hash,...body}=a;void snapshot_hash;a.snapshot_hash=await snapshotHash(body);return a;}
async function mergeAll(input){for(const r of retainedIssuerFinancialReleases)input=await mergeIssuerFinancials(input,r.packet,r.expectedHash);return input;}
const count=a=>a.inputs.reduce((n,i)=>n+i.facts.length,0);

test('partial release pins 31 original direct basic quarters without changing either previous release',async()=>{
 const path='../supabase/functions/_shared/retained-issuer-financials-20261103-partial.json';
 const parsed=JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
 assert.deepEqual(parsed,packet);assert.equal(await snapshotHash(parsed),expectedHash);
 assert.equal(expectedHash,'c2edd821e88e331ce75ca3160f5e4fb9e46b757da050632b03c7720b3d631cc3');
 assert.equal(packet.source_study_sha256,'2d6927e770b3dc69ee701b54670801b8f534c8b37ac0ead0ad2ba449ff6ea5eb');
 assert.equal(packet.created_at,'2026-11-02T16:41:08.617339+00:00');assert.equal(packet.max_age_days,7);
 assert.deepEqual(retainedIssuerFinancialReleases,[retainedIssuerFinancials,retainedIssuerFinancialSupplement,release]);
 assert.equal(await snapshotHash(retainedIssuerFinancials.packet),'ba31adff1451a974b68a201c5cebfcc072b9a4b9e56c2b9c0ab088b578c2a942');
 assert.equal(await snapshotHash(retainedIssuerFinancialSupplement.packet),'9cd79b7eb5cf0ecb5686afc03999e239a2fc9c927359a752b00be0d86720a629');
 assert.equal(createHash('sha256').update(readFileSync(new URL('../supabase/functions/_shared/retained-issuer-financials-20261030.json',import.meta.url))).digest('hex'),'4a4e4ba4c5dda188a5b6d70b3a00fc56b7edd69cec3ad1954a90c5a5b9e1103b');
 assert.equal(createHash('sha256').update(readFileSync(new URL('../supabase/functions/_shared/retained-issuer-financials-20261102.json',import.meta.url))).digest('hex'),'89cd6a0b749a8fc826245812c864a9daf52a66eb4c67dfbf018f885af4e66a86');
 assert.equal(packet.facts.length,31);
 assert.deepEqual([...new Set(packet.facts.map(f=>f.symbol))].sort(),['1514','1519','1590','2357','2376','2603','2609','2881','2882','3529','3661','8299']);
 for(const flag of ['source_admitted','member_publication_approved','methodology_promoted'])assert.equal(packet[flag],false);
 assert.deepEqual(packet.known_release_deadlines,{});assert.deepEqual(packet.release_deadline_sources,{});
 const oldKeys=new Set(retainedIssuerFinancialReleases.slice(0,2).flatMap(r=>r.packet.facts.map(f=>`${f.symbol}:${f.kind}:${f.period}`)));
 for(const f of packet.facts){
  const {id,evidence_hash,...body}=f;assert.equal(evidence_hash,await snapshotHash(body));assert(!oldKeys.has(`${f.symbol}:${f.kind}:${f.period}`));
  assert.equal(f.kind,'EPS');assert.equal(f.basis,'SINGLE_QUARTER');assert.equal(f.values.measurement_basis,'BASIC');assert.equal(f.values.consolidation,'CONSOLIDATED');assert.equal(f.values.period_basis,'DIRECT_SINGLE_QUARTER');
  assert.equal(f.published_at,null);assert.equal(f.available_at,f.first_seen_at);assert(Date.parse(f.first_seen_at)<Date.parse(packet.created_at));assert.equal(f.source_admitted,false);assert.equal(f.member_publication_approved,false);
  assert.match(f.source_sha256,/^[0-9a-f]{64}$/);assert(f.source_bytes>0);assert(f.source_locator.page>0);assert(!f.period.endsWith('Q4'));
  if(['2881','2882'].includes(f.symbol))assert.equal(f.values.cross_2025_ifrs17_comparability,'NOT_ESTABLISHED_DO_NOT_JOIN_ORIGINAL_2025_IFRS4');
 }
 assert.deepEqual(packet.facts.filter(f=>f.symbol==='2357').map(f=>[f.period,f.values.value,f.source_locator.page]),[['2025-Q3',14.21,3],['2026-Q1',13.19,3],['2026-Q2',25.64,3]]);
 assert.deepEqual(packet.facts.filter(f=>f.symbol==='3529').map(f=>[f.period,f.values.value]),[['2026-Q1',7.98],['2026-Q2',7.77],['2026-Q3',8.56]]);
});

test('all three releases add only missing facts and repeat intake preserves immutable inputs',async()=>{
 const input=await acquired(),original=clone(input),out=await mergeAll(input);
 assert.deepEqual(input,original);assert.equal(out.inputs.length,72);assert.equal(count(out),77);
 const repeated=await mergeAll(out);assert.deepEqual(repeated,out);
 for(const r of retainedIssuerFinancialReleases)for(const f of r.packet.facts)assert.deepEqual(out.inputs.find(i=>i.symbol===f.symbol).facts.find(x=>x.id===f.id),f);
 assert.deepEqual(out.inputs.map(i=>i.cutoff),input.inputs.map(i=>i.cutoff));
 assert(out.inputs.every(i=>i.facts.every(f=>f.member_publication_approved===false)));
});

test('three independently pinned release boundaries preserve old expiry and do not replay unavailable facts',async()=>{
 const old=retainedIssuerFinancials,next=retainedIssuerFinancialSupplement;
 const prior=await mergeAll(await acquired(at(-1)));assert.equal(count(prior),46);
 assert(prior.source_issues.some(i=>i.key===expectedHash&&i.reason==='RETAINED_PACKET_NOT_YET_AVAILABLE'));
 for(const [r,total]of [[old,39],[next,31],[release,0]]){
  const cutoff=new Date(Date.parse(r.packet.created_at)+7*86400000).toISOString();
  const out=await mergeAll(await acquired(cutoff));assert.equal(count(out),total);
  assert(out.source_issues.some(i=>i.key===r.expectedHash&&i.reason==='RETAINED_PACKET_REVIEW_EXPIRED'));
 }
 const beforeExpiry=await mergeIssuerFinancials(await acquired(at(7*86400000-1)),packet,expectedHash);assert.equal(count(beforeExpiry),31);
});

test('newer financial periods remain authoritative and conflicting existing quarters are never replaced',async()=>{
 const first=packet.facts.find(f=>f.symbol==='1514'),a=await acquired(),i=a.inputs.find(i=>i.symbol==='1514');
 const marker={...clone(first),id:'synthetic-new-quarter',kind:'FINANCIAL_YTD',period:'2026-Q3'};
 i.facts.push(marker);await rehash(a);const before=clone(a),out=await mergeIssuerFinancials(a,packet,expectedHash);
 assert.deepEqual(a,before);assert.deepEqual(out.inputs.find(i=>i.symbol==='1514').facts,[marker]);
 assert(out.source_issues.some(i=>i.key==='1514'&&i.reason==='NEWER_FINANCIAL_PERIOD_REQUIRES_REVIEW'));
 const b=await acquired(),j=b.inputs.find(i=>i.symbol==='1514');j.facts.push({...clone(first),values:{...first.values,value:first.values.value+1}});await rehash(b);
 const original=clone(b);await assert.rejects(()=>mergeIssuerFinancials(b,packet,expectedHash),/EXISTING_CONFLICT/);assert.deepEqual(b,original);
});

test('separately valid packets cannot combine basic and diluted EPS for the same issuer',async()=>{
 const basic=clone(packet),diluted=clone(packet);
 basic.facts=[clone(packet.facts.find(f=>f.symbol==='1514'&&f.period==='2025-Q3'))];
 diluted.facts=[clone(packet.facts.find(f=>f.symbol==='1514'&&f.period==='2026-Q1'))];
 diluted.facts[0].values.measurement_basis='DILUTED';
 const f=diluted.facts[0],{id,evidence_hash,...body}=f;void id;void evidence_hash;f.evidence_hash=await snapshotHash(body);
 const acquiredBasic=await mergeIssuerFinancials(await acquired(),basic,await snapshotHash(basic)),before=clone(acquiredBasic);
 const dilutedHash=await snapshotHash(diluted);
 await assert.rejects(()=>mergeIssuerFinancials(acquiredBasic,diluted,dilutedHash),/EPS_BASIS/);
 assert.deepEqual(acquiredBasic,before);
});

/** Restored real issuer originals; synthetic acquisition controls, not a natural run. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {mergeIssuerFinancialBatch} from '../src/features/vnext/issuerFinancialIntake.ts';
import {RECOMMENDATION_UNIVERSE} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';
import {retainedIssuerFinancials,retainedIssuerFinancialSupplement,retainedIssuerFinancialPartialSupplement,retainedIssuerFinancialBasicSupplement,retainedIssuerFinancialReleases as allReleases} from '../supabase/functions/_shared/retained-issuer-financials.ts';
// Preserve this four-packet release's independent time and expiry controls.
const releases=allReleases.slice(0,4);
const binding=retainedIssuerFinancialBasicSupplement,{packet,expectedHash}=binding;
const clone=v=>structuredClone(v),time=(offset=1000)=>new Date(Date.parse(packet.created_at)+offset).toISOString();
const count=a=>a.inputs.reduce((n,i)=>n+i.facts.length,0);
async function acquired(cutoff=time(),extra=[]){
 const body={inputs:RECOMMENDATION_UNIVERSE.map(symbol=>({symbol,company:symbol,cutoff,through:'2026-11-02',next_session:'2026-11-03',
  expected_sessions:[],bars:[],facts:clone(extra.filter(f=>f.symbol===symbol)),v1_missing:{SHORT:['NOT_EVALUATED'],MEDIUM:['NOT_EVALUATED'],LONG:['NOT_EVALUATED']}})),entry:null,evidence_cutoff:cutoff};
 return {...body,snapshot_hash:await snapshotHash(body)};
}

test('fourth release restores the exact12 direct consolidated basic quarters and original review time',async()=>{
 const bytes=readFileSync(new URL('../supabase/functions/_shared/retained-issuer-financials-20261103-basic.json',import.meta.url));
 assert.equal(bytes.length,21732);assert.equal(createHash('sha256').update(bytes).digest('hex'),'26bab9af75ade3039a25cc795b3ab4e9ddad9f8df7245d1bbb155af5e88c865a');
 assert.deepEqual(JSON.parse(bytes),packet);assert.equal(await snapshotHash(packet),expectedHash);
 assert.equal(expectedHash,'7d0f5ca5ab48677d10381b4134c98c9f34695145cd0982a83c2c4f311aa6ea68');
 assert.equal(packet.source_study_sha256,'80ba6001f562591f226447c83a4cee3ee17d62343cd7e8bc5ba26023a2a77ce1');
 assert.equal(packet.created_at,'2026-11-02T17:31:03.890Z');assert.equal(packet.max_age_days,7);assert.equal(packet.facts.length,12);
 assert.deepEqual(releases,[retainedIssuerFinancials,retainedIssuerFinancialSupplement,retainedIssuerFinancialPartialSupplement,binding]);
 for(const [r,hash,n]of [[releases[0],'ba31adff1451a974b68a201c5cebfcc072b9a4b9e56c2b9c0ab088b578c2a942',38],[releases[1],'9cd79b7eb5cf0ecb5686afc03999e239a2fc9c927359a752b00be0d86720a629',8],[releases[2],'c2edd821e88e331ce75ca3160f5e4fb9e46b757da050632b03c7720b3d631cc3',31]]){
  assert.equal(r.expectedHash,hash);assert.equal(await snapshotHash(r.packet),hash);assert.equal(r.packet.facts.length,n);
 }
 for(const [symbol,values,total]of [['2303',[.81,1.29,3.39,1.32],6.81],['3006',[3.68,7.22,20.21,36.79],67.90],['3711',[3.37,3.23,4.80,6.13],17.53]]){
  const fs=packet.facts.filter(f=>f.symbol===symbol);assert.deepEqual(fs.map(f=>f.period),['2025-Q4','2026-Q1','2026-Q2','2026-Q3']);
  assert.deepEqual(fs.map(f=>f.values.value),values);assert.equal(Number(values.reduce((sum,v)=>sum+v,0).toFixed(2)),total);
 }
 const priorKeys=new Set(releases.slice(0,3).flatMap(r=>r.packet.facts.map(f=>`${f.symbol}:${f.kind}:${f.period}`)));
 for(const f of packet.facts){
  const {id,evidence_hash,...body}=f;assert.equal(evidence_hash,await snapshotHash(body));assert(!priorKeys.has(`${f.symbol}:${f.kind}:${f.period}`));
  assert.equal(f.kind,'EPS');assert.equal(f.basis,'SINGLE_QUARTER');assert.equal(f.values.period_basis,'DIRECT_SINGLE_QUARTER');
  assert.equal(f.values.measurement_basis,'BASIC');assert.equal(f.values.consolidation,'CONSOLIDATED');assert.equal(f.values.unit,'TWD_PER_COMMON_SHARE');
  assert.equal(f.published_at,null);assert.equal(f.available_at,f.first_seen_at);assert(Date.parse(f.available_at)<Date.parse(packet.created_at));
  assert.match(f.source_sha256,/^[0-9a-f]{64}$/);assert(f.source_bytes>0);assert(f.source_locator.page>0);assert.equal(f.source_admitted,false);assert.equal(f.member_publication_approved,false);
 }
 for(const key of ['source_admitted','member_publication_approved','methodology_promoted'])assert.equal(packet[key],false);
 assert.deepEqual(packet.known_release_deadlines,{});assert.deepEqual(packet.release_deadline_sources,{});
});

test('ASE numeric availability uses the required image receipt and cannot be backdated to its HTML container',async()=>{
 const ase=packet.facts.filter(f=>f.symbol==='3711');
 for(const f of ase){
  assert.equal(f.source_received_at,'2026-11-01T16:19:43.616283+00:00');
  assert.equal(f.first_seen_at,'2026-11-01T16:21:02.536407+00:00');assert.equal(f.available_at,f.first_seen_at);
  assert.equal(f.source_locator.image_received_at,f.first_seen_at);assert.equal(f.source_locator.image_bytes,605721);
  assert.equal(f.source_locator.image_sha256,'43fff7a1f638032a65759500d803b485400f1752b54d47a2b968fad4eaed7e16');
  assert.equal(f.source_locator.image_source,'https://www.sec.gov/Archives/edgar/data/1122411/000095010326016323/image_015.jpg');
  assert.equal(f.values.ppa_basis,'AS_REPORTED_NOT_EXCLUDING_PPA');
 }
 const earlier=clone(packet);earlier.facts=clone(ase);earlier.created_at=ase[0].source_received_at;
 const input=await acquired(),earlierHash=await snapshotHash(earlier);
 await assert.rejects(()=>mergeIssuerFinancialBatch(input,[{packet:earlier,expectedHash:earlierHash}]),/FACT_SCOPE/);
});

test('four-packet intake joins89 facts idempotently without rewriting caller input or prior records',async()=>{
 const input=await acquired(),before=clone(input),out=await mergeIssuerFinancialBatch(input,releases);
 assert.deepEqual(input,before);assert.equal(out.inputs.length,72);assert.equal(count(out),89);
 assert.deepEqual(await mergeIssuerFinancialBatch(out,releases),out);
 for(const r of releases)for(const f of r.packet.facts)assert.deepEqual(out.inputs.find(i=>i.symbol===f.symbol).facts.find(x=>x.id===f.id),f);
 assert(out.inputs.every(i=>i.facts.every(f=>f.source_admitted===false&&f.member_publication_approved===false)));
});

test('four releases retain independent exact expiry and the new packet cannot enter an earlier cutoff',async()=>{
 const before=await mergeIssuerFinancialBatch(await acquired(time(-1)),releases);assert.equal(count(before),77);
 assert(before.source_issues.some(i=>i.key===expectedHash&&i.reason==='RETAINED_PACKET_NOT_YET_AVAILABLE'));
 for(const [r,total]of [[releases[0],51],[releases[1],43],[releases[2],12],[binding,0]]){
  const cutoff=new Date(Date.parse(r.packet.created_at)+7*86400000).toISOString(),out=await mergeIssuerFinancialBatch(await acquired(cutoff),releases);
  assert.equal(count(out),total);assert(out.source_issues.some(i=>i.key===r.expectedHash&&i.reason==='RETAINED_PACKET_REVIEW_EXPIRED'));
 }
 assert.equal(count(await mergeIssuerFinancialBatch(await acquired(time(7*86400000-1)),[binding])),12);
});

test('a newly reported Q3 still vetoes a separately rebound stale Q2 series for all three issuers',async()=>{
 const stale=clone(packet);stale.facts=stale.facts.filter(f=>f.period!=='2026-Q3');
 const newer=packet.facts.filter(f=>f.period==='2026-Q3').map(f=>({...clone(f),id:'synthetic-newer-quarter-'+f.symbol,kind:'FINANCIAL_YTD',basis:'AS_REPORTED_YTD'}));
 const input=await acquired(time(),newer),before=clone(input),out=await mergeIssuerFinancialBatch(input,[{packet:stale,expectedHash:await snapshotHash(stale)}]);
 assert.deepEqual(input,before);
 for(const symbol of ['2303','3006','3711']){
  assert(out.source_issues.some(i=>i.key===symbol&&i.reason==='NEWER_FINANCIAL_PERIOD_REQUIRES_REVIEW'));
  assert.deepEqual(out.inputs.find(i=>i.symbol===symbol).facts,newer.filter(f=>f.symbol===symbol));
 }
});

test('known later issuer release invalidates only that issuer at its exact boundary',async()=>{
 const p=clone(packet),deadline=time(86400000);p.known_release_deadlines['2303']=deadline;p.release_deadline_sources['2303']=p.facts.find(f=>f.symbol==='2303').source;
 const b={packet:p,expectedHash:await snapshotHash(p)};
 const before=await mergeIssuerFinancialBatch(await acquired(new Date(Date.parse(deadline)-1).toISOString()),[b]);assert.equal(count(before),12);
 const after=await mergeIssuerFinancialBatch(await acquired(deadline),[b]);assert.equal(count(after),8);
 assert.equal(after.inputs.find(i=>i.symbol==='2303').facts.length,0);assert(after.source_issues.some(i=>i.key==='2303'&&i.reason==='NEW_ISSUER_RELEASE_REQUIRES_REVIEW'));
});

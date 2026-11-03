/** Real sealed packets, synthetic acquired input. No publication or production writer. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {mergeIssuerFinancials,mergeIssuerFinancialBatch} from '../src/features/vnext/issuerFinancialIntake.ts';
import {retainedIssuerFinancialReleases} from '../supabase/functions/_shared/retained-issuer-financials.ts';
import {RECOMMENDATION_UNIVERSE} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';
const clone=v=>structuredClone(v),releases=retainedIssuerFinancialReleases;
const time=(r,delta=1)=>new Date(Date.parse(r.packet.created_at)+delta).toISOString();
async function acquired(cutoff=time(releases.at(-1))){
 const body={inputs:RECOMMENDATION_UNIVERSE.map(symbol=>({symbol,company:symbol,cutoff,through:'2026-11-02',next_session:'2026-11-03',
  expected_sessions:[],bars:[],facts:[],v1_missing:{SHORT:['NOT_EVALUATED'],MEDIUM:['NOT_EVALUATED'],LONG:['NOT_EVALUATED']}})),
  entry:null,evidence_cutoff:cutoff};
 return {...body,snapshot_hash:await snapshotHash(body)};
}
async function sequential(input,bindings=releases){for(const r of bindings)input=await mergeIssuerFinancials(input,r.packet,r.expectedHash);return input;}
async function rebindFact(packet){const f=packet.facts[0],{id,evidence_hash,...body}=f;void id;void evidence_hash;f.evidence_hash=await snapshotHash(body);return {packet,expectedHash:await snapshotHash(packet)};}

test('batch output is deeply identical to ordered single calls at independent availability and seven-day expiry boundaries',async()=>{
 const times=[...releases.map(r=>time(r,-1)),time(releases.at(-1)),
  ...releases.flatMap(r=>[time(r,7*86400000-1),time(r,7*86400000)])];
 for(const cutoff of times){
  const input=await acquired(cutoff),original=clone(input),packets=clone(releases);
  const batch=await mergeIssuerFinancialBatch(input,releases),single=await sequential(input);
  assert.deepEqual(batch,single);assert.deepEqual(input,original);assert.deepEqual(releases,packets);
  assert.equal(batch.snapshot_hash,await snapshotHash(Object.fromEntries(Object.entries(batch).filter(([k])=>k!=='snapshot_hash'))));
 }
 const live=await mergeIssuerFinancialBatch(await acquired(),releases);
 assert.equal(live.inputs.flatMap(i=>i.facts).length,329);
 assert(live.inputs.every(i=>i.facts.every(f=>f.source_admitted===false&&f.member_publication_approved===false)));
});

test('batch owns the acquired input, every packet and every hash binding before its first digest await',async()=>{
 const input=await acquired(),bindings=clone(releases),expected=await sequential(input,bindings);
 const pending=mergeIssuerFinancialBatch(input,bindings);
 input.inputs[0].company='CALLER_MUTATION_AFTER_START';
 bindings[0].packet.facts[0].values.value=-999;
 bindings[1].packet.source_admitted=true;
 bindings[2].expectedHash='f'.repeat(64);
 bindings[3].packet.facts[0].values.value=-123;
 bindings[4].packet.facts[0].values.value=-456;
 bindings.push(clone(bindings[0]));
 assert.deepEqual(await pending,expected);
});

test('a later packet failure never leaks earlier merged facts into caller input or packets',async()=>{
 const input=await acquired(),bindings=clone(releases);bindings[1].expectedHash='f'.repeat(64);
 const original=clone(input),packets=clone(bindings);
 await assert.rejects(()=>mergeIssuerFinancialBatch(input,bindings),/PACKET_HASH/);
 assert.deepEqual(input,original);assert.deepEqual(bindings,packets);
 input.inputs[0].company='BAD_PREIMAGE';
 await assert.rejects(()=>mergeIssuerFinancialBatch(input,releases),/ACQUIRED_HASH/);
});

test('future and expired packets still undergo every packet and fact validation',async()=>{
 for(const cutoff of [time(releases[0],-1),time(releases.at(-1),8*86400000)]){
  const bindings=clone(releases);bindings[1].packet.facts[0].values.value+=1;
  bindings[1].expectedHash=await snapshotHash(bindings[1].packet);
  const input=await acquired(cutoff);
  await assert.rejects(()=>mergeIssuerFinancialBatch(input,bindings),/FACT_HASH/);
 }
});

test('individually valid cross-packet quarter conflicts and basic/diluted conflicts keep the single-call veto',async()=>{
 const a=clone(releases[0].packet),first=a.facts.filter(f=>f.kind==='EPS'&&f.symbol==='2330');a.facts=[first[0]];
 const b=clone(a);b.facts[0].values.value+=1;
 const conflicting=[{packet:a,expectedHash:await snapshotHash(a)},await rebindFact(b)];
 const input=await acquired(),original=clone(input);
 await assert.rejects(()=>mergeIssuerFinancialBatch(input,conflicting),/EXISTING_CONFLICT/);assert.deepEqual(input,original);
 const c=clone(a);c.facts=[clone(first[1])];c.facts[0].values.measurement_basis='BASIC';
 const mixed=[conflicting[0],await rebindFact(c)];
 await assert.rejects(()=>mergeIssuerFinancialBatch(input,mixed),/EPS_BASIS/);assert.deepEqual(input,original);
});

test('repeated bindings remain idempotent and an empty batch preserves a valid snapshot',async()=>{
 const input=await acquired(),once=await mergeIssuerFinancialBatch(input,releases);
 assert.deepEqual(await mergeIssuerFinancialBatch(input,[...releases,...releases]),once);
 assert.deepEqual(await mergeIssuerFinancialBatch(once,releases),once);
 assert.deepEqual(await mergeIssuerFinancialBatch(input,[]),input);
});

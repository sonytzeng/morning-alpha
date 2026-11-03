// Real issuer originals; synthetic intake controls, never a natural run or trade.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {mergeIssuerFinancialBatch} from '../src/features/vnext/issuerFinancialIntake.ts';
import {evaluateResearch} from '../src/features/vnext/researchFunnel.ts';
import {RECOMMENDATION_UNIVERSE} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';
import {retainedIssuerFinancialReleases as prior} from '../supabase/functions/_shared/retained-issuer-financials.ts';
import {retainedIssuerFinancialNovatekSupplement as binding,retainedIssuerFinancialReleases as current} from '../supabase/functions/_shared/retained-issuer-financials-current.ts';
const {packet,expectedHash}=binding,clone=v=>structuredClone(v),at=ms=>new Date(Date.parse(packet.created_at)+ms).toISOString();
const stock=a=>a.inputs.find(i=>i.symbol==='3034');
async function acquired(cutoff=at(1),extra=[]){
 const body={inputs:RECOMMENDATION_UNIVERSE.map(symbol=>({symbol,company:symbol,cutoff,through:'2026-11-03',next_session:'2026-11-04',
  expected_sessions:[],bars:[],facts:clone(extra.filter(f=>f.symbol===symbol)),v1_missing:{SHORT:[],MEDIUM:[],LONG:[]}})),entry:null,evidence_cutoff:cutoff};
 return {...body,snapshot_hash:await snapshotHash(body)};
}
test('current worker appends one pinned three-quarter packet while prior six reviews remain intact',async()=>{
 assert.equal(prior.length,6);assert.equal(current.length,7);assert.deepEqual(current.slice(0,6),prior);assert.equal(current[6],binding);
 assert.equal(await snapshotHash(packet),expectedHash);
 const worker=readFileSync(new URL('../supabase/functions/vnext-daily-research-v1/index.ts',import.meta.url),'utf8');
 assert.match(worker,/from '\.\.\/_shared\/retained-issuer-financials-current\.ts'/);assert.match(worker,/issuerFinancials:retainedIssuerFinancialReleases/);
 for(const r of prior)assert.equal(await snapshotHash(r.packet),r.expectedHash);
});
test('facts bind inspected source pages, direct basic columns and separate original receipt/review times',async()=>{
 const bytes=readFileSync(new URL('../research/evidence/novatek-financial-originals-20261103.json',import.meta.url));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),packet.source_study_sha256);
 const study=JSON.parse(bytes);assert.equal(study.four_quarter_basic_series_complete,false);assert.equal(study.annual_subtraction_performed,false);
 assert.deepEqual(packet.facts.map(f=>[f.period,f.values.value]),[['2025-Q3',6.01],['2026-Q1',6.19],['2026-Q2',10.4]]);
 for(const f of packet.facts){
  const {id,evidence_hash,...body}=f,original=study.observations.find(o=>o.period===f.period);
  assert.equal(evidence_hash,await snapshotHash(body));assert.equal(id,`issuer-quarter:3034:${f.period}:EPS:${f.source_sha256}`);
  assert.equal(f.source,original.url);assert.equal(f.source_sha256,original.sha256);assert.equal(f.source_bytes,original.bytes);
  assert.deepEqual(f.source_locator.cell_bbox,original.cell_bbox);assert.equal(f.source_locator.page,6);
  assert.equal(f.values.measurement_basis,'BASIC');assert.equal(f.values.consolidation,'CONSOLIDATED');assert.equal(f.values.period_basis,'DIRECT_SINGLE_QUARTER');
  assert.equal(f.published_at,null);assert.equal(f.first_seen_at,original.received_at);assert.equal(f.available_at,packet.created_at);
  assert(Date.parse(f.first_seen_at)<Date.parse(f.available_at));assert.equal(f.source_admitted,false);assert.equal(f.member_publication_approved,false);
 }
 assert.deepEqual(study.held_out.map(r=>r.reason),['ANNUAL_TOTAL_NOT_DIRECT_Q4_BASIC_EPS','EPS_BASIS_NOT_EXPLICIT_BASIC_OR_DILUTED']);
 assert(!packet.facts.some(f=>f.period==='2025-Q4'));assert.equal(packet.max_age_days,7);
 for(const key of ['source_admitted','member_publication_approved','methodology_promoted'])assert.equal(packet[key],false);
});
test('three observations merge idempotently without editing another issuer or establishing LONG completion',async()=>{
 const input=await acquired(),before=clone(input),out=await mergeIssuerFinancialBatch(input,[binding]);assert.deepEqual(input,before);
 assert.deepEqual(stock(out).facts,packet.facts);assert.deepEqual(await mergeIssuerFinancialBatch(out,[binding]),out);
 assert(out.inputs.filter(i=>i.symbol!=='3034').every(i=>i.facts.length===0));
 assert.equal(evaluateResearch(stock(out),'LONG').state,'INSUFFICIENT');assert.equal(stock(out).facts.length,3);
});
test('all seven releases compose without replacing existing margin evidence or renewing an older review',async()=>{
 const input=await acquired(),before=await mergeIssuerFinancialBatch(input,prior),after=await mergeIssuerFinancialBatch(input,current);
 assert.equal(after.inputs.flatMap(i=>i.facts).length,before.inputs.flatMap(i=>i.facts).length+3);
 for(const row of before.inputs){
  const next=after.inputs.find(i=>i.symbol===row.symbol);
  if(row.symbol!=='3034')assert.deepEqual(next,row);
  else{assert.deepEqual(next.facts.filter(f=>f.kind!=='EPS'),row.facts);assert.equal(next.facts.filter(f=>f.kind==='EPS').length,3);}
 }
 for(let n=0;n<prior.length;n++){assert.equal(current[n].packet.created_at,prior[n].packet.created_at);assert.equal(current[n].expectedHash,prior[n].expectedHash);}
});
test('unavailable original, scheduled release day and exact expiry each withhold the packet',async()=>{
 for(const [cutoff,reason]of [[at(-1),'RETAINED_PACKET_NOT_YET_AVAILABLE'],[packet.known_release_deadlines['3034'],'NEW_ISSUER_RELEASE_REQUIRES_REVIEW'],[at(7*86400000),'RETAINED_PACKET_REVIEW_EXPIRED']]){
  const out=await mergeIssuerFinancialBatch(await acquired(cutoff),[binding]);assert.equal(stock(out).facts.length,0);
  assert(out.source_issues.some(i=>i.reason===reason));
 }
 const deadline=Date.parse(packet.known_release_deadlines['3034']),last=await mergeIssuerFinancialBatch(await acquired(new Date(deadline-1).toISOString()),[binding]);
 assert.equal(stock(last).facts.length,3);assert.equal(packet.release_deadline_sources['3034'],'https://www.novatek.com.tw/en-global/Download/ir_event/Index/analyst_meeting');
});
test('tampering and a separately observed newer quarter cannot replace reviewed originals',async()=>{
 const changed=clone(packet);changed.facts[0].values.value=99;
 await assert.rejects(async()=>mergeIssuerFinancialBatch(await acquired(),[{packet:changed,expectedHash}]),/PACKET_HASH/);
 const newer={...clone(packet.facts[0]),id:'synthetic-newer-quarter',kind:'FINANCIAL_YTD',basis:'AS_REPORTED_YTD',period:'2026-Q3'};
 const out=await mergeIssuerFinancialBatch(await acquired(at(1),[newer]),[binding]);assert.deepEqual(stock(out).facts,[newer]);
 assert(out.source_issues.some(i=>i.reason==='NEWER_FINANCIAL_PERIOD_REQUIRES_REVIEW'));
});

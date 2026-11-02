import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {mergeIssuerFinancials} from '../src/features/vnext/issuerFinancialIntake.ts';
import {RECOMMENDATION_UNIVERSE} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';
import {evaluateResearch,publicationEligibility} from '../src/features/vnext/researchFunnel.ts';
import {retainedIssuerFinancials,retainedIssuerFinancialSupplement,retainedIssuerFinancialReleases} from '../supabase/functions/_shared/retained-issuer-financials.ts';
const {packet,expectedHash}=retainedIssuerFinancials;
const time=(ms=1000)=>new Date(Date.parse(packet.created_at)+ms).toISOString();
const clone=v=>structuredClone(v);
async function acquired(at=time()){
 const inputs=RECOMMENDATION_UNIVERSE.map(symbol=>({symbol,company:symbol,cutoff:at,through:'2026-10-29',next_session:'2026-10-30',expected_sessions:[],bars:[],facts:[],v1_missing:{SHORT:['NOT_EVALUATED'],MEDIUM:['NOT_EVALUATED'],LONG:['NOT_EVALUATED']}}));
 const body={inputs,entry:null,evidence_cutoff:at};return {...body,snapshot_hash:await snapshotHash(body)};
}
async function rehash(a){const {snapshot_hash,...b}=a;void snapshot_hash;a.snapshot_hash=await snapshotHash(b);return a;}
async function mutatedPacket(change){const p=clone(packet);change(p);return [p,await snapshotHash(p)];}
async function mergeReleases(input){
 for(const release of retainedIssuerFinancialReleases)input=await mergeIssuerFinancials(input,release.packet,release.expectedHash);
 return input;
}

test('sealed real issuer facts join all 72 inputs without changing quotes, cutoffs or permission flags',async()=>{
 const a=await acquired(),before=clone(a),out=await mergeIssuerFinancials(a,packet,expectedHash);
 assert.deepEqual(a,before);assert.equal(out.inputs.length,72);assert.equal(out.inputs.flatMap(i=>i.facts).length,38);
 assert.equal(await snapshotHash(packet),expectedHash);assert.notEqual(out.snapshot_hash,a.snapshot_hash);
 for(const i of out.inputs){assert.deepEqual(i.bars,[]);assert.equal(i.cutoff,a.evidence_cutoff);for(const f of i.facts){assert.equal(f.symbol,i.symbol);assert.equal(f.published_at,null);assert.equal(f.source_admitted,false);assert.equal(f.member_publication_approved,false);}}
 const t=out.inputs.find(i=>i.symbol==='2330'),long=evaluateResearch(t,'LONG');
 assert.equal(t.facts.length,12);assert.equal(long.state,'INSUFFICIENT');
 assert.deepEqual(long.reasons,['MISSING_DEMAND_1','MISSING_MOAT_1','MISSING_VALUATION_1']);
 assert.equal(publicationEligibility(long,{now:time(),audience:'owner',server_entitlement_verified:true,input_hash:out.snapshot_hash,approved_hash:null,approved_at:null,methodology_approved:false,quality_reviewed:false,use:'OWN_ANALYSIS',grants:[]}).eligible,false);
});
test('exact repeated intake is idempotent and preserves the existing evidence timestamps',async()=>{
 const once=await mergeIssuerFinancials(await acquired(),packet,expectedHash);
 const twice=await mergeIssuerFinancials(once,packet,expectedHash);assert.deepEqual(twice,once);
});
test('future packet and seven-day expiry do not inject old observations into a new run',async()=>{
 for(const [at,reason] of [[time(-1),'RETAINED_PACKET_NOT_YET_AVAILABLE'],[time(7*86400000),'RETAINED_PACKET_REVIEW_EXPIRED']]){
  const out=await mergeIssuerFinancials(await acquired(at),packet,expectedHash);
  assert.equal(out.inputs.flatMap(i=>i.facts).length,0);assert(out.source_issues.some(i=>i.reason===reason));
 }
});
test('known next release invalidates that issuer at the exact boundary, while other issuers remain available',async()=>{
 // Synthetic future release: the real 10/30 Q3 release is now inspected.
 const deadline=time(86400000),[p,h]=await mutatedPacket(p=>{
  p.known_release_deadlines['2454']=deadline;
  p.release_deadline_sources['2454']='https://www.mediatek.com/investor-relations/financial-information';
 });
 const before=await mergeIssuerFinancials(await acquired(new Date(Date.parse(deadline)-1).toISOString()),p,h);
 const after=await mergeIssuerFinancials(await acquired(deadline),p,h);
 assert.equal(before.inputs.find(i=>i.symbol==='2454').facts.length,10);assert.equal(after.inputs.find(i=>i.symbol==='2454').facts.length,0);
 assert.equal(after.inputs.find(i=>i.symbol==='2330').facts.length,12);assert(after.source_issues.some(i=>i.key==='2454'&&i.reason==='NEW_ISSUER_RELEASE_REQUIRES_REVIEW'));
});
test('a newer reported period prevents stale retained quarterly series from masking missing new data',async()=>{
 const a=await acquired(),i=a.inputs.find(i=>i.symbol==='2454');
 i.facts.push({kind:'FINANCIAL_YTD',period:'2026-Q4',basis:'AS_REPORTED_YTD',values:{}});await rehash(a);
 const out=await mergeIssuerFinancials(a,packet,expectedHash);
 assert.deepEqual(out.inputs.find(i=>i.symbol==='2454').facts,i.facts);assert(out.source_issues.some(i=>i.key==='2454'&&i.reason==='NEWER_FINANCIAL_PERIOD_REQUIRES_REVIEW'));
});
test('reviewed Q3 release supplies basic EPS and gross margin without guessing Realtek EPS basis or CAPEX',async()=>{
 const out=await mergeIssuerFinancials(await acquired(),packet,expectedHash);
 const media=out.inputs.find(i=>i.symbol==='2454').facts;
 assert.equal(media.find(f=>f.kind==='EPS'&&f.period==='2026-Q3').values.value,17.5);
 assert.equal(media.find(f=>f.kind==='EPS'&&f.period==='2026-Q3').values.measurement_basis,'BASIC');
 assert.equal(media.find(f=>f.kind==='MARGIN'&&f.period==='2026-Q3').values.value,46.3);
 assert.deepEqual(media.filter(f=>f.kind==='EPS').map(f=>f.period).sort().slice(-4),['2025-Q4','2026-Q1','2026-Q2','2026-Q3']);
 const realtek=out.inputs.find(i=>i.symbol==='2379').facts;
 assert.equal(realtek.find(f=>f.kind==='MARGIN'&&f.period==='2026-Q3').values.value,47.4);
 assert(!realtek.some(f=>f.kind==='EPS'&&f.period==='2026-Q3'));
 assert(![...media,...realtek].some(f=>f.kind==='CAPEX'));
});
test('changed retained bytes, forged admission and missing immutable preimage are rejected',async()=>{
 const a=await acquired(),p=clone(packet);p.facts[0].values.value+=1;
 await assert.rejects(()=>mergeIssuerFinancials(a,p,expectedHash),/PACKET_HASH/);
 const [promoted,h]=await mutatedPacket(p=>p.source_admitted=true);await assert.rejects(()=>mergeIssuerFinancials(a,promoted,h),/PACKET_SCOPE/);
 a.inputs[0].company='changed after digest';await assert.rejects(()=>mergeIssuerFinancials(a,packet,expectedHash),/ACQUIRED_HASH/);
});
test('even a separately rebound packet must preserve fact hashes and company identity',async()=>{
 for(const [change,reason] of [
  [p=>p.facts[0].values.value+=1,/FACT_HASH/],
  [p=>p.facts[0].symbol='999999',/DUPLICATE_OR_UNKNOWN/],
  [p=>p.facts.push(clone(p.facts[0])),/DUPLICATE_OR_UNKNOWN/],
 ]){const [p,h]=await mutatedPacket(change);await assert.rejects(()=>mergeIssuerFinancials(acquiredFixture,p,h),reason);}
});
const acquiredFixture=await acquired();
test('rehashed facts still reject wrong units, invalid values, quarter dates and future observations',async()=>{
 for(const [kind,change,reason] of [
  ['EPS',f=>f.values.unit='USD_PER_SHARE',/EPS_UNIT/],
  ['EPS',f=>f.values.value='1.00',/FACT_SCOPE/],
  ['MARGIN',f=>f.values.value=101,/MARGIN_UNIT/],
  ['CAPEX',f=>f.values.measurement_basis='NET_INVESTING_CASH_FLOW',/CAPEX_UNIT/],
  ['EPS',f=>f.as_of='2026-10-01T00:00:00+08:00',/FACT_SCOPE/],
  ['EPS',f=>f.first_seen_at=time(1),/FACT_SCOPE/],
 ]){
  const p=clone(packet),f=p.facts.find(f=>f.kind===kind);change(f);
  const {id,evidence_hash,...body}=f;void id;void evidence_hash;f.evidence_hash=await snapshotHash(body);
  const packetHash=await snapshotHash(p);
  await assert.rejects(()=>mergeIssuerFinancials(acquiredFixture,p,packetHash),reason);
 }
});
test('existing conflicting quarter and mixed basic/diluted series fail instead of silently replacing records',async()=>{
 const a=await acquired(),first=packet.facts.find(f=>f.kind==='EPS'),i=a.inputs.find(i=>i.symbol===first.symbol);
 i.facts.push({...clone(first),values:{...first.values,value:first.values.value+1}});await rehash(a);
 await assert.rejects(()=>mergeIssuerFinancials(a,packet,expectedHash),/EXISTING_CONFLICT/);
 const b=await acquired(),j=b.inputs.find(i=>i.symbol===first.symbol);j.facts.push({...clone(first),id:'different-quarter',period:'2024-Q4',values:{...first.values,measurement_basis:first.values.measurement_basis==='BASIC'?'DILUTED':'BASIC'}});await rehash(b);
 await assert.rejects(()=>mergeIssuerFinancials(b,packet,expectedHash),/EPS_BASIS/);
});
test('independently sealed supplement supplies eight direct basic quarters without changing the original packet',async()=>{
 const next=retainedIssuerFinancialSupplement;
 assert.equal(packet.created_at,'2026-10-30T08:27:15.413Z');assert.equal(packet.facts.length,38);
 assert.equal(expectedHash,'ba31adff1451a974b68a201c5cebfcc072b9a4b9e56c2b9c0ab088b578c2a942');
 assert.equal(await snapshotHash(packet),expectedHash);assert.equal(await snapshotHash(next.packet),next.expectedHash);
 assert.equal(retainedIssuerFinancialReleases[0],retainedIssuerFinancials);assert.equal(next.packet.facts.length,8);
 assert.equal(next.packet.max_age_days,7);assert(Date.parse(next.packet.created_at)>Date.parse(packet.created_at));
 assert.deepEqual(next.packet.known_release_deadlines,{});assert.deepEqual(next.packet.release_deadline_sources,{});
 const out=await mergeReleases(await acquired(new Date(Date.parse(next.packet.created_at)+1).toISOString()));
 assert.equal(out.inputs.flatMap(i=>i.facts).length,46);
 for(const f of packet.facts)assert.deepEqual(out.inputs.find(i=>i.symbol===f.symbol).facts.find(x=>x.id===f.id),f);
 for(const [symbol,periods,values]of[
  ['2382',['2025-Q3','2025-Q4','2026-Q1','2026-Q2'],[4.26,5.76,5.50,7.43]],
  ['3443',['2025-Q4','2026-Q1','2026-Q2','2026-Q3'],[8.65,12.28,11.61,16.95]],
 ]){
  const input=out.inputs.find(i=>i.symbol===symbol),facts=input.facts;
  assert.deepEqual(facts.map(f=>f.period),periods);assert.deepEqual(facts.map(f=>f.values.value),values);
  for(const f of facts){assert.equal(f.kind,'EPS');assert.equal(f.basis,'SINGLE_QUARTER');assert.equal(f.values.measurement_basis,'BASIC');assert.equal(f.values.consolidation,'CONSOLIDATED');assert.equal(f.published_at,null);assert.equal(f.source_admitted,false);assert.equal(f.member_publication_approved,false);assert(Date.parse(f.first_seen_at)<=Date.parse(next.packet.created_at));}
  const long=evaluateResearch(input,'LONG');assert.equal(long.state,'INSUFFICIENT');
  assert(!long.reasons.includes('MISSING_EPS_4'));assert(long.reasons.includes('MISSING_CAPEX_4'));assert(long.reasons.includes('MISSING_DEMAND_1'));
 }
 const quanta=next.packet.facts.filter(f=>f.symbol==='2382');
 for(const f of quanta){assert(new URL(f.source).pathname.endsWith('.aspx'));assert.equal(f.source_locator.download_method,'POST_FORM_EXISTING_DOWNLOAD_CONTROL');assert.match(f.source_locator.download_control,/^grvList\$ctl\d{2}\$ImageButton1$/);}
 assert.equal(quanta.find(f=>f.period==='2026-Q1').values.reported_decimal,'5.50');
});
test('release packets keep independent exact expiry and availability boundaries',async()=>{
 const next=retainedIssuerFinancialSupplement,oldExpiry=Date.parse(packet.created_at)+7*86400000,newExpiry=Date.parse(next.packet.created_at)+7*86400000;
 const before=await mergeReleases(await acquired(new Date(oldExpiry-1).toISOString()));assert.equal(before.inputs.flatMap(i=>i.facts).length,46);
 const oldExpired=await mergeReleases(await acquired(new Date(oldExpiry).toISOString()));assert.equal(oldExpired.inputs.flatMap(i=>i.facts).length,8);
 assert(oldExpired.source_issues.some(i=>i.key===expectedHash&&i.reason==='RETAINED_PACKET_REVIEW_EXPIRED'));
 assert.deepEqual([...new Set(oldExpired.inputs.flatMap(i=>i.facts).map(f=>f.symbol))].sort(),['2382','3443']);
 const allExpired=await mergeReleases(await acquired(new Date(newExpiry).toISOString()));assert.equal(allExpired.inputs.flatMap(i=>i.facts).length,0);
 assert(allExpired.source_issues.some(i=>i.key===next.expectedHash&&i.reason==='RETAINED_PACKET_REVIEW_EXPIRED'));
 for(const at of ['2026-11-01T00:59:30Z',new Date(Date.parse(next.packet.created_at)-1).toISOString()]){
  const prior=await mergeReleases(await acquired(at));assert.equal(prior.inputs.flatMap(i=>i.facts).length,38);
  assert(!prior.inputs.flatMap(i=>i.facts).some(f=>['2382','3443'].includes(f.symbol)));
  assert(prior.source_issues.some(i=>i.key===next.expectedHash&&i.reason==='RETAINED_PACKET_NOT_YET_AVAILABLE'));
 }
});
test('worker injects the sealed server packet only into a new acquisition before its immutable checkpoint',()=>{
 const runtime=readFileSync(new URL('../src/features/vnext/dailyRuntime.ts',import.meta.url),'utf8');
 const worker=readFileSync(new URL('../supabase/functions/vnext-daily-research-v1/index.ts',import.meta.url),'utf8');
 assert(runtime.indexOf('mergeIssuerFinancials(acquired,')>runtime.indexOf('if(!acquired){'));
 assert(runtime.indexOf('mergeIssuerFinancials(acquired,')<runtime.indexOf("await rpc('CHECKPOINT',{acquired})"));
 assert(worker.includes('issuerFinancials:retainedIssuerFinancialReleases'));assert(!worker.includes('JSON.parse(req'));
});

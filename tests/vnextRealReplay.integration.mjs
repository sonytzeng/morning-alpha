// Explicit private/offline acceptance, never collected by public test:public.
import assert from 'node:assert/strict';
import {loadRetainedResearch,auditOfficialCache,persistResearchLock} from '../scripts/vnext/real-evidence.mjs';
import {verifyResearchLock} from '../src/features/vnext/realResearch.ts';
assert(!process.env.CI,'PRIVATE_REPLAY_NOT_PUBLIC_CI');
const reports=await loadRetainedResearch(process.env.MA_ENTRY_PRIVATE_FIXTURE_DIR,process.env.MA_VNEXT_DISPLAY_NAMES);
const again=await loadRetainedResearch(process.env.MA_ENTRY_PRIVATE_FIXTURE_DIR,process.env.MA_VNEXT_DISPLAY_NAMES);
assert.deepEqual(reports,again,'DETERMINISTIC_REPLAY');
for(const r of reports){
 assert.equal(r.universe,72);assert.equal(r.cards.length,216);
 assert.deepEqual(r.coverage,{20:72,60:0,120:0,250:0});
 assert.equal(r.events.length,r.business_date==='2026-10-07'?9:12);
 for(const h of ['SHORT','MEDIUM','LONG'])assert.deepEqual(r.counts[h],{qualified:0,insufficient:72});
 assert.equal(r.forward_sample,0);assert.equal(r.outcome_sample,0);assert.equal(r.supply_chain,'UNKNOWN');
 assert.equal(r.mode,'HISTORICAL_REPLAY');assert(await verifyResearchLock(r));
 for(const c of r.cards)for(const e of c.evidence){
  for(const key of ['published_at','first_seen_at','available_at','as_of','source','evidence_hash'])assert(Object.hasOwn(e,key));
  assert(Date.parse(e.available_at)<=Date.parse(r.cutoff),'FUTURE_EVIDENCE_REJECTED');
 }
 const tampered=structuredClone(r);tampered.cards[0].known.push('tampered');assert.equal(await verifyResearchLock(tampered),false);
 persistResearchLock(r,process.env.MA_VNEXT_LOCK_DIR);
 assert.equal(persistResearchLock(r,process.env.MA_VNEXT_LOCK_DIR).state,'ALREADY_LOCKED');
 console.log(JSON.stringify({date:r.business_date,cards:r.cards.length,coverage:r.coverage,counts:r.counts,events:r.events.length,
  snapshot:r.snapshot_hash,replay:'PASS',immutable:'PASS',forward:0,outcome:0}));
}
const cache=auditOfficialCache(process.env.MA_ENTRY_HISTORY_CACHE_DIR);
assert.equal(cache.universe,72);assert.deepEqual(cache.coverage,{20:72,60:72,120:72,250:0});
assert.equal(cache.complete_action_clearance,false);assert.equal(cache.adjusted_returns_permitted,false);
for(const row of cache.rows)assert(Date.parse(row.first_receipt)>Date.parse(reports.at(-1).cutoff),'LATER_CACHE_MUST_NOT_ENTER_ORIGINAL_CUTOFF');
console.log(JSON.stringify({later_cache:cache.coverage,actions:cache.action_events,original_cutoff_reuse:'DENIED',adjusted_returns:'NOT_PERMITTED',production_writes:0}));

if(process.env.MA_VNEXT_REAL_AUTH==='ISOLATED_ONLY'){
 const base='http://127.0.0.1:3220',auth='http://127.0.0.1:55632',sessions={};
 const read=token=>fetch(base+'/__vnext_owner_research?role=owner',{headers:token?{Authorization:'Bearer '+token}:{}});
 assert.equal((await read()).status,401);
 for(const role of ['owner','free','premium','other']){
  const login=await fetch(auth+'/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({email:role+'@academy.test',password:'Academy-local-only-2026!'})});
  assert.equal(login.status,200);sessions[role]=await login.json();
  const response=await read(sessions[role].access_token);assert.equal(response.status,role==='owner'?200:403);
  if(role==='owner'){
   const body=await response.json();assert.equal(body.member_publication,false);assert.deepEqual(body.reports,reports);
  }else assert(!JSON.stringify(await response.json()).includes('cards'));
 }
 const forged=sessions.free.access_token.split('.');forged[1]=Buffer.from(JSON.stringify({sub:sessions.owner.user.id,role:'authenticated'})).toString('base64url');
 assert.equal((await read(forged.join('.'))).status,401);
 assert.equal((await fetch(base+'/__vnext_owner_research',{method:'POST',headers:{Authorization:'Bearer '+sessions.owner.access_token}})).status,405);
 assert.equal((await fetch(base+'/__vnext_owner_research',{headers:{Origin:'https://example.com',Authorization:'Bearer '+sessions.owner.access_token}})).status,403);
 for(const s of Object.values(sessions))await fetch(auth+'/logout',{method:'POST',headers:{Authorization:'Bearer '+s.access_token}});
 assert.equal((await read()).status,401);
 console.log(JSON.stringify({auth:'REAL_ISOLATED_SUPABASE_AUTH_NOT_PRODUCTION_SONY',owner:'ALLOW',free:'DENY',premium:'DENY',other:'DENY',anonymous:'DENY',forged:'DENY',query_role_bypass:'DENY',cross_origin:'DENY',method_write:'DENY',logout_without_identity:'DENY',production_writes:0}));
}

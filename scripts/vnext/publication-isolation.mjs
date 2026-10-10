import assert from 'node:assert/strict';
import {parseMemberResearch} from '../../src/features/vnext/member.ts';
import {readOwnerResearch} from './owner-research-server.mjs';

/** LOCAL disposable fixtures only; append revocation, never erase a research row. */
export function revokeSyntheticPublications(runtime){
 assert.equal(runtime.sql("select count(*) from vnext_private.stock_horizon_observations where strategy_version not like 'SYNTHETIC%'"),'0','REFUSE_REAL_ROWS');
 runtime.sql(`insert into vnext_private.publication_audit(observation_id,snapshot_hash,audience,approved,content_kind,reviewer_ref,license_review_ref,gate_version)
 select distinct on(observation_id) observation_id,snapshot_hash,audience,false,content_kind,'ISOLATED_REAL_READINESS_EMPTY','NOT_A_PUBLICATION_APPROVAL',gate_version
 from vnext_private.publication_audit order by observation_id,id desc;`);
}
export async function verifyEmptyPublication(readiness=null){
 const checks=[];
 for(const role of ['owner','free','premium','other']){
  const login=await fetch('http://127.0.0.1:55632/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({email:role+'@academy.test',password:'Academy-local-only-2026!'})});assert.equal(login.status,200);
  const session=await login.json(),headers={'Content-Type':'application/json',Authorization:'Bearer '+session.access_token};
  const r=await fetch('http://127.0.0.1:55633/rpc/get_vnext_member_v1',{method:'POST',headers,body:'{}'});assert.equal(r.status,200);
  const data=parseMemberResearch(await r.json());assert.equal(data.tier,role==='other'?'free':role);
  assert.deepEqual(data.observations,[]);assert.deepEqual(data.history,[]);assert.deepEqual(data.watchlist,[]);
  const owner=await readOwnerResearch({method:'GET',authorization:headers.Authorization},[],fetch,null,readiness);
  assert.equal(owner.status,role==='owner'?200:403);
  if(role!=='owner')assert(!JSON.stringify(owner.body).includes('source_rights'));
  for(const body of [{tier:'owner'},{p_tier:'premium'}])assert.equal((await fetch('http://127.0.0.1:55633/rpc/get_vnext_member_v1',{method:'POST',headers,body:JSON.stringify(body)})).status,404);
  assert.equal((await fetch('http://127.0.0.1:55632/logout',{method:'POST',headers})).status,204);
  assert.equal((await fetch('http://127.0.0.1:55633/rpc/get_vnext_member_v1',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
  checks.push(role+': real isolated Auth, true DB empty projection, direct-tier denial, Owner audit boundary, logout');
 }
 assert.equal((await readOwnerResearch({method:'GET'},[],fetch,null,readiness)).status,401);
 return {checks,identity:'ISOLATED_REAL_AUTH_NOT_PRODUCTION',member_research:0,production_operations:0};
}

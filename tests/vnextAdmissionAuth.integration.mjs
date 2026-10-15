/** Existing disposable Supabase Auth only; no Production caller or new role. */
import assert from 'node:assert/strict';
const origin='http://127.0.0.1:3223',auth='http://127.0.0.1:55632';
assert(!process.env.CI);let ownerHash;
const checks=[];
for(const role of ['owner','free','premium','other']){
 const login=await fetch(auth+'/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:role+'@academy.test',password:'Academy-local-only-2026!'})});assert.equal(login.status,200);
 const session=await login.json(),headers={Authorization:'Bearer '+session.access_token,'Content-Type':'application/json',Origin:origin};
 const read=await fetch(origin+'/__vnext_owner_research',{headers});assert.equal(read.status,role==='owner'?200:403);
 if(role==='owner'){const b=await read.json();assert.equal(b.admission.cards.length,29);assert(b.admission.cards.every(c=>!c.owner_approval_ready));ownerHash=b.review.cards[0].review_hash;}
 const body={action:'APPROVE',review_hash:ownerHash,idempotency_key:'local-negative-'+role+'-20261011',reason:'NEGATIVE CONTROL: prerequisites are missing, no approval requested'};
 const decision=await fetch(origin+'/__vnext_owner_approval',{method:'POST',headers,body:JSON.stringify(body)});assert.equal(decision.status,role==='owner'?409:403);
 const member=await fetch('http://127.0.0.1:55633/rpc/get_vnext_member_v1',{method:'POST',headers,body:'{}'});assert.equal(member.status,200);const p=await member.json();assert.deepEqual(p.observations,[]);assert.equal(p.tier,role==='other'?'free':role);
 assert.equal((await fetch('http://127.0.0.1:55633/rpc/get_vnext_member_v1',{method:'POST',headers,body:'{"tier":"owner"}'})).status,404);
 assert.equal((await fetch(auth+'/logout',{method:'POST',headers})).status,204);
 assert.equal((await fetch(auth+'/token?grant_type=refresh_token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refresh_token:session.refresh_token})})).status,400);
 checks.push({role,private_read:read.status,approval:decision.status,member_observations:0,direct_tier:'DENY',logout_refresh:'DENY'});
}
assert.equal((await fetch(origin+'/__vnext_owner_research')).status,401);
assert.equal((await fetch(origin+'/__vnext_owner_approval',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'})).status,401);
assert.equal((await fetch(origin+'/__vnext_owner_approval',{method:'POST',headers:{Origin:'https://example.com','Content-Type':'application/json'},body:'{}'})).status,403);
console.log(JSON.stringify({identity:'REAL_LOCAL_SUPABASE_AUTH_NOT_PRODUCTION',checks,anonymous:'DENY',cross_origin:'DENY',real_research_approved:0,production_operations:0}));

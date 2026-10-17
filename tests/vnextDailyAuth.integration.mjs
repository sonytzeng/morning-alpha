/** Real disposable GoTrue identities, not Sony/Production membership proof. */
import assert from 'node:assert/strict';
import {verifyDailyPreview} from '../src/features/vnext/dailyPreview.ts';
assert(!process.env.CI);const origin='http://127.0.0.1:3225',auth='http://127.0.0.1:55632',checks=[];
for(const role of ['owner','free','premium','other']){
 const login=await fetch(auth+'/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:role+'@academy.test',password:'Academy-local-only-2026!'})});assert.equal(login.status,200);
 const session=await login.json(),headers={Authorization:'Bearer '+session.access_token,'Content-Type':'application/json',Origin:origin};
 const read=await fetch(origin+'/__vnext_owner_research',{headers});assert.equal(read.status,role==='owner'?200:403);
 if(role==='owner'){const body=await read.json();assert(await verifyDailyPreview(body.daily));assert.equal(body.daily.rows.length,216);}
 const member=await fetch('http://127.0.0.1:55633/rpc/get_vnext_member_v1',{method:'POST',headers,body:'{}'});assert.equal(member.status,200);assert.deepEqual((await member.json()).observations,[]);
 const spoof=await fetch('http://127.0.0.1:55633/rpc/get_vnext_member_v1',{method:'POST',headers,body:'{"tier":"owner"}'});assert.equal(spoof.status,404);
 assert.equal((await fetch(auth+'/logout',{method:'POST',headers})).status,204);
 assert.equal((await fetch(auth+'/token?grant_type=refresh_token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refresh_token:session.refresh_token})})).status,400);
 checks.push({role,private_read:read.status,member_research:0,tier_spoof:'DENY',refresh_after_logout:'DENY'});
}
assert.equal((await fetch(origin+'/__vnext_owner_research')).status,401);
assert.equal((await fetch(origin+'/__vnext_owner_research',{headers:{Origin:'https://example.com'}})).status,403);
console.log(JSON.stringify({identity:'REAL_LOCAL_SUPABASE_AUTH_NOT_PRODUCTION',checks,anonymous:'DENY',cross_origin:'DENY',production_operations:0}));

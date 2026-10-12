// Disposable Auth/DB only. Existing Production billing/Auth is never called.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {environment,installCandidate} from '../scripts/vnext/isolation.mjs';
export const controlMigration='supabase/migrations/20261012080628_vnext_member_publication_control_candidate.sql';
const source=readFileSync(new URL('../'+controlMigration,import.meta.url),'utf8');
export async function verifyMemberRelease(runtime){
 const checks=[],sessions={},rest='http://127.0.0.1:55633',auth='http://127.0.0.1:55632';
 const rpc=async(role,name,body={})=>{const r=await fetch(rest+'/rpc/'+name,{method:'POST',headers:{'Content-Type':'application/json',...(role?{Authorization:'Bearer '+sessions[role].access_token}:{})},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 for(const role of ['owner','free','premium','other']){
  const r=await fetch(auth+'/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:role+'@academy.test',password:'Academy-local-only-2026!'})});assert.equal(r.status,200);sessions[role]=await r.json();
 }
 const prefix='release-'+randomUUID();
 runtime.sql(`begin;
 insert into vnext_private.stock_horizon_observations(id,symbol,company,horizon,created_at,as_of,available_at,last_verified_at,next_review_at,expires_at,reason,strategy_version,mode,snapshot_hash,status,confirmation_conditions,invalidation_conditions)
 select '${prefix}',symbol,'隔離發布驗收（非真實股票）',horizon,transaction_timestamp(),as_of,available_at,last_verified_at,now()+interval '1 day',now()+interval '7 days',reason,strategy_version,mode,snapshot_hash,status,confirmation_conditions,invalidation_conditions from vnext_private.stock_horizon_observations where id='test-SHORT';
 insert into vnext_private.observation_evidence select '${prefix}',evidence_id from vnext_private.observation_evidence where observation_id='test-SHORT';
 commit;`);
 const makeReview=(quality,licensing='PASS',observation=prefix)=>{
  const id=randomUUID(),hash=createHash('sha256').update(id).digest('hex');
  runtime.sql(`insert into vnext_private.publication_reviews(id,observation_id,snapshot_hash,review_hash,review_version,reviewer_ref,quality,time_status,licensing,quality_document_hash,time_document_hash,license_document_hash,evidence_set_hash,free_allowed,premium_allowed,reason,primary_risk,supporting_ids,contradicting_ids,expires_at)
  select '${id}',id,snapshot_hash,'${hash}','ISOLATED_REVIEW','INDEPENDENT_TEST_REVIEWER','${quality}','PASS','${licensing}',repeat('b',64),repeat('c',64),repeat('d',64),vnext_private.publication_evidence_hash(id),true,true,'隔離控制，非真實授權','合成測試風險',array['test-PRICE_VOLUME'],array['test-NEWS'],now()+interval '1 day' from vnext_private.stock_horizon_observations where id='${observation}';`);
  return id;
 };
 let review=makeReview('PENDING');
 const request=(action='APPROVE',key=randomUUID())=>({p_observation_id:prefix,p_review_id:review,p_action:action,p_audience:'free',p_request_key:key});
 for(const role of [null,'free','premium','other']){
  assert.ok([401,403].includes((await rpc(role,'review_vnext_publication_candidate_v1',request())).status));
  assert.ok([401,403].includes((await rpc(role,'get_owner_vnext_publication_review_v1')).status));
 }
 assert.notEqual((await rpc('owner','review_vnext_publication_candidate_v1',request())).status,200);
 assert.equal(runtime.sql(`select count(*) from vnext_private.publication_audit where observation_id='${prefix}'`),'0');
 review=makeReview('PASS','PENDING');assert.notEqual((await rpc('owner','review_vnext_publication_candidate_v1',request())).status,200);
 checks.push('real local Auth; anonymous/member approval denied; Owner cannot bypass pending quality/licensing');
 review=makeReview('PASS');const body=request();
 const responses=await Promise.all(Array.from({length:8},()=>rpc('owner','review_vnext_publication_candidate_v1',body)));
 for(const r of responses)assert.equal(r.status,200,JSON.stringify(r.data));
 assert.equal(runtime.sql(`select count(*) from vnext_private.owner_publication_events where observation_id='${prefix}'`),'1');
 assert.notEqual((await rpc('owner','review_vnext_publication_candidate_v1',{...body,p_action:'REVOKE'})).status,200);
 checks.push('8 concurrent identical Owner requests append one approval; changed request key payload rejected');
 for(const [role,detail] of [['owner',true],['premium',true],['free',false],['other',false]]){
  const r=await rpc(role,'get_vnext_member_v1');assert.equal(r.status,200);
  const card=r.data.observations.find(x=>x.id===prefix);assert(card);assert.equal(card.details!==null,detail);
 }
 assert.equal((await rpc(null,'get_vnext_member_v1')).status,401);
 assert.equal((await rpc('free','get_vnext_member_v1',{tier:'premium'})).status,404);
 const who=sessions.premium.user.id;
 for(const [state,end,expected] of [['paid_active',"now()+interval '1 day'",'premium'],['canceled',"now()+interval '1 day'",'premium'],['canceled',"now()-interval '1 second'",'free'],['expired',"now()+interval '1 day'",'free'],['past_due',"now()+interval '1 day'",'free']]){
  runtime.sql(`begin;update public.member_entitlements set state='${state}',access_ends_at=${end} where user_id='${who}';set local role authenticated;set local request.jwt.claims='{"sub":"${who}"}';do $$begin if public.get_vnext_member_v1()->>'tier'<>'${expected}' then raise exception 'ENTITLEMENT_DRIFT';end if;end$$;rollback;`);
 }
 checks.push('current DB entitlement: active, cancel-at-period-end, expiry, overdue; no JWT/client-tier authority');
 // Refund handling is NOT invented: production billing is disabled. Only a
 // confirmed server revocation/expired transition is tested, not payment E2E.
 for(const table of ['publication_reviews','owner_publication_events']){
  assert.throws(()=>runtime.sql(`begin;set local role authenticated;set local request.jwt.claims='{"sub":"${sessions.owner.user.id}"}';select * from vnext_private.${table};rollback;`));
  assert.throws(()=>runtime.sql(`update vnext_private.${table} set observation_id=observation_id where observation_id='${prefix}'`));
 }
 const watch={p_observation_id:prefix,p_watching:true};
 assert.equal((await rpc('premium','set_vnext_watch_v1',watch)).status,200);
 assert.equal((await rpc('other','get_vnext_member_v1')).data.watchlist.length,0);
 assert.equal((await rpc('owner','review_vnext_publication_candidate_v1',request('REVOKE'))).status,200);
 for(const role of ['owner','premium','free']){const r=await rpc(role,'get_vnext_member_v1');assert(![...r.data.observations,...r.data.history].some(x=>x.id===prefix));assert(!r.data.watchlist.includes(prefix));}
 checks.push('immutable review/audit, cross-account isolation, revocation removes card/history/watchlist');
 // Brief history must come from the exact original free edition; merely being
 // expired or Premium-approved does not make a record free. These are new,
 // short-lived synthetic records, never backdated existing research.
 const histories=[];
 for(const audience of ['free','premium']){
  const id=prefix+'-history-'+audience;
  runtime.sql(`begin;
   insert into vnext_private.stock_horizon_observations(id,symbol,company,horizon,created_at,as_of,available_at,last_verified_at,next_review_at,expires_at,reason,strategy_version,mode,snapshot_hash,status,confirmation_conditions,invalidation_conditions)
   select '${id}',symbol,'隔離歷史摘要（非真實股票）',horizon,transaction_timestamp(),as_of,available_at,last_verified_at,transaction_timestamp()+interval '10 seconds',transaction_timestamp()+interval '12 seconds',reason,strategy_version,mode,snapshot_hash,status,confirmation_conditions,invalidation_conditions from vnext_private.stock_horizon_observations where id='${prefix}';
   insert into vnext_private.observation_evidence select '${id}',evidence_id from vnext_private.observation_evidence where observation_id='${prefix}';commit;`);
  const reviewId=makeReview('PASS','PASS',id),payload={p_observation_id:id,p_review_id:reviewId,p_action:'APPROVE',p_audience:audience,p_request_key:randomUUID()};
  assert.equal((await rpc('owner','review_vnext_publication_candidate_v1',payload)).status,200);
  histories.push({id,payload});
 }
 for(let attempt=0;attempt<30;attempt++){
  if(runtime.sql(`select bool_and(clock_timestamp()>expires_at) from vnext_private.stock_horizon_observations where id in ('${histories[0].id}','${histories[1].id}')`)==='t')break;
  await new Promise(r=>setTimeout(r,500));
 }
 for(const role of [null,'premium','owner'])assert.ok([401,403].includes((await rpc(role,'get_vnext_free_history_v1')).status));
 const brief=await rpc('free','get_vnext_free_history_v1');assert.equal(brief.status,200);assert.equal(brief.data.schema,'VNEXT_FREE_HISTORY_V1');
 assert(brief.data.history.some(x=>x.id===histories[0].id&&x.status==='EXPIRED'&&x.details===null));
 assert(!brief.data.history.some(x=>x.id===histories[1].id));assert(brief.data.history.every(x=>x.details===null));
 assert.equal((await rpc('free','get_vnext_free_history_v1',{tier:'premium'})).status,404);
 const full=(await rpc('premium','get_vnext_member_v1')).data.history;
 for(const h of histories)assert(full.some(x=>x.id===h.id&&x.details!==null));
 assert.deepEqual((await rpc('free','get_vnext_member_v1')).data.history,[],'legacy response unchanged');
 for(const h of histories)assert.equal((await rpc('owner','review_vnext_publication_candidate_v1',{...h.payload,p_action:'REVOKE',p_request_key:randomUUID()})).status,200);
 assert(!(await rpc('free','get_vnext_free_history_v1')).data.history.some(x=>histories.some(h=>h.id===x.id)));
 checks.push('free historical brief: original free edition only; Premium-only rows and evidence denied; revocation immediate; legacy response unchanged');
 const logout=await fetch(auth+'/logout',{method:'POST',headers:{Authorization:'Bearer '+sessions.premium.access_token}});assert.equal(logout.status,204);
 const refresh=await fetch(auth+'/token?grant_type=refresh_token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refresh_token:sessions.premium.refresh_token})});assert.equal(refresh.status,400);
 assert.equal((await rpc(null,'get_vnext_member_v1')).status,401);
 checks.push('logout refresh revoked; no anonymous private projection');
 return {checks,identity:'ISOLATED_REAL_SUPABASE_AUTH_NOT_PRODUCTION',payment_provider_e2e:'NOT_VERIFIED',production_operations:0};
}
if(process.argv[1]===new URL(import.meta.url).pathname){
 const runtime=await environment();try{
  if(!process.env.MA_VNEXT_REUSE_LOCAL_DB)installCandidate(runtime);
  const installed=runtime.sql("select to_regclass('vnext_private.publication_reviews') is not null");
  const hash=createHash('sha256').update(source).digest('hex');
  if(installed==='f'){runtime.sql(source);runtime.sql(`comment on table vnext_private.publication_reviews is 'ISOLATED_CONTROL_SHA256:${hash}';notify pgrst,'reload schema';`);}
  else assert.equal(runtime.sql("select obj_description('vnext_private.publication_reviews'::regclass)"),'ISOLATED_CONTROL_SHA256:'+hash);
  await new Promise(r=>setTimeout(r,500));
  console.log(JSON.stringify(await verifyMemberRelease(runtime)));
 }finally{runtime.cleanup();}
}

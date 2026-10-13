// Explicit synthetic UI/security fixtures, in disposable local Auth/DB only.
import assert from 'node:assert/strict';
import {environment,installCandidate,verifyCandidate} from './isolation.mjs';
import {parseMemberResearch} from '../../src/features/vnext/member.ts';
import {revokeSyntheticPublications,verifyEmptyPublication} from './publication-isolation.mjs';
const base='http://127.0.0.1:55633',auth='http://127.0.0.1:55632';
export function installMemberFixtures(runtime){
 runtime.sql(`begin;
 insert into vnext_private.publication_audit(observation_id,snapshot_hash,audience,approved,content_kind,reviewer_ref,license_review_ref,gate_version)
 values('test-LONG',repeat('a',64),'premium',true,'RESEARCH_OBSERVATION','SYNTHETIC','SYNTHETIC','VNEXT_PUBLICATION_1');
 insert into vnext_private.member_copy(observation_id,publication_id,primary_risk,supporting_ids,contradicting_ids)
 select o.id,a.id,'示範風險：條件仍未確認；若後續資料相反，原本的研究理由就不成立。',array['test-PRICE_VOLUME'],array['test-NEWS']
 from vnext_private.stock_horizon_observations o cross join lateral(select id from vnext_private.publication_audit where observation_id=o.id order by id desc limit 1)a;
 insert into vnext_private.event_sources(id,symbol,kind,source,source_ref,license_id,published_at,first_seen_at,available_at,as_of,last_verified_at,valid_until,snapshot_hash,classification,quality,relevant,summary)
 select 'demo-'||n||'-'||kind,'DEMO'||n,kind,source,source_ref,license_id,published_at,first_seen_at,available_at,as_of,last_verified_at,valid_until,snapshot_hash,classification,quality,relevant,summary
 from vnext_private.event_sources cross join generate_series(2,4)n where symbol='TEST';
 insert into vnext_private.stock_horizon_observations(id,symbol,company,horizon,created_at,as_of,available_at,last_verified_at,next_review_at,expires_at,reason,strategy_version,mode,snapshot_hash,status,confirmation_conditions,invalidation_conditions)
 select 'demo-'||n,'DEMO'||n,'示範'||n||'號公司（非真實股票）',horizon,transaction_timestamp(),as_of,available_at,last_verified_at,next_review_at,expires_at,reason,strategy_version,mode,snapshot_hash,status,
 replace(confirmation_conditions::text,'test-','demo-'||n||'-')::jsonb,replace(invalidation_conditions::text,'test-','demo-'||n||'-')::jsonb
 from vnext_private.stock_horizon_observations cross join generate_series(2,4)n where id='test-SHORT';
 insert into vnext_private.observation_evidence select o.id,e.id from vnext_private.stock_horizon_observations o join vnext_private.event_sources e using(symbol) where o.id like 'demo-%';
 insert into vnext_private.publication_audit(observation_id,snapshot_hash,audience,approved,content_kind,reviewer_ref,license_review_ref,gate_version)
 select id,snapshot_hash,'free',true,'RESEARCH_OBSERVATION','SYNTHETIC','SYNTHETIC','VNEXT_PUBLICATION_1' from vnext_private.stock_horizon_observations where id like 'demo-%';
 insert into vnext_private.market_events(event_id,revision,source,source_event_id,published_at,first_seen_at,available_at,last_verified_at,title,affected_companies,expected_horizons,invalidation,evidence_ids,classification,snapshot_hash)
 select 'member-event',1,'SYNTHETIC','member-announcement',published_at,first_seen_at,last_verified_at,last_verified_at,
 '示範：公司更新營運說明，影響仍待後續驗證',array['DEMO2'],array['SHORT'],'若公司更正說明，需重新評估',array[id],'CONFIRMED_FACT',repeat('a',64)
 from vnext_private.event_sources where id='demo-2-INDUSTRY_EVENT';
 insert into vnext_private.supply_chain_relations(id,from_entity,to_entity,relation_type,source,evidence_ids,valid_from,observed_at,available_at,confidence,verification_status)
 select 'member-relation','DEMO2','示範客戶（非真實公司）','SUPPLIER','SYNTHETIC',array[id],published_at,first_seen_at,last_verified_at,'DOCUMENTED','VERIFIED'
 from vnext_private.event_sources where id='demo-2-SUPPLY_CHAIN';
 insert into vnext_private.member_copy(observation_id,publication_id,primary_risk,supporting_ids,contradicting_ids,event_ids,relation_ids)
 select o.id,a.id,'示範風險：若價格與量能不同步，不能把短期變化當成持續趨勢。',array['demo-'||right(o.id,1)||'-PRICE_VOLUME'],array['demo-'||right(o.id,1)||'-NEWS'],
 case when o.id='demo-2' then array['member-event'] else '{}'::text[] end,case when o.id='demo-2' then array['member-relation'] else '{}'::text[] end
 from vnext_private.stock_horizon_observations o join vnext_private.publication_audit a on a.observation_id=o.id where o.id like 'demo-%';
 insert into vnext_private.member_daily_edition(business_date,slot,symbol) values
 ((now() at time zone 'Asia/Taipei')::date,1,'TEST'),((now() at time zone 'Asia/Taipei')::date,2,'DEMO2'),((now() at time zone 'Asia/Taipei')::date,3,'DEMO3');
 commit;notify pgrst,'reload schema';`);
}
export async function verifyMember(runtime){
 const sessions={},checks=[];
 const login=async role=>{const r=await fetch(auth+'/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:role+'@academy.test',password:'Academy-local-only-2026!'})});assert.equal(r.status,200);return r.json();};
 const rpc=async(role,name='get_vnext_member_v1',body={})=>{const r=await fetch(base+'/rpc/'+name,{method:'POST',headers:{'Content-Type':'application/json',...(role?{Authorization:'Bearer '+sessions[role].access_token}:{})},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 for(const role of ['owner','free','premium','other']){
  sessions[role]=await login(role);const r=await rpc(role);assert.equal(r.status,200);
  const p=parseMemberResearch(r.data);assert.equal(p.tier,role==='other'?'free':role);
  assert.equal(p.observations.length,['free','other'].includes(role)?3:6);
  assert.equal(p.observations.filter(o=>o.details!==null).length,['free','other'].includes(role)?0:6);
  if(role==='premium'){const d=p.observations.find(o=>o.id==='demo-2').details;assert.equal(d.events.length,1);assert.equal(d.relations.length,1);}
  if(role==='free')assert.equal(new Set(p.observations.map(o=>o.symbol)).size,3);
  checks.push(role+' real Supabase Auth + tier-specific DB projection');
 }
 assert.equal((await rpc(null)).status,401);
 assert.equal((await rpc('free','set_vnext_watch_v1',{p_observation_id:'test-SHORT',p_watching:true})).status,403);
 for(const p of [{tier:'premium'},{p_tier:'owner'},{p_symbol:'DEMO4'},{p_horizon:'LONG'}])assert.equal((await rpc('free','get_vnext_member_v1',p)).status,404);
 for(const name of ['get_vnext_observations_v1','member_card','member_allowed'])assert.ok([403,404].includes((await rpc('free',name)).status));
 checks.push('anonymous, direct private API, client tier / horizon enumeration DENY');
 await fetch(auth+'/user',{method:'PUT',headers:{Authorization:'Bearer '+sessions.free.access_token,'Content-Type':'application/json'},body:JSON.stringify({data:{owner:true,tier:'premium'}})});
 assert.equal(parseMemberResearch((await rpc('free')).data).tier,'free');checks.push('user metadata cannot elevate');
 const as=(role,q)=>runtime.sql(`begin;set local role authenticated;set local request.jwt.claims='{"sub":"${sessions[role].user.id}"}';${q};rollback;`);
 for(const role of ['free','premium','owner'])for(const table of ['member_copy','member_daily_edition','member_watch_events'])assert.throws(()=>as(role,'select * from vnext_private.'+table));
 assert.throws(()=>as('free',"select vnext_private.member_card('test-LONG',true)"));
 assert.throws(()=>runtime.sql("insert into vnext_private.member_daily_edition(business_date,slot,symbol) values((now() at time zone 'Asia/Taipei')::date,4,'DEMO4')"));
 assert.throws(()=>runtime.sql("update vnext_private.member_daily_edition set symbol='DEMO4' where slot=1"));
 checks.push('raw tables denied; daily three-stock edition immutable, no fourth-slot bypass');
 const watch=()=>rpc('premium','set_vnext_watch_v1',{p_observation_id:'test-SHORT',p_watching:true});
 assert.equal((await watch()).status,200);assert.equal((await watch()).status,200);
 assert.equal(runtime.sql('select count(*) from vnext_private.member_watch_events'),'1');
 assert.deepEqual((await rpc('owner')).data.watchlist,[]);assert.deepEqual((await rpc('other')).data.watchlist,[]);
 assert.deepEqual((await rpc('premium')).data.watchlist,['test-SHORT']);
 const loggedOut=await fetch(auth+'/logout',{method:'POST',headers:{Authorization:'Bearer '+sessions.premium.access_token}});assert.equal(loggedOut.status,204);
 const refresh=await fetch(auth+'/token?grant_type=refresh_token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refresh_token:sessions.premium.refresh_token})});assert.equal(refresh.status,400);
 sessions.premium=await login('premium');assert.deepEqual((await rpc('premium')).data.watchlist,['test-SHORT']);
 assert.equal((await rpc('premium','set_vnext_watch_v1',{p_observation_id:'test-SHORT',p_watching:false})).status,200);
 checks.push('watchlist idempotency, A/B isolation, logout revokes refresh, real re-login persistence');
 const identity=sessions.premium.user.id;
 runtime.sql(`begin;update public.member_entitlements set state='expired' where user_id='${identity}';set local role authenticated;set local request.jwt.claims='{"sub":"${identity}"}';
 do $$begin if public.get_vnext_member_v1()->>'tier'<>'free' or public.get_vnext_member_v1()->'history'<>'[]'::jsonb then raise exception 'DOWNGRADE_LEAK';end if;end$$;rollback;`);
 checks.push('server downgrade immediately strips Premium evidence/history');
 for(const [field,values,message] of [['event_ids',"array['test-event']",'MEMBER_EVENT_UNVERIFIED'],['relation_ids',"array['test-relation']",'MEMBER_RELATION_UNVERIFIED'],['supporting_ids',"array['not-associated']",'MEMBER_COPY_NOT_APPROVED']]){
  assert.throws(()=>runtime.sql(`insert into vnext_private.member_copy(observation_id,publication_id,primary_risk,${field}) select observation_id,publication_id,primary_risk,${values} from vnext_private.member_copy where observation_id='test-SHORT'`),e=>String(e.stderr||e).includes(message));
 }
 checks.push('unverified event, same-industry inference and unlinked evidence rejected at DB copy gate');
 runtime.sql(`begin;
 insert into vnext_private.market_events select event_id,2,source,source_event_id,published_at,first_seen_at,available_at,last_verified_at,
 '未經原會員審查的新修訂',affected_companies,expected_horizons,invalidation,evidence_ids,classification,repeat('b',64)
 from vnext_private.market_events where event_id='member-event' and revision=1;
 set local role authenticated;set local request.jwt.claims='{"sub":"${identity}"}';
 do $$begin if exists(select from jsonb_array_elements(public.get_vnext_member_v1()->'observations') x where x->>'id'='demo-2' and x->'details'->'events'->0->>'title'='未經原會員審查的新修訂') then raise exception 'EVENT_REVISION_LEAK';end if;end$$;rollback;`);
 checks.push('later backdated event revision cannot replace approved member copy');
 runtime.sql(`begin;insert into vnext_private.publication_audit(observation_id,snapshot_hash,audience,approved,content_kind,reviewer_ref,license_review_ref,gate_version)
 select observation_id,snapshot_hash,audience,false,content_kind,reviewer_ref,license_review_ref,gate_version from vnext_private.publication_audit where observation_id='test-SHORT';
 set local role authenticated;set local request.jwt.claims='{"sub":"${identity}"}';
 do $$begin if exists(select from jsonb_array_elements(public.get_vnext_member_v1()->'observations') x where x->>'id'='test-SHORT') then raise exception 'REVOKED_COPY_LEAK';end if;end$$;rollback;`);
 checks.push('revoked publication not served from copy or watchlist');
 // A short-lived, explicitly synthetic forward lock verifies expiry history.
 // This is not one of the retained historical research observations.
 runtime.sql(`begin;
 insert into vnext_private.stock_horizon_observations(id,symbol,company,horizon,created_at,as_of,available_at,last_verified_at,next_review_at,expires_at,reason,strategy_version,mode,snapshot_hash,status,confirmation_conditions,invalidation_conditions)
 select 'member-history',symbol,'已到期示範（非真實股票）',horizon,transaction_timestamp(),as_of,available_at,last_verified_at,transaction_timestamp()+interval '1 second',transaction_timestamp()+interval '2 seconds',reason,'SYNTHETIC_HISTORY_TEST',mode,snapshot_hash,status,confirmation_conditions,invalidation_conditions
 from vnext_private.stock_horizon_observations where id='test-SHORT';
 insert into vnext_private.observation_evidence select 'member-history',evidence_id from vnext_private.observation_evidence where observation_id='test-SHORT';
 insert into vnext_private.publication_audit(observation_id,snapshot_hash,audience,approved,content_kind,reviewer_ref,license_review_ref,gate_version)
 values('member-history',repeat('a',64),'premium',true,'RESEARCH_OBSERVATION','SYNTHETIC','SYNTHETIC','VNEXT_PUBLICATION_1');
 insert into vnext_private.member_copy(observation_id,publication_id,primary_risk)
 select observation_id,id,'示範已到期：原條件不能再當成目前有效研究。' from vnext_private.publication_audit where observation_id='member-history';
 insert into vnext_private.observation_outcomes(observation_id,horizon_days,observed_at,evidence_hash,state,cost_model_version,revision)
 values('member-history',1,clock_timestamp(),repeat('a',64),'NOT_MATURED','SYNTHETIC',1);
 commit;`);
 // Observe the database clock rather than assuming host/container timers are
 // perfectly aligned (Docker Desktop can pause the VM during UI activity).
 for(let n=0;n<30;n++){
  if(runtime.sql("select clock_timestamp()>expires_at from vnext_private.stock_horizon_observations where id='member-history'")==='t')break;
  await new Promise(r=>setTimeout(r,200));
 }
 const history=parseMemberResearch((await rpc('premium')).data).history;
 assert.equal(history.find(o=>o.id==='member-history').status,'EXPIRED');
 assert.equal(history.find(o=>o.id==='member-history').details.outcomes[0].state,'NOT_MATURED');
 assert.deepEqual((await rpc('free')).data.history,[]);
 checks.push('previously approved expired research only in Premium history; no fabricated measured outcome');
 return {identity:'ISOLATED_REAL_SUPABASE_AUTH_NOT_PRODUCTION',checks,production_changed:false};
}
if(process.argv[1]===new URL(import.meta.url).pathname){
 const runtime=await environment();try{
  installCandidate(runtime);console.log(JSON.stringify(await verifyCandidate(runtime)));
  installMemberFixtures(runtime);console.log(JSON.stringify(await verifyMember(runtime)));
  if(process.env.MA_VNEXT_KEEP_PREVIEW!=='ISOLATED_ONLY'){
   revokeSyntheticPublications(runtime);console.log(JSON.stringify(await verifyEmptyPublication()));
  }
  if(process.env.MA_VNEXT_KEEP_PREVIEW==='ISOLATED_ONLY'){
   process.env.MA_VNEXT_LOCAL='ISOLATED_ONLY';process.env.MA_VNEXT_ANON=runtime.anon;
   const {createServer}=await import('vite');
   const server=await createServer({configFile:new URL('../../tests/browser/vnext.vite.ts',import.meta.url).pathname});await server.listen();
   console.log('MEMBER_PREVIEW=http://127.0.0.1:'+(process.env.MA_VNEXT_PORT||3220)+'/stocks');
   await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});await server.close();
  }
 }finally{runtime.cleanup();}
}

// Reuses the reviewed Academy local Auth/PostgREST infrastructure, never Production.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {parseProjection} from '../../src/features/vnext/projection.ts';
// Reusing an already verified local runtime must not initialize another Auth
// environment or eagerly load unrelated original Academy material.
const localAuthBase='http://127.0.0.1:55632',localRestBase='http://127.0.0.1:55633';
const localTestPassword='Academy-local-only-2026!'; // Disposable local account only.
export const migration='supabase/migrations/20261010061630_vnext_research_projection_candidate.sql';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export const candidateFingerprint=()=>createHash('sha256').update(read(migration)).digest('hex');
export function verifyInstalledCandidate(runtime){
 assert.equal(runtime.sql("select obj_description('vnext_private'::regnamespace,'pg_namespace')"),
  'ISOLATED_CANDIDATE_SHA256:'+candidateFingerprint(),'LOCAL_SCHEMA_SOURCE_DRIFT');
}
export async function environment(){
 const name=process.env.MA_VNEXT_REUSE_LOCAL_DB;
 if(!name){const {startAuthEnvironment}=await import('../academy-v11/auth-environment.mjs');return startAuthEnvironment();}
 assert.match(name,/^ma-academy-auth-[0-9]+-db$/);
 const sql=s=>execFileSync('docker',['exec','-i',name,'psql','-XqAt','-U','postgres','-v','ON_ERROR_STOP=1'],{input:s,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
 assert.equal(sql("select count(*) from auth.users where email in ('owner@academy.test','free@academy.test','premium@academy.test','other@academy.test')"),'4');
 const c=await fetch('http://127.0.0.1:3219/__academy_public_config',{signal:AbortSignal.timeout(5000)}).then(r=>r.json());
 assert.equal(typeof c.anon,'string');
 return {sql,anon:c.anon,cleanup:()=>{}};
}
export function installCandidate(runtime){
 assert.equal(runtime.sql("select count(*) from pg_namespace where nspname='vnext_private'"),'0','CANDIDATE_ALREADY_PRESENT_NO_OVERWRITE');
 runtime.sql(read(migration));
 // Synthetic rows only, in the new candidate schema. Existing Academy untouched.
 runtime.sql(`begin;
 insert into vnext_private.source_licenses values('test-license','SYNTHETIC','https://example.com/license',now()-interval '1 day',null,true,true,true,true,'SYNTHETIC TEST ONLY');
 insert into vnext_private.event_sources(id,symbol,kind,source,source_ref,license_id,published_at,first_seen_at,available_at,as_of,last_verified_at,valid_until,snapshot_hash,classification,quality,relevant,summary)
 select 'test-'||k,'TEST',k,'SYNTHETIC','https://example.com/evidence','test-license',now()-interval '2 hours',now()-interval '1 hour',now()-interval '1 hour',now()-interval '3 hours',now()-interval '30 minutes',now()+interval '7 days',repeat('a',64),'CONFIRMED_FACT','PASS',true,'這是隔離測試資料，不是真實公司或行情。'
 from unnest(array['PRICE_VOLUME','INSTITUTIONAL','NEWS','TECHNICAL_STRUCTURE','REVENUE','ORDERS','GUIDANCE','INDUSTRY_EVENT','DEMAND','MOAT','SUPPLY_CHAIN','EPS','MARGIN','CAPEX','VALUATION']) k;
 insert into vnext_private.stock_horizon_observations(id,symbol,company,horizon,created_at,as_of,available_at,last_verified_at,next_review_at,expires_at,reason,strategy_version,mode,snapshot_hash,status,confirmation_conditions,invalidation_conditions)
 select 'test-'||h,'TEST','測試公司（非真實標的）',h,now(),now()-interval '1 hour',now()-interval '1 hour',now()-interval '30 minutes',now()+interval '1 day',now()+interval '7 days',
 case h when 'SHORT' then '示範：先觀察量價與消息，等待條件確認。' when 'MEDIUM' then '示範：訂單需要營收驗證，不用短期漲幅代替。' else '示範：需求與獲利尚待持續驗證，不急著下結論。' end,
 'SYNTHETIC_TEST_ONLY','FORWARD_SHADOW',repeat('a',64),'WATCHING',
 jsonb_build_array(jsonb_build_object('text',case h when 'SHORT' then '示範條件：價格與成交量共同確認後，再重新評估。' when 'MEDIUM' then '示範條件：已公布的訂單由後續月營收驗證，再重新評估。' else '示範條件：需求、毛利與獲利持續驗證，且估值仍有合理依據。' end,'state','UNKNOWN','evidence_ids',jsonb_build_array(case h when 'SHORT' then 'test-PRICE_VOLUME' when 'MEDIUM' then 'test-REVENUE' else 'test-EPS' end))),
 jsonb_build_array(jsonb_build_object('text',case h when 'SHORT' then '示範失效：價格跌破已確認支撐，停止短期觀察。' when 'MEDIUM' then '示範失效：訂單取消或月營收未驗證原假設，停止觀察。' else '示範失效：長期需求或競爭優勢的證據不再成立，停止觀察。' end,'state','NOT_MET','evidence_ids',jsonb_build_array(case h when 'SHORT' then 'test-TECHNICAL_STRUCTURE' when 'MEDIUM' then 'test-ORDERS' else 'test-DEMAND' end)))
 from unnest(array['SHORT','MEDIUM','LONG']) h;
 insert into vnext_private.observation_evidence select o.id,e.id from vnext_private.stock_horizon_observations o cross join vnext_private.event_sources e;
 insert into vnext_private.publication_audit(observation_id,snapshot_hash,audience,approved,content_kind,reviewer_ref,license_review_ref,gate_version)
 values('test-SHORT',repeat('a',64),'free',true,'RESEARCH_OBSERVATION','SYNTHETIC','SYNTHETIC','VNEXT_PUBLICATION_1'),
  ('test-MEDIUM',repeat('a',64),'premium',true,'RESEARCH_OBSERVATION','SYNTHETIC','SYNTHETIC','VNEXT_PUBLICATION_1');
 insert into vnext_private.market_events(event_id,revision,source,source_event_id,published_at,first_seen_at,available_at,last_verified_at,title,affected_companies,expected_horizons,invalidation,evidence_ids,classification,snapshot_hash)
 values('test-event',1,'SYNTHETIC','test-announcement',now()-interval '2 hours',now()-interval '1 hour',now()-interval '20 minutes',now()-interval '10 minutes',
 '示範：公司公布需求展望，仍需營收驗證',array['TEST'],array['MEDIUM'],'若後續營收未驗證，撤回原本推論',array['test-INDUSTRY_EVENT'],'REPORTED_CLAIM',repeat('a',64)),
 ('test-event',2,'SYNTHETIC','test-announcement',now()-interval '2 hours',now()-interval '1 hour',now()-interval '5 minutes',now()-interval '1 minute',
 '示範更新：展望已修正，不能重複當成新利多',array['TEST'],array['MEDIUM'],'以後續更正公告重新驗證',array['test-INDUSTRY_EVENT'],'REPORTED_CLAIM',repeat('b',64));
 insert into vnext_private.supply_chain_relations(id,from_entity,to_entity,relation_type,source,evidence_ids,valid_from,valid_to,observed_at,available_at,confidence,revenue_exposure,verification_status)
 values('test-relation','測試公司（非真實標的）','測試產業','INDUSTRY','SYNTHETIC',array['test-SUPPLY_CHAIN'],now()-interval '1 day',null,now()-interval '1 hour',now()-interval '10 minutes','UNKNOWN',null,'UNVERIFIED');
 commit;notify pgrst,'reload schema';`);
 runtime.sql("comment on schema vnext_private is 'ISOLATED_CANDIDATE_SHA256:"+candidateFingerprint()+"'");
}
export async function verifyCandidate(runtime){
 const checks=[],sessions={};
 const rpc=async(token)=>{const r=await fetch(localRestBase+'/rpc/get_vnext_observations_v1',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:'{}'});return {status:r.status,body:await r.json()};};
 const login=async(role)=>{const r=await fetch(localAuthBase+'/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:role+'@academy.test',password:localTestPassword})});assert.equal(r.status,200);return r.json();};
 for(const [role,count] of [['owner',3],['free',0],['premium',0],['other',0]]){
  sessions[role]=await login(role);
  let result;for(let i=0;i<10;i++){result=await rpc(sessions[role].access_token);if(result.status!==404)break;await new Promise(r=>setTimeout(r,100));}
  if(role!=='owner'){assert.equal(result.status,403,'old private read path is Owner-only');checks.push(role+' private predecessor denied');continue;}
  assert.equal(result.status,200,role+' projection');assert.equal(result.body.observations.length,count,role+' approved content');
  assert.equal(parseProjection(result.body).observations.length,count,'actual PostgreSQL JSON accepted by browser read model');
  assert.equal(result.body.industry.events.length,role==='owner'?2:0,'independent industry publication approval required');
  assert.equal(result.body.industry.relations.length,role==='owner'?1:0);
  if(role==='owner')assert.equal(result.body.industry.relations[0].evidence_status,'UNKNOWN');
  assert.equal(result.body.tier,role==='other'?'free':role);checks.push(role+' real local Auth + publication/entitlement');
 }
 const anonymous=await rpc(null);assert.ok([401,403].includes(anonymous.status));checks.push('anonymous denied');
 const id=sessions.free.user.id;
 const as=(query,role='authenticated')=>runtime.sql(`begin;set local role ${role};set local request.jwt.claims='{"sub":"${id}"}';${query};rollback;`);
 assert.equal(as('select count(*) from vnext_private.stock_horizon_observations'),'0');checks.push('free raw table denied by RLS');
 assert.throws(()=>as("insert into vnext_private.source_licenses(id) values('attack')"));
 assert.throws(()=>as("select vnext_private.publication_allowed('test-SHORT',now())"));checks.push('client write and internal gate denied');
 const forged=sessions.free.access_token.split('.');forged[1]=Buffer.from(JSON.stringify({role:'authenticated',sub:sessions.owner.user.id})).toString('base64url');
 assert.equal((await rpc(forged.join('.'))).status,401);checks.push('forged JWT denied');
 await fetch(localAuthBase+'/user',{method:'PUT',headers:{'Content-Type':'application/json',Authorization:'Bearer '+sessions.free.access_token},body:JSON.stringify({data:{owner:true,tier:'premium'}})});
 assert.equal((await rpc(sessions.free.access_token)).status,403);checks.push('user metadata cannot elevate');
 assert.throws(()=>runtime.sql("update vnext_private.stock_horizon_observations set reason='tamper' where id='test-SHORT'"));
 assert.throws(()=>runtime.sql("delete from vnext_private.stock_horizon_observations where id='test-SHORT'"));
 assert.throws(()=>runtime.sql("insert into vnext_private.stock_horizon_observations select * from vnext_private.stock_horizon_observations limit 1"));checks.push('immutable prediction and duplicate lock denied');
 assert.throws(()=>runtime.sql("insert into vnext_private.observation_evidence values('test-SHORT','test-PRICE_VOLUME')"));checks.push('later evidence membership cannot rewrite locked snapshot');
 const outcome="insert into vnext_private.observation_outcomes(observation_id,horizon_days,observed_at,evidence_hash,state,cost_model_version,revision) ";
 runtime.sql(`begin;${outcome}select 'test-SHORT',1,created_at,repeat('a',64),'NOT_MATURED','SYNTHETIC',1 from vnext_private.stock_horizon_observations where id='test-SHORT';${outcome}values('test-SHORT',1,clock_timestamp(),repeat('a',64),'UNCONFIRMED','SYNTHETIC',2);rollback;`);
 assert.throws(()=>runtime.sql(`${outcome}values('test-SHORT',1,clock_timestamp(),repeat('a',64),'UNCONFIRMED','SYNTHETIC',2)`));
 assert.throws(()=>runtime.sql(`${outcome}values('test-SHORT',20,clock_timestamp(),repeat('a',64),'UNCONFIRMED','SYNTHETIC',1)`));checks.push('append-only outcome revisions and per-horizon boundaries');
 checks.push('Owner industry timeline, unknown relation and member non-publication');
 assert.equal(runtime.sql("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='vnext_private' and c.relkind='r' and c.relrowsecurity and c.relforcerowsecurity"),'11');checks.push('eleven private tables forced RLS');
 for(const mutation of ["snapshot_hash=repeat('b',64)","approved=false","audience='premium'"]){
  // Append a new review only inside rollback, never alter original audit.
  runtime.sql(`begin;insert into vnext_private.publication_audit(observation_id,snapshot_hash,audience,approved,content_kind,reviewer_ref,license_review_ref,gate_version)
   select observation_id,${mutation.startsWith('snapshot')?"repeat('b',64)":"snapshot_hash"},${mutation.startsWith('audience')?"'premium'":"audience"},${mutation.startsWith('approved')?'false':'approved'},content_kind,reviewer_ref,license_review_ref,gate_version from vnext_private.publication_audit where observation_id='test-SHORT' order by id desc limit 1;
   do $$begin if ${mutation.startsWith('audience')?"false":"vnext_private.publication_allowed('test-SHORT',clock_timestamp())"} then raise exception 'PUBLICATION_BYPASS';end if;end$$;rollback;`);
 }checks.push('hash mismatch/revocation/audience fail closed');
 runtime.sql(`begin;
 insert into vnext_private.stock_horizon_observations(id,symbol,company,horizon,created_at,as_of,available_at,last_verified_at,next_review_at,expires_at,reason,strategy_version,mode,snapshot_hash,status,confirmation_conditions,invalidation_conditions)
 select 'test-history',symbol,company,horizon,created_at,as_of,available_at,last_verified_at,next_review_at,created_at+interval '1 microsecond',reason,'SYNTHETIC_HISTORY_ONLY','HISTORICAL_REPLAY',snapshot_hash,status,confirmation_conditions,invalidation_conditions
 from vnext_private.stock_horizon_observations where id='test-SHORT';
 set local role authenticated;set local request.jwt.claims='{"sub":"${sessions.owner.user.id}"}';
 do $$begin if not exists(select from jsonb_array_elements(public.get_vnext_observations_v1()->'observations') x where x->>'id'='test-history' and x->>'mode'='HISTORICAL_REPLAY' and x->>'status'='EXPIRED') then raise exception 'HISTORY_OR_EXPIRY_LABEL_MISSING';end if;end$$;
 reset role;
 do $$begin if vnext_private.publication_allowed('test-history',clock_timestamp()) then raise exception 'HISTORY_LEAK';end if;end$$;rollback;`);
 checks.push('historical mode and expired state remain explicit, never member forward');
 // DB function/Owner predicate fingerprints, not Production data, for regression.
 checks.push('no Production endpoint or source imported');
 return {identity:'ISOLATED_SUPABASE_AUTH_NOT_SONY',checks,production_changed:false};
}
if(process.argv[1]===new URL(import.meta.url).pathname){
 const runtime=await environment();try{installCandidate(runtime);console.log(JSON.stringify(await verifyCandidate(runtime)));}finally{runtime.cleanup();}
}

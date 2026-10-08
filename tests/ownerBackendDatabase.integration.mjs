// Actual candidate + actual Phase 1 Owner gate, synthetic empty read dependencies.
// This is NOT Production Owner proof, a full schema replay, or an Auth/JWT test.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

assert.equal(process.versions.node.split('.')[0],'22','Run with Node 22');
const container=process.env.MA_TEST_DOCKER_CONTAINER,db=process.env.MA_ISOLATED_TEST_DB;
assert.match(container||'',/^ma-owner-backend-ci-\d+$/);
assert.match(db||'',/^ma_owner_backend_test\d+$/);
const docker=(args,input)=>execFileSync('docker',args,{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:30000,maxBuffer:8*1024*1024}).trim();
const inspect=JSON.parse(docker(['inspect',container]))[0];
assert.equal(inspect.HostConfig.NetworkMode,'none');
assert.equal(Object.keys(inspect.HostConfig.PortBindings||{}).length,0,'No published ports');
const exec=(database,input)=>docker(['exec','-i',container,'psql','-X','-q','-U','postgres','-d',database,'-At','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],input);
const sql=s=>exec(db,s),read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const lit=s=>"'"+String(s).replaceAll("'","''")+"'";
const candidatePath='supabase/migrations/20261008040043_owner_backend_status_read_model_v1.sql';
const candidate=read(candidatePath),sha=s=>createHash('sha256').update(s).digest('hex');
let stage='fresh isolated PostgreSQL 17';
try {
 assert.equal(Math.floor(Number(exec('postgres','show server_version_num'))/10000),17);
 assert.equal(exec('postgres',`select count(*) from pg_database where datname=${lit(db)}`),'0','Database must not exist');
 exec('postgres',`create database ${db}`);
 stage='synthetic dependencies and actual Phase 1 Owner migration';
 sql(read('tests/fixtures/research-foundation-dependencies.sql'));
 sql(read('supabase/migrations/20261004033642_intelligence_foundation_owner_shadow_v1.sql'));
 sql(read('tests/fixtures/owner-backend-dependencies.sql'));
 // Load actual calendar functions (the bounded block used by existing DB gates).
 sql(read('supabase/migrations/20260930043122_six_bug_preventive_closure_v1.sql').split('create or replace function public.latest_completed_us_session_v1')[0]+'commit;');
 // Exact pre-existing read function definitions, not mocked Owner authorization.
 const reader=(path,name)=>{
  const source=read(path),start=source.search(new RegExp('create (?:or replace )?function public\\.'+name+'\\('));
  assert(start>=0,'Missing actual reader '+name);
  const end=source.indexOf('end $$;',start);assert(end>start);sql(source.slice(start,end+7));
  sql(`revoke all on function public.${name}() from public,anon,authenticated,service_role;grant execute on function public.${name}() to authenticated;`);
 };
 reader('supabase/migrations/20261007113746_recommendation_v2_watch_prospective_lock.sql','get_owner_recommendation_shadow_v2');
 reader('supabase/migrations/20261007125316_recommendation_v2_forward_lifecycle.sql','get_owner_recommendation_v2_forward');
 const owner='10000000-0000-4000-8000-000000000001',normal='10000000-0000-4000-8000-000000000002',paid='10000000-0000-4000-8000-000000000003',otherAdmin='10000000-0000-4000-8000-000000000004';
 sql(`insert into public.profiles values('${owner}','admin'),('${normal}','member'),('${paid}','paid'),('${otherAdmin}','admin');
 insert into research_private.owner_access(principal_id,enabled,approval_reference) values('${owner}',true,'SYNTHETIC_LOCAL_ONLY_NOT_PRODUCTION_OWNER_PROOF');`);
 const relations=JSON.parse(sql("select jsonb_agg(jsonb_build_array(n.nspname,c.relname) order by n.nspname,c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','research_private','cron') and c.relkind='r'"));
 const ident=s=>'"'+s.replaceAll('"','""')+'"';
 const dataSnapshot=()=>sql(relations.map(([n,t])=>`select ${lit(n+'.'+t)}||':'||coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb)::text from ${ident(n)}.${ident(t)} r`).join(' union all '));
 const existingFunctions=()=>sql("select jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),pg_get_functiondef(p.oid),p.proowner,p.proacl,p.proconfig) order by p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','research_private','auth') and p.proname<>'get_owner_backend_status_v1'");
 const securitySnapshot=()=>sql(`select jsonb_build_object(
 'relations',(select jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relkind,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity,c.reloptions) order by c.oid) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','research_private','cron','auth')),
 'schemas',(select jsonb_agg(jsonb_build_array(nspname,nspowner,nspacl) order by nspname) from pg_namespace where nspname in ('public','research_private','cron','auth')),
 'policies',(select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname) from pg_policies p),
 'roles',(select jsonb_agg(to_jsonb(r) order by rolname) from pg_roles r),
 'triggers',(select jsonb_agg(pg_get_triggerdef(oid) order by oid) from pg_trigger where not tgisinternal))`);
 const functionsBefore=existingFunctions(),securityBefore=securitySnapshot(),dataBefore=dataSnapshot();
 stage='actual candidate migration';sql(candidate);
 const metadata=JSON.parse(sql(`select jsonb_build_object('schema',n.nspname,'language',l.lanname,'volatility',p.provolatile,
  'security_definer',p.prosecdef,'args',p.pronargs,'return_type',p.prorettype::regtype::text,'config',p.proconfig,'body',p.prosrc,
  'execute_roles',(select jsonb_agg(coalesce(r.rolname,'PUBLIC') order by coalesce(r.rolname,'PUBLIC'))
   from aclexplode(p.proacl) a left join pg_roles r on r.oid=a.grantee where a.privilege_type='EXECUTE'))
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
  where p.oid='public.get_owner_backend_status_v1()'::regprocedure`));
 assert.equal(metadata.schema,'public');assert.equal(metadata.language,'plpgsql');assert.equal(metadata.volatility,'s');
 assert.equal(metadata.security_definer,true);assert.equal(metadata.args,0);assert.equal(metadata.return_type,'jsonb');
 assert.deepEqual(metadata.config,['search_path=""','statement_timeout=8s']);
 assert.deepEqual(metadata.execute_roles,['authenticated','postgres']);
 assert.equal(metadata.body.trim(),candidate.slice(candidate.indexOf('as $$')+5,candidate.indexOf('end $$;')+3).trim(),'Installed body must equal actual candidate source');
 assert.match(metadata.body,/auth\.uid\(\) is null or not coalesce\(public\.is_research_owner_v1\(\),false\)/);
 assert.equal(existingFunctions(),functionsBefore);assert.equal(securitySnapshot(),securityBefore);assert.equal(dataSnapshot(),dataBefore);
 assert.throws(()=>sql(candidate),/already exists/,'Forward migration must prevent duplicate application');
 const rpc='select public.get_owner_backend_status_v1()';
 const user=(uid,query=rpc)=>`begin read only;set local role authenticated;set local request.jwt.claim.sub=${lit(uid)};set local request.jwt.claims='{}';${query};commit;`;
 const rollbackUser=(uid,query)=>user(uid,query).replace('begin read only;','begin;').replace(/commit;$/,'rollback;');
 const denied=(q,reason=/RESEARCH_OWNER_REQUIRED|permission denied/)=>assert.throws(()=>sql(q),e=>{assert.match(e.stderr,reason);assert.match(e.stderr,/42501/);return true;});
 stage='anonymous, normal, paid, unenrolled admin, logout and service-role denies';
 denied('set role anon;'+rpc);denied('set role service_role;'+rpc);
 for(const uid of [normal,paid,otherAdmin,''])denied(user(uid));
 denied(user(normal,`set local request.jwt.claims='{"user_metadata":{"role":"admin"}}';${rpc}`));
 denied(`begin read only;set local role authenticated;set local request.jwt.claim.sub='${owner}';${rpc};set local request.jwt.claim.sub='';set local request.jwt.claims='{}';${rpc};commit;`,/RESEARCH_OWNER_REQUIRED/);
 // Owner eligibility is the ACTUAL existing singleton + enabled + admin gate.
 denied(`begin;update research_private.owner_access set enabled=false;set local role authenticated;set local request.jwt.claim.sub='${owner}';${rpc};rollback;`,/RESEARCH_OWNER_REQUIRED/);
 denied(`begin;update public.profiles set role='member' where id='${owner}';set local role authenticated;set local request.jwt.claim.sub='${owner}';${rpc};rollback;`,/RESEARCH_OWNER_REQUIRED/);
 stage='Owner empty-schema read-only execution';
 const empty=JSON.parse(sql(user(owner)));
 assert.equal(empty.schema_version,'OWNER_BACKEND_STATUS_V1');assert.equal(empty.business_writes,0);assert.equal(empty.timezone,'Asia/Taipei');
 assert.equal(empty.today_date,sql("select (statement_timestamp() at time zone 'Asia/Taipei')::date"));
 for(const key of ['acceptance','runtime','report','learning','closing'])assert.equal(empty[key],null,key);
 for(const key of ['schedule','sla','batches','history','legacy_health'])assert.deepEqual(empty[key],[],key);
 assert.equal(empty.calendar.length,33);assert.equal(empty.line.total,0);
 assert.equal(empty.quality.stock_shadow.read_status,'AVAILABLE','Actual V2 reader must execute, not silently fall into optional catch');
 assert.equal(empty.quality.stock_shadow.forward_sample,0);assert.equal(empty.stock_data,null);
 for(const metric of empty.quality.market_direction){assert.equal(metric.samples,0);assert.equal(metric.accuracy,null);}
 assert.equal(dataSnapshot(),dataBefore);assert.equal(existingFunctions(),functionsBefore);assert.equal(securitySnapshot(),securityBefore);
 stage='saved close review is distinct from the 1430 runtime checkpoint';
 const checkpoint=`insert into public.owner_backend_runtime_fixture(trading_date,closing_status,updated_at)
  values((now() at time zone 'Asia/Taipei')::date,'SUCCEEDED',now()-interval '1 minute');`;
 const review=(dayOffset,age,quality,missing,result)=>`insert into public.close_market_reviews(report_date,data_quality,missing_data,verification_result,updated_at)
  values((now() at time zone 'Asia/Taipei')::date+${dayOffset},${lit(quality)},${missing},${lit(result)},now()-interval ${lit(age)});`;
 const closingScenario=seed=>{
  const before=dataSnapshot(),r=JSON.parse(sql(`begin;${checkpoint}${seed}
   set local role authenticated;set local request.jwt.claim.sub='${owner}';${rpc};rollback;`));
  assert.equal(dataSnapshot(),before);assert.equal(r.business_writes,0);
  assert.equal(r.runtime.closing_status,'SUCCEEDED');return r;
 };
 assert.equal(closingScenario('').closing,null,'1430 checkpoint success is NOT a saved close review');
 const ignored=review(-1,'1 day','complete',"'{}'::text[]",'SYNTHETIC_YESTERDAY_RESULT')+
  review(1,'1 minute','complete',"'{}'::text[]",'SYNTHETIC_FUTURE_DATE_RESULT')+
  review(0,'-1 day','complete',"'{}'::text[]",'SYNTHETIC_FUTURE_UPDATED_RESULT');
 assert.equal(closingScenario(ignored).closing,null,'Stale/future reviews cannot impersonate today');
 const saved=review(0,'10 minutes','complete',"'{}'::text[]",'SYNTHETIC_PRIVATE_CLOSING_REVIEW_TEXT');
 const completed=closingScenario(ignored+saved);
 assert.equal(completed.closing.business_date,empty.today_date);assert.equal(completed.closing.data_quality,'complete');
 assert.equal(completed.closing.missing_count,0);assert.equal(completed.closing.has_result,true);
 assert(Date.parse(completed.closing.updated_at)<=Date.parse(completed.as_of));
 assert.doesNotMatch(JSON.stringify(completed),/SYNTHETIC_PRIVATE_CLOSING_REVIEW_TEXT|SYNTHETIC_FUTURE|SYNTHETIC_YESTERDAY/);
 const incomplete=closingScenario(saved+review(0,'1 minute','partial',"ARRAY['SYNTHETIC_PRIVATE_MISSING_ITEM']",'   '));
 assert.equal(incomplete.closing.data_quality,'partial');assert.equal(incomplete.closing.missing_count,1);
 assert.equal(incomplete.closing.has_result,false,'The latest incomplete review must not inherit prior success');
 assert.doesNotMatch(JSON.stringify(incomplete),/SYNTHETIC_PRIVATE_MISSING_ITEM|SYNTHETIC_PRIVATE_CLOSING_REVIEW_TEXT/);
 assert.equal(dataSnapshot(),dataBefore);assert.equal(existingFunctions(),functionsBefore);assert.equal(securitySnapshot(),securityBefore);
 stage='synthetic allowlist projection, not Production evidence';
 const secret='SYNTHETIC_PRIVATE_SENTINEL_NEVER_PROJECT';
 sql(`insert into public.reports(report_date,created_at,ai_strategy_json) values
 ((now() at time zone 'Asia/Taipei')::date-1,now()-interval '1 day','{"market_report_gate":{"recommendation_status":"BLOCKED"},"raw_payload":"${secret}"}'),
 ((now() at time zone 'Asia/Taipei')::date+1,now(),'{"market_report_gate":{"recommendation_status":"FUTURE_MUST_NOT_PROJECT"}}');
 insert into cron.job values(1,'morning-alpha-daily-generate-primary','20 23 * * 0-4',true,'${secret}'),(2,'not-allowlisted','* * * * *',true,'${secret}');
 insert into public.line_delivery_outbox(report_date,push_type,status,sent_at,recipient_id,payload) values((now() at time zone 'Asia/Taipei')::date,'daily_report','SENT',now(),'${secret}','{"private":"${secret}"}');`);
 sql(`update public.reports set ai_strategy_json=ai_strategy_json||jsonb_build_object(
  'market_publication_contract',jsonb_build_object('status','PUBLISHED','report_date',report_date),
  'recommendation_stock_evidence',jsonb_build_object('contract','RECOMMENDATION_STOCK_EVIDENCE_V1','business_date',report_date,'universe_count',72,
   'captures',jsonb_build_array(jsonb_build_object('symbol','2330','status','PASS','endpoint','historical/candles','rows',(select jsonb_agg(jsonb_build_object('raw',${lit(secret)})) from generate_series(1,20))),
    jsonb_build_object('symbol','2317','status','HTTP_503','endpoint','historical/candles','rows','[]'::jsonb))))
  where report_date=(now() at time zone 'Asia/Taipei')::date-1;
 insert into public.recommendation_shadow_v2_predictions(business_date,symbol,observation_kind,methodology_version,locked_at,status) values
 ((now() at time zone 'Asia/Taipei')::date,'2330','FORWARD','RECOMMENDATION_SHADOW_TREND_ACTUALS_2.0.0',now()-interval '1 hour','WATCH'),
 ((now() at time zone 'Asia/Taipei')::date,'2317','FORWARD','RECOMMENDATION_SHADOW_TREND_ACTUALS_2.0.0',now()-interval '1 hour','READY'),
 ((now() at time zone 'Asia/Taipei')::date-1,'2330','HISTORICAL_REPLAY','RECOMMENDATION_SHADOW_TREND_ACTUALS_2.0.0',now()-interval '1 hour','READY'),
 ((now() at time zone 'Asia/Taipei')::date-2,'2330','FORWARD','OTHER_METHODOLOGY',now()-interval '1 hour','READY'),
 ((now() at time zone 'Asia/Taipei')::date-3,'2330','FORWARD','RECOMMENDATION_SHADOW_TREND_ACTUALS_2.0.0',now()+interval '1 day','READY'),
 ((now() at time zone 'Asia/Taipei')::date+1,'2330','FORWARD','RECOMMENDATION_SHADOW_TREND_ACTUALS_2.0.0',now()-interval '1 hour','READY');`);
 const populatedBefore=dataSnapshot(),projected=JSON.parse(sql(user(owner)));
 assert.doesNotMatch(JSON.stringify(projected),new RegExp(secret+'|FUTURE_MUST_NOT_PROJECT'));
 assert.equal(projected.report.business_date,sql("select (now() at time zone 'Asia/Taipei')::date-1"));
 assert.equal(projected.schedule.length,1);assert.equal(projected.line.sent,1);
 assert.equal(projected.report.publication_status,'PUBLISHED');assert.equal(projected.report.publication_date,projected.report.business_date);
 assert.equal(projected.stock_data.captured_symbols,2);assert.equal(projected.stock_data.passed_symbols,1);
 assert.equal(projected.stock_data.failed_captures,1);assert.equal(projected.stock_data.historical_20d,1);
 assert.equal(projected.quality.stock_shadow.read_status,'AVAILABLE');assert.equal(projected.quality.stock_shadow.forward_sample,1);
 assert.equal(dataSnapshot(),populatedBefore);
 stage='optional V2 unavailable does not fabricate zero or hide core status';
 // Temporary failures exist only within rolled-back local fixture transactions.
 // Reader failure, a missing relation, and sensitive exception diagnostics must
 // all produce the same honest bounded UNAVAILABLE projection, never success.
 for(const failure of [
  'alter function public.get_owner_recommendation_v2_forward() rename to owner_backend_test_unavailable;',
  'alter table public.recommendation_shadow_v2_predictions rename to owner_backend_test_missing_predictions;',
  `create or replace function public.get_owner_recommendation_v2_forward() returns jsonb language plpgsql security invoker set search_path='' as $test$ begin
   raise exception '${secret}' using errcode='P0001',detail='SYNTHETIC_PRIVATE_EMAIL@example.invalid',hint='SYNTHETIC_PRIVATE_TOKEN';end $test$;`,
 ]){
  const unavailable=JSON.parse(sql(`begin;${failure}
   set local role authenticated;set local request.jwt.claim.sub='${owner}';${rpc};rollback;`));
  assert.deepEqual(unavailable.quality.stock_shadow,{
   read_status:'UNAVAILABLE',completed_forward_dates:null,forward_sample:null,
   latest_snapshot:{business_date:null,counts:null,cutoff:null},performance:null,
  });
  assert.deepEqual(unavailable.report,projected.report);
  assert.doesNotMatch(JSON.stringify(unavailable),/SYNTHETIC_PRIVATE|owner_backend_test_|"(?:sqlstate|sqlerrm|error_message|detail|hint)"\s*:/i);
  assert.equal(dataSnapshot(),populatedBefore);assert.equal(existingFunctions(),functionsBefore);assert.equal(securitySnapshot(),securityBefore);
 }
 // A missing CORE dependency must fail the RPC, not be absorbed by the
 // optional-research catch and presented as an available stock/core read.
 assert.throws(()=>sql(`begin;alter table public.reports rename to owner_backend_test_missing_reports;
  set local role authenticated;set local request.jwt.claim.sub='${owner}';${rpc};rollback;`),e=>{assert.match(e.stderr,/42P01/);assert.equal(e.stdout.trim(),'');return true;});
 stage='direct reads/writes remain denied and metadata unchanged';
 for(const table of ['reports','line_delivery_outbox','production_acceptance_results','recommendation_shadow_v2_predictions','close_market_reviews']){
  denied(user(owner,`select * from public.${table}`));
  denied(rollbackUser(owner,`insert into public.${table} default values`));
  denied(rollbackUser(owner,`update public.${table} set id=id where false`));
  denied(rollbackUser(owner,`delete from public.${table} where false`));
 }
 assert.equal(dataSnapshot(),populatedBefore);assert.equal(existingFunctions(),functionsBefore);assert.equal(securitySnapshot(),securityBefore);
 assert.equal(sha(read(candidatePath)),sha(candidate),'Candidate changed during test: rerun fresh DB');
 console.log(JSON.stringify({status:'PASS',fresh_db:db,container,postgres:17,node:process.versions.node,candidate_sha256:sha(candidate),actual_phase1_owner:true,actual_candidate_executed:true,candidate_catalog_scope:'STABLE_DEFINER_EMPTY_SEARCH_PATH_8S_AUTHENTICATED_ONLY',candidate_body_exact:true,existing_functions_acl_rls_unchanged:true,read_only_transactions:true,business_writes:0,anonymous:'DENY',normal:'DENY',paid:'DENY',logout:'DENY',unenrolled_admin:'DENY',synthetic_owner:'ALLOW',optional_v2_failure:'UNAVAILABLE_WITHOUT_DIAGNOSTIC_LEAK',missing_core_dependency:'FAIL_CLOSED',closing_review:{checkpoint_only:'NULL_NOT_SUCCESS',stale_future:'EXCLUDED',saved_today:'METADATA_ONLY',latest_incomplete:'NOT_PRIOR_SUCCESS'},scope:'SYNTHETIC_LOCAL_NOT_PRODUCTION_OWNER_PROOF',production_used:false}));
} catch(error){
 console.error(JSON.stringify({status:'FAIL',stage,fresh_db:db,candidate_sha256:sha(candidate),error:error.stderr?.trim()||error.message,production_used:false}));
 process.exitCode=1;
}

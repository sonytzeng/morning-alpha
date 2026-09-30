// Fresh controlled schema only. Exact Production predecessor, no remote DB.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {RETRY_CHECKPOINTS,recorderReplayIdentity} from './helpers/recorderRetryReplayContract.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
assert.equal(process.env.MA_RECORDER_LOCAL_SCOPE,'ma-recorder-retry-projection-20260930');
const db=process.env.MA_ISOLATED_TEST_DB;assert.match(db||'',/^ma_six_bug_test\d+$/);
const container=process.env.MA_TEST_DOCKER_CONTAINER;
if(container)assert.equal(container,'ma-six-bug-shadow-db');
const port=process.env.MA_TEST_PGPORT||'55439';assert.match(port,/^\d{4,5}$/);
const sql=input=>execFileSync(container?'docker':'psql',container?
 ['exec','-i',container,'psql','-X','-q','-U','postgres','-d',db,'-At','-v','ON_ERROR_STOP=1']:
 ['-X','-q','-h','127.0.0.1','-p',port,'-d',db,'-At','-v','ON_ERROR_STOP=1'],
 {input:"set morning_alpha.recorder_execution_origin='SHADOW_CAPTURE';"+input,encoding:'utf8',timeout:30000,maxBuffer:6e6,stdio:['pipe','pipe','pipe']}).trim();
const q=v=>`'${String(v).replaceAll("'","''")}'`,j=v=>q(JSON.stringify(v))+'::jsonb';
execFileSync(process.execPath,['tests/sixBugDatabase.integration.mjs','--bootstrap-only'],{
 cwd:root,env:{...process.env,MA_LOCAL_SCOPE:'ma-six-bug-preventive-20260930'},stdio:['pipe','pipe','pipe']});
assert.equal(sql('select scope from ma_isolated_guard.identity'),'ma-six-bug-preventive-20260930');
const read=p=>readFileSync(root+p,'utf8');
const migration=read('supabase/migrations/20260930080719_recorder_retry_projection_parity_v1.sql');
const changed=['project_critical_sql_input_v1','critical_sql_replay_inputs_v1','record_critical_contract_evidence_v1'];
const catalog=()=>sql(`select jsonb_agg(jsonb_build_object('name',oid::regprocedure::text,'owner',proowner,'acl',proacl,'security',prosecdef,'config',proconfig,'defaults',proargdefaults::text) order by oid) from pg_proc where pronamespace='public'::regnamespace`);
const business=()=>sql(`select jsonb_agg(jsonb_build_array(oid::regprocedure::text,md5(pg_get_functiondef(oid))) order by oid) from pg_proc where pronamespace='public'::regnamespace and prokind='f' and proname not in (${changed.map(q).join(',')})`);
const policies=()=>sql("select jsonb_agg(to_jsonb(p) order by tablename,policyname) from pg_policies p where schemaname='public'");
const before={catalog:catalog(),business:business(),policies:policies()};
const checkpoint='premarket_readiness_retry_0845',first='10000000-0000-4000-8000-000000000001',second='10000000-0000-4000-8000-000000000002';
const sourceState={trading_date:'2026-09-30',current_state:'SCHEDULED',state_rank:0,
 checkpoint_status:{[checkpoint]:{status:'SCHEDULED',correlation_id:first}},last_correlation_id:first,last_metadata:{}};
assert.equal(JSON.parse(sql(`select public.project_critical_sql_input_v1(${j(sourceState)})`)).checkpoint_status[checkpoint],undefined);
sql(migration);
assert.equal(catalog(),before.catalog);assert.equal(business(),before.business);assert.equal(policies(),before.policies);
assert.equal(sql('select count(*) from reports'),'0');assert.equal(sql('select count(*) from market_checkpoint_snapshots'),'0');
assert.deepEqual(JSON.parse(sql(`select public.project_critical_sql_input_v1(${j(sourceState)})`)),sourceState);
assert.equal(sql("select has_function_privilege('anon','record_critical_contract_evidence_v1(date,text,jsonb)','EXECUTE')"),'f');
assert.equal(sql("select has_table_privilege('authenticated','production_critical_contract_evidence','INSERT')"),'f');
assert.throws(()=>sql(migration),/PREDECESSOR_MISMATCH/);
if(process.argv.includes('--bootstrap-only')){
 console.log(JSON.stringify({fresh_database:db,bootstrap:'PASS',business_unchanged:true,production_writes:0}));process.exit(0);
}
sql(read('tests/fixtures/six-bug-loopback-transport.sql'));
const afterTransportBusiness=business();
sql(`insert into data_provider_health(provider,service_date,phase,checkpoint,status,success_rate,last_error_code,details)
 values('market_fetch_v10','2026-09-30','premarket','premarket','down',0,'PROVIDER_HTTP_5XX','{"retry_entry_state":"WAITING_FOR_PROVIDER_DATA"}');`);
// Both normal and duplicate schedules go through the real durable dispatch
// and Lifecycle RPC. Inputs are explicitly SYNTHETIC_CONTROL, not raw history.
// A single transaction freezes PostgreSQL now() for strict timestamp equality
// on stock CI PostgreSQL too. Each Replay subtransaction is rolled back; it
// restores only recorded INPUTS and invokes the unchanged actual Lifecycle RPC.
sql(`do $test$declare v_checkpoint text; v_attempt integer; r public.production_critical_contract_evidence;
 args jsonb; original jsonb; actual jsonb; count_before integer;
begin
 foreach v_checkpoint in array array[${RETRY_CHECKPOINTS.map(q).join(',')}] loop
  for v_attempt in 1..2 loop
   if v_attempt=2 then
    perform public.ma_local_record_response(d.request_id,200,'{"success":false,"status":"FAILED"}') from runtime_http_dispatches d where d.checkpoint=v_checkpoint;
    perform public.reconcile_runtime_http_dispatches_v1();
   end if;
   perform public.dispatch_morning_alpha_runtime_v1('2026-09-30','daily_delivery',v_checkpoint,'{"phase":"watchdog","readiness_retry":true}',false,'2026-09-30T08:45:00+08:00');
   select * into strict r from production_critical_contract_evidence where capsule#>>'{args,p_checkpoint}'=v_checkpoint and (capsule#>>'{retry_attempt,attempt}')::integer=v_attempt;
   args:=r.capsule->'args';
   original:=r.capsule-array['capture_origin','source_event_id','recorder_projection_version','source_correlation_id','retry_attempt'];
   if public.record_critical_contract_evidence_v1('2026-09-30','LIFECYCLE',original)<>r.id then raise exception 'SOURCE_EVENT_DUPLICATED';end if;
   select count(*) into count_before from production_critical_contract_evidence;
   begin
    perform set_config('morning_alpha.recorder_execution_origin','REPLAY',true);
    if public.record_critical_contract_evidence_v1('2026-09-30','LIFECYCLE',original) is not null then raise exception 'REPLAY_RECORDED_AS_SOURCE';end if;
    delete from trading_day_state where trading_date='2026-09-30';
    insert into trading_day_state select * from jsonb_populate_recordset(null::trading_day_state,r.capsule#>'{database_inputs,tables,trading_day_state}');
    actual:=public.project_critical_sql_input_v1(to_jsonb(public.advance_trading_day_state_v1((args->>'p_trading_date')::date,args->>'p_state',args->>'p_checkpoint',args->>'p_status',(args->>'p_correlation_id')::uuid,args->'p_metadata')));
    if actual is distinct from r.capsule->'expected' then raise exception 'EXACT_REPLAY_DIFF:%:%',v_checkpoint,v_attempt;end if;
    if (select count(*) from production_critical_contract_evidence)<>count_before then raise exception 'REPLAY_APPENDED_SOURCE';end if;
    raise exception using errcode='ZZ001',message='CONTROLLED_REPLAY_ROLLBACK';
   exception when sqlstate 'ZZ001' then null;end;
  end loop;
 end loop;
end;$test$;`);
const rows=JSON.parse(sql('select jsonb_agg(to_jsonb(r) order by capsule#>>\'{args,p_checkpoint}\',capsule#>>\'{retry_attempt,attempt}\') from production_critical_contract_evidence r'));
const results=rows.map(row=>{
 const checkpoint=row.capsule.args.p_checkpoint,attempt=row.capsule.retry_attempt.attempt;
 assert.equal(row.capsule.retry_attempt.checkpoint,checkpoint);
 assert.equal(row.capsule.source_correlation_id,row.capsule.args.p_correlation_id);
 assert.equal(row.capsule.retry_attempt.attempt_kind,checkpoint.endsWith('0845')?'FINAL_DEADLINE_ATTEMPT':'READINESS_RETRY_ATTEMPT');
 assert.equal(row.capsule.retry_attempt.deadline_state,checkpoint.endsWith('0845')?'AT_FINAL_DEADLINE':'BEFORE_FINAL_DEADLINE');
 assert.deepEqual(row.capsule.retry_attempt.failure_classification,{primary_code:'PROVIDER_HTTP_5XX',retry_entry_state:'WAITING_FOR_PROVIDER_DATA'});
 assert.equal(row.capsule.capture_origin,'SHADOW_CAPTURE');
 if(attempt===2)assert(row.capsule.database_inputs.tables.trading_day_state[0].checkpoint_status[checkpoint]);
 assert.equal(recorderReplayIdentity(row,randomUUID()).capture_origin,'REPLAY');
 return {checkpoint,attempt,checkpoint_diff:0,correlation_diff:0,failure_reason_diff:0,deadline_state_diff:0};
});
assert.equal(results.length,26);
assert.equal(sql('select count(*) from production_critical_contract_evidence'),String(results.length));
assert.equal(sql('select public.cleanup_expired_critical_contract_evidence_v1(1000)'),'0');
assert.equal(sql('select count(*) from production_critical_contract_evidence'),String(results.length));
for(const input of [{Authorization:'Bearer synthetic-forbidden'}, {email:'isolated@example.invalid'}]) {
 assert.equal(sql(`select public.record_critical_contract_evidence_v1('2026-09-30','RESEARCH',${j({contract_version:'CRITICAL_CONTRACT_REPLAY_V1',input,expected:{status:'BLOCKED'}})})`),'');
}
// Storage-side failure must stay fail-open and may not affect the real RPC.
sql(`begin;alter table production_critical_contract_evidence add constraint local_recorder_unavailable check(false) not valid;
 do $failure$begin
  perform public.advance_trading_day_state_v1('2026-09-30','SCHEDULED','premarket','SCHEDULED',null,'{}');
  if (select count(*) from production_critical_contract_evidence)<>26 then raise exception 'FAILED_RECORDER_INSERTED';end if;
 end;$failure$;rollback;`);
assert.throws(()=>sql("update production_critical_contract_evidence set stage='LEARNING'"),/APPEND_ONLY/);
assert.throws(()=>sql('delete from production_critical_contract_evidence'),/APPEND_ONLY/);
assert.equal(sql("select bool_and(retention_until=recorded_at+interval '90 days') from production_critical_contract_evidence"),'t');
const newest=JSON.parse(sql('select to_jsonb(r) from production_critical_contract_evidence r order by recorded_at desc limit 1'));
const old=structuredClone(newest);delete old.capsule.database_inputs.recorder_projection_version;
assert.equal(recorderReplayIdentity(old,randomUUID()).replay_status,'LEGACY_RECORDER_PROJECTION_INCOMPLETE');
assert.equal(business(),afterTransportBusiness);assert.equal(policies(),before.policies);
console.log(JSON.stringify({fresh_database:db,retry_captures:results.length,results,deterministic:'100%',business_unchanged:true,acl_unchanged:true,history_backfill:0,production_writes:0}));

// Restore only recorded read-set inputs in a NEW local DB, preserving all
// database constraints/triggers. Never obtain expected output from the fixture
// to drive a business function. No generated result is used as a substitute.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
const root=fileURLToPath(new URL('../../',import.meta.url));
assert.equal(process.env.MA_LOCAL_SCOPE,'ma-six-bug-preventive-20260930');
const source=process.env.MA_REPLAY_SOURCE_DB||'ma_six_bug_test2',target=process.env.MA_REPLAY_TARGET_DB||'ma_six_bug_test100';
assert.match(source,/^ma_six_bug_test\d+$/);assert.match(target,/^ma_six_bug_test1\d\d$/);
assert.notEqual(source,target);
const q=v=>`'${String(v).replaceAll("'","''")}'`,j=v=>q(JSON.stringify(v))+'::jsonb';
const sql=(db,input)=>{try{return execFileSync('docker',['exec','-i','ma-six-bug-shadow-db','psql','-X','-q','-U','postgres','-d',db,'-At','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',timeout:30000,maxBuffer:6e6,stdio:['pipe','pipe','pipe']}).trim();}catch{throw Error('ISOLATED_SQL_OPERATION_FAILED');}};
const migration=readFileSync(root+'/supabase/migrations/20260930043122_six_bug_preventive_closure_v1.sql','utf8');
// Refresh only candidate observability projection in the LOCAL source before
// capturing this test's actual SQL calls. Business gates stay unchanged.
const projection=migration.slice(migration.indexOf('create or replace function public.project_critical_sql_input_v1'),migration.indexOf('-- Instrument the exact reviewed SQL bodies'));
sql(source,projection);
writeFileSync(root+'/node_modules/.ma-six-clock','2026-09-30 07:35:00\n');
const marker='SIX_BUG_SQL_REPLAY_'+target;
const existing=process.argv.includes('--existing');
if(!existing)sql(source,`select public.advance_trading_day_state_v1('2026-09-30','HEALTH_AUDITED','closing_health','SUCCEEDED',null,${j({source:marker})});`);
sql(source,`select public.capture_morning_alpha_acceptance_v1('2026-09-30',${q(marker)});`);
const capsules=JSON.parse(sql(source,`select jsonb_agg(to_jsonb(r)) from (select id,stage,capsule from production_critical_contract_evidence where ${existing?"capsule ? 'sql_signature'":`capsule#>>'{args,p_evaluator_version}'=${q(marker)} or capsule#>>'{args,p_metadata,source}'=${q(marker)}`} order by stage,recorded_at,id)r`));
assert(capsules.length>=2);
assert.equal(sql('postgres',`select count(*) from pg_database where datname=${q(target)}`),'0');
sql('postgres',`create database ${target} template ma_six_bug_test3`);
sql(target,projection);
const order=['runtime_quality_policies','research_sessions','reports','decision_snapshots','pipeline_runs','member_content_revisions','semantic_coherence_reviews','editorial_reviews','ma_ops_runs','content_os_sync_incidents','learning_runs','learning_predictions','prediction_outcomes','runtime_http_dispatches','runtime_dead_letters','ma_ops_recovery_actions','market_checkpoint_batches','market_checkpoint_snapshots','market_data_snapshots','trading_day_state','line_delivery_outbox'];
const results=[];
for(const row of capsules){
 const cap=row.capsule,tables=cap.database_inputs.tables;
 writeFileSync(root+'/node_modules/.ma-six-clock',new Date(cap.database_inputs.observed_at).toISOString().replace('T',' ').slice(0,23)+'\n');
 let command='begin;set constraints all deferred;';
 // The target is a disposable input-only clone, never a reused business DB.
 command+='truncate '+order.map(t=>'public.'+t).join(',')+' cascade;';
 for(const table of order){
  const records=structuredClone(tables[table]||[]);if(!records.length)continue;
  if(table==='line_delivery_outbox')for(const [index,r]of records.entries()){
   const ordinal=String(r.group_index).padStart(12,'0');
   const id='00000000-0000-4000-8000-'+ordinal;
   command+=`insert into line_subscribers(id,line_user_id,is_active) values(${q(id)},${q('U_REPLAY_GROUP_'+ordinal)},true) on conflict do nothing;`;
   r.line_subscriber_id=id;r.line_user_id='U_REPLAY_GROUP_'+ordinal;r.idempotency_key='local-replay:'+index;delete r.group_index;
  }
  const columns=Object.keys(records[0]);assert(columns.every(x=>/^[a-z0-9_]+$/.test(x)));
  command+=`insert into public.${table}(${columns.join(',')}) overriding system value select ${columns.join(',')} from jsonb_populate_recordset(null::public.${table},${j(records)});`;
 }
 const args=cap.args;
 if(row.stage==='LIFECYCLE'){
  const invocation=`public.advance_trading_day_state_v1(${q(args.p_trading_date)},${q(args.p_state)},${q(args.p_checkpoint)},${q(args.p_status)},${args.p_correlation_id?q(args.p_correlation_id):'null'},${j(args.p_metadata)})`;
  if(cap.expected.sqlstate){
   command+=`create temporary table replay_failure(result jsonb);do $replay$declare s text;m text;begin begin perform ${invocation};exception when others then get stacked diagnostics s=returned_sqlstate,m=message_text;insert into replay_failure values(jsonb_build_object('sqlstate',s${cap.expected.failure_reason?",'failure_reason',public.project_critical_sql_input_v1(to_jsonb(m))":''}));end;end$replay$;select result from replay_failure;`;
  }else command+=`select public.project_critical_sql_input_v1(to_jsonb(${invocation}));`;
 }else if(row.stage==='PUBLICATION'){
  command+=`select public.validate_core_market_publication_v1(${q(args.p_report_date)},${['p_ai','p_decision','p_contract','p_member','p_semantic'].map(k=>j(args[k])).join(',')});`;
 }else{
  command+=`select public.capture_morning_alpha_acceptance_v1(${q(args.p_business_date)},${q(args.p_evaluator_version)});select jsonb_build_object('verdict',verdict,'blocking_checks',blocking_checks) from production_acceptance_results where business_date=${q(args.p_business_date)} order by evaluated_at desc limit 1;`;
 }
 command+='rollback;';
 let output;try{output=sql(target,command);}catch{throw Error('SQL_CAPSULE_REPLAY_FAILED:'+row.stage);}
 const actual=JSON.parse(output.split('\n').at(-1));
 // Never expose replay payloads through assertion diagnostics.
 if(!isDeepStrictEqual(actual,cap.expected)&&row.stage==='ACCEPTANCE')console.error(JSON.stringify({stage:row.stage,
  expected_verdict:cap.expected.verdict,actual_verdict:actual.verdict,missing_reason_codes:cap.expected.blocking_checks.filter(x=>!actual.blocking_checks.includes(x)),
  extra_reason_codes:actual.blocking_checks.filter(x=>!cap.expected.blocking_checks.includes(x))}));
 assert(isDeepStrictEqual(actual,cap.expected),'SQL_CAPSULE_CONTRACT_DIFF:'+row.stage);
 results.push({stage:row.stage,evidence_id:row.id,result:'DETERMINISTIC',constraints:'UNCHANGED'});
}
writeFileSync('/tmp/ma-six-sql-replay.json',JSON.stringify({source,target,results,production_writes:0},null,2));console.log(JSON.stringify({results,production_writes:0}));

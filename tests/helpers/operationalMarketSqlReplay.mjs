// Replay captured SQL read sets in a NEW local isolation database, with all
// actual constraints, functions and triggers. Original production is untouched.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
const root=new URL('../../',import.meta.url);
assert.equal(process.env.MA_OPERATIONAL_SCOPE,'operational-market-20261001');
const source=process.env.MA_REPLAY_SOURCE_DB,target=process.env.MA_ISOLATED_TEST_DB;
for(const db of [source,target])assert.match(db||'',/^ma_six_bug_test5\d\d$/);assert.notEqual(source,target);
const q=v=>`'${String(v).replaceAll("'","''")}'`,j=v=>q(JSON.stringify(v))+'::jsonb';
const sql=(db,input)=>execFileSync('docker',['exec','-i','ma-six-bug-shadow-db','psql','-X','-q','-U','postgres','-d',db,'-At','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',timeout:30000,maxBuffer:12e6,stdio:['pipe','pipe','pipe']}).trim();
for(const db of [source,target])assert.equal(sql(db,'select scope from ma_isolated_guard.identity'),'ma-six-bug-preventive-20260930');
assert.equal(sql(target,'select count(*) from reports'),'0');
const capsules=JSON.parse(sql(source,"select jsonb_agg(jsonb_build_object('id',id,'stage',stage,'capsule',capsule) order by recorded_at,id) from production_critical_contract_evidence where capsule ? 'sql_signature'"));
// Published-report insert guard now also rechecks its immutable core proof.
// Restore that recorded dependency first; never disable the guard for Replay.
const order=['runtime_quality_policies','research_sessions','market_checkpoint_batches','market_checkpoint_snapshots','market_data_snapshots','reports','decision_snapshots','pipeline_runs','member_content_revisions','semantic_coherence_reviews','editorial_reviews','ma_ops_runs','content_os_sync_incidents','learning_runs','learning_predictions','prediction_outcomes','runtime_http_dispatches','runtime_dead_letters','ma_ops_recovery_actions','trading_day_state','line_delivery_outbox'];
const results=[];
for(const row of capsules){
 const cap=row.capsule,tables=cap.database_inputs.tables;
 writeFileSync(new URL('node_modules/.ma-six-clock',root),new Date(cap.database_inputs.observed_at).toISOString().replace('T',' ').slice(0,23)+'\n');
 let command="begin;set constraints all deferred;set local morning_alpha.recorder_execution_origin='REPLAY';";
 command+='truncate '+order.map(t=>'public.'+t).join(',')+' cascade;';
 for(const table of order){
  const records=structuredClone(tables[table]||[]);if(!records.length)continue;
  if(table==='decision_snapshots'){
   // Restore immutable revisions in their original order. The production
   // insert guard compares against that revision's report input, not N+1.
   // Use the separately recorded PUBLICATION input; never invent a PASS or
   // disable a trigger. Restore the captured current report after insertion.
   for(const record of records.sort((a,b)=>a.version-b.version)){
    if(record.session_type==='PREMARKET'&&record.status==='READY'){
     const publication=capsules.find(c=>c.stage==='PUBLICATION'
      && c.capsule.args.p_report_date===record.report_date
      && c.capsule.args.p_decision.generated_text?.canonical_market_state?.generated_at===record.generated_text?.canonical_market_state?.generated_at);
     assert(publication,'RECORDED_REVISION_INPUT_REQUIRED');
     command+=`update reports set ai_strategy_json=${j(publication.capsule.args.p_ai)} where id=${q(record.report_id)};`;
    }
    const columns=Object.keys(record);assert(columns.every(k=>/^[a-z0-9_]+$/.test(k)));
    command+=`insert into decision_snapshots(${columns.join(',')}) overriding system value select ${columns.join(',')} from jsonb_populate_record(null::decision_snapshots,${j(record)});`;
   }
   for(const report of tables.reports||[])command+=`update reports set ai_strategy_json=${j(report.ai_strategy_json)} where id=${q(report.id)};`;
   continue;
  }
  if(table==='line_delivery_outbox')for(const [index,r]of records.entries()){
   const ordinal=String(r.group_index).padStart(12,'0'),id='00000000-0000-4000-8000-'+ordinal;
   command+=`insert into line_subscribers(id,line_user_id,is_active) values(${q(id)},${q('U_OPERATIONAL_REPLAY_'+ordinal)},true) on conflict do nothing;`;
   r.line_subscriber_id=id;r.line_user_id='U_OPERATIONAL_REPLAY_'+ordinal;r.idempotency_key='local-replay:'+index;delete r.group_index;
  }
  const columns=Object.keys(records[0]);assert(columns.every(k=>/^[a-z0-9_]+$/.test(k)));
  command+=`insert into public.${table}(${columns.join(',')}) overriding system value select ${columns.join(',')} from jsonb_populate_recordset(null::public.${table},${j(records)});`;
 }
 const args=cap.args;
 if(row.stage==='PUBLICATION')command+=`select validate_core_market_publication_v1(${q(args.p_report_date)},${['p_ai','p_decision','p_contract','p_member','p_semantic'].map(k=>j(args[k])).join(',')});`;
 else if(row.stage==='LIFECYCLE'){
  const invoke=`advance_trading_day_state_v1(${q(args.p_trading_date)},${q(args.p_state)},${q(args.p_checkpoint)},${q(args.p_status)},${args.p_correlation_id?q(args.p_correlation_id):'null'},${j(args.p_metadata)})`;
  if(cap.expected.sqlstate)command+=`create temporary table replay_failure(result jsonb);do $replay$declare s text;m text;begin begin perform ${invoke};exception when others then get stacked diagnostics s=returned_sqlstate,m=message_text;insert into replay_failure values(jsonb_build_object('sqlstate',s${cap.expected.failure_reason?",'failure_reason',public.project_critical_sql_input_v1(to_jsonb(m))":''}));end;end$replay$;select result from replay_failure;`;
  else command+=`select project_critical_sql_input_v1(to_jsonb(${invoke}));`;
 }else if(row.stage==='ACCEPTANCE'){
  const dimensions=Object.hasOwn(cap.expected,'service_available')?",'service_available',evidence->'service_available','acceptance_dimensions',evidence->'acceptance_dimensions'":'';
  command+=`select capture_morning_alpha_acceptance_v1(${q(args.p_business_date)},${q(args.p_evaluator_version)});select jsonb_build_object('verdict',verdict,'blocking_checks',blocking_checks${dimensions}) from production_acceptance_results where business_date=${q(args.p_business_date)} order by evaluated_at desc limit 1;`;
 }else throw Error('UNKNOWN_SQL_STAGE');
 command+='rollback;';
 let actual;try{actual=JSON.parse(sql(target,command).split('\n').at(-1));}catch(error){
  console.error(String(error.stderr||error.message).split('\n').filter(line=>line.startsWith('ERROR:')).join('\n'));
  throw Error('SQL_REPLAY_EXECUTION_FAILED:'+row.stage+':'+row.id);
 }
 if(!isDeepStrictEqual(actual,cap.expected))console.log(JSON.stringify({id:row.id,stage:row.stage,expected:cap.expected,actual}));
 assert(isDeepStrictEqual(actual,cap.expected),'SQL_CONTRACT_DIFF:'+row.stage);
 results.push({id:row.id,stage:row.stage,deterministic:true});
}
writeFileSync('/tmp/ma-operational-sql-replay.json',JSON.stringify({source,target,results,production_writes:0},null,2));
console.log(JSON.stringify({sql_capsules:results.length,contract_diff:0,production_writes:0}));

// Opt-in integration test: local isolated PostgreSQL only, never Supabase.
// Bootstrap tests/fixtures/core-research-{schema,publish-baseline}.sql, then the
// candidate migration. Run: node --test tests/researchPipelineDatabase.integration.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
const exec = promisify(execFile);
const bin = process.env.MA_TEST_PSQL || 'psql';
const database=process.env.MA_ISOLATED_TEST_DB;
if(!/^ma_core_test\d+$/.test(database||''))throw new Error('Fresh isolated MA_ISOLATED_TEST_DB=ma_core_test<number> required');
const args = ['-X','-h','127.0.0.1','-p','55439','-d',database,'-A','-t','-v','ON_ERROR_STOP=1'];
const quote = (value) => `'${String(value).replaceAll("'","''")}'`;
const json = (value) => `${quote(JSON.stringify(value))}::jsonb`;
async function sql(text){ return (await exec(bin,[...args,'-c',text],{timeout:15000})).stdout.trim(); }
const date='2026-09-07';
const fp = (digit) => digit.repeat(64);
async function claim(fingerprint,correlation,dateOverride=date){
  return JSON.parse(await sql(`select public.claim_research_input_v1(${quote(dateOverride)},${quote(fingerprint)},${quote(correlation)},'test-engine','isolated-test','{"source":"isolated-fixture","missing_sources":[],"market_count":3,"news_count":1,"sector_count":1}');`));
}
async function finish(row,correlation,outcome='DEGRADED',retry=null){
  return sql(`select public.finish_research_input_v1(${quote(row.run_id)},${quote(correlation)},${quote(outcome)},'{"success":false,"error_code":"FIXTURE_QUALITY_REJECTED"}',${retry??'null'});`);
}
function bundle(run,correlation,fingerprint,overrides={}){
  const sentence='鴻海營收事件需要由盤中確認';
  const quality={publish_status:'ready',evidence_coverage:100,unsupported_claims:[],duplicate_claims:[],contradictions:[],missing_sections:[]};
  const report={report_date:date,summary:sentence,today_summary:sentence,today_quote:sentence,
    ai_strategy_json:{data_quality:'complete',research_master_v2:{quality},line_push_copy:{one_sentence:sentence}}};
  const decision={input_fingerprint:fingerprint,report_mode:'normal_overnight',is_trading_day:true,market_status:'OPEN',data_as_of:'2026-09-07T07:00:00+08:00',engine_version:'test-engine',decision_mode:'recommendations',content_score:100,content_grade:'high_quality',action:'SELECTIVE',generated_text:{daily_sentence:sentence,recommendations:[{symbol:'2317'}]}};
  const contract={report_date:date,snapshot_id:correlation,snapshot_version:1};
  const member={today_core_thesis:sentence,line_summary:sentence};
  const semantic={status:'PASSED',eligible:true,reason_codes:[],gate_version:'ISOLATED_TEST'};
  const all={report,decision,contract,member,semantic,...overrides};
  return `select public.publish_research_bundle_v1(${quote(run.run_id)},${quote(correlation)},${json(all.report)},${json(all.decision)},${json(all.contract)},${json(all.member)},${json(all.semantic)});`;
}

test('isolated DB: upgrade preserves Production RPC signatures/security and reproduces service-only grants',async()=>{
  const contracts=[
    ['claim_research_input_v1(date,text,uuid,text,text,jsonb)','jsonb',false],
    ['finish_research_input_v1(uuid,uuid,text,jsonb,integer)','boolean',false],
    ['publish_research_bundle_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb)','jsonb',false],
    ['reconcile_runtime_terminal_failures_v1(date,uuid)','integer',true],
    ['capture_morning_alpha_acceptance_v1(date,text)','uuid',true],
    ['reconcile_runtime_http_dispatches_v1(integer)','TABLE(dispatch_id uuid, dispatch_status text, http_status integer, error_code text)',true],
  ];
  for(const [signature,resultType,definer] of contracts){
    const row=JSON.parse(await sql(`select json_build_object('result',pg_get_function_result(p.oid),'definer',p.prosecdef,
      'anon',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),
      'service',has_function_privilege('service_role',p.oid,'EXECUTE')) from pg_proc p where p.oid='public.${signature}'::regprocedure;`));
    assert.deepEqual(row,{result:resultType,definer,anon:false,authenticated:false,service:true},signature);
  }
});

test('isolated DB: leases, tenfold/concurrent dedup, changed input, atomic rollback, LINE immutability and privileges',async()=>{
  // Assertions run against the actual RPCs, not a JS Map pretending to be locks.
  const owner=randomUUID(); const first=await claim(fp('a'),owner);
  assert.equal(first.status,'ACQUIRED');
  const concurrent=await Promise.all(Array.from({length:10},()=>claim(fp('a'),randomUUID())));
  assert.ok(concurrent.every(row=>row.status==='IN_PROGRESS'));
  assert.equal(await sql("select count(*) from public.pipeline_runs where idempotency_key like 'research-input:%';"),'1');
  assert.equal(await finish(first,owner),'t');
  for(let i=0;i<10;i++)assert.equal((await claim(fp('a'),randomUUID())).status,'REUSED');

  const timeoutOwner=randomUUID(); const timeout=await claim(fp('b'),timeoutOwner);
  assert.equal(timeout.status,'ACQUIRED');
  await finish(timeout,timeoutOwner,'FAILED',30);
  assert.equal((await claim(fp('b'),randomUUID())).status,'BACKOFF');
  // Advance only isolated retry fixture, never wall-clock replay in Production.
  await sql(`update public.pipeline_runs set next_retry_at=now()-interval '1 second' where id=${quote(timeout.run_id)};`);
  const nextOwner=randomUUID(); const recovered=await claim(fp('b'),nextOwner);
  assert.equal(recovered.attempt,2);
  await finish(recovered,nextOwner);
  assert.equal(await sql(`select jsonb_array_length(provider_status->'attempt_history') from public.pipeline_runs where id=${quote(timeout.run_id)}`),'1');

  const owner2=randomUUID(); const changed=await claim(fp('c'),owner2);
  assert.equal(changed.status,'ACQUIRED');
  await assert.rejects(sql(bundle(changed,owner2,fp('c'),{semantic:{status:'BLOCKED',eligible:false,reason_codes:['PRIMARY_THESIS_DIVERGENCE']}})),/PUBLICATION_GATE_BLOCKED/);
  assert.equal(await sql('select count(*) from public.reports;'),'0');
  assert.equal(await sql('select count(*) from public.decision_snapshots;'),'0');

  await sql("create function public.test_member_failure() returns trigger language plpgsql as $$ begin raise exception 'ISOLATED_MEMBER_FAILURE'; end $$; create trigger test_member_failure before insert on public.member_content_revisions for each row execute function public.test_member_failure();");
  await assert.rejects(sql(bundle(changed,owner2,fp('c'))),/ISOLATED_MEMBER_FAILURE/);
  assert.equal(await sql('select count(*) from public.reports;'),'0');
  assert.equal(await sql('select count(*) from public.decision_snapshots;'),'0');
  await sql('drop trigger test_member_failure on public.member_content_revisions;');
  await sql("insert into public.line_delivery_outbox(report_date,line_subscriber_id,line_user_id,push_type,idempotency_key,status,sent_at,payload) values('2026-09-07',gen_random_uuid(),'isolated-non-deliverable','data_incident','isolated-line','SENT','2026-09-07T07:30:00+08:00','{\"fixture\":true}');");
  const before=await sql('select jsonb_agg(to_jsonb(o) order by id)::text from public.line_delivery_outbox o;');
  const published=JSON.parse(await sql(bundle(changed,owner2,fp('c'))));
  assert.equal(published.success,true);
  const reused=await claim(fp('c'),randomUUID()); assert.equal(reused.status,'REUSED'); assert.equal(reused.outcome,'SUCCEEDED');
  assert.equal(await sql('select count(*) from public.decision_snapshots;'),'1');
  assert.equal(await sql('select count(*) from public.member_content_revisions;'),'1');
  assert.equal(await sql('select jsonb_agg(to_jsonb(o) order by id)::text from public.line_delivery_outbox o;'),before);
  assert.equal(await sql("select r.ai_strategy_json->>'revision_id'=d.id::text and m.decision_snapshot_id=d.id and r.today_quote=m.member_content->>'today_core_thesis' from public.reports r join public.decision_snapshots d on d.report_id=r.id join public.member_content_revisions m on m.report_id=r.id;"),'t');

  const newerOwner=randomUUID(); const newer=await claim(fp('d'),newerOwner);
  await assert.rejects(sql(bundle(newer,newerOwner,fp('d'),{semantic:{status:'BLOCKED'}})),/PUBLICATION_GATE_BLOCKED/);
  assert.equal(await sql('select count(*) from public.decision_snapshots where is_current;'),'1');
  assert.equal(await sql('select id from public.decision_snapshots where is_current;'),published.decision_snapshot_id);
  await finish(newer,newerOwner);
  const crossOwner=randomUUID(); const cross=await claim(fp('e'),crossOwner,'2026-09-08');
  await assert.rejects(sql(bundle(cross,crossOwner,fp('e'))),/RESEARCH_LEASE_LOST/);
  await finish(cross,crossOwner);
  const expiredOwner=randomUUID(); const expired=await claim(fp('f'),expiredOwner);
  await sql(`update public.pipeline_runs set provider_status=jsonb_set(provider_status,'{lease_expires_at}',to_jsonb((now()-interval '1 second')::text)) where id='${expired.run_id}';`);
  const replacementOwner=randomUUID();const replacement=await claim(fp('f'),replacementOwner);
  assert.equal(replacement.attempt,2);
  await assert.rejects(sql(bundle(expired,expiredOwner,fp('f'))),/RESEARCH_LEASE_LOST/);
  await finish(replacement,replacementOwner,'FAILED',1);
  await sql(`update public.pipeline_runs set next_retry_at=now()-interval '1 second' where id='${expired.run_id}';`);
  const thirdOwner=randomUUID();const third=await claim(fp('f'),thirdOwner);assert.equal(third.attempt,3);
  await finish(third,thirdOwner,'FAILED',1);
  assert.equal((await claim(fp('f'),randomUUID())).status,'EXHAUSTED');
  assert.equal(await sql("select has_function_privilege('anon','public.publish_research_bundle_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb)','execute');"),'f');
  assert.equal(await sql("select has_function_privilege('authenticated','public.claim_research_input_v1(date,text,uuid,text,text,jsonb)','execute');"),'f');
});
test('isolated DB: HTTP 200 business failure, quality 409, bounded in-progress and transient retry',async()=>{
  const cases=[
    [200,{success:false,error_code:'DELIVERY_GATE_BLOCKED'},'FAILED',false],
    [409,{success:false,error_code:'RESEARCH_QUALITY_REJECTED'},'FAILED',false],
    [409,{success:false,error_code:'RESEARCH_IN_PROGRESS'},'FAILED',true],
    [429,{success:false,error_code:'RATE_LIMIT'},'FAILED',true],
    [500,{success:false,error_code:'UPSTREAM_TIMEOUT'},'FAILED',true],
    [200,{success:true},'SUCCEEDED',false],
    [200,{},'FAILED',false],
  ];
  for(const [index,[http,payload,status,retry]] of cases.entries()){
    const id=randomUUID(),request=1000+index;
    await sql(`insert into net._http_response values(${request},${http},${quote(JSON.stringify(payload))},false,null);
      insert into public.runtime_http_dispatches(id,trading_date,job_name,checkpoint,endpoint,idempotency_key,dispatch_status,request_id,lease_expires_at)
      values('${id}','2026-09-07','isolated_http','PREMARKET','isolated','isolated-http-${index}','DISPATCHED',${request},now()+interval '5 minutes');`);
    await sql('select * from public.reconcile_runtime_http_dispatches_v1(100);');
    const row=JSON.parse(await sql(`select json_build_object('status',dispatch_status,'retry',next_retry_at is not null,'payload',response_body) from public.runtime_http_dispatches where id='${id}';`));
    assert.equal(row.status,status);assert.equal(row.retry,retry);assert.deepEqual(row.payload,payload);
  }
});
test('isolated DB: append-only full-chain acceptance, same revision, incident vs report, safe reconciliation',async()=>{
  const historical='2026-09-04';
  // Move only this isolated fixture to a past trading day to exercise the real
  // afternoon branch without changing clocks or introducing a Production override.
  await sql(`update public.reports set report_date='${historical}';
    update public.decision_snapshots set report_date='${historical}';
    update public.research_sessions set trading_date='${historical}',data_as_of='${historical}T07:00:00+08:00';
    update public.member_content_revisions set report_date='${historical}';
    update public.semantic_coherence_reviews set report_date='${historical}';
    update public.pipeline_runs set trading_date='${historical}' where status='SUCCEEDED';
    update public.line_delivery_outbox set report_date='${historical}';`);
  const snapshot=await sql("select id from public.decision_snapshots where is_current;");
  const report=await sql("select id from public.reports;");
  async function capture(day=historical){
    const id=await sql(`select public.capture_morning_alpha_acceptance_v1('${day}','ISOLATED_ACCEPTANCE');`);
    return JSON.parse(await sql(`select row_to_json(a) from public.production_acceptance_results a where id=${quote(id)};`));
  }
  const before=await capture();
  assert.equal(before.verdict,'FAIL');
  assert.ok(before.blocking_checks.includes('NORMAL_REPORT_LINE_NOT_COMPLETE'));
  assert.equal(before.evidence.automatic_stable_day,false);
  const checkpointIds=Object.fromEntries(['0900','0930','1030','1300','1410','1430'].map(k=>[k,randomUUID()]));
  const checkpoints=Object.fromEntries(Object.entries(checkpointIds).map(([k,id])=>[k,{
    status:'SUCCEEDED',updated_at:historical+'T14:30:00+08:00',correlation_id:id,metadata:{core_batch_complete:true},
  }]));
  const premarketCorrelation=randomUUID();
  checkpoints.premarket={status:'SUCCEEDED',correlation_id:premarketCorrelation,metadata:{core_batch_complete:true}};
  const closing={status:'completed',data_status:'complete',report_date:historical,opening_decision_snapshot_id:snapshot,verified_at:historical+'T14:31:00+08:00',
    ...Object.fromEntries(['actual_taiex_close','actual_2330_close','actual_txf_close'].map(key=>[key,{value:100,change_percent:1,source:'isolated',captured_at:historical+'T13:30:00+08:00'}]))};
  await sql(`update public.reports set ai_strategy_json=ai_strategy_json||jsonb_build_object('closing_verification_v2',${json(closing)});
    insert into public.trading_day_state(trading_date,current_state,state_rank,checkpoint_status) values('${historical}','DAY_COMPLETED',150,${json(checkpoints)});
    insert into public.ma_ops_runs(check_type,status,severity,completed_at,details_json) values
      ('report','passed','info',now(),${json({target_date:historical})}),('closing','passed','info',now(),${json({target_date:historical})});
    insert into public.line_delivery_outbox(report_date,decision_snapshot_id,line_subscriber_id,line_user_id,push_type,idempotency_key,status,sent_at,payload)
      values('${historical}',${quote(snapshot)},gen_random_uuid(),'isolated-not-a-user','daily_report','isolated-daily','SENT','${historical}T07:30:00+08:00','{"fixture":true}');`);
  for(const [checkpoint,id] of Object.entries(checkpointIds)){
    for(const symbol of ['TAIEX','2330','TXF']){
    await sql(`insert into public.market_checkpoint_snapshots(checkpoint,trading_date,captured_at,market_session,symbol,value,change_percent,source,source_timestamp,correlation_id,snapshot_version)
      values('${checkpoint}','${historical}','${historical}T${checkpoint.slice(0,2)}:${checkpoint.slice(2)}:00+08:00','${['1410','1430'].includes(checkpoint)?'close':'intraday'}','${symbol}',20000,1,'isolated','${historical}T09:00:00+08:00','${id}',${Number(checkpoint)*10+['TAIEX','2330','TXF'].indexOf(symbol)});`);
    }
  }
  const prediction=randomUUID();
  for(const [index,symbol] of ['TAIEX','2330','TXF','NVDA','TSM','SPX'].entries()){
    await sql(`insert into public.market_checkpoint_snapshots(checkpoint,trading_date,captured_at,market_session,symbol,value,change_percent,source,source_timestamp,correlation_id,snapshot_version,raw)
      values('PREMARKET','${historical}','${historical}T07:00:00+08:00','premarket','${symbol}',100,1,'isolated','${historical}T05:00:00+08:00','${premarketCorrelation}',${100+index},'{"contract":"FETCH_CHECKPOINT_EVIDENCE_V1","fixture":true}');`);
  }
  await sql(`insert into public.learning_runs(run_date,run_type,idempotency_key,engine_version,status,completed_at,failed_count,errors) values('${historical}','daily','isolated-learning','isolated','succeeded',now(),0,'[]');
    insert into public.learning_predictions(id,decision_snapshot_id,report_id,report_date,prediction_at,analysis_window,prediction_scope,symbol,thesis,direction,expected_horizon,data_quality_status,idempotency_key)
    values('${prediction}',${quote(snapshot)},${quote(report)},'${historical}','${historical}T07:00:00+08:00','PREMARKET','market','TAIEX','isolated fixture','neutral','close','complete','isolated-prediction');
    insert into public.prediction_outcomes(prediction_id,horizon,target_session,target_date,status,data_quality_status,evaluated_at)
    values('${prediction}','close',0,'${historical}','completed','complete','${historical}T14:32:00+08:00');`);
  const passed=await capture();
  assert.equal(passed.verdict,'PASS',JSON.stringify(passed.blocking_checks));
  assert.equal(passed.evidence.automatic_stable_day,false);
  assert.ok(passed.evidence.automatic_blocking_checks.includes('HISTORICAL_REPLAY'));
  assert.ok(passed.evidence.automatic_blocking_checks.includes('MANUAL_RECOVERY_OR_UNVERIFIED_TRIGGER'));
  assert.notEqual(before.id,passed.id);
  assert.equal((await capture()).id,passed.id);
  assert.equal(await sql(`select verdict from public.production_acceptance_results where id='${before.id}'`),'FAIL');
  await sql("update public.pipeline_runs set provider_status=jsonb_set(provider_status,'{trigger}','\"scheduled\"') where status='SUCCEEDED';");
  assert.equal((await capture()).evidence.manual_intervention,false);
  await sql(`insert into public.ma_ops_recovery_actions(action_type,target,idempotency_key,status,before_json)
    values('rebuild_member_content_revision','generate-daily-report-v7','isolated-approved-recovery','succeeded',
    ${json({request_payload:{report_date:historical,suppress_notifications:true}})});`);
  const manualRecovery=await capture();
  assert.equal(manualRecovery.evidence.manual_intervention,true);
  assert.equal(manualRecovery.evidence.automatic_stable_day,false);
  assert.ok(manualRecovery.evidence.automatic_blocking_checks.includes('MANUAL_RECOVERY_OR_UNVERIFIED_TRIGGER'));
  await sql(`update public.reports set ai_strategy_json=jsonb_set(ai_strategy_json,'{closing_verification_v2,opening_decision_snapshot_id}',to_jsonb(gen_random_uuid()::text));`);
  const drift=await capture();
  assert.equal(drift.verdict,'FAIL');
  assert.ok(drift.blocking_checks.includes('CLOSING_REVISION_UNVERIFIED'));
  await sql(`update public.reports set ai_strategy_json=jsonb_set(ai_strategy_json,'{closing_verification_v2,opening_decision_snapshot_id}',${json(snapshot)});`);
  await sql("update public.market_checkpoint_snapshots set change_percent=null where symbol='TXF' and checkpoint='0930';");
  const missingQuote=await capture();assert.equal(missingQuote.verdict,'FAIL');assert.ok(missingQuote.blocking_checks.includes('CHECKPOINT_0930_TXF_EVIDENCE_MISSING'));
  await sql("update public.market_checkpoint_snapshots set change_percent=1 where symbol='TXF' and checkpoint='0930';");
  const failedId=randomUUID(),successId=randomUUID(),otherId=randomUUID();
  await sql(`insert into public.runtime_http_dispatches(id,trading_date,job_name,checkpoint,endpoint,idempotency_key,dispatch_status,http_status,response_success,response_error_code,response_body,completed_at) values
    ('${failedId}','${historical}','daily_generate','PREMARKET','isolated','isolated-failed','FAILED',500,false,'ORIGINAL_TIMEOUT','{"original":true}',now()-interval '1 minute'),
    ('${otherId}','${historical}','unrelated_job','PREMARKET','isolated','isolated-other','FAILED',500,false,'DO_NOT_CLOSE','{}',now()-interval '1 minute'),
    ('${successId}','${historical}','daily_generate','PREMARKET','isolated','isolated-success','SUCCEEDED',200,true,null,${json({report_date:historical,decision_snapshot_id:snapshot})},now());`);
  await sql(`insert into public.runtime_dead_letters(component,operation,idempotency_key,correlation_id,attempt,max_attempts,error_code,context)
    values('runtime_http_dispatch','daily_generate','isolated-dead',gen_random_uuid(),1,3,'ORIGINAL_TIMEOUT',${json({dispatch_id:failedId,trading_date:historical})});`);
  const failedBeforeAcceptance=await sql(`select row_to_json(d)::text from public.runtime_http_dispatches d where id='${failedId}';`);
  const deadBeforeAcceptance=await sql("select row_to_json(d)::text from public.runtime_dead_letters d where idempotency_key='isolated-dead';");
  const observedFailure=await capture();
  assert.equal(observedFailure.verdict,'FAIL');
  assert.ok(observedFailure.blocking_checks.includes('RUNTIME_FAILURE_PRESENT'));
  assert.equal(await sql(`select row_to_json(d)::text from public.runtime_http_dispatches d where id='${failedId}';`),failedBeforeAcceptance);
  assert.equal(await sql("select row_to_json(d)::text from public.runtime_dead_letters d where idempotency_key='isolated-dead';"),deadBeforeAcceptance);
  const reconciled=JSON.parse(await sql(`select public.reconcile_runtime_terminal_failures_v1('${historical}',gen_random_uuid());`));
  assert.equal(reconciled,1);
  const old=JSON.parse(await sql(`select json_build_object('status',dispatch_status,'error',response_error_code,'http',http_status,'body',response_body) from public.runtime_http_dispatches where id='${failedId}';`));
  assert.equal(old.status,'SKIPPED');assert.equal(old.error,'ORIGINAL_TIMEOUT');assert.equal(old.http,500);assert.equal(old.body.original,true);
  assert.equal(await sql("select status||':'||error_code from public.runtime_dead_letters where idempotency_key='isolated-dead';"),'resolved:ORIGINAL_TIMEOUT');
  assert.equal(await sql(`select dispatch_status from public.runtime_http_dispatches where id='${otherId}';`),'FAILED');
  assert.equal((await capture('2026-09-05')).verdict,'NOT_DUE');
  assert.equal((await capture('2099-09-07')).verdict,'NOT_DUE');
  assert.equal(await sql("select has_function_privilege('anon','public.capture_morning_alpha_acceptance_v1(date,text)','execute');"),'f');
});

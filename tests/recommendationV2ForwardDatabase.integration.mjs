import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {v2Fixture} from './helpers/recommendationV2Fixtures.mjs';
import {evaluateV2Shadow,v2Canonical,nextV2Session} from '../supabase/functions/_shared/recommendation-shadow-v2-engine.ts';
import {persistForwardOutcomes} from '../supabase/functions/_shared/recommendation-v2-forward-outcomes.ts';
import {RECOMMENDATION_UNIVERSE} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';
import {v2DailySnapshot} from '../src/features/research/recommendation-v2-forward.ts';

assert.equal(process.env.MA_V2_FORWARD_DB_SCOPE,'LOCAL_ISOLATION_ONLY');
const container='ma-v2-forward-'+process.pid,dir=mkdtempSync(join(tmpdir(),'ma-v2-forward-clock-'));
const image=process.env.MA_V2_FORWARD_DB_IMAGE||'ma-v2-clock-ci';assert(['ma-v2-clock-ci','ma-runtime-sparse-ci'].includes(image));
let created=false;
const clock=time=>{writeFileSync(dir+'/now',time+'\n');if(created)docker(['cp',dir+'/now',container+':/tmp/v2-now']);};
const docker=(args,input)=>execFileSync('docker',args,{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:30000}).trim();
const sql=s=>docker(['exec','-i',container,'psql','-X','-q','-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1'],s);
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const lit=s=>"'"+String(s).replaceAll("'","''")+"'",j=v=>lit(JSON.stringify(v))+'::jsonb';
const date='2026-09-07';clock(date+' 23:00:00');
try{
 docker(['create','--name',container,'--network','none',
  '--env','FAKETIME_TIMESTAMP_FILE=/tmp/v2-now','--env','FAKETIME_NO_CACHE=1','--entrypoint','bash',image,'-c',
  'initdb -D "$PGDATA" --auth=trust >/dev/null && exec env -u FAKETIME LD_PRELOAD=/usr/local/lib/libfaketime.so.1 postgres -D "$PGDATA" -c listen_addresses=127.0.0.1']);
 created=true;clock(date+' 23:00:00');docker(['start',container]);
 for(let i=0;i<30;i++){try{sql('select 1');break;}catch{await new Promise(r=>setTimeout(r,200));}}
 assert.equal(docker(['inspect','--format','{{.HostConfig.NetworkMode}}',container]),'none');
 sql(read('tests/fixtures/research-foundation-dependencies.sql'));
 sql(read('supabase/migrations/20261004033642_intelligence_foundation_owner_shadow_v1.sql'));
 sql(read('supabase/migrations/20260930043122_six_bug_preventive_closure_v1.sql').split('create or replace function public.latest_completed_us_session_v1')[0]+'commit;');
 sql(`create schema extensions;create extension pgcrypto with schema extensions;
 create table sector_stock_map(symbol text primary key,stock_name text,is_active boolean);
 grant select on sector_stock_map to authenticated,service_role;
 insert into sector_stock_map values ${RECOMMENDATION_UNIVERSE.map(s=>`('${s}','SYNTHETIC_${s}',true)`).join(',')};
 create table market_checkpoint_batches(batch_id uuid primary key,business_date date,checkpoint text,status text,expected_provider_count int,committed_provider_count int,committed_at timestamptz);
 -- Synthetic read-contract scaffold. No Atomic producer or Production connection.
 create function read_committed_market_checkpoint_batch_v1(p_date date,p_checkpoint text) returns table(batch_id uuid) language sql as $$
  select b.batch_id from public.market_checkpoint_batches b,generate_series(1,b.committed_provider_count) n where b.business_date=p_date and b.checkpoint=p_checkpoint and b.status='COMMITTED'; $$;`);
 sql(read('supabase/migrations/20261007092045_recommendation_v2_owner_shadow.sql'));
 sql(read('supabase/migrations/20261007113746_recommendation_v2_watch_prospective_lock.sql'));
 sql(`alter table decision_snapshots add column status text;
 create table research_daily_analysis(id uuid primary key,analysis jsonb,prediction_hash text,analysis_cutoff_at timestamptz,created_at timestamptz);
 create table market_quotes(id uuid primary key,symbol text,trading_date date,phase text,quality_status text,freshness_status text,value numeric,captured_at timestamptz,ingested_at timestamptz);
 grant select on market_quotes,research_daily_analysis to service_role;`);
 sql(read('supabase/migrations/20261006082157_owner_trading_lab_v1.sql'));
 const protectedHash=()=>sql("select md5(string_agg(pg_get_functiondef(oid),'' order by proname)) from pg_proc where proname in ('uid','is_research_owner_v1','market_calendar_session_v1','read_committed_market_checkpoint_batch_v1')");
 const before=protectedHash();
 sql(read('supabase/migrations/20261007125316_recommendation_v2_forward_lifecycle.sql'));
 assert.equal(protectedHash(),before);
 const denied=(s,regex)=>assert.throws(()=>sql(s),regex);
 const owner='10000000-0000-4000-8000-000000000001',member='10000000-0000-4000-8000-000000000002',paid='10000000-0000-4000-8000-000000000003';
 sql(`insert into profiles values('${owner}','admin'),('${member}','member'),('${paid}','paid');insert into research_private.owner_access(principal_id,enabled,approval_reference) values('${owner}',true,'SYNTHETIC_ONLY');`);
 const asUser=(id,s)=>`begin;set local role authenticated;set local request.jwt.claim.sub='${id}';${s};rollback;`;
 let firstPredictions;
 const phases=['PREMARKET','09:00','09:30','10:30','13:00','14:10','14:30'];
 for(const [i,phase] of phases.entries()){
  const minute=phase==='PREMARKET'?'07:05':phase;
  const utc=new Date(date+'T'+minute+':00+08:00').toISOString().slice(0,19).replace('T',' ');clock(utc);
  assert.equal(sql("select to_char(clock_timestamp() at time zone 'Asia/Taipei','HH24:MI')"),minute);
  const batch='20000000-0000-4000-8000-00000000000'+i,cp=phase.replace(':','');
  sql(`insert into market_checkpoint_batches values('${batch}','${date}','${cp}','COMMITTED',11,11,clock_timestamp());`);
  const claim=`select claim_recommendation_v2_forward('${date}','${phase}','${batch}')`;
  const receipt=JSON.parse(sql('set role service_role;'+claim));assert.equal(receipt.status,'ACQUIRED');
  assert.equal(JSON.parse(sql('set role service_role;'+claim)).status,'IN_PROGRESS');
  denied('set role anon;'+claim,/permission denied/);denied('set role authenticated;'+claim,/permission denied/);
  const now=new Date(sql("select clock_timestamp()")).toISOString(),input=v2Fixture(now);
  input.identity.revision_id=receipt.source_revision;input.v1.revision_id=receipt.source_revision;
  if(phase!=='PREMARKET')input.data.quotes.push({id:'SYNTHETIC_CURRENT_TAIEX',symbol:'TAIEX',trading_date:date,phase:phase>='14:10'?'close':'intraday',provider:'fugle',value:20000,change_percent:0,captured_at:phase>='14:10'?date+'T13:30:00+08:00':now,ingested_at:now});
  if(phase==='PREMARKET')input.sources=input.sources.filter(s=>s.kind!=='shares');
  if(phase==='09:00')input.captures.push({symbol:'2330',endpoint:'intraday/quote',received_at:now,status:'PASS',rows:[{id:'SYNTHETIC_PAPER_QUOTE',symbol:'2330',phase:'intraday',trading_date:date,value:120,captured_at:now,ingested_at:now,quality_status:'verified',freshness_status:'provider_returned'}]});
  const result=await evaluateV2Shadow(input),snapshot=v2DailySnapshot(result);
  assert.equal(result.counts[phase==='PREMARKET'?'WATCH':'READY'],72);
  const put=`select store_recommendation_shadow_v2(${lit(v2Canonical(input))},${j(result)},'${phase}',${j(snapshot)})`;
  assert.equal(JSON.parse(sql('set role service_role;'+put)).status,'STORED');
  assert.equal(JSON.parse(sql('set role service_role;'+put)).status,'ALREADY_STORED');
  const finish=`select finish_recommendation_v2_forward('${receipt.job_id}','${receipt.lease_id}','COMPLETE')`;
  assert.equal(JSON.parse(sql('set role service_role;'+finish)).status,'COMPLETE');
  assert.equal(JSON.parse(sql('set role service_role;'+claim)).status,'COMPLETE');
  if(phase==='09:00'){
   const run=sql(`select id from recommendation_shadow_v2_runs where source_revision=${lit(receipt.source_revision)}`);
   const request='40000000-0000-4000-8000-000000000001';
   const trade={kind:'OWNER_EXPERIMENT',research_run_id:run,symbol:'2330',quantity:10,stop_price:110,horizon:'1D',entry_condition:'SYNTHETIC_ONLY_OWNER_PLAN'};
   const record=who=>`select owner_lab_record_experiment_v1('${who}','${request}',${j(trade)})`;
   assert.equal(JSON.parse(sql('set role service_role;'+record(owner))).status,'RECORDED');
   assert.equal(JSON.parse(sql('set role service_role;'+record(owner))).status,'ALREADY_RECORDED');
   for(const who of [member,paid])denied('set role service_role;'+record(who),/RESEARCH_OWNER_REQUIRED/);
   denied('set role authenticated;'+record(owner),/permission denied/);
   assert.equal(sql(asUser(owner,"select count(*) from owner_lab_trades where kind='OWNER_EXPERIMENT'")),'1');
   for(const who of [member,paid])assert.equal(sql(asUser(who,'select count(*) from owner_lab_trades')),'0');
   assert.equal(sql("select system_snapshot->>'v2_performance_eligible' from owner_lab_trades limit 1"),'false');
  }
  assert.equal(sql(`select count(*) from recommendation_shadow_v2_predictions where evaluation_phase='${phase}'`),'72');
  if(i===0)firstPredictions=sql("select jsonb_agg(to_jsonb(p) order by symbol) from recommendation_shadow_v2_predictions p where evaluation_phase='PREMARKET'");
  else assert.equal(sql("select jsonb_agg(to_jsonb(p) order by symbol) from recommendation_shadow_v2_predictions p where evaluation_phase='PREMARKET'"),firstPredictions);
 }
 assert.equal(sql('select count(*) from recommendation_shadow_v2_predictions'),'504');
 assert.equal(sql(asUser(owner,"select get_owner_recommendation_v2_forward()->>'forward_sample'")),'1');
 assert.equal(sql(asUser(owner,"select jsonb_array_length(get_owner_recommendation_v2_forward()->'history')")),'1');
 for(const uid of [member,paid])denied(asUser(uid,'select get_owner_recommendation_v2_forward()'),/RESEARCH_OWNER_REQUIRED/);
 denied('set role anon;select get_owner_recommendation_v2_forward()',/permission denied/);
 denied('set role authenticated;select get_owner_recommendation_v2_forward()',/RESEARCH_OWNER_REQUIRED/);
 for(const role of ['anon','authenticated','service_role'])denied(`set role ${role};select * from research_private.recommendation_v2_forward_jobs`,/permission denied/);
 denied("update recommendation_shadow_v2_predictions set status='READY'",/IMMUTABLE/);
 denied('delete from recommendation_shadow_v2_predictions',/IMMUTABLE/);
 const claimCache="select claim_recommendation_v2_acquisition('2026-09-07')";
 const c=JSON.parse(sql('set role service_role;'+claimCache));assert.equal(c.status,'ACQUIRED');
 assert.equal(JSON.parse(sql('set role service_role;'+claimCache)).status,'IN_PROGRESS');
 const payload={business_date:date,acquisition_cutoff:date+'T06:30:00Z',captures:[]};
 assert.equal(sql(`set role service_role;select finish_recommendation_v2_acquisition('${c.lease_id}',${j(payload)})`),'STORED');
 assert.equal(JSON.parse(sql('set role service_role;'+claimCache)).status,'CACHED');
 denied(`set role service_role;select finish_recommendation_v2_acquisition('${c.lease_id}',${j({...payload,tamper:true})})`,/IMMUTABLE/);
 clock(date+' 07:01:00');assert.equal(JSON.parse(sql('set role service_role;'+claimCache)).status,'ACQUIRED');
 // Advance only the isolated clock. No history rewrite or Production call.
 const later='2026-10-07';clock(later+' 06:30:00');
 const outcomeBatch='30000000-0000-4000-8000-000000000001';
 sql(`insert into market_checkpoint_batches values('${outcomeBatch}','${later}','1430','COMMITTED',11,11,clock_timestamp());`);
 const job=JSON.parse(sql(`set role service_role;select claim_recommendation_v2_forward('${later}','14:30','${outcomeBatch}')`));
 const current=v2Fixture(new Date(sql('select clock_timestamp()')).toISOString());current.identity.revision_id=job.source_revision;current.v1.revision_id=job.source_revision;
 current.data.quotes.push({id:'SYNTHETIC_CLOSE',symbol:'TAIEX',trading_date:later,phase:'close',provider:'fugle',value:20000,change_percent:0,captured_at:later+'T13:30:00+08:00',ingested_at:current.identity.generated_at});
 current.sources.find(s=>s.kind==='growth').rows.forEach(r=>{r.revenue_yoy=-.1;});
 const currentResult=await evaluateV2Shadow(current);assert.equal(currentResult.counts.NONE,72);
 sql(`set role service_role;select store_recommendation_shadow_v2(${lit(v2Canonical(current))},${j(currentResult)},'14:30',${j(v2DailySnapshot(currentResult))});select finish_recommendation_v2_forward('${job.job_id}','${job.lease_id}','COMPLETE')`);
 const claimOutcome=`select claim_recommendation_v2_outcome_work('${job.job_id}','${job.lease_id}')`;
 const outcomeJob=JSON.parse(sql('set role service_role;'+claimOutcome));assert.equal(outcomeJob.status,'ACQUIRED');
 assert.equal(JSON.parse(sql('set role service_role;'+claimOutcome)).status,'IN_PROGRESS');
 const pending=JSON.parse(sql('set role service_role;select pending_recommendation_shadow_v2()'));
 assert.equal(pending.length,504);const prediction=pending[0],trigger=prediction.entry.trigger_price;
 let session=prediction.entry.not_before;const observed=current.identity.generated_at;
 const capture={symbol:prediction.symbol,endpoint:'historical/candles',status:'PASS',received_at:observed,rows:Array.from({length:20},()=>{const d=session;session=nextV2Session(d);return {id:'SYNTHETIC_OUTCOME:'+d,trading_date:d,ingested_at:observed,raw_payload:{open:trigger,high:trigger+2,low:trigger-.1,close:trigger+1,volume_shares:100000,amount_twd:100000000}};})};
 const experimentCapture={...capture,symbol:'2330',rows:[{...capture.rows[0],id:'SYNTHETIC_PAPER_CLOSE:'+date,trading_date:date},...capture.rows]};
 const source={source_revision:outcomeJob.source_revision,observed_at:observed,captures:prediction.symbol==='2330'?[experimentCapture]:[capture,experimentCapture]};
 assert.equal(sql(`set role service_role;select store_recommendation_v2_outcome_source(${lit(v2Canonical(source))})`),'STORED');
 assert.equal(sql(`set role service_role;select store_recommendation_v2_outcome_source(${lit(v2Canonical(source))})`),'ALREADY_STORED');
 denied(`set role service_role;select store_recommendation_v2_outcome_source(${lit(v2Canonical({...source,changed:true}))})`,/IMMUTABLE/);
 const store=(result,evidence)=>{sql(`set role service_role;select store_recommendation_shadow_v2_outcome(${j(result)},${lit(evidence)})`);return Promise.resolve({error:null});};
 const outcome=await persistForwardOutcomes({predictions:[prediction],captures:[capture],sourceRevision:source.source_revision,now:()=>observed,store});
 assert.equal(outcome.observed,5);assert.equal(sql('select count(*) from recommendation_shadow_v2_outcomes'),'5');
 await persistForwardOutcomes({predictions:[prediction],captures:[capture],sourceRevision:source.source_revision,now:()=>observed,store});
 assert.equal(sql('select count(*) from recommendation_shadow_v2_outcomes'),'5');
 assert.equal(sql(`select result->>'target_reason' from recommendation_shadow_v2_outcomes limit 1`),'NO_LOCKED_PRICE_TARGET');
 const papers=JSON.parse(sql('set role service_role;select pending_owner_v2_experiments()'));assert.equal(papers.length,1);
 for(const h of ['CLOSE','1D','3D','5D']){
  const save=`select store_owner_v2_experiment_outcome('${papers[0].id}','${h}',${lit(source.source_revision)})`;
  assert.equal(sql('set role service_role;'+save),'RECORDED');assert.equal(sql('set role service_role;'+save),'ALREADY_RECORDED');
 }
 assert.equal(sql('select count(*) from owner_lab_trade_events'),'4');
 assert.equal(sql('set role service_role;select jsonb_array_length(pending_owner_v2_experiments())'),'0');
 assert.equal(sql(asUser(owner,"select (get_owner_recommendation_v2_forward()->'performance_all'->0->>'observed')::integer")),'1');
 assert.equal(sql(asUser(owner,"select get_owner_recommendation_v2_forward()->>'completed_forward_dates'")),'0');
 sql(`set role service_role;select finish_recommendation_v2_outcome_work('${job.job_id}','${job.lease_id}',true)`);
 assert.equal(JSON.parse(sql('set role service_role;'+claimOutcome)).status,'ALREADY_COMPLETE');
 denied('update research_private.recommendation_v2_outcome_sources set observed_at=clock_timestamp()',/IMMUTABLE/);
 assert.equal(sql('select count(*) from recommendation_shadow_v2_predictions'),'504');
 assert.equal(sql('select count(*) from decision_snapshots'),'0');assert.equal(protectedHash(),before);
 console.log(JSON.stringify({fresh_db:'PASS',network:'none',phases:7,append_only_locks:504,independent_forward_dates:1,legacy_rewrite:0,duplicate_locks:0,outcome_horizons:5,duplicate_outcomes:0,owner_allow:true,anonymous_member_paid_logout:'DENY',source_reservation:'PASS',business_writes:0}));
 if(process.env.MA_V2_FORWARD_UI==='LOCAL_ONLY'){
  const server=createServer((req,res)=>{const role=new URL(req.url,'http://127.0.0.1').searchParams.get('role');
   try{const who={owner,member,paid}[role];const query=who?asUser(who,'select get_owner_recommendation_v2_forward()'):'set role anon;select get_owner_recommendation_v2_forward()';
    res.setHeader('Content-Type','application/json');res.end(sql(query));}catch{res.statusCode=403;res.end('{}');}});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(3199,'127.0.0.1',resolve);});console.log('LOCAL_FORWARD_OWNER_BRIDGE=3199');
  await new Promise(resolve=>{process.once('SIGTERM',resolve);process.once('SIGINT',resolve);});await new Promise(resolve=>server.close(resolve));
 }
}finally{try{docker(['rm','-f',container]);}finally{rmSync(dir,{recursive:true,force:true});}}

// Local orchestration only. Every case receives a new cloned INPUT-only DB.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
assert.equal(process.env.MA_LOCAL_SCOPE,'ma-six-bug-preventive-20260930');
const docker=args=>execFileSync('docker',args,{encoding:'utf8',timeout:30000,stdio:['pipe','pipe','pipe']}).trim();
const sql=(db,s)=>docker(['exec','ma-six-bug-shadow-db','psql','-X','-q','-U','postgres','-d',db,'-At','-v','ON_ERROR_STOP=1','-c',s]);
const cases=[['429','PROVIDER_RATE_LIMIT','07:40',7],['timeout','PROVIDER_TIMEOUT','08:00',8],['malformed','PROVIDER_INVALID_RESPONSE','08:30',9],
 ['deadline','PROVIDER_HTTP_5XX',null,10],['stale','PROVIDER_STALE_SESSION',null,11],['cardinality','ATOMIC_CARDINALITY',null,12],['wrong-correlation','ATOMIC_ROW_CONTRACT',null,13],
 ['missing-news',null,null,14],['missing-close',null,null,15]];
const results=[];
const requested=process.argv.find(x=>x.startsWith('--cases='))?.slice(8).split(',');
const template=process.env.MA_TEST_TEMPLATE_DB||'ma_six_bug_test3';assert.match(template,/^ma_six_bug_test\d+$/);
function handler(stage,time,extra=[]){
 const out=execFileSync('deno',['run','--no-check','--cached-only','--allow-read','--allow-env','--allow-write=node_modules/.ma-six-clock,/tmp','--allow-net=127.0.0.1:55447',
  'tests/helpers/sixBugFullHandlerShadow.mjs','--scope=ma-six-bug-preventive-20260930','--port=55447','--stage='+stage,'--time=2026-09-30T'+time+':00+08:00',...extra],
  {cwd:root,encoding:'utf8',timeout:180000,stdio:['pipe','pipe','pipe']});
 return JSON.parse(out.trim().split('\n').at(-1));
}
for(const [name,cause,recovery,index]of cases){
 if(requested&&!requested.includes(name))continue;
 const offset=Number(process.env.MA_TEST_DB_OFFSET||0);assert(Number.isInteger(offset)&&offset>=0&&offset<1000);
 const db='ma_six_bug_test'+(index+offset);
 assert.equal(sql('postgres',`select count(*) from pg_database where datname='${db}'`),'0');
 sql('postgres',`create database ${db} template ${template}`);
 docker(['stop','ma-six-bug-negative-rest']);docker(['rm','ma-six-bug-negative-rest']);
 docker(['run','--pull=never','-d','--name','ma-six-bug-negative-rest','--network','ma-chaos-baseline-internal','--ip','172.19.0.20',
  '-e',`PGRST_DB_URI=postgres://postgres@ma-six-bug-shadow-db:5432/${db}`,'-e','PGRST_DB_SCHEMAS=public','-e','PGRST_DB_ANON_ROLE=service_role','postgrest/postgrest:v14.13']);
 let ready=false;for(let i=0;i<40;i++){try{const r=await fetch('http://127.0.0.1:55447/');if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}assert(ready);
 const research=name.startsWith('missing-');
 const wrongCorrelation=name==='wrong-correlation';
 const initial=handler('fetch',wrongCorrelation?'14:10':'07:00',research?[]:
  ['--fault='+(name==='deadline'?'500':name),...(wrongCorrelation?['--phase=close','--checkpoint=1410']:[])]);
 const count=()=>Number(sql(db,"select count(*) from market_checkpoint_snapshots where trading_date='2026-09-30'"));
 const entry=sql(db,"select jsonb_build_object('cause',last_error_code,'entry',details->>'retry_entry_state') from data_provider_health where provider='market_fetch_v10'");
 if(wrongCorrelation){
  assert.equal(count(),11,'batch itself is valid; caller lifecycle correlation is invalid');assert.equal(initial.success,false);
  assert.equal(sql(db,"select coalesce(max(state_rank),0) from trading_day_state where trading_date='2026-09-30'"),'0');
  assert.equal(sql(db,"select count(*) from production_critical_contract_evidence where stage='LIFECYCLE' and capsule->'expected' ? 'sqlstate'"),'1');
 }
 else if(!research){assert.equal(count(),0,name);assert.equal(JSON.parse(entry).cause,cause,name);assert.equal(initial.success,false);}
 else{assert.equal(count(),11);const report=handler('report','07:15',['--fault='+name]);assert.equal(report.http,409,name);assert.equal(report.error,'RESEARCH_QUALITY_REJECTED');}
 if(recovery){
  assert.equal(JSON.parse(entry).entry,'WAITING_FOR_PROVIDER_DATA');
  const restored=handler('retry',recovery);assert.equal(restored.results[0]?.success,true,name);
  assert.equal(count(),11);assert.equal(sql(db,"select count(*) from reports where report_date='2026-09-30'"),'1');
  assert.equal(sql(db,"select count(*) from line_delivery_outbox where status='SENT' and push_type='daily_report'"),'1');
  assert.equal(sql(db,"select provider_status->>'delivery_sla_status' from pipeline_runs where provider_status->>'provider_delay_context'='true' order by created_at desc limit 1"),'MISS');
  assert.equal(handler('retry','08:35').dispatch,null,'delivered window must stop');
 }else if(name==='deadline'){
  const deadline=handler('retry','08:45');assert.equal(count(),0);assert.equal(sql(db,'select count(*) from reports'),'0');
  assert.equal(sql(db,"select count(*) from line_delivery_outbox where status='SENT' and push_type='data_incident'"),'1');
  handler('retry','08:45');assert.equal(sql(db,"select count(*) from line_delivery_outbox where status='SENT' and push_type='data_incident'"),'1');
  assert.equal(handler('retry','08:50').dispatch,null);assert(deadline.results.length===1);
 }else if(!research&&!wrongCorrelation){assert.equal(handler('retry','07:40').dispatch,null,'permanent rejection is not a provider retry');}
 const replay=handler('replay',recovery||'08:45');assert.deepEqual(replay.provider_diff,[]);assert.deepEqual(replay.critical_edge_diff,[]);
 const result={case:name,database:db,result:'PASS',source:'REAL_EVIDENCE_WITH_EXPLICIT_FAULT_MUTATION',root_cause:cause,atomic_rows:count(),replay,production_writes:0,real_line_calls:0};
 results.push(result);console.log(JSON.stringify({case:name,result:'PASS',atomic_rows:count()}));
 writeFileSync('/tmp/ma-six-negative-results.json',JSON.stringify(results,null,2));
}

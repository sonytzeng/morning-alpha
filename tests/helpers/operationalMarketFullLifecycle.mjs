// Repeatable isolated real Handler -> SQL -> local LINE -> Closing/Learning.
// No expected outcome is written to a business table by this driver.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
assert.equal(process.env.MA_OPERATIONAL_SCOPE,'operational-market-20261001');
const db=process.env.MA_ISOLATED_TEST_DB;assert.match(db||'',/^ma_six_bug_test5\d\d$/);
const mode=process.argv.find(x=>x.startsWith('--mode='))?.slice(7)||'real';
assert(['real','full','sector','learning','fatal'].includes(mode));
const run=(bin,args)=>execFileSync(bin,args,{cwd:root,env:process.env,encoding:'utf8',timeout:180000,maxBuffer:4e6,stdio:['pipe','pipe','pipe']}).trim();
const sql=input=>execFileSync('docker',['exec','-i','ma-six-bug-shadow-db','psql','-X','-q','-U','postgres','-d',db,'-At','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',maxBuffer:4e6,stdio:['pipe','pipe','pipe']}).trim();
assert.equal(sql('select scope from ma_isolated_guard.identity'),'ma-six-bug-preventive-20260930');
const resume=process.argv.includes('--next-day-only');
if(!resume){
assert.equal(sql('select count(*) from reports'),'0');
run(process.execPath,['tests/helpers/operationalMarketSeed.mjs',...(mode==='fatal'?['--core-fatal']:[])]);
}
// Dedicated test container; never stop/reconfigure any production service.
try{run('docker',['stop','ma-operational-shadow-rest']);run('docker',['rm','ma-operational-shadow-rest']);}catch{}
run('docker',['run','--pull=never','-d','--name','ma-operational-shadow-rest','--network','container:ma-six-bug-negative-rest',
 '-e',`PGRST_DB_URI=postgres://postgres@ma-six-bug-shadow-db:5432/${db}`,'-e','PGRST_DB_SCHEMAS=public','-e','PGRST_DB_ANON_ROLE=service_role','-e','PGRST_SERVER_PORT=3001','postgrest/postgrest:v14.13']);
let ready=false;for(let i=0;i<40;i++){try{if((await fetch('http://127.0.0.1:55450/')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}assert(ready);
const saved=resume?JSON.parse(readFileSync('/tmp/ma-operational-lifecycle-'+mode+'.json','utf8')):null;
if(saved)assert.equal(saved.database,db);
const results=saved?.results||[];let last=results.length?Date.parse(results.at(-1).time):0;
const save=()=>writeFileSync('/tmp/ma-operational-lifecycle-'+mode+'.json',JSON.stringify({database:db,mode,
 input_types:['REAL_PRODUCTION_RETAINED_PROJECTION',...(mode==='full'?['SYNTHETIC_AUDITED_NEWS_CONTROL']:[]),'SYNTHETIC_NEXT_DAY_CONTROL'],
 results,real_line_calls:0,production_writes:0},null,2));
function handler(stage,time,extra=[]){
 assert(Date.parse(time)>=last,'NO_CLOCK_REWIND');last=Date.parse(time);
 const output=run('deno',['run','--no-lock','--no-check','--cached-only','--allow-read','--allow-env','--allow-write=node_modules/.ma-six-clock,/tmp','--allow-net=127.0.0.1:55450',
  'tests/helpers/operationalMarketShadow.mjs','--scope=operational-market-20261001','--stage='+stage,'--time='+time,...extra]);
 const result=JSON.parse(output.split('\n').at(-1));results.push({stage,time,result});save();
 console.log(JSON.stringify({mode,stage,...result}));return result;
}
const at=t=>'2026-10-01T'+t+':00+08:00';
if(!resume){
const faults=mode==='sector'?['--fault=missing-sector']:mode==='learning'?['--fault=learning-unavailable']:[];
const report=handler('report',at('07:05'),faults);
if(mode==='fatal'){
 assert.equal(report.http,409);assert.equal(report.error_code,'CORE_MARKET_BLOCKED');
 assert.equal(sql("select count(*) from reports where report_date='2026-10-01'"),'0');
}else{
 assert.equal(report.http,200);assert.equal(report.success,true);assert.equal(report.recommendation_status,'BLOCKED');
 const level=()=>sql("select ai_strategy_json#>>'{market_report_gate,operational_market,report_level}' from reports where report_date='2026-10-01'");
 assert.equal(level(),'DEGRADED');
 assert.equal(handler('line',at('07:06')).local_line_send,1);
 assert.equal(handler('line',at('07:07')).local_line_send,0);
 if(mode==='full'){
  const first=sql("select ai_strategy_json->>'revision_id' from reports where report_date='2026-10-01'");
  run(process.execPath,['tests/helpers/operationalMarketControls.mjs','--late-news']);
  const enriched=handler('orchestrator',at('07:15'),['--phase=generate']);
  assert.equal(enriched.http,200);assert.equal(enriched.success,true);assert.equal(level(),'FULL');
  assert.notEqual(sql("select ai_strategy_json->>'revision_id' from reports where report_date='2026-10-01'"),first);
  assert.equal(handler('line',at('07:16')).local_line_send,0);
 }
 results.push({stage:'intraday_close_inputs',result:JSON.parse(run(process.execPath,['tests/helpers/operationalMarketLifecycleInputs.mjs']).split('\n').at(-1))});
 assert.equal(handler('closing',at('14:35')).success,true);
 assert.equal(handler('learning',at('15:10'),mode==='learning'?['--fault=learning-write']:[]).success,mode!=='learning');
 assert.equal(handler('acceptance',at('15:35')).http,200);
 const acceptance=JSON.parse(sql("select jsonb_build_object('service_available',evidence->'service_available','dimensions',evidence->'acceptance_dimensions','legacy_verdict',verdict,'diagnostics',blocking_checks) from production_acceptance_results where business_date='2026-10-01' order by evaluated_at desc limit 1"));
 assert.equal(acceptance.service_available,true);assert.equal(acceptance.dimensions.CORE_MARKET,'PASS');
 assert.equal(acceptance.dimensions.CLOSING,'PASS');assert.equal(acceptance.dimensions.LINE,'PASS');
 assert.equal(acceptance.dimensions.LEARNING,mode==='learning'?'LEARNING_DEGRADED':'PASS');
 results.push({stage:'dimensional_acceptance',result:acceptance});save();
}
assert.deepEqual(handler('replay',at('15:36')).diff,[]);
}
// Full/Degraded/Fatal previous day cannot poison a valid next-day core.
run(process.execPath,['tests/helpers/operationalMarketControls.mjs','--next-day']);
const next='2026-10-02T';
assert.equal(handler('report',next+'07:05:00+08:00').success,true);
assert.equal(handler('line',next+'07:06:00+08:00').local_line_send,1);
assert.equal(handler('line',next+'07:07:00+08:00').local_line_send,0);
assert.deepEqual(handler('replay',next+'07:08:00+08:00').diff,[]);
save();console.log(JSON.stringify({mode,result:'PASS',next_day:'PASS',production_writes:0,real_line_calls:0}));

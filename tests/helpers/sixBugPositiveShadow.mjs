// A monotonically advancing, real-handler lifecycle in one fresh local DB.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {reviewPremiumNewsEvidence} from '../../supabase/functions/_shared/premium-evidence.ts';
const root=fileURLToPath(new URL('../../',import.meta.url));
assert.equal(process.env.MA_LOCAL_SCOPE,'ma-six-bug-preventive-20260930');
const db=process.env.MA_ISOLATED_TEST_DB;assert.match(db||'',/^ma_six_bug_test\d+$/);
const docker=args=>execFileSync('docker',args,{encoding:'utf8',timeout:30000,stdio:['pipe','pipe','pipe']}).trim();
const sql=input=>execFileSync('docker',['exec','-i','ma-six-bug-shadow-db','psql','-X','-q','-U','postgres','-d',db,'-At','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',maxBuffer:2e6,stdio:['pipe','pipe','pipe']}).trim();
const q=v=>`'${String(v).replaceAll("'","''")}'`;
assert.equal(sql('select scope from ma_isolated_guard.identity'),'ma-six-bug-preventive-20260930');
const resume=process.argv.includes('--next-day-only');
if(!resume){
assert.equal(sql('select count(*) from reports'),'0','INPUT_ONLY_DATABASE_REQUIRED');
sql(readFileSync(root+'/tests/fixtures/six-bug-loopback-transport.sql','utf8'));
docker(['stop','ma-six-bug-negative-rest']);docker(['rm','ma-six-bug-negative-rest']);
docker(['run','--pull=never','-d','--name','ma-six-bug-negative-rest','--network','ma-chaos-baseline-internal','--ip','172.19.0.20',
 '-e',`PGRST_DB_URI=postgres://postgres@ma-six-bug-shadow-db:5432/${db}`,'-e','PGRST_DB_SCHEMAS=public','-e','PGRST_DB_ANON_ROLE=service_role','postgrest/postgrest:v14.13']);
let ready=false;for(let i=0;i<40;i++){try{if((await fetch('http://127.0.0.1:55447/')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}assert(ready);
}
const saved=resume?JSON.parse(readFileSync('/tmp/ma-six-positive-lifecycle.json','utf8')):null;
if(resume){assert.equal(saved.database,db);assert(saved.results.some(r=>r.stage==='acceptance'));assert.equal(sql("select verdict from production_acceptance_results where business_date='2026-09-30' order by evaluated_at desc limit 1"),'PASS');}
const results=saved?.results||[];let lastTime=results.length?Date.parse(results.at(-1).time):0;
function handler(stage,time,extra=[]){
 const stamp=Date.parse(time);assert(stamp>=lastTime,'CLOCK_MUST_NOT_REWIND');lastTime=stamp;
 const output=execFileSync('deno',['run','--no-check','--cached-only','--allow-read','--allow-env','--allow-write=node_modules/.ma-six-clock,/tmp','--allow-net=127.0.0.1:55447',
  'tests/helpers/sixBugFullHandlerShadow.mjs','--scope=ma-six-bug-preventive-20260930','--port=55447','--stage='+stage,'--time='+time,...extra],
  {cwd:root,encoding:'utf8',timeout:180000,stdio:['pipe','pipe','pipe']});
 const result=JSON.parse(output.trim().split('\n').at(-1));
 if(stage==='health')assert(result.results.length===1&&result.results[0].success===true,'HEALTH_FAILED');
 else if(stage==='acceptance')assert.equal(sql("select verdict from production_acceptance_results where business_date='2026-09-30' order by evaluated_at desc limit 1"),'PASS');
 else if(stage==='replay'){assert.deepEqual(result.provider_diff,[]);assert.deepEqual(result.critical_edge_diff,[]);}
 else assert(result.http===200&&result.success!==false,stage+':HANDLER_FAILED');
 results.push({stage,time,result});writeFileSync('/tmp/ma-six-positive-lifecycle.json',JSON.stringify({database:db,input_types:['REAL_EVIDENCE','AUDITED_FIXTURE'],results,production_writes:0},null,2));
 console.log(JSON.stringify({stage,time,result:'PASS'}));return result;
}
const at=t=>'2026-09-30T'+t+':00+08:00';
if(!resume){
handler('preflight',at('06:50'));handler('fetch',at('07:00'));handler('report',at('07:15'));
assert.equal(handler('line',at('07:16')).local_line_send,1);
assert.equal(handler('line',at('07:17')).local_line_send,0);
handler('health',at('07:20'),['--check=report']);
const retained=JSON.parse(readFileSync(root+'/tests/fixtures/six-bug-production-intraday-20260930.json','utf8'));
for(const checkpoint of ['0900','0930','1030','1300','1410','1430']){
 // The saved 09:00 response was received seconds after the nominal Cron slot.
 // Freeze at its real recorded time, never before the quote existed. Raw
 // evidence is unchanged; do not manufacture a future quote at 09:00:00.
 const captures=retained.rows.filter(r=>r.checkpoint===checkpoint).map(r=>Date.parse(r.recorded_at));
 const observed=captures.length?new Date(Math.ceil(Math.max(...captures)/1000)*1000+8*3600000).toISOString().slice(0,19)+'+08:00':at(checkpoint.slice(0,2)+':'+checkpoint.slice(2));
 handler('fetch',observed,['--checkpoint='+checkpoint,'--phase='+(Number(checkpoint)>=1410?'close':'intraday')]);
}
handler('closing',at('14:35'));handler('learning',at('15:10'));handler('health',at('15:25'),['--check=closing']);handler('acceptance',at('15:35'));
assert.equal(sql("select count(*) from reports where report_date='2026-09-30'"),'1');
assert.equal(sql("select count(*) from line_delivery_outbox where report_date='2026-09-30' and push_type='daily_report' and status='SENT'"),'1');
handler('replay',at('15:36'));
}
// Only missing next-day input is synthetic; the previous day's generated close
// evidence is consumed unchanged. No Report/Recommendation/PASS row is seeded.
const fixture=JSON.parse(readFileSync(root+'/tests/fixtures/production-parity-v4/research-cross-day-20260930.json','utf8'));
const original=fixture.news_events.find(n=>reviewPremiumNewsEvidence({title:n.title,source:n.source_name,url:n.source_url,published_at:n.published_at,taiwan_impact_summary:n.raw_payload?.taiwan_impact_summary||n.summary},Date.parse('2026-09-30T07:15:00+08:00')).eligible);
assert(original,'Existing audited corpus must have a contract-qualified positive news input');
const news={...original,id:randomUUID(),published_at:'2026-09-30T12:50:24Z'};
for(const key of ['title','normalized_title','duplicate_group_key'])if(key in news)news[key]='AUDITED_FIXTURE_NEXT_DAY '+news[key];
if('fingerprint'in news)news.fingerprint=createHash('sha256').update('AUDITED_FIXTURE_NEXT_DAY:'+original.fingerprint).digest('hex');
for(const key of Object.keys(news))if(/url/.test(key))news[key]='https://fixture.invalid/six-bug-next-day';
if('source'in news)news.source='AUDITED_FIXTURE';
news.source_name='AUDITED_FIXTURE';news.provider='AUDITED_FIXTURE';
const columns=Object.keys(news);assert(columns.every(k=>/^[a-z_]+$/.test(k)));
sql(`insert into news_events(${columns.join(',')}) select ${columns.join(',')} from jsonb_populate_record(null::news_events,${q(JSON.stringify(news))}::jsonb) on conflict(fingerprint) do update set source_name='AUDITED_FIXTURE',provider='AUDITED_FIXTURE';`);
for(const originalTag of fixture.news_event_tags.filter(t=>t.news_key===original.fingerprint)){
 const tag={...originalTag,news_key:news.fingerprint};
 const cols=Object.keys(tag);sql(`insert into news_event_tags(${cols.join(',')}) select ${cols.join(',')} from jsonb_populate_record(null::news_event_tags,${q(JSON.stringify(tag))}::jsonb) on conflict(news_key) do nothing;`);
}
for(const [stage,time]of [['preflight','06:50'],['fetch','07:00'],['report','07:15']]){
 const timestamp='2026-10-01T'+time+':00+08:00';
 if(!results.some(r=>r.stage===stage&&r.time===timestamp))handler(stage,timestamp);
}
assert.equal(handler('line','2026-10-01T07:16:00+08:00').local_line_send,1);
handler('replay','2026-10-01T07:17:00+08:00');
console.log(JSON.stringify({positive_lifecycle:'PASS',next_day:'PASS',production_writes:0,real_line_calls:0}));

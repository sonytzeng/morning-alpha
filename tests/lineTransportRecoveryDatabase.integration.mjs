// Real isolated PostgreSQL + actual Sender. Memory transport is NOT LINE delivery.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {webcrypto} from 'node:crypto';
import {isolatedFunction} from './helpers/isolatedEdgeLoader.mjs';
const container='ma-line-transport-'+process.pid;
const run=(args,input)=>execFileSync('docker',args,{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:20e6}).trim();
const sql=q=>run(['exec','-i',container,'psql','-h','127.0.0.1','-XqAt','-U','postgres','-v','ON_ERROR_STOP=1'],q);
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const literal=v=>v===null?'null':typeof v==='number'?String(v):"'"+String(v).replaceAll("'","''")+"'";
const checks=[];
try{
 run(['run','-d','--name',container,'--network','none','--env','POSTGRES_PASSWORD=isolated-test-only','postgres:17']);
 let ready=false;for(let n=0;n<60;n++){try{sql('select 1');ready=true;break;}catch{await new Promise(r=>setTimeout(r,250));}}assert(ready);
 const fixture=read('tests/fixtures/six-bug-schema-only-20260930.sql');
 const extract=prefix=>{const start=fixture.indexOf(prefix),end=fixture.indexOf('\n\n\n--',start);assert(start>=0&&end>start);return fixture.slice(start,end);};
 const tables=['line_subscribers','line_push_logs','line_delivery_outbox'];
 const functions=['claim_line_delivery_outbox_v1','mark_line_delivery_outbox_v1'];
 const constraints=[...fixture.matchAll(/ALTER TABLE ONLY public\.(line_subscribers|line_push_logs|line_delivery_outbox)\n\s+ADD CONSTRAINT [^;]+;/g)].map(x=>x[0]);assert.equal(constraints.length,8);
 sql('create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create table public.decision_snapshots(id uuid primary key);'
  +tables.map(n=>extract('CREATE TABLE public.'+n+' (')).join('\n')
  +functions.map(n=>extract('CREATE FUNCTION public.'+n+'(')).join('\n')+constraints.join('\n'));
 for(const table of tables)sql('alter table public.'+table+' enable row level security;revoke all on public.'+table+' from public,anon,authenticated;grant all on public.'+table+' to service_role;');
 sql('revoke all on function public.claim_line_delivery_outbox_v1(date,uuid,text,integer,integer),public.mark_line_delivery_outbox_v1(uuid[],text,text,integer) from public,anon,authenticated;grant execute on function public.claim_line_delivery_outbox_v1(date,uuid,text,integer,integer),public.mark_line_delivery_outbox_v1(uuid[],text,text,integer) to service_role;');
 const originals=sql("select jsonb_agg(jsonb_build_array(proname,md5(pg_get_functiondef(oid))) order by proname)from pg_proc where proname in('claim_line_delivery_outbox_v1','mark_line_delivery_outbox_v1')");
 const acl=sql("select jsonb_agg(to_jsonb(p) order by tablename,policyname)from pg_policies p");
 const migration=read('supabase/migrations/20261014002215_line_transport_immutable_request_candidate_v1.sql');
 sql(migration);assert.throws(()=>sql(migration),/already exists/);
 assert.equal(sql("select jsonb_agg(jsonb_build_array(proname,md5(pg_get_functiondef(oid))) order by proname)from pg_proc where proname in('claim_line_delivery_outbox_v1','mark_line_delivery_outbox_v1')"),originals);
 assert.equal(sql("select jsonb_agg(to_jsonb(p) order by tablename,policyname)from pg_policies p"),acl);
 assert.equal(sql("select count(*)from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='line_transport_private' and relkind='r' and relrowsecurity and relforcerowsecurity"),'2');
 for(const role of ['anon','authenticated']){
  assert.throws(()=>sql('set role '+role+";select public.claim_line_transport_request_v1('2026-01-08',null,'daily_report',1000,180)"),/permission denied/);
  assert.throws(()=>sql('set role '+role+';select * from line_transport_private.requests'),/permission denied/);
 }
 checks.push('Fresh exact schema; original functions/ACL/policies unchanged; replay safely refused; anon/member raw/RPC DENY');
 sql("insert into public.line_subscribers(id,line_user_id,source)select md5('ISOLATED-LINE-'||i)::uuid,'ISOLATED-LINE-'||i,'ISOLATED'from generate_series(1,4)i;");
 const enqueue=(date,count=2)=>sql("insert into public.line_delivery_outbox(report_date,line_subscriber_id,line_user_id,push_type,idempotency_key,payload)select '"+date+"',id,line_user_id,'daily_report','"+date+":'||id,'{\"message\":{\"type\":\"text\",\"text\":\"ISOLATED_ONLY\"},\"message_preview\":\"ISOLATED_ONLY\"}'from public.line_subscribers order by id limit "+count);
 const database={async rpc(name,p){
  assert(['claim_line_transport_request_v1','complete_line_transport_request_v1'].includes(name));
  const args=name.startsWith('claim')?[p.p_report_date,p.p_decision_snapshot_id,p.p_push_type,p.p_limit,p.p_lease_seconds]:[p.p_request,p.p_lease,p.p_status,p.p_error,p.p_accepted_request_id];
  try{return {data:JSON.parse(sql('set role service_role;select public.'+name+'('+args.map(literal).join(',')+')')),error:null};}catch{return {data:null,error:{message:'ISOLATED_RPC_DENIED'}};}
 }};
 const source=read('supabase/functions/line-daily-push/index.ts');
 const accepted=new Map(),requests=[];let mode='200';
 const deps={Date,Map,Set,Array,Math,String,Boolean,Number,JSON,TextEncoder,Uint8Array,crypto:webcrypto,AbortSignal,Response,
  fetch:async(url,options)=>{
   assert.equal(url,'https://api.line.me/v2/bot/message/multicast');const body=JSON.parse(options.body),key=options.headers['X-Line-Retry-Key'];
   assert(body.to.every(x=>x.startsWith('ISOLATED-LINE-')));requests.push({key,body:options.body});
   if(accepted.has(key)){assert.equal(accepted.get(key),options.body);return new Response('{}',{status:409,headers:{'x-line-accepted-request-id':'ISOLATED_ACCEPTED_ID'}});}
   if(mode==='409_WITHOUT_PROOF')return new Response('{}',{status:409});
   if(mode==='429')return new Response('{}',{status:429});
   if(mode==='400')return new Response('{}',{status:400});
   accepted.set(key,options.body);if(mode==='LOST_ACK')throw Error('ISOLATED_LOST_ACK');return new Response('{}',{status:200});
  }};
 for(const name of ['claimDeliveryOutbox','sendMulticastBatches'])deps[name]=isolatedFunction(source,name,deps);
 const claim=date=>deps.claimDeliveryOutbox(database,date,null,'daily_report');
 const send=(date,targets)=>deps.sendMulticastBatches({supabase:database,channelAccessToken:'ISOLATED_NOT_A_CREDENTIAL',subscribers:targets,message:{type:'text',text:'DIFFERENT_CURRENT_RENDER_MUST_NOT_BE_SENT'},messagePreview:'DIFFERENT',reportDate:date,pushType:'daily_report'});
 enqueue('2026-01-08');let targets=await claim('2026-01-08');assert.equal(targets.length,2);
 const original={...targets[0].transport};
 assert.throws(()=>sql("update line_transport_private.requests set body_text='{}'"),/TRANSPORT_REQUEST_IMMUTABLE/);
 assert.throws(()=>sql("update line_transport_private.members set line_user_id='changed'"),/TRANSPORT_MEMBERS_IMMUTABLE/);
 assert.throws(()=>sql("delete from line_transport_private.requests"),/TRANSPORT_APPEND_ONLY/);
 assert.throws(()=>sql("update public.line_delivery_outbox set attempt_count=attempt_count+1 where report_date='2026-01-08'"),/TRANSPORT_BOUND_OUTBOX_REQUIRES_NEW_WORKER/);
 assert.throws(()=>sql("update public.line_delivery_outbox set payload='{}'where report_date='2026-01-08'"),/TRANSPORT_BOUND_OUTBOX_IMMUTABLE/);
 mode='LOST_ACK';assert.deepEqual({...await send('2026-01-08',targets)},{sentCount:0,failedCount:2,pendingCount:2});
 assert.equal(sql("select count(*)from public.line_delivery_outbox where status='PENDING'"),'2');
 // Actually wait the preserved 60s retry deadline; no clock rewrite.
 let due=false;for(let n=0;n<17;n++){due=Number(sql("select count(*)from line_transport_private.requests where next_retry_at<=clock_timestamp() and state='PENDING'"))===1;if(due)break;await new Promise(r=>setTimeout(r,5000));}assert(due);
 targets=await claim('2026-01-08');assert.equal(targets[0].transport.retry_key,original.retry_key);assert.equal(targets[0].transport.body_text,original.body_text);
 const forged=structuredClone(targets);forged[0].transport.body_text='{}';const beforeCalls=requests.length;await assert.rejects(()=>send('2026-01-08',forged),/MISMATCH/);assert.equal(requests.length,beforeCalls);
 mode='200';assert.deepEqual({...await send('2026-01-08',targets)},{sentCount:2,failedCount:0,pendingCount:0});
 assert.equal((await claim('2026-01-08')).length,0);
 assert.equal(requests.length,2);assert.equal(accepted.size,1);
 assert.equal(sql("select count(*)from public.line_delivery_outbox where status='SENT'"),'2');
 assert.equal(sql("select count(*)from public.line_delivery_outbox where status='DEAD_LETTERED'"),'0');
 await assert.rejects(()=>send('2026-01-08',targets),/COMPLETION_REJECTED/); // Late stale writer cannot double-log.
 assert.equal(sql("select count(*)from public.line_push_logs where status='success'"),'2');
 checks.push('Real 60s lost-ack retry uses exact body/key; documented accepted409 reconciles atomically; forged body DENY; stale completion DENY; no duplicate success');
 for(const [date,scenario,expected]of[['2026-01-09','409_WITHOUT_PROOF','PENDING'],['2026-01-12','429','PENDING'],['2026-01-13','400','DEAD_LETTERED']]){
  enqueue(date);targets=await claim(date);mode=scenario;await send(date,targets);assert.equal(sql("select distinct status from public.line_delivery_outbox where report_date='"+date+"'"),expected);
 }
 checks.push('Unproven409/429 remain retryable; permanent400 remains denied');
 enqueue('2026-01-14',4);
 const execute=promisify(execFile),q="set role service_role;select public.claim_line_transport_request_v1('2026-01-14',null,'daily_report',1000,180)";
 const parallel=await Promise.all(Array.from({length:2},()=>execute('docker',['exec',container,'psql','-h','127.0.0.1','-XqAt','-U','postgres','-v','ON_ERROR_STOP=1','-c',q])));
 const groups=parallel.flatMap(v=>JSON.parse(v.stdout));assert.equal(groups.length,1);assert.equal(groups[0].members.length,4);
 const beforeAudit=sql("select md5(string_agg(row_to_json(o)::text,E'\n'order by id))from public.line_delivery_outbox o");
 const priorDef=sql("select pg_get_functiondef('public.claim_line_delivery_outbox_v1(date,uuid,text,integer,integer)'::regprocedure)");
 // Exact recovery rollback: stop the new caller, revoke only new entrypoints,
 // preserve all queue/log/request history and both original function definitions.
 sql('revoke execute on function public.claim_line_transport_request_v1(date,uuid,text,integer,integer),public.complete_line_transport_request_v1(uuid,uuid,text,text,text) from service_role');
 assert.throws(()=>sql('set role service_role;'+q.replace('set role service_role;','')),/permission denied/);
 assert.equal(sql("select md5(string_agg(row_to_json(o)::text,E'\n'order by id))from public.line_delivery_outbox o"),beforeAudit);
 assert.equal(sql("select pg_get_functiondef('public.claim_line_delivery_outbox_v1(date,uuid,text,integer,integer)'::regprocedure)"),priorDef);
 assert.throws(()=>sql("update public.line_delivery_outbox set status='PROCESSING',attempt_count=attempt_count+1 where report_date='2026-01-14'"),/TRANSPORT_BOUND_OUTBOX_REQUIRES_NEW_WORKER/);
 checks.push('Concurrent whole-group claim; exact additive rollback retains queue/log/history and old functions; legacy bound retry fail-closed instead of new-key resend');
 console.log(JSON.stringify({scope:'REAL_ISOLATED_POSTGRES_ACTUAL_SENDER_DOCUMENTED_MEMORY_TRANSPORT',checks,external_line_requests:0,production_changed:false,real_delivery_verified:false}));
}finally{try{run(['rm','-f',container]);}catch{}}

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {MODEL,DELIVERY_ROOT,validatePhase,phaseBudget,readRegularSource,cleanupOwnedContainer,assertLocalDockerEndpoint,assertOwnedInspection,selectedColumns,memberId,expectedTier,workloadSql,quantiles,parseTransactionLogs,parsePgbench,safePlan} from '../scripts/operations/member-capacity-20261020.mjs';

test('10,000 accounts are not 10,000 connections: separate bounded steady/peak assumptions',()=>{
 assert.equal(MODEL.members,10000);assert.equal(validatePhase(MODEL.steady).rate,20);assert.equal(validatePhase(MODEL.peak).rate,100);
 assert.equal(MODEL.max_clients,16);assert.equal(MODEL.max_connections,24);
 for(const change of [{clients:10000},{rate:1000},{seconds:31},{seconds:0},{clients:0},{active_fraction:1},{think_seconds:0},{url:'https://example.com'}])assert.throws(()=>validatePhase({...MODEL.peak,...change}));
});
test('transaction ceilings are integer per-client limits, not Poisson expected counts',()=>{
 assert.deepEqual(phaseBudget(MODEL.steady),{transactions_per_client:75,hard_transaction_cap:300,process_timeout_ms:25000});
 assert.deepEqual(phaseBudget(MODEL.peak),{transactions_per_client:93,hard_transaction_cap:1488,process_timeout_ms:25000});
 for(let seconds=1;seconds<=30;seconds++)for(const phase of [MODEL.steady,MODEL.peak]){const b=phaseBudget({...phase,seconds});assert(b.hard_transaction_cap<=3000);assert.equal(b.hard_transaction_cap,b.transactions_per_client*phase.clients);}
 assert.throws(()=>phaseBudget({...MODEL.peak,seconds:31}));assert.equal(DELIVERY_ROOT,fileURLToPath(new URL('../product-delivery-20261020',import.meta.url)));
});
test('read allowlist refuses traversal, symlinks and oversized source, without reading arbitrary files',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ma-capacity-negative-'));
 try{
  const path='supabase/functions/member-access/index.ts',parent=join(dir,'supabase/functions/member-access');mkdirSync(parent,{recursive:true});
  assert.throws(()=>readRegularSource('../AGENTS.md',dir),/NOT_ALLOWLISTED/);
  const file=join(dir,path),other=join(dir,'synthetic.ts');writeFileSync(other,'SYNTHETIC');symlinkSync(other,file);assert.throws(()=>readRegularSource(path,dir),/SYMLINK/);rmSync(file);
  writeFileSync(file,Buffer.alloc(1048577));assert.throws(()=>readRegularSource(path,dir),/BOUNDED_SOURCE/);
  writeFileSync(file,'SYNTHETIC');assert.equal(readRegularSource(path,dir).toString(),'SYNTHETIC');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('cleanup wrong owner, Docker failure or surviving container cannot produce verified removal',()=>{
 const good={Name:'/synthetic',Config:{Labels:{'morning-alpha.member-capacity':'nonce'}},HostConfig:{NetworkMode:'none',ReadonlyRootfs:true}};
 let removed=false;const docker=args=>{if(args[0]==='rm'){removed=true;return '';}return removed?'':'id';};
 assert.equal(cleanupOwnedContainer(docker,()=>good,'synthetic','nonce').status,'VERIFIED_REMOVED');assert(removed);
 removed=false;assert.throws(()=>cleanupOwnedContainer(docker,()=>({...good,Name:'/foreign'}),'synthetic','nonce'));assert.equal(removed,false);
 assert.throws(()=>cleanupOwnedContainer(()=>{throw Error('SYNTHETIC_DOCKER_FAIL');},()=>good,'synthetic','nonce'),/DOCKER_FAIL/);
 assert.throws(()=>cleanupOwnedContainer(()=> 'id',()=>good,'synthetic','nonce'),/REMAINS/);
});
test('only local Unix Docker sockets; no remote daemon or endpoint redirection',()=>{
 assert.equal(assertLocalDockerEndpoint('unix:///private/tmp/owned.sock'),'unix:///private/tmp/owned.sock');
 for(const url of ['tcp://127.0.0.1:2375','tcp://example.com:2375','ssh://host','https://example.com','unix:///tmp/../x.sock','unix:///tmp/x.sock?host=evil'])assert.throws(()=>assertLocalDockerEndpoint(url));
});
test('cleanup/loads require owned, network-none, read-only, unpublished containers',()=>{
 const info={Name:'/synthetic',Config:{Labels:{'morning-alpha.member-capacity':'nonce'}},HostConfig:{NetworkMode:'none',ReadonlyRootfs:true,Privileged:false,PortBindings:{},Binds:[]}};
 assertOwnedInspection(info,'synthetic','nonce');
 for(const mutate of [i=>i.Name='/other',i=>i.Config.Labels={},i=>i.HostConfig.NetworkMode='host',i=>i.HostConfig.ReadonlyRootfs=false,i=>i.HostConfig.Privileged=true,i=>i.HostConfig.PortBindings={'5432/tcp':[{}]},i=>i.HostConfig.Binds=['/private/tmp:/data']]){const f=structuredClone(info);mutate(f);assert.throws(()=>assertOwnedInspection(f,'synthetic','nonce'));}
});
test('workload derives exact existing member-access select fields rather than a substitute service',()=>{
 const source=readFileSync(new URL('../supabase/functions/member-access/index.ts',import.meta.url),'utf8');
 const columns=Object.fromEntries(['profiles','member_entitlements','membership_access_config'].map(t=>[t,selectedColumns(source,t)]));
 assert.equal(columns.profiles,'role,subscription_status,membership_tier,paid_until');assert.match(columns.member_entitlements,/state,tier,source,/);
 const sql=workloadSql(columns);assert.match(sql,/BEGIN READ ONLY/);assert.match(sql,/SET LOCAL ROLE service_role/);assert.match(sql,/SET LOCAL ROLE authenticated/);
 assert.match(sql,/get_member_policy_receipt_v1/);assert.match(sql,/get_academy_catalog_v11/);assert.match(sql,/academy_progress_v11/);assert.match(sql,/ROLLBACK/);
 assert.doesNotMatch(sql,/INSERT|UPDATE|DELETE|ensure_member_entitlement|billing_event|http|LINE/);
 for(const bad of [source.replace('role,subscription_status,membership_tier,paid_until','*'),source+source,''])assert.throws(()=>selectedColumns(bad,'profiles'));
});
test('deterministic 10,000 synthetic IDs and independent expected tier distribution',()=>{
 const ids=new Set(),counts={free:0,premium:0,owner:0};for(let i=1;i<=10000;i++){ids.add(memberId(i));counts[expectedTier(i)]++;}
 assert.equal(ids.size,10000);assert.deepEqual(counts,{free:4999,premium:5000,owner:1});
 for(const i of [0,-1,10001,1.5,NaN])assert.throws(()=>memberId(i));
});
test('latency quantiles are nearest-rank and scheduled wait is not mislabeled as execution',()=>{
 assert.deepEqual(quantiles([4,1,2,3]),{count:4,p50_ms:2,p95_ms:4,p99_ms:4,max_ms:4});
 const r=parseTransactionLogs('0 1 3000 0 1 1 1000\n1 2 5000 0 1 2 2000');
 assert.equal(r.scheduled_latency.p95_ms,5);assert.equal(r.execution_latency.p95_ms,3);assert.equal(r.schedule_lag.p95_ms,2);
 assert.throws(()=>parseTransactionLogs('0 1 1000 0 1 1 2000'));assert.throws(()=>parseTransactionLogs('INVALID'));assert.throws(()=>quantiles([]));
});
test('failures/skips cannot become a load PASS, and missing summary fails closed',()=>{
 const summary=parsePgbench('number of transactions actually processed: 7\nnumber of failed transactions: 2 (20%)\nnumber of transactions skipped: 1 (10%)\ntps = 4.5 (without initial connection time)');
 assert.deepEqual(summary,{completed:7,failed:2,skipped:1,tps:4.5});
 const logs=parseTransactionLogs('0 1 2000 0 1 1 1000\n0 2 skipped 0 1 1 0\n0 3 failed 0 1 1 0');assert.equal(logs.failed,1);assert.equal(logs.skipped,1);
 assert.throws(()=>parsePgbench('tps = 10000'));assert.throws(()=>parseTransactionLogs(''));
});
test('EXPLAIN safe projection keeps actual DB metrics, excludes predicates/IDs/raw payload',()=>{
 const p=safePlan([{'Plan':{'Node Type':'Index Scan','Index Name':'profiles_pkey','Index Cond':"id='SYNTHETIC'",'Actual Rows':1,'Actual Total Time':.1},'Execution Time':.2,'Planning Time':.1}]);
 assert.equal(p.plan['Index Name'],'profiles_pkey');assert.equal(p.execution_ms,.2);assert(!JSON.stringify(p).includes('SYNTHETIC'));assert.throws(()=>safePlan([]));
});
test('runner never pulls/exposes a DB, calls external services, loads env, or swallows cleanup failure',()=>{
 const code=readFileSync(new URL('../scripts/operations/member-capacity-20261020.mjs',import.meta.url),'utf8');
 assert.match(code,/'--pull','never'/);assert.match(code,/'--network','none'/);assert.match(code,/CLEANUP_CONTAINER_REMAINS/);assert.match(code,/report\.cleanup=\{status:'FAIL'/);
 assert.doesNotMatch(code,/fetch\(|['"]\.env\b|docker.*prune|PGRST_DB_URI|SUPABASE_SERVICE_ROLE_KEY/);
 assert.deepEqual([...code.matchAll(/process\.env\.([A-Z_]+)/g)].map(m=>m[1]),['PATH']);
 assert.match(code,/UNKNOWN_NOT_PROVEN/);assert.match(code,/cost:'UNKNOWN'/);assert.match(code,/production_auth_e2e:false/);
});

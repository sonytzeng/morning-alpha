import assert from 'node:assert/strict';
import {execFileSync,execFile} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';import vm from 'node:vm';
const db=process.env.MA_ISOLATED_TEST_DB,container=process.env.MA_TEST_DOCKER_CONTAINER;
assert.match(db||'',/^ma_cockpit_test\d+$/);assert.match(container||'',/^ma-entry-ci-\d+$/);
const run=(args,input)=>execFileSync('docker',args,{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:8e6}).trim();
assert.equal(JSON.parse(run(['inspect',container]))[0].HostConfig.NetworkMode,'none');
const args=name=>['exec','-i',container,'psql','-X','-q','-U','postgres','-d',name,'-At','-v','ON_ERROR_STOP=1'];
const sql=s=>run(args(db),s),read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
assert.equal(run(args('postgres'),`select count(*) from pg_database where datname='${db}'`),'0');run(args('postgres'),`create database ${db}`);
sql(read('tests/fixtures/research-foundation-dependencies.sql'));
sql(read('supabase/migrations/20261004033642_intelligence_foundation_owner_shadow_v1.sql'));
sql(`create function research_private.lab_require_owner(p_owner uuid) returns void language plpgsql security definer set search_path='' as $$ begin
 if not exists(select from research_private.owner_access a join public.profiles p on p.id=a.principal_id where a.principal_id=p_owner and a.enabled and lower(p.role)='admin') then raise exception 'RESEARCH_OWNER_REQUIRED';end if;end $$;
 revoke all on function research_private.lab_require_owner(uuid) from public,anon,authenticated,service_role;`);
const owner='10000000-0000-4000-8000-000000000001',member='10000000-0000-4000-8000-000000000002',paid='10000000-0000-4000-8000-000000000003';
sql(`insert into profiles values('${owner}','admin'),('${member}','member'),('${paid}','paid');insert into research_private.owner_access(principal_id,enabled,approval_reference) values('${owner}',true,'SYNTHETIC_LOCAL_ONLY');`);
const hash=()=>sql("select md5(string_agg(pg_get_functiondef(oid),'' order by oid)) from pg_proc where proname in ('uid','is_research_owner_v1','lab_require_owner')");
const before=hash();sql(read('supabase/migrations/20261008213105_owner_trading_cockpit_ledger_v1.sql'));assert.equal(hash(),before);
const j=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
const fill=(over={})=>({book:'LIVE',symbol:'2330',action:'BUY',quantity:10,price:100,fee:10,tax:0,other_cost:0,occurred_at:'2026-01-02T02:00:00Z',reason:'ISOLATED TEST ONLY',...over});
const statement=(f,key=randomUUID(),who=owner)=>`set role service_role;select owner_cockpit_record_v1('${who}','${key}',${j(f)});`;
const add=(f,key,who)=>JSON.parse(sql(statement(f,key,who)));
const get=()=>JSON.parse(sql(`set role service_role;select owner_cockpit_read_v1('${owner}');`));
const position=(symbol='2330',book='LIVE')=>get().positions.find(p=>p.symbol===symbol&&p.book===book);
const count=()=>get().audit.length;
const denied=(fn,re)=>assert.throws(fn,re);
const key=randomUUID();add(fill(),key);assert.equal(add(fill(),key).status,'ALREADY_RECORDED');
denied(()=>add(fill({quantity:11}),key),/IDEMPOTENCY_CONFLICT/);
add(fill({price:200,fee:20,occurred_at:'2026-01-03T02:00:00Z'}));assert.equal(position().average_cost,151.5);
add(fill({action:'SELL',quantity:5,price:250,fee:5,tax:3,other_cost:2,occurred_at:'2026-01-04T02:00:00Z'}));
assert.equal(position().quantity,15);assert.equal(position().cost,2272.5);assert.equal(position().realized,482.5);
add(fill({quantity:5,fee:5,occurred_at:'2026-01-05T02:00:00Z'}));assert.equal(position().average_cost,138.875);
const n=count();denied(()=>add(fill({action:'SELL',quantity:21,occurred_at:'2026-01-06T02:00:00Z'})),/OVERSELL/);assert.equal(count(),n);
// Canceling an earlier buy would make the chronological sell invalid; entire request rolls back.
const needed=add(fill({symbol:'2603',quantity:5}));
add(fill({symbol:'2603',action:'SELL',quantity:5,occurred_at:'2026-01-04T02:00:00Z'}));
denied(()=>add(fill({symbol:'2603',action:'VOID',quantity:null,price:null,replaces:needed.id})),/OVERSELL/);
// Independent symbol: cancel then corrected re-entry never destroys original audit.
const correctable=add(fill({symbol:'2317'}));const replacement=add(fill({symbol:'2317',price:110,replaces:correctable.id,reason:'輸入價格更正'}));
assert.equal(position('2317').average_cost,111);assert(get().audit.find(r=>r.id===correctable.id).superseded);
add(fill({symbol:'2317',action:'VOID',quantity:null,price:null,replaces:replacement.id,reason:'取消誤記'}));assert.equal(position('2317'),undefined);
denied(()=>add(fill({replaces:correctable.id})),/CORRECTION_INVALID/);
add(fill({book:'PAPER',quantity:2,fee:0}));assert.equal(position('2330','PAPER').quantity,2);assert.equal(position().quantity,20);
add(fill({symbol:'2454',fee:null}));assert.equal(position('2454').cost,null);assert.equal(position('2454').average_cost,null);
add(fill({symbol:'2454',action:'SELL',quantity:10,occurred_at:'2026-01-07T02:00:00Z'}));assert.equal(position('2454').realized,null);
assert.equal(position('2454').quantity,0);
// Single buy/full sell with explicit fees and tax.
add(fill({symbol:'3008',quantity:1,fee:1}));add(fill({symbol:'3008',action:'SELL',quantity:1,price:110,fee:1,tax:2,other_cost:1,occurred_at:'2026-01-07T02:00:00Z'}));
assert.equal(position('3008').realized,5);assert.equal(position('3008').cost,0);
const asyncSQL=input=>new Promise((resolve,reject)=>{const c=execFile('docker',args(db),{encoding:'utf8'},(e,out)=>e?reject(e):resolve(out));c.stdin.end(input);});
const concurrent=await Promise.allSettled([1,2].map(()=>asyncSQL(statement(fill({action:'SELL',quantity:15,occurred_at:'2026-01-08T02:00:00Z'})))));
assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);assert.equal(position().quantity,5);
for(const who of [member,paid])denied(()=>add(fill(),undefined,who),/RESEARCH_OWNER_REQUIRED/);
for(const role of ['anon','authenticated']){
 denied(()=>sql(`set role ${role};select owner_cockpit_read_v1('${owner}');`),/permission denied/);
 denied(()=>sql(`set role ${role};select * from research_private.owner_cockpit_ledger;`),/permission denied/);
}
denied(()=>sql('update research_private.owner_cockpit_ledger set fee=0'),/APPEND_ONLY/);
denied(()=>sql('delete from research_private.owner_cockpit_ledger'),/APPEND_ONLY/);
denied(()=>sql('truncate research_private.owner_cockpit_ledger'),/APPEND_ONLY/);
denied(()=>add(fill({price:'NaN'})),/DECIMAL_INVALID/);denied(()=>add(fill({occurred_at:'2999-01-01T00:00:00Z'})),/FUTURE/);
assert.equal(hash(),before);
// Same deployed handler source; only network/auth adapter replaced for an
// explicitly synthetic local identity. Every new journal RPC executes real SQL.
const object=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
const buildClient=(_url,_key,options)=>{
 const token=options?.global?.headers?.Authorization?.slice(7),uid=({owner,member,paid})[token];
 return {auth:{getUser:async()=>({data:{user:uid?{id:uid}:null},error:!uid})},
  rpc:async(name,p)=>{try{if(name==='is_research_owner_v1')return {data:sql(`begin;set local role authenticated;set local request.jwt.claim.sub='${uid}';select is_research_owner_v1();rollback;`)==='t',error:null};
   if(name==='market_calendar_session_v1')return{data:true,error:null};
   const text=name==='owner_cockpit_read_v1'?`select owner_cockpit_read_v1('${p.p_owner}')`:`select owner_cockpit_record_v1('${p.p_owner}','${p.p_request}',${j(p.p_fill)})`;
   return{data:JSON.parse(sql('set role service_role;'+text)),error:null};}catch(e){return{data:null,error:{message:e.message}};}},
  from:()=>{const q={then:resolve=>resolve({data:[],error:null})};for(const k of ['select','in','eq','lte','order','limit'])q[k]=()=>q;return q;}};
};
const exp={};vm.runInNewContext(ts.transpileModule(read('supabase/functions/owner-trading-lab-v1/index.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 {exports:exp,Request,Response,Date,Deno:{env:{get:()=>''},serve:()=>{}},require:name=>name.includes('supabase-js')?{createClient:buildClient}:name.includes('owner-trading-lab')?{object,records:v=>Array.isArray(v)?v:[],taipeiDate:()=> '2026-01-09'}:{}});
const request=async(body,token)=>{const r=await exp.handleOwnerTradingLab(new Request('http://localhost/only-isolated',{method:'POST',headers:token?{Authorization:'Bearer '+token}:{},body:JSON.stringify(body)}));return{status:r.status,data:await r.json()};};
for(const token of [undefined,'wrong','member','paid'])assert([401,403].includes((await request({operation:'COCKPIT_READ'},token)).status));
assert.equal((await request({operation:'COCKPIT_READ'},'owner')).status,200);
const httpFill={operation:'COCKPIT_RECORD',request_id:randomUUID(),fill:fill({symbol:'2881'})};
assert.equal((await request(httpFill,'owner')).data.status,'RECORDED');assert.equal((await request(httpFill,'owner')).data.status,'ALREADY_RECORDED');
assert.equal((await request({operation:'COCKPIT_RECORD',request_id:randomUUID(),fill:fill({symbol:'2881',action:'SELL',quantity:11})},'owner')).data.error,'OVERSELL');
console.log(JSON.stringify({fresh_db:db,accounting:'PASS',partial_sell:'PASS',average_cost:'PASS',fees:'PASS',unknown_fees:'PASS',correction_audit:'PASS',idempotency:'PASS',concurrency_oversell:'PASS',paper_live_isolation:'PASS',non_owner:'DENY',immutable:'PASS',existing_auth_diff:0,production_used:false}));

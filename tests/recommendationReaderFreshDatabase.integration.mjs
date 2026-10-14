// Real network-none PostgreSQL/RLS; isolated values, NOT Production member E2E.
import assert from 'node:assert/strict';import {readFileSync}from'node:fs';import {execFileSync}from'node:child_process';
import {buildEvidenceDecision}from'../supabase/functions/_shared/decision-v1-evidence.ts';
import {evidenceRows,IDENTITY}from'./fixtures/decision-evidence-rows.mjs';
import vm from'node:vm';import ts from'typescript';
import * as phase from'../supabase/functions/_shared/recommendation-phase.ts';
import * as sessions from'../supabase/functions/_shared/market-session-contract.mjs';
const name='ma-reader-fresh-'+process.pid,run=(a,input)=>execFileSync('docker',a,{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:20e6}).trim();
const sql=input=>run(['exec','-i',name,'psql','-h','127.0.0.1','-XqAt','-U','postgres','-v','ON_ERROR_STOP=1'],input);
try{
 run(['run','-d','--name',name,'--network','none','--env','POSTGRES_PASSWORD=isolated-only','postgres:17']);
 let ready=false;for(let i=0;i<60;i++){try{sql('select 1');ready=true;break;}catch{await new Promise(r=>setTimeout(r,250));}}assert(ready);
 const fixture=readFileSync(new URL('./fixtures/six-bug-schema-only-20260930.sql',import.meta.url),'utf8');
 const start=fixture.indexOf('CREATE TABLE public.market_quotes ('),end=fixture.indexOf('\n\n\n--',start);assert(start>=0&&end>start);
 sql('create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;'+fixture.slice(start,end));
 sql('alter table public.market_quotes enable row level security;alter table public.market_quotes force row level security;revoke all on public.market_quotes from public,anon,authenticated;grant select on public.market_quotes to service_role;');
 for(const role of ['anon','authenticated'])assert.throws(()=>sql('set role '+role+';select *from public.market_quotes'),/permission denied/);
 assert.equal(sql('set role service_role;select count(*)from public.market_quotes'),'0');
 const before=sql("select jsonb_build_object('rls',relrowsecurity,'force',relforcerowsecurity,'acl',relacl,'policies',(select count(*)from pg_policies where tablename='market_quotes'))from pg_class where oid='public.market_quotes'::regclass");
 const old=execFileSync('git',['show','2a5d461ec3d98bfc8bc3177a295c95e299b7bda2:supabase/functions/_shared/decision-v1-evidence.ts'],{encoding:'utf8'});
 const exports={};vm.runInNewContext(ts.transpileModule(old,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,
  {exports,Date,Intl,URL,require:p=>p==='./recommendation-phase.ts'?phase:p==='./market-session-contract.mjs'?sessions:(()=>{throw Error(p)})()});
 const data=evidenceRows(),row=data.quotes.filter(q=>q.symbol==='2330'&&q.phase==='close').at(-1);
 const raw={contract:'RECOMMENDATION_STOCK_EVIDENCE_V1',endpoint:'historical/candles',volume_unit:'SHARES',volume_shares:1000000,amount_unit:'TWD',amount_twd:100000000};
 data.quotes.push({...row,id:'stock-evidence:'+row.id,raw_payload:raw});row.raw_payload={};row.id='a-core-'+row.id;
 const oldResult=exports.buildEvidenceDecision(data,IDENTITY),fixed=buildEvidenceDecision(data,IDENTITY);
 assert(oldResult.screening.rejected.find(r=>r.symbol==='2330').reasons.includes('20_DAILY_VOLUMES_MISSING'));
 assert(!fixed.screening.rejected.some(r=>r.symbol==='2330'&&r.reasons.includes('20_DAILY_VOLUMES_MISSING')));
 assert.deepEqual(JSON.parse(JSON.stringify(exports.buildEvidenceDecision(data,IDENTITY))),JSON.parse(JSON.stringify(oldResult)),'exact rollback executes original code and reproduces original result');
 assert.equal(sql("select jsonb_build_object('rls',relrowsecurity,'force',relforcerowsecurity,'acl',relacl,'policies',(select count(*)from pg_policies where tablename='market_quotes'))from pg_class where oid='public.market_quotes'::regclass"),before);
 console.log(JSON.stringify({scope:'ACTUAL_ISOLATED_POSTGRES_RLS_AND_EXACT_SOURCE_ROLLBACK',fresh_db:'PASS',anon:'DENY',free_paid_raw:'DENY',service_read:'PASS',acl_rls_unchanged:true,exact_rollback:'PASS',production_changed:false}));
}finally{try{run(['rm','-f',name]);}catch{}}

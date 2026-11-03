// Isolated PostgreSQL only. Vault and pg_net are synthetic fixtures; no HTTP
// request, production credential or live source is used by this test.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const module=process.env.MA_PGLITE_MODULE;assert(module?.startsWith('/'),'LOCAL_PGLITE_MODULE_REQUIRED');
const {PGlite}=await import(module),db=new PGlite();await db.waitReady;
const batchA='a'.repeat(64),batchB='b'.repeat(64),missing='f'.repeat(64),token='isolated-test-token-not-a-production-secret';
try{
 await db.exec(`
  create role anon;create role authenticated;create role service_role;
  create schema vnext_runtime;create schema vault;create schema net;
  create table vnext_runtime.ai_stock_batches(id text primary key);
  create table vault.decrypted_secrets(name text,decrypted_secret text,created_at timestamptz);
  create table net.mock_requests(id bigserial primary key,url text,headers jsonb,body jsonb,timeout_milliseconds integer);
  create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint
   language plpgsql as $$declare request_id bigint;begin
    insert into net.mock_requests(url,headers,body,timeout_milliseconds) values(url,headers,body,timeout_milliseconds) returning id into request_id;
    return request_id;
   end$$;
  revoke all on schema vault,net from public,anon,authenticated,service_role;
  revoke all on vault.decrypted_secrets,net.mock_requests from public,anon,authenticated,service_role;
 `);
 await db.query('insert into vnext_runtime.ai_stock_batches(id) values($1),($2)',[batchA,batchB]);
 await db.query("insert into vault.decrypted_secrets values('morning_alpha_daily_delivery_token',$1,'2026-10-31T01:00:00Z')",[token]);
 const sql=readFileSync(new URL('../research/daily-ai-dispatch.candidate.sql',import.meta.url),'utf8');
 await db.exec(sql);
 const call=async batch=>(await db.query('select public.dispatch_daily_stock_ai_batch_v1($1) result',[batch])).rows[0].result;
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);
  await assert.rejects(()=>call(batchA),/permission denied/);
  await assert.rejects(()=>db.query('select * from vnext_runtime.ai_stock_dispatches'),/permission denied/);
  await assert.rejects(()=>db.query('select * from vault.decrypted_secrets'),/permission denied/);
  await db.exec('reset role');
 }
 await db.exec('set role service_role');
 await assert.rejects(()=>db.query('select * from vnext_runtime.ai_stock_dispatches'),/permission denied/);
 await assert.rejects(()=>db.query('select * from vault.decrypted_secrets'),/permission denied/);
 for(const bad of [null,'','g'.repeat(64),'a'.repeat(63),'a'.repeat(65)])await assert.rejects(()=>call(bad),/AI_DISPATCH_SCOPE/);
 await assert.rejects(()=>call(missing),/AI_DISPATCH_BATCH_MISSING/);
 const first=await call(batchA);assert.equal(first.state,'DISPATCHED');assert.equal(first.batch_id,batchA);assert.equal(first.member_published,false);
 assert(!JSON.stringify(first).includes(token));assert(!Object.hasOwn(first,'token'));assert(!Object.hasOwn(first,'headers'));
 await db.exec('reset role');
 const request=(await db.query('select * from net.mock_requests')).rows[0];
 assert.equal(request.url,'https://cttfzgvhiewfckydcrci.supabase.co/functions/v1/daily-stock-analysis-v1');
 assert.equal(request.headers['x-daily-delivery-token'],token);assert.equal(request.headers['Content-Type'],'application/json');
 assert.deepEqual(request.body,{batch_id:batchA});assert.equal(request.timeout_milliseconds,60000);
 assert(!JSON.stringify(request.body).includes(token));
 // Race-shaped callers reach the same single PostgreSQL/WASM connection;
 // PGlite serializes statements, so this proves the cap at the SQL boundary,
 // not a multi-connection production load or lock-wait timing assertion.
 await db.query('insert into vnext_runtime.ai_stock_dispatches(request_id,batch_id) select n,$1 from generate_series(1000,1213)n',[batchA]);
 assert.equal((await db.query('select count(*)::int n from vnext_runtime.ai_stock_dispatches where batch_id=$1',[batchA])).rows[0].n,215);
 await db.exec('set role service_role');
 const competing=await Promise.all(Array.from({length:8},()=>call(batchA)));
 assert.equal(competing.filter(r=>r.state==='DISPATCHED').length,1);
 assert.equal(competing.filter(r=>r.state==='DISPATCH_BUDGET_EXHAUSTED').length,7);
 assert(competing.every(r=>!JSON.stringify(r).includes(token)));
 assert.equal((await call(batchA)).state,'DISPATCH_BUDGET_EXHAUSTED');
 await db.exec('reset role');
 assert.equal((await db.query('select count(*)::int n from vnext_runtime.ai_stock_dispatches where batch_id=$1',[batchA])).rows[0].n,216);
 assert.equal((await db.query('select count(*)::int n from net.mock_requests')).rows[0].n,2);
 // Test absent and unusable Vault values before allowing a mock HTTP enqueue.
 await db.exec('delete from vault.decrypted_secrets');await db.exec('set role service_role');
 await assert.rejects(()=>call(batchB),/AI_DISPATCH_CREDENTIAL_UNAVAILABLE/);
 await db.exec('reset role');await db.query("insert into vault.decrypted_secrets values('morning_alpha_daily_delivery_token',$1,clock_timestamp())",['short-test-token']);
 await db.exec('set role service_role');await assert.rejects(()=>call(batchB),/AI_DISPATCH_CREDENTIAL_UNAVAILABLE/);await db.exec('reset role');
 await db.exec('delete from vault.decrypted_secrets');
 await db.query("insert into vault.decrypted_secrets values('morning_alpha_daily_delivery_token',$1,clock_timestamp())",['x'.repeat(513)]);
 await db.exec('set role service_role');await assert.rejects(()=>call(batchB),/AI_DISPATCH_CREDENTIAL_UNAVAILABLE/);await db.exec('reset role');
 assert.equal((await db.query('select count(*)::int n from vnext_runtime.ai_stock_dispatches where batch_id=$1',[batchB])).rows[0].n,0);
 assert.equal((await db.query('select count(*)::int n from net.mock_requests')).rows[0].n,2);
 const rls=(await db.query("select relrowsecurity,relforcerowsecurity from pg_class where oid='vnext_runtime.ai_stock_dispatches'::regclass")).rows[0];
 assert(rls.relrowsecurity&&rls.relforcerowsecurity);
 console.log('PASS: dispatch role/raw isolation, exact retained batch selector, server-only token, SQL budget cap 216, missing/bad selectors and missing/short/oversized credentials fail without enqueue. Isolated pg_net/Vault fixtures only.');
}finally{await db.close();}

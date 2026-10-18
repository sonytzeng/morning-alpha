// Real disposable PostgreSQL contract, not a Supabase Storage HTTP/Gateway E2E.
// Derived from the read-only Production RLS/index catalog on2026-10-17.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {startAuthEnvironment} from '../scripts/academy-v11/auth-environment.mjs';

const runtime=await startAuthEnvironment();
const prefix='ma-academy-auth-'+process.pid,db=prefix+'-db';
const insert="set role service_role;insert into storage.objects(bucket_id,name)values('v1-provider-capability-review-20261017','once.json') returning 1;";
let result;
try{
 runtime.sql(`create schema storage;
 create table storage.buckets(id text primary key,public boolean not null);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id),name text not null,version text,archived_at timestamptz,is_versioned boolean not null default false);
 create unique index objects_bucket_id_name_version_key on storage.objects(bucket_id,name collate "C",version) nulls not distinct;
 create unique index idx_objects_current_version on storage.objects(bucket_id,name collate "C") where archived_at is null;
 create unique index idx_objects_null_version on storage.objects(bucket_id,name collate "C") where not is_versioned;
 alter table storage.buckets enable row level security;
 alter table storage.objects enable row level security;
 grant usage on schema storage to anon,authenticated,service_role;
 grant select,insert,delete on storage.buckets,storage.objects to anon,authenticated,service_role;
 insert into storage.buckets values('v1-provider-capability-review-20261017',false);`);
 assert.equal(runtime.sql("select count(*) from pg_policies where schemaname='storage'"),'0');
 for(const role of ['anon','authenticated']){
  assert.equal(runtime.sql(`set role ${role};select count(*) from storage.buckets;`),'0');
  assert.equal(runtime.sql(`set role ${role};select count(*) from storage.objects;`),'0');
  assert.throws(()=>runtime.sql(`set role ${role};insert into storage.objects(bucket_id,name)values('v1-provider-capability-review-20261017','once.json');`),/LOCAL_ACADEMY_DOCKER_OPERATION_FAILED/);
 }
 const claim=()=>new Promise(resolve=>{
  const child=spawn('docker',['exec','-i',db,'psql','-h','127.0.0.1','-XqAt','-U','postgres','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='';
  child.stdout.on('data',b=>{stdout+=b;});child.stderr.on('data',b=>{stderr+=b;});
  child.on('error',()=>resolve({status:-1,success:false,duplicate:false}));
  child.on('close',status=>resolve({status,success:status===0&&stdout.trim()==='1',duplicate:status!==0&&/duplicate key value violates unique constraint/.test(stderr)}));
  child.stdin.end(insert);
 });
 const results=await Promise.all(Array.from({length:8},claim));
 assert.equal(results.filter(r=>r.success).length,1);
 assert.equal(results.filter(r=>r.duplicate).length,7);
 assert.equal(runtime.sql('select count(*) from storage.objects'),'1');
 for(const role of ['anon','authenticated'])runtime.sql(`set role ${role};delete from storage.objects where name='once.json';`);
 assert.equal(runtime.sql('select count(*) from storage.objects'),'1');
 assert.throws(()=>runtime.sql(insert),/LOCAL_ACADEMY_DOCKER_OPERATION_FAILED/);
 const protectedBefore=runtime.sql("select md5(coalesce(jsonb_agg(to_jsonb(p) order by id)::text,'')) from public.profiles p");
 runtime.sql("set role service_role;select public.is_research_owner_v1();");
 assert.equal(runtime.sql("select md5(coalesce(jsonb_agg(to_jsonb(p) order by id)::text,'')) from public.profiles p"),protectedBefore);
 result={schema:'PROVIDER_CAPABILITY_FRESH_SQL_CONTROL_V1',scope:'REAL_DISPOSABLE_POSTGRES_NOT_STORAGE_HTTP_OR_PRODUCTION',concurrent_claims:8,accepted:1,duplicates:7,
  anon_member_rls:'DENY_DEFAULT_WITH_RLS_ON_NO_POLICIES',member_delete_effect:0,control_objects:1,profile_diff:0,provider_calls:0,production_operations:0};
}finally{runtime.cleanup();}
for(const name of [db,prefix+'-auth',prefix+'-rest'])assert.notEqual(spawnSync('docker',['container','inspect',name],{stdio:'ignore'}).status,0,'temporary container remains');
assert.notEqual(spawnSync('docker',['network','inspect',prefix],{stdio:'ignore'}).status,0,'temporary network remains');
console.log(JSON.stringify({...result,temporary_resources_remaining:0}));

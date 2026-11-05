// Real disposable PostgreSQL + captured live reader/rights/access functions.
// Synthetic users, cards and reviews only; no Production writes or Auth E2E.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
assert(process.env.MA_PGLITE_MODULE?.startsWith('/'),'LOCAL_PGLITE_MODULE_REQUIRED');
const {PGlite}=await import(process.env.MA_PGLITE_MODULE),db=new PGlite();await db.waitReady;
const here=new URL('.',import.meta.url),read=name=>readFileSync(new URL(name,here),'utf8');
const baseline=JSON.parse(read('live-baseline.json')),manifest=JSON.parse(read('candidate-manifest.json'));
const sql=read('member-ai-delta.candidate.sql'),rollback=read('rollback.candidate.sql');
const sha=value=>createHash('sha256').update(value).digest('hex');
const id='a'.repeat(64),other='b'.repeat(64),USER='00000000-0000-0000-0000-000000000001';
const SECOND='00000000-0000-0000-0000-000000000002',OWNER='00000000-0000-0000-0000-000000000003';
let phase='bootstrap',checks=0;
const check=(actual,expected,message)=>{assert.deepEqual(actual,expected,message);checks++;};
const admin=()=>db.exec('reset role');
const login=async(user=USER,role='authenticated')=>{await admin();await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user??'']);await db.exec('set role '+role);};
const delta=async(known=null,tier=null)=>(await db.query('select public.get_daily_ai_member_research_delta_v1($1,$2) result',[known,tier])).rows[0].result;
const old=async()=>(await db.query('select public.get_daily_ai_member_research_v1() result')).rows[0].result;
const pins=async()=>Promise.all(manifest.pinned_readers.map(async p=>(await db.query("select encode(sha256(convert_to(pg_get_functiondef($1::regprocedure),'UTF8')),'hex') hash,proacl::text acl,prosecdef,provolatile,proconfig from pg_proc where oid=$1::regprocedure",[p.signature])).rows[0]));
const setField=async(table,field,value,where='')=>{await admin();await db.query('update vnext_private.'+table+' set '+field+'=$1 '+where,[value]);};
const seedEdition=async(edition,created,review)=>{
 const cards=Array.from({length:72},(_,i)=>['SHORT','MEDIUM','LONG'].map(horizon=>({symbol:String(1000+i),horizon,
  reason:'SYNTHETIC PRIVATE FACT '.repeat(250),sources:[{source:'https://synthetic.invalid/fact',evidence_id:'S'+i}],counter_evidence:[{text:'Synthetic risk'}]}))).flat();
 await db.query(`insert into vnext_private.ai_research_editions values($1,current_date,current_date,now()-interval '1 hour',$2,'2099-01-01',$3)`,[edition,created,{cards,source_urls:['https://synthetic.invalid/fact']}]);
 await db.query(`insert into vnext_private.ai_research_reviews values($1,$2,$2,'PASS','PASS','PASS','2020-01-01','2099-01-01')`,[review,edition]);
 await db.query(`insert into vnext_private.ai_research_publication_events(edition_id,review_id,action,audience) values($1,$2,'APPROVE','free')`,[edition,review]);
 await db.query(`insert into vnext_private.ai_research_use_reviews values($1,$2,$2,'OWN_ANALYSIS_ONLY',false,'PASS','2020-01-01','2020-01-01','2099-01-01',true)`,[review,edition]);
};
try{
 check(sha(sql),manifest.candidate_sql_sha256);check(sha(rollback),manifest.rollback_sql_sha256);
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;grant usage on schema auth to public;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table auth.users(id uuid primary key,is_anonymous boolean default false);
 create table public.profiles(id uuid primary key,role text,subscription_status text,paid_until timestamptz);
 create table public.member_entitlements(user_id uuid primary key,state text,access_ends_at timestamptz,current_period_end timestamptz,trial_ends_at timestamptz);
 create schema research_private;create table research_private.owner_access(principal_id uuid primary key,enabled boolean);
 create schema academy_private;create schema vnext_private;
 create table vnext_private.ai_research_editions(id text primary key,business_date date,through date,cutoff timestamptz,created_at timestamptz,expires_at timestamptz,payload jsonb);
 create table vnext_private.ai_research_reviews(id text primary key,edition_id text,snapshot_hash text,quality text,time_status text,licensing text,recorded_at timestamptz,expires_at timestamptz);
 create table vnext_private.ai_research_publication_events(id bigint generated always as identity,edition_id text,review_id text,action text,audience text);
 create table vnext_private.ai_research_use_reviews(id text primary key,edition_id text,snapshot_hash text,use_scope text,raw_redistribution boolean,quality text,reviewed_at timestamptz,recorded_at timestamptz,expires_at timestamptz,documents_ready boolean);
 create table vnext_private.source_licenses(source text,storage_allowed boolean,derived_allowed boolean,commercial_allowed boolean,reviewed_at timestamptz,expires_at timestamptz,document_url text,attribution text);`);
 for(const f of baseline.functions){
  check(sha(f.definition),f.definition_sha256);await db.exec(f.definition);
  const signature=manifest.pinned_readers.find(p=>p.signature.includes('.'+f.proname+'(')).signature;
  await db.exec('revoke all on function '+signature+' from public,anon,authenticated,service_role');
  if(f.acl.includes('authenticated='))await db.exec('grant execute on function '+signature+' to authenticated');
  if(f.acl.includes('service_role='))await db.exec('grant execute on function '+signature+' to service_role');
 }
 await db.query(`insert into auth.users(id) values($1),($2),($3)`,[USER,SECOND,OWNER]);
 await db.query(`insert into public.profiles values($1,'user','inactive',null),($2,'user','inactive',null),($3,'admin','inactive',null)`,[USER,SECOND,OWNER]);
 await db.query(`insert into public.member_entitlements values($1,'paid_active','2099-01-01',null,null),($2,'free',null,null,null)`,[USER,SECOND]);
 await db.query('insert into research_private.owner_access values($1,true)',[OWNER]);
 await seedEdition(id,'2020-01-01','review-a');
 const originalPins=await pins();
 for(let i=0;i<originalPins.length;i++)check(originalPins[i].hash,manifest.pinned_readers[i].hash);

 phase='fingerprint and ACL guards';
 const reader=baseline.functions.find(f=>f.proname==='get_daily_ai_member_research_v1');
 await db.exec(reader.definition.replace('begin\n','begin\n -- isolated reader drift\n'));
 await assert.rejects(()=>db.exec(sql),/AI_MEMBER_DELTA_READER_BASELINE_DRIFT/);checks++;await db.exec('rollback');
 await db.exec(reader.definition);
 await db.exec('revoke execute on function public.get_daily_ai_member_research_v1() from authenticated');
 await assert.rejects(()=>db.exec(sql),/AI_MEMBER_DELTA_READER_PRIVILEGE_DRIFT/);checks++;await db.exec('rollback');
 await db.exec('grant execute on function public.get_daily_ai_member_research_v1() to authenticated');
 await db.exec(sql);check(await pins(),originalPins,'Every original reader definition and ACL stays unchanged');
 const metadata=(await db.query("select prosecdef,provolatile,proconfig,proacl::text acl from pg_proc where oid='public.get_daily_ai_member_research_delta_v1(text,text)'::regprocedure")).rows[0];
 check(metadata,{prosecdef:false,provolatile:'s',proconfig:['search_path=""'],acl:'{postgres=X/postgres,authenticated=X/postgres}'});
 await assert.rejects(()=>db.exec(sql),/AI_MEMBER_DELTA_ALREADY_EXISTS/);checks++;await db.exec('rollback');

 phase='FULL and UNCHANGED preserve original projection';
 await login();const original=await old(),full=await delta();
 check(full.mode,'FULL');check(full.payload,original);check(full.user_id,USER);check(full.edition,original.edition);check(original.cards.length,216);
 const unchanged=await delta(id,'premium');check(unchanged.mode,'UNCHANGED');check(unchanged.user_id,USER);check(unchanged.edition,original.edition);
 check(Object.hasOwn(unchanged,'payload'),false);check(Object.hasOwn(unchanged,'cards'),false);check(unchanged.business_date,original.business_date);
 const fullBytes=Buffer.byteLength(JSON.stringify(full)),unchangedBytes=Buffer.byteLength(JSON.stringify(unchanged));
 check(fullBytes>1_000_000,true);check(unchangedBytes<1024,true);
 for(const [known,tier] of [[id,'free'],[other,'premium'],[null,'premium'],['not-a-hash','premium']])check((await delta(known,tier)).mode,'FULL');

 phase='tier changes and caller identity';
 await login(SECOND);const free=await delta(id,'premium');check(free.mode,'FULL');check(free.user_id,SECOND);check(free.tier,'free');check(free.payload.cards.length,9);
 check(free.payload.cards.every(c=>!Object.hasOwn(c,'sources')&&!Object.hasOwn(c,'counter_evidence')),true);
 const freeUnchanged=await delta(id,'free');check(freeUnchanged.mode,'UNCHANGED');check(freeUnchanged.user_id,SECOND);
 await login(OWNER);check((await delta(id,'premium')).mode,'FULL');check((await delta(id,'owner')).mode,'UNCHANGED');
 await admin();await db.query("update public.member_entitlements set state='expired' where user_id=$1",[USER]);
 await login();const downgraded=await delta(id,'premium');check(downgraded.mode,'FULL');check(downgraded.tier,'free');check(downgraded.payload.cards.length,9);
 await admin();await db.query("update public.member_entitlements set state='paid_active' where user_id=$1",[USER]);

 phase='old-reader execute permission cannot be bypassed by a known cache key';
 await db.exec('revoke execute on function public.get_daily_ai_member_research_v1() from authenticated');await login();
 await assert.rejects(()=>delta(id,'premium'),/permission denied/);checks++;
 await admin();await db.exec('grant execute on function public.get_daily_ai_member_research_v1() to authenticated');
 for(const role of ['anon','service_role']){await login(USER,role);await assert.rejects(()=>delta(id,'premium'),/permission denied/);checks++;}
 await login(null);await assert.rejects(()=>delta(id,'premium'),/MEMBER_REQUIRED/);checks++;
 await admin();await db.query('update auth.users set is_anonymous=true where id=$1',[USER]);await login();await assert.rejects(()=>delta(id,'premium'),/MEMBER_REQUIRED/);checks++;
 await admin();await db.query('update auth.users set is_anonymous=false where id=$1',[USER]);

 phase='publication withdrawal and review/edition expiry return FULL empty edition';
 const empty=async label=>{await login();const response=await delta(id,'premium');check(response.mode,'FULL',label);check(response.edition,null,label);check(response.payload.edition,null,label);check(response.payload.cards,[],label);};
 await setField('ai_research_publication_events','action','REVOKE');await empty('Publication withdrawn');
 await setField('ai_research_publication_events','action','APPROVE');
 for(const [table,field,bad,good] of [['ai_research_editions','expires_at','2000-01-01','2099-01-01'],['ai_research_reviews','expires_at','2000-01-01','2099-01-01'],['ai_research_reviews','quality','FAIL','PASS'],['ai_research_reviews','time_status','FAIL','PASS'],['ai_research_reviews','licensing','FAIL','PASS'],['ai_research_use_reviews','quality','FAIL','PASS'],['ai_research_use_reviews','documents_ready',false,true],['ai_research_use_reviews','expires_at','2000-01-01','2099-01-01']]){
  await setField(table,field,bad);await empty(table+'.'+field);await setField(table,field,good);
 }

 phase='new edition and latest review supersession';
 await admin();await seedEdition(other,'2020-01-02','review-b');await login();
 const newer=await delta(id,'premium');check(newer.mode,'FULL');check(newer.edition.id,other);check((await delta(other,'premium')).mode,'UNCHANGED');
 await admin();await db.query("insert into vnext_private.ai_research_use_reviews values('latest-fail',$1,$1,'OWN_ANALYSIS_ONLY',false,'FAIL','2020-02-01','2020-02-01','2099-01-01',true)",[other]);
 await login();const fallback=await delta(other,'premium');check(fallback.mode,'FULL');check(fallback.edition.id,id,'Latest failed source-use review cannot retain newer cached edition');
 await admin();await db.exec("insert into vnext_private.ai_research_reviews values('latest-quality-fail','"+id+"','"+id+"','FAIL','PASS','PASS','2020-02-01','2099-01-01')");
 await empty('Superseding quality review excludes old approved review');

 phase='restore exact RPC-only rollback';
 await admin();check(await pins(),originalPins,'Behavior tests do not require changing the original reader implementations');
 await db.exec(rollback);check((await db.query("select to_regprocedure('public.get_daily_ai_member_research_delta_v1(text,text)') value")).rows[0].value,null);
 check(await pins(),originalPins);
 const report={schema:'MEMBER_AI_DELTA_LOCAL_SQL_RESULT_V1',result:'PASS',checks,server_version:(await db.query('show server_version')).rows[0].server_version,
  full_json_bytes:fullBytes,unchanged_json_bytes:unchangedBytes,production_used:false,production_capacity_proven:false,db_cpu_reduction_claimed:false,
  current_entitlement_and_rights_checked_every_call:true,original_readers_modified:false,source_grants_written:false,candidate_sql_sha256:manifest.candidate_sql_sha256};
 writeFileSync(new URL('local-sql-result.json',here),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch(error){console.error(JSON.stringify({result:'FAIL',phase,checks,message:error.message,code:error.code}));process.exitCode=1;}
finally{await db.close();}

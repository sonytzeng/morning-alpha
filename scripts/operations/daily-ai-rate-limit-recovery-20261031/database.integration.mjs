// Isolated PostgreSQL17.5. Real application SQL; synthetic packets/results,
// instrumented local Vault/pg_net. No provider call or production mutation.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {canonical} from '../../../research/entry-opportunity.ts';
const module=process.env.MA_PGLITE_MODULE;assert(module?.startsWith('/'),'LOCAL_PGLITE_MODULE_REQUIRED');
const {PGlite}=await import(module),db=new PGlite();await db.waitReady;
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8'),sha=s=>createHash('sha256').update(s).digest('hex');
const candidate=read('candidate.sql'),baseline=JSON.parse(read('../../../build/recovery-live-baseline.json'));
const ORIGINAL='gpt-6-astra:DAILY_AI_STOCK_ANALYSIS_V1:prompt-7:reasoning-low',RECOVERY=ORIGINAL+':recovery-1';
const receiptTable='vnext_runtime.ai_stock_rate_limit_recovery_receipts_v1';
const review='a'.repeat(64),otherReview='b'.repeat(64),token='isolated-recovery-token-000000000';
const seedFile=process.env.MA_RECOVERY_SEED_FILE??'/workspace/scratch/3d0c86e17b1f/evidence/2330-long-bound-reviews-v2-new72.seed.json';
const seed=readFileSync(seedFile,'utf8'),PIN='0524783a79af043a70be593d2e019c435bc067f168a5b2567a831e32d78b4ddc';
assert.equal(sha(seed),PIN,'Exact retained seed required; this test never substitutes the production batch pin');
const body=JSON.parse(seed),cutoff=body.cutoff,through=body.through,symbols=Object.keys(body.packet_texts).sort();
assert.equal(symbols.length,72);assert.equal(seed,canonical(body));
// Stable logical fixture slots map to the retained actual72 symbols. All model
// result text/receipts remain synthetic and receive no review/publication.
const sym=s=>typeof s==='string'&&/^10\d\d$/.test(s)&&Number(s)>=1000&&Number(s)<1072?symbols[Number(s)-1000]:s;
const inputHash=s=>body.packet_hashes[sym(s)];
const identity=(symbol,revision)=>canonical({version:'DAILY_AI_BATCH_1',input_hash:inputHash(symbol),model_revision:revision});
const jobKey=(symbol,revision)=>sha(identity(symbol,revision));
const context=(symbol,revision)=>({symbol:sym(symbol),input_hash:inputHash(symbol),cutoff,model_revision:revision});
const analysis=(symbol,revision)=>({schema:'DAILY_AI_STOCK_ANALYSIS_V1',symbol:sym(symbol),input_hash:inputHash(symbol),cutoff,
 member_published:false,publication_ready:false,model_generated:true,receipt:{response_id:'isolated-'+jobKey(symbol,revision),model:'gpt-6-astra',input_tokens:10,output_tokens:20},
 sources:JSON.parse(body.packet_texts[sym(symbol)]).evidence.map(({content,...source})=>source),
 horizons:['SHORT','MEDIUM','LONG'].map(horizon=>({horizon,status:'WAIT',reason:{text:'隔離研究判斷',evidence_ids:[JSON.parse(body.packet_texts[sym(symbol)]).evidence[0].id]},counter_evidence:[],confirmation:'等待新增資料',invalidation:'反面資料否定判斷',gaps:[]}))});
let phase='bootstrap',checks=0,batch;
const equal=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;};
const ok=(a,message)=>{assert(a,message);checks++;};
async function isolated(fn){await db.exec('begin');try{await fn();}finally{await db.exec('rollback');}}
async function rejects(fn,pattern){await db.exec('savepoint expected_rejection');let error;try{await fn();}catch(e){error=e;}await db.exec('rollback to savepoint expected_rejection;release savepoint expected_rejection');ok(error,'Expected a rejection');ok(pattern.test(error.message),error.message);}
async function service(fn){await db.exec('set role service_role');let failed=false;try{return await fn();}catch(error){failed=true;throw error;}finally{try{await db.exec('reset role');}catch(error){if(!failed)throw error;}}}
const dispatch=(symbol='1018',doc=review,id=batch)=>db.query('select public.dispatch_daily_stock_ai_rate_limit_recovery_v1($1,$2,$3) value',[id,sym(symbol),doc]).then(r=>r.rows[0].value);
const fence=(symbol='1018',doc=review,id=batch)=>db.query('select public.load_daily_stock_ai_rate_limit_recovery_v1($1,$2,$3) value',[id,sym(symbol),doc]).then(r=>r.rows[0].value);
const progress=(id=batch)=>db.query('select public.load_daily_stock_ai_rate_limit_recovery_progress_v1($1) value',[id]).then(r=>r.rows[0].value);
const normalJob=(symbol,revision,op,{lease=null,result=null,code=null}={})=>db.query('select public.daily_stock_ai_job_v1($1,$2,$3,$4,$5,$6,$7) value',[op,jobKey(symbol,revision),identity(symbol,revision),context(symbol,revision),result,lease,code]).then(r=>r.rows[0].value);
const recoveryJob=(symbol='1018',op='CLAIM',args={})=>db.query('select public.daily_stock_ai_rate_limit_recovery_job_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value',[
 args.batch??batch,sym(symbol),args.doc??review,op,args.key??jobKey(symbol,RECOVERY),op==='CLAIM'?(args.identity??identity(symbol,RECOVERY)):null,
 op==='CLAIM'?(args.context??context(symbol,RECOVERY)):null,args.result??null,args.lease??null,args.code??null]).then(r=>r.rows[0].value);
const count=table=>db.query('select count(*)::int n from '+table).then(r=>r.rows[0].n);
const originalRows=()=>db.query('select jsonb_agg(to_jsonb(j) order by id) value from vnext_runtime.ai_stock_jobs j where model_revision=$1',[ORIGINAL]).then(r=>r.rows[0].value);
const recoveryRows=()=>db.query('select coalesce(jsonb_agg(to_jsonb(j) order by id),\'[]\'::jsonb) value from vnext_runtime.ai_stock_jobs j where model_revision=$1',[RECOVERY]).then(r=>r.rows[0].value);
const counters=async()=>({vault:await count('vault.read_audit'),post:await count('net.requests'),dispatch:await count('vnext_runtime.ai_stock_dispatches'),receipts:await count(receiptTable)});
const oldFunctions=async()=>{const rows=[];for(const pin of baseline.functions){rows.push((await db.query('select pg_get_functiondef(p.oid) definition,to_jsonb(p) metadata from pg_proc p where p.oid=$1::regprocedure',['public.'+pin.signature])).rows[0]);}return rows;};
const sqlBody=s=>s.replace(/\nbegin;\n/,'\n').replace(/\ncommit;\s*$/,'\n');
async function atClock(value,fn){const saved=Date.now;Date.now=()=>Date.parse(value);try{const actual=(await db.query('select clock_timestamp()::text value')).rows[0].value;ok(Math.abs(Date.parse(actual)-Date.parse(value))<1000,'Only the isolated WASM clock is advanced');await fn();}finally{Date.now=saved;}}
async function completeRecovery(symbol){const c=await service(()=>recoveryJob(symbol));equal(c.state,'ACQUIRED');equal(await service(()=>recoveryJob(symbol,'COMPLETE',{lease:c.lease,result:analysis(symbol,RECOVERY)})),{state:'STORED',member_published:false});return c;}
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema vnext_runtime;create function vnext_runtime.immutable() returns trigger language plpgsql as $$begin raise exception 'IMMUTABLE';end$$;
 create schema vault;create table vault.secret_values(name text,decrypted_secret text,created_at timestamptz default clock_timestamp());create table vault.read_audit(at_time timestamptz default clock_timestamp());
 create function vault.read_secrets() returns setof vault.secret_values language plpgsql volatile as $$begin insert into vault.read_audit default values;return query select * from vault.secret_values;end$$;
 create view vault.decrypted_secrets as select * from vault.read_secrets();
 create schema net;create table net.requests(id bigserial primary key,url text,headers jsonb,body jsonb,timeout_milliseconds integer);
 create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language plpgsql as $$declare n bigint;forced text:=nullif(current_setting('test.recovery_http_result',true),'');begin
  if forced='NULL' then return null;elsif forced is not null then return forced::bigint;end if;
  insert into net.requests(url,headers,body,timeout_milliseconds) values(url,headers,body,timeout_milliseconds) returning id into n;return n;end$$;
 revoke all on schema vault,net from public,anon,authenticated,service_role;revoke all on all tables in schema vault,net from public,anon,authenticated,service_role;revoke all on all functions in schema vault,net from public,anon,authenticated,service_role;
 create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create schema academy_private;create function academy_private.access_v11() returns text language sql stable as $$select current_setting('test.tier',true)$$;
 create function public.is_research_owner_v1() returns boolean language sql stable as $$select current_setting('test.tier',true)='owner'$$;
 create schema vnext_private;create function vnext_private.immutable_record() returns trigger language plpgsql as $$begin raise exception 'IMMUTABLE';end$$;
 create table vnext_private.source_licenses(id text primary key,source text,document_url text,reviewed_at timestamptz,expires_at timestamptz,storage_allowed boolean,derived_allowed boolean,commercial_allowed boolean,redistribution_allowed boolean,attribution text);`);
 for(const name of ['daily-ai-jobs','daily-ai-batches','daily-ai-dispatch','daily-ai-member'])await db.exec(read('../../../research/'+name+'.candidate.sql'));
 await db.exec(read('../daily-ai-429-cooldown-20261031/candidate.sql'));
 for(const pin of baseline.functions){await db.exec(pin.definition);equal(sha((await db.query('select pg_get_functiondef($1::regprocedure) value',['public.'+pin.signature])).rows[0].value),pin.hash);}
 await db.query('insert into vault.secret_values(name,decrypted_secret) values($1,$2)',['morning_alpha_daily_delivery_token',token]);
 const text=canonical(body);batch=sha(text);await service(()=>db.query('select public.store_daily_stock_ai_batch_v1($1,$2)',[text,batch]));
 for(let i=0;i<72;i++){const symbol=String(1000+i);if(i<18){const c=await service(()=>normalJob(symbol,ORIGINAL,'CLAIM'));await service(()=>normalJob(symbol,ORIGINAL,'COMPLETE',{lease:c.lease,result:analysis(symbol,ORIGINAL)}));}
  else for(let attempt=0;attempt<3;attempt++){const c=await service(()=>normalJob(symbol,ORIGINAL,'CLAIM'));await service(()=>normalJob(symbol,ORIGINAL,'FAIL',{lease:c.lease,code:'STOCK_AI_PROVIDER_HTTP_429'}));}}
 const oldRows=await originalRows(),oldMetadata=await oldFunctions();equal(oldRows.length,72);equal(oldRows.filter(j=>j.state==='COMPLETE').length,18);equal(oldRows.filter(j=>j.state==='FAILED'&&j.attempts===3&&j.code==='STOCK_AI_PROVIDER_HTTP_429').length,54);
 phase='dependency guards';
 await isolated(async()=>{await db.exec('alter function public.daily_stock_ai_job_v1(text,text,text,jsonb,jsonb,uuid,text) security invoker');await rejects(()=>db.exec(sqlBody(candidate)),/DEPENDENCY_DRIFT|PRIVILEGE_DRIFT/);});
 await isolated(async()=>{await db.exec('grant execute on function public.stage_daily_ai_research_edition_v1(text,text[],timestamptz) to authenticated');await rejects(()=>db.exec(sqlBody(candidate)),/PRIVILEGE_DRIFT/);});
 phase='apply and exact preservation';await db.exec(candidate);equal(await oldFunctions(),oldMetadata);equal(await originalRows(),oldRows);equal(await counters(),{vault:0,post:0,dispatch:0,receipts:0});
 await isolated(async()=>{await rejects(()=>db.exec(sqlBody(candidate)),/ALREADY_EXISTS/);});
 phase='role isolation and metadata';
 await isolated(async()=>{for(const role of ['anon','authenticated']){await db.exec('set role '+role);for(const fn of [()=>dispatch(),()=>fence(),()=>progress(),()=>recoveryJob()])await rejects(fn,/permission denied/);await db.exec('reset role');}
  await service(async()=>{for(const table of [receiptTable,'vnext_runtime.ai_stock_jobs','vnext_runtime.ai_stock_dispatches','vault.decrypted_secrets'])await rejects(()=>db.query('select * from '+table),/permission denied/);
   await rejects(()=>db.query('select vnext_runtime.daily_stock_ai_rate_limit_recovery_context_v1($1,$2)',[batch,'1018']),/permission denied/);});});
 const funcs=(await db.query("select p.prosecdef,p.proconfig,p.proacl::text acl,p.provolatile,pg_get_userbyid(p.proowner) owner from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('dispatch_daily_stock_ai_rate_limit_recovery_v1','load_daily_stock_ai_rate_limit_recovery_v1','load_daily_stock_ai_rate_limit_recovery_progress_v1','daily_stock_ai_rate_limit_recovery_job_v1')")).rows;
 equal(funcs.length,4);for(const f of funcs){equal(f.prosecdef,true);equal(f.proconfig,['search_path=""']);equal(f.acl,'{postgres=X/postgres,service_role=X/postgres}');equal(f.owner,'postgres');}
 equal((await db.query('select relrowsecurity,relforcerowsecurity from pg_class where oid=$1::regclass',[receiptTable])).rows[0],{relrowsecurity:true,relforcerowsecurity:true});
 phase='original complete caches without recovery expense';await isolated(async()=>{equal((await service(()=>dispatch('1000'))).state,'CACHED');equal(await counters(),{vault:0,post:0,dispatch:0,receipts:0});equal(await recoveryRows(),[]);});
 phase='selectors, missing receipt, ineligible targets';await isolated(async()=>{
  for(const doc of [null,'','A'.repeat(64),'g'.repeat(64),'a'.repeat(63),'a'.repeat(65)])await rejects(()=>service(()=>dispatch('1018',doc)),/RECOVERY_REVIEW/);
  for(const symbol of [null,'','999','1000000','1018 OR TRUE'])await rejects(()=>service(()=>dispatch(symbol)),/RECOVERY_SCOPE/);
  await rejects(()=>service(()=>dispatch('9999')),/query returned no rows/);await rejects(()=>service(()=>fence()),/query returned no rows/);await rejects(()=>service(()=>recoveryJob()),/query returned no rows/);
  equal(await counters(),{vault:0,post:0,dispatch:0,receipts:0});});
 phase='production batch pin rejects a separately committed same-input batch';await isolated(async()=>{const otherBody={...body,gaps:{isolated_test:'different immutable batch'}},text=canonical(otherBody),id=sha(text);
  await service(()=>db.query('select public.store_daily_stock_ai_batch_v1($1,$2)',[text,id]));await rejects(()=>service(()=>dispatch('1018',review,id)),/RECOVERY_SCOPE/);await rejects(()=>service(()=>progress(id)),/RECOVERY_SCOPE/);equal(await counters(),{vault:0,post:0,dispatch:0,receipts:0});});
 for(const patch of ["state='RUNNING'","attempts=1","attempts=2","code='STOCK_AI_PROVIDER_HTTP_500'","code=null"]){await isolated(async()=>{await db.query('update vnext_runtime.ai_stock_jobs set '+patch+' where id=$1',[jobKey('1018',ORIGINAL)]);await rejects(()=>service(()=>dispatch()),/ORIGINAL_INELIGIBLE/);equal(await counters(),{vault:0,post:0,dispatch:0,receipts:0});});}
 phase='whole original batch must be closed before any paid recovery';
 for(const patch of ['delete',"state='RUNNING'","attempts=2","code=null","code='STOCK_AI_PROVIDER_HTTP_500'"]){await isolated(async()=>{if(patch==='delete')await db.query('delete from vnext_runtime.ai_stock_jobs where id=$1',[jobKey('1019',ORIGINAL)]);else await db.query('update vnext_runtime.ai_stock_jobs set '+patch+' where id=$1',[jobKey('1019',ORIGINAL)]);
  await rejects(()=>service(()=>dispatch()),/ORIGINAL_BATCH_NOT_CLOSED/);equal(await counters(),{vault:0,post:0,dispatch:0,receipts:0});});}
 phase='one immutable dispatch receipt, exact load fence and global single flight';
 await isolated(async()=>{const first=await service(()=>dispatch());equal(first.state,'DISPATCHED');equal(first.job_key,jobKey('1018',RECOVERY));equal(first.original_job_key,jobKey('1018',ORIGINAL));equal(first.member_published,false);
  const ready=await service(()=>fence());equal(ready,{state:'READY',batch_id:batch,symbol:sym('1018'),input_hash:inputHash('1018'),cutoff,original_job_key:jobKey('1018',ORIGINAL),job_key:jobKey('1018',RECOVERY),model_revision:RECOVERY,member_published:false,review_document_hash:review,dispatch_request_id:first.request_id});
  equal((await service(()=>dispatch())).state,'BUSY');equal((await service(()=>dispatch('1019'))).state,'BUSY');equal(await counters(),{vault:1,post:1,dispatch:1,receipts:1});
  await rejects(()=>service(()=>dispatch('1018',otherReview)),/REVIEW_CONFLICT/);await rejects(()=>service(()=>fence('1018',otherReview)),/REVIEW_CONFLICT/);await rejects(()=>service(()=>recoveryJob('1018','CLAIM',{doc:otherReview})),/REVIEW_CONFLICT/);
  for(const op of ['update '+receiptTable+' set review_document_hash=review_document_hash','delete from '+receiptTable,'truncate '+receiptTable])await rejects(()=>db.exec(op),/RECEIPT_IMMUTABLE/);
  const request=(await db.query('select url,headers,body,timeout_milliseconds from net.requests')).rows[0];equal(request,{url:'https://cttfzgvhiewfckydcrci.supabase.co/functions/v1/daily-stock-analysis-v1',headers:{'Content-Type':'application/json','x-daily-delivery-token':token},body:{batch_id:batch,recovery_symbol:sym('1018'),review_document_hash:review},timeout_milliseconds:60000});
  const claims=await Promise.all(Array.from({length:8},()=>recoveryJob()));equal(claims.filter(c=>c.state==='ACQUIRED').length,1);equal(claims.filter(c=>c.state==='BUSY').length,7);equal((await recoveryRows())[0].attempts,1);
  const acquired=claims.find(c=>c.state==='ACQUIRED');equal(await service(()=>recoveryJob('1018','COMPLETE',{lease:acquired.lease,result:analysis('1018',RECOVERY)})),{state:'STORED',member_published:false});
  equal(await service(()=>recoveryJob()),{state:'CACHED',result:analysis('1018',RECOVERY)});equal((await service(()=>dispatch())).state,'CACHED');equal(await originalRows(),oldRows);
  const p=await service(()=>progress());equal(p.counts,{original_complete:18,recovery_complete:1,remaining:53});equal(p.job_keys.length,19);equal(p.complete,false);equal(await count('vnext_private.ai_research_editions'),0);
  equal((await service(()=>dispatch('1019'))).state,'DISPATCHED');});
 phase='first claim rechecks the whole original batch and exact context';
 await isolated(async()=>{await service(()=>dispatch());for(const args of [{key:jobKey('1018',ORIGINAL)},{identity:identity('1018',ORIGINAL)},{context:{...context('1018',RECOVERY),cutoff:new Date(Date.parse(cutoff)+1).toISOString()}}])await rejects(()=>service(()=>recoveryJob('1018','CLAIM',args)),/RECOVERY_KEY|RECOVERY_IDENTITY/);
  await db.query("update vnext_runtime.ai_stock_jobs set state='RUNNING' where id=$1",[jobKey('1019',ORIGINAL)]);await rejects(()=>service(()=>recoveryJob()),/ORIGINAL_BATCH_NOT_CLOSED/);equal(await recoveryRows(),[]);});
 phase='a failed or unknown recovery permanently stops the batch without another attempt';
 for(const failure of ['FAILED','UNKNOWN'])await isolated(async()=>{await service(()=>dispatch());const c=await service(()=>recoveryJob());
  if(failure==='FAILED')await service(()=>recoveryJob('1018','FAIL',{lease:c.lease,code:'STOCK_AI_PROVIDER_HTTP_429'}));else await db.query("update vnext_runtime.ai_stock_jobs set lease_until=clock_timestamp()-interval '1 second' where id=$1",[jobKey('1018',RECOVERY)]);
  const before=await recoveryRows();equal(await service(()=>recoveryJob()),{state:'EXHAUSTED'});equal((await service(()=>dispatch('1019'))).state,failure==='FAILED'?'STOPPED':'STOPPED_UNKNOWN');equal(await recoveryRows(),before);equal(await counters(),{vault:1,post:1,dispatch:1,receipts:1});
  await rejects(()=>service(()=>recoveryJob('1018','COMPLETE',{lease:c.lease,result:analysis('1018',RECOVERY)})),/AI_JOB_LEASE/);equal(await originalRows(),oldRows);});
 phase='original cached data preserves its real job key ahead of a completed recovery';
 await isolated(async()=>{await service(()=>dispatch());await completeRecovery('1018');await db.query("update vnext_runtime.ai_stock_jobs set state='COMPLETE',result=$1,code=null where id=$2",[analysis('1018',ORIGINAL),jobKey('1018',ORIGINAL)]);
  const before=await recoveryRows();equal(await service(()=>recoveryJob()),{state:'CACHED',result:analysis('1018',ORIGINAL)});equal(await recoveryRows(),before);
  const p=await service(()=>progress());equal(p.counts,{original_complete:19,recovery_complete:0,remaining:53});ok(p.job_keys.includes(jobKey('1018',ORIGINAL)));ok(!p.job_keys.includes(jobKey('1018',RECOVERY)));});
 phase='paid work expires at the bound-review deadline while reads remain allowed';
 await isolated(async()=>{await service(()=>dispatch());await atClock('2026-11-02T05:30:00.001Z',async()=>{
  await rejects(()=>service(()=>dispatch('1019')),/RECOVERY_EXPIRED/);await rejects(()=>service(()=>recoveryJob()),/RECOVERY_EXPIRED/);equal((await service(()=>dispatch('1000'))).state,'CACHED');equal((await service(()=>fence())).state,'READY');equal((await service(()=>progress())).counts,{original_complete:18,recovery_complete:0,remaining:54});equal(await recoveryRows(),[]);});});
 phase='unconfirmed transport cannot create an authorizing receipt';
 for(const forced of ['NULL','0','-1'])await isolated(async()=>{await db.query("select set_config('test.recovery_http_result',$1,true)",[forced]);await rejects(()=>service(()=>dispatch()),/DISPATCH_UNCONFIRMED/);equal(await counters(),{vault:0,post:0,dispatch:0,receipts:0});await rejects(()=>service(()=>fence()),/query returned no rows/);});
 phase='credentials and separate54 recovery budget with unchanged normal216';
 for(const value of [null,'x'.repeat(23),'x'.repeat(513)])await isolated(async()=>{await db.exec('delete from vault.secret_values');if(value!==null)await db.query('insert into vault.secret_values(name,decrypted_secret) values($1,$2)',['morning_alpha_daily_delivery_token',value]);await rejects(()=>service(()=>dispatch()),/CREDENTIAL_UNAVAILABLE/);equal(await counters(),{vault:0,post:0,dispatch:0,receipts:0});});
 await isolated(async()=>{await db.query('insert into vnext_runtime.ai_stock_dispatches select n,$1,clock_timestamp() from generate_series(10000,10215)n',[batch]);equal((await service(()=>dispatch())).state,'DISPATCHED');equal(await counters(),{vault:1,post:1,dispatch:217,receipts:1});});
 phase='independent54 receipt cap rejects an additional eligible target before Vault';
 await isolated(async()=>{for(let i=0;i<54;i++){const logical=String(1000+i),symbol=sym(logical),id=30000+i;await db.query('insert into vnext_runtime.ai_stock_dispatches(request_id,batch_id) values($1,$2)',[id,batch]);
   await db.query("insert into vnext_runtime.ai_stock_jobs(id,input_hash,model_revision,symbol,cutoff,state,attempts,lease,lease_until,result) values($1,$2,$3,$4,$5,'COMPLETE',1,gen_random_uuid(),clock_timestamp(),$6)",[jobKey(logical,RECOVERY),inputHash(logical),RECOVERY,symbol,cutoff,analysis(logical,RECOVERY)]);
   await db.query('insert into '+receiptTable+'(batch_id,symbol,review_document_hash,input_hash,cutoff,original_job_key,recovery_job_key,model_revision,dispatch_request_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[batch,symbol,review,inputHash(logical),cutoff,jobKey(logical,ORIGINAL),jobKey(logical,RECOVERY),RECOVERY,id]);}
  equal((await service(()=>dispatch('1071'))).state,'RECOVERY_BUDGET_EXHAUSTED');equal(await counters(),{vault:0,post:0,dispatch:54,receipts:54});});
 phase='72 true-key union can stage only through the unmodified manual stage RPC';
 await isolated(async()=>{for(let i=18;i<72;i++){const symbol=String(1000+i);equal((await service(()=>dispatch(symbol))).state,'DISPATCHED');await completeRecovery(symbol);}
  const p=await service(()=>progress());equal(p.schema,'DAILY_AI_RATE_LIMIT_RECOVERY_PROGRESS_V1');equal(p.complete,true);equal(p.counts,{original_complete:18,recovery_complete:54,remaining:0});equal(p.job_keys.length,72);equal(new Set(p.job_keys).size,72);
  equal(p.job_keys,[...Array.from({length:18},(_,i)=>jobKey(String(1000+i),ORIGINAL)),...Array.from({length:54},(_,i)=>jobKey(String(1018+i),RECOVERY))]);equal(p.member_published,false);ok(!Object.hasOwn(p,'completed'));equal(await count('vnext_private.ai_research_editions'),0);equal(await count('vnext_private.ai_research_reviews'),0);equal(await count('vnext_private.ai_research_publication_events'),0);
  const expires='2026-11-02T05:30:00Z';await rejects(()=>service(()=>db.query('select public.stage_daily_ai_research_edition_v1($1,$2,$3)',[batch,p.job_keys.slice(0,71),expires])),/AI_EDITION_SCOPE/);
  const staged=(await service(()=>db.query('select public.stage_daily_ai_research_edition_v1($1,$2,$3) value',[batch,p.job_keys,expires]))).rows[0].value;equal(staged.status,'STAGED_REVIEW_REQUIRED');equal(staged.member_published,false);equal(await count('vnext_private.ai_research_editions'),1);equal(await count('vnext_private.ai_research_reviews'),0);equal(await count('vnext_private.ai_research_publication_events'),0);equal(await originalRows(),oldRows);
 });
 const newCatalog=(await db.query("select n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')' signature,pg_get_functiondef(p.oid) definition,to_jsonb(p) metadata from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in('dispatch_daily_stock_ai_rate_limit_recovery_v1','load_daily_stock_ai_rate_limit_recovery_v1','load_daily_stock_ai_rate_limit_recovery_progress_v1','daily_stock_ai_rate_limit_recovery_job_v1','daily_stock_ai_rate_limit_recovery_context_v1','seal_daily_stock_ai_rate_limit_recovery_receipt_v1') order by n.nspname,p.proname")).rows.map(row=>({...row,definition_sha256:sha(row.definition)}));
 writeFileSync(new URL('local-function-catalog.json',import.meta.url),JSON.stringify({schema:'DAILY_AI_RATE_LIMIT_RECOVERY_LOCAL_CATALOG_V1',postgres:'17.5',candidate_sql_sha256:sha(candidate),functions:newCatalog},null,2)+'\n');
 phase='rollback refuses paid or unknown records and restores only an empty candidate';
 if(existsSync(new URL('rollback.sql',import.meta.url))){const rollback=read('rollback.sql');
  await isolated(async()=>{await service(()=>dispatch());await rejects(()=>db.exec(sqlBody(rollback)),/HAS_RECORDS/);equal(await count(receiptTable),1);});
  await isolated(async()=>{const c=await service(()=>normalJob('1018',RECOVERY,'CLAIM'));equal(c.state,'ACQUIRED');await rejects(()=>db.exec(sqlBody(rollback)),/HAS_RECORDS/);equal((await recoveryRows()).length,1);});
  await isolated(async()=>{await db.exec(sqlBody(rollback));equal((await db.query('select to_regclass($1)::text value',[receiptTable])).rows[0].value,null);equal(await oldFunctions(),oldMetadata);});
 }
 equal(await originalRows(),oldRows);equal(await oldFunctions(),oldMetadata);equal(await counters(),{vault:0,post:0,dispatch:0,receipts:0});
 const report={status:'PASS',checks,postgres:'17.5',candidate_sha256:sha(candidate),retained_seed_sha256:sha(seed),retained_seed_bytes:Buffer.byteLength(seed),synthetic_model_results:true,synthetic_expiry_clock_test:true,original_complete:18,original_failed_429_attempts3:54,original_jobs_unchanged:true,old_functions_unchanged:true,production_calls:0,external_calls:0,limitation:'Single isolated PostgreSQL/WASM connection; not production lock-wait/load evidence. No CPU capacity improvement claimed.'};
 writeFileSync(new URL('local-sql-result.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}catch(error){console.error('FAIL phase: '+phase);throw error;}finally{await db.close();}

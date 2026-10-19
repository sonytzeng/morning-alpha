/** Disposable real PostgreSQL/PostgREST, synthetic C/source controls only.
 * Not natural research, an Owner browser session, licensed stock research or performance. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {randomBytes,randomUUID,createHash,createHmac} from 'node:crypto';
import {persistOriginalObservation} from '../src/features/vnext/originalIngress.ts';
import {lockObservation} from '../src/features/vnext/engine.ts';
import {HORIZONS,snapshotHash} from '../src/features/vnext/contracts.ts';
const migration='supabase/migrations/20261019123345_original_observation_ingress_candidate_v1.sql';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const name='ma-original-ingress-'+process.pid,db=name+'-db',rest=name+'-rest',port=55860;
const password=randomBytes(24).toString('hex'),secret=randomBytes(48).toString('hex');
const env={...process.env,POSTGRES_PASSWORD:password,PGPASSWORD:password,PGRST_DB_URI:`postgres://authenticator:${password}@${db}:5432/postgres`,PGRST_JWT_SECRET:secret};
const run=(args,input)=>execFileSync('docker',args,{env,encoding:'utf8',input,stdio:['pipe','pipe','pipe'],maxBuffer:32e6}).trim();
const sql=q=>run(['exec','-i','-e','PGPASSWORD',db,'psql','-h','127.0.0.1','-XqAt','-U','postgres','-v','ON_ERROR_STOP=1'],q);
const sha=x=>createHash('sha256').update(x).digest('hex'),quote=x=>"'"+String(x).replaceAll("'","''")+"'";
const json=x=>quote(JSON.stringify(x))+'::jsonb',sleep=ms=>new Promise(r=>setTimeout(r,ms));
const jwt=role=>{const h=Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),p=Buffer.from(JSON.stringify({role,exp:Math.floor(Date.now()/1000)+600})).toString('base64url');return h+'.'+p+'.'+createHmac('sha256',secret).update(h+'.'+p).digest('base64url');};
let vmLoopback=false;
async function request(role,args){
 const url=`http://127.0.0.1:${port}/rpc/ingest_vnext_original_observation_candidate_v1`;
 const headers={'Content-Type':'application/json',Authorization:'Bearer '+jwt(role)};
 if(vmLoopback){const config=['url = '+JSON.stringify(url),'request = "POST"',...Object.entries(headers).map(([k,v])=>'header = '+JSON.stringify(k+': '+v)),'data = '+JSON.stringify(JSON.stringify(args))].join('\n');
  const raw=execFileSync('colima',['ssh','--','curl','--silent','--show-error','--max-time','10','--write-out','\\n%{http_code}','--config','-'],{input:config,encoding:'utf8',stdio:['pipe','pipe','pipe']});const at=raw.lastIndexOf('\n');return {status:Number(raw.slice(at+1)),data:JSON.parse(raw.slice(0,at))};}
 const r=await fetch(url,{method:'POST',headers,body:JSON.stringify(args),signal:AbortSignal.timeout(10000)});return {status:r.status,data:await r.json()};
}
const checks=[];let counter=0;
const fixtureEpoch=Date.now(),fixtureRun=randomUUID(),fixtureRevision=sha('synthetic-shared-source-revision');
const rpc=async(_name,args)=>{const r=await request('service_role',args);if(r.status!==200)throw Error(r.data.message);return r.data;};
const fixture=({horizon='SHORT',omit=[],quality='PASS',licensed=true,future=false,sourceLate=false,expired=false,confirmed=false,invalidated=false,wideYear=false}={})=>{
 const symbol=String(7000+counter++),id='synthetic:'+symbol+':'+horizon,runid=fixtureRun,now=fixtureEpoch;
 const time=ms=>new Date(now+ms).toISOString(),cutoff=time(-60000),generated=time(-30000),actionable=time(1800000);
 const body={id,business_date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(now),mode:'FORWARD_SHADOW',provenance:'RETAINED_REAL_EVIDENCE',symbol,company:'合成隔離公司',horizon,
  strategy_version:'VNEXT_OBSERVATION_HYPOTHESIS_2.0.0',generated_at:generated,locked_at:generated,evidence_cutoff:cutoff,actionable_at:actionable,next_review_at:time(3600000),research:{status:'QUALIFIED'}};
 const text=JSON.stringify(body),hash=sha(text),payload={...body,lock_hash:hash},revision=fixtureRevision;
 sql(`insert into vnext_runtime.runs(id,business_date,upstream_batch,upstream_phase,created_at,actionable_at,source_revision,checkpoint)
 values('${runid}',(transaction_timestamp() at time zone 'Asia/Taipei')::date,'${randomUUID()}','PREMARKET',${quote(time(-120000))},${quote(actionable)},'${revision}',${json({acquired:{snapshot_hash:revision,evidence_cutoff:cutoff},locks:[payload]})})
 on conflict(id) do update set checkpoint=jsonb_set(vnext_runtime.runs.checkpoint,'{locks}',(vnext_runtime.runs.checkpoint->'locks')||(excluded.checkpoint->'locks'));
 insert into vnext_runtime.predictions(id,run_id,symbol,horizon,lock_hash,payload_text,payload,locked_at)
 values(${quote(id)},'${runid}','${symbol}','${horizon}','${hash}',${quote(text)},${json(payload)},${quote(generated)});`);
 const license=sha('license:'+symbol);
 sql(`insert into vnext_private.source_licenses values('${license}','SYNTHETIC','https://example.com/license',${quote(time(-120000))},null,${licensed},${licensed},false,false,'SYNTHETIC ISOLATED ONLY');`);
 const all=HORIZONS[horizon].required,ids=all.filter(k=>!omit.includes(k)).map(k=>sha(symbol+':'+k));
 for(const kind of all.filter(k=>!omit.includes(k))){const eid=sha(symbol+':'+kind);sql(`insert into vnext_private.event_sources(id,symbol,kind,source,source_ref,license_id,published_at,first_seen_at,available_at,as_of,last_verified_at,valid_until,snapshot_hash,classification,quality,relevant,summary)
 values('${eid}','${symbol}','${kind}','SYNTHETIC','https://example.com/evidence','${license}',${quote(time(-100000))},${quote(time(-90000))},${quote(time(sourceLate?-10000:-80000))},${quote(time(-110000))},
 ${quote(time(future?10000:sourceLate?-5000:-70000))},${quote(wideYear?'10000-01-01T00:00:00Z':time(expired?-1000:600000))},'${sha('raw:'+eid)}','CONFIRMED_FACT','${quality}',true,'隔離資料：「量價／消息」並非真實股票。\n測試雜湊與中文');`);}
 const input={schema:'ORIGINAL_OBSERVATION_INGRESS_1',c_prediction_id:id,c_lock_hash:hash,symbol,company:'合成隔離公司',horizon,
  reason:'隔離測試：原始證據獨立檢查，不使用 C 合格標籤。',evidence_ids:ids,
  confirmation_conditions:[{text:'隔離確認條件',state:confirmed?'CONFIRMED':'UNKNOWN',evidence_ids:[ids[0]]}],
  invalidation_conditions:[{text:'隔離失效條件',state:invalidated?'CONFIRMED':'UNKNOWN',evidence_ids:[ids.at(-1)]}],next_review_at:time(3600000),expires_at:time(7200000)};
 return {input,key:randomUUID(),runid,id};
};
const count=()=>sql("select jsonb_build_object('obs',(select count(*) from vnext_private.stock_horizon_observations),'links',(select count(*) from vnext_private.observation_evidence),'receipts',(select count(*) from vnext_private.original_ingress_receipts))");
try{
 run(['network','create',name]);run(['run','-d','--name',db,'--network',name,'--tmpfs','/var/lib/postgresql/data:rw,size=268435456','-e','POSTGRES_PASSWORD','postgres:17']);
 let ready=false;for(let i=0;i<60;i++){try{sql('select 1');ready=true;break;}catch{await sleep(300);}}assert(ready,'ISOLATED_DB_UNAVAILABLE');
 sql(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create role authenticator login password '${password}' noinherit;
 grant anon,authenticated,service_role to authenticator;create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
 create function public.is_research_owner_v1() returns boolean language sql stable as $$select false$$;
 create schema academy_private;create function academy_private.access_v11() returns text language sql stable as $$select 'free'::text$$;
 create function public.market_calendar_session_v1(text,date) returns boolean language sql stable as $$select true$$;
 create function public.authoritative_market_calendar_v1() returns jsonb language sql stable as $$select '{}'::jsonb$$;
 create table public.market_checkpoint_batches(batch_id uuid,business_date date,checkpoint text,status text,expected_provider_count int,committed_provider_count int,committed_at timestamptz);
 create table public.decision_snapshots(id uuid,report_date date,session_type text,status text,created_at timestamptz,generated_text jsonb,market_regime text);
 create table public.recommendation_shadow_v2_runs(business_date date,source_batch_id uuid,cutoff timestamptz,evidence jsonb,input_sha256 text);`);
 sql(read('supabase/migrations/20261010061630_vnext_research_projection_candidate.sql'));
 sql(read('supabase/migrations/20261012054120_vnext_daily_research_runtime_candidate.sql'));
 sql(read(migration));checks.push('Fresh DB exact original projection + Runtime + ingress SQL; synthetic prerequisite contracts only');
 const vector={observation:{reason:'中文「引號」\\斜線\n\t\b\f\r\u0001😀𠮷\u2028\u2029',available_at:'2026-10-19T00:00:00.123456Z',publication_status:'RESEARCH_ONLY'},evidence:[{relevant:true,summary:null}]};
 assert.equal(sql(`select encode(sha256(convert_to(vnext_private.original_canonical_v1(${json(vector)}),'UTF8')),'hex')`),await snapshotHash(vector));
 const hexIds=Array.from({length:100},(_,i)=>sha('sort-control:'+i));
 assert.deepEqual([...hexIds].sort((a,b)=>a.localeCompare(b)),[...hexIds].sort());
 assert.throws(()=>sql("select vnext_private.original_canonical_v1('{\"unexpected\":1}'::jsonb)"));
 checks.push('SQL/original JS canonical UTF-8 parity: Chinese, quotes, control characters, non-BMP, microseconds and actual runtime hex ordering; numbers rejected');
 run(['run','-d','--name',rest,'--network',name,'-p',`127.0.0.1:${port}:3000`,'-e','PGRST_DB_URI','-e','PGRST_JWT_SECRET','-e','PGRST_DB_ANON_ROLE=anon','-e','PGRST_DB_SCHEMAS=public','-e','PGRST_LOG_LEVEL=crit','postgrest/postgrest:v14.13']);
 ready=false;for(let i=0;i<30;i++){try{const r=await request('service_role',{p_request_key:randomUUID(),p_request:{}});if(r.status===400&&r.data.message==='ORIGINAL_REQUEST_INVALID'){ready=true;break;}}catch{if(process.platform==='darwin'&&i>=3)vmLoopback=true;}await sleep(300);}
 assert(ready,'LOCAL_POSTGREST_UNAVAILABLE');
 const first=fixture(),before=count();
 for(const role of ['anon','authenticated'])assert([401,403].includes((await request(role,{p_request_key:first.key,p_request:first.input})).status));
 assert.equal(count(),before);checks.push('Anonymous and all browser authenticated roles cannot execute ingress; no rows written');
 const receipts=await Promise.all(Array.from({length:8},()=>persistOriginalObservation(first.key,first.input,rpc)));
 assert.equal(receipts.filter(r=>!r.replayed).length,1);assert(receipts.every(r=>r.observation.snapshot_hash===receipts[0].observation.snapshot_hash));
 assert.equal(receipts[0].state,'WATCHING','C QUALIFIED must not become CONDITION_MET');
 assert.equal(receipts[0].observation.publication_status,'RESEARCH_ONLY');
 assert.equal(sql('select count(*) from vnext_private.original_ingress_receipts'),'1');
 assert.equal(sql('select bool_and(created_at=locked_at) from vnext_private.stock_horizon_observations'),'t');
 await lockObservation(receipts[0].observation,receipts[0].evidence);checks.push('Eight real HTTP concurrent writes produce one atomic lock/link/audit; original JS snapshot hash and microsecond DB lock agree');
 const changed={...first.input,reason:'不同內容'};await assert.rejects(()=>persistOriginalObservation(first.key,changed,rpc),/IDEMPOTENCY_CONFLICT/);
 await assert.rejects(()=>persistOriginalObservation(randomUUID(),first.input,rpc),/ALREADY_LINKED/);
 for(const [opts,error] of [[{omit:['INSTITUTIONAL']},'HORIZON_EVIDENCE_INCOMPLETE'],[{quality:'INSUFFICIENT'},'TIME_QUALITY_OR_STORAGE_RIGHTS'],[{licensed:false},'TIME_QUALITY_OR_STORAGE_RIGHTS'],[{future:true},'TIME_QUALITY_OR_STORAGE_RIGHTS'],[{sourceLate:true},'TIME_QUALITY_OR_STORAGE_RIGHTS'],[{expired:true},'TIME_QUALITY_OR_STORAGE_RIGHTS'],[{wideYear:true},'TIME_QUALITY_OR_STORAGE_RIGHTS']]){
  const f=fixture(opts),saved=count();await assert.rejects(()=>persistOriginalObservation(f.key,f.input,rpc),new RegExp(error));assert.equal(count(),saved);
 }checks.push('Missing original evidence, rejected quality, missing storage/derived permission, future verification, post-C-cutoff source and expired source all reject without partial writes');
 const shifted=fixture(),shiftedBefore=count();shifted.input.expires_at='9999-12-31T23:59:59-01:00';
 await assert.rejects(()=>persistOriginalObservation(shifted.key,shifted.input,rpc),/ORIGINAL_REVIEW_TIME_INVALID/);assert.equal(count(),shiftedBefore);
 checks.push('Native finite year10000 source or timezone-shifted expiry outside original ISO range rejects before any business rows');
 const missing=fixture();missing.input.evidence_ids[0]=sha('not-registered');missing.input.confirmation_conditions[0].evidence_ids=[missing.input.evidence_ids[0]];
 await assert.rejects(()=>persistOriginalObservation(missing.key,missing.input,rpc),/REGISTERED_EVIDENCE_MISSING/);
 for(const horizon of ['MEDIUM','LONG']){const f=fixture({horizon});const r=await persistOriginalObservation(f.key,f.input,rpc);assert.equal(r.observation.horizon,horizon);}
 for(const opts of [{confirmed:true},{invalidated:true}]){const f=fixture(opts),saved=count();
  const r=await request('service_role',{p_request_key:f.key,p_request:f.input});assert.equal(r.data.message,'ORIGINAL_CONDITION_INVALID');assert.equal(count(),saved);}
 checks.push('Separate SHORT/MEDIUM/LONG required kinds; no C score promotion or caller-declared condition truth');
 const rollback=fixture(),saved=count();
 assert.throws(()=>sql(`begin;select public.ingest_vnext_original_observation_candidate_v1('${rollback.key}',${json(rollback.input)});select 1/0;commit;`));
 assert.equal(count(),saved);checks.push('Crash before transaction commit rolls back observation, exact evidence set and ingress receipt together');
 const extra=fixture(),extraId=sha('extra-same-transaction');
 sql(`insert into vnext_private.event_sources select '${extraId}',symbol,kind,source,source_ref,license_id,published_at,first_seen_at,available_at,as_of,last_verified_at,valid_until,snapshot_hash,classification,quality,relevant,summary from vnext_private.event_sources where id='${extra.input.evidence_ids[0]}'`);
 const extraBefore=count(),oid='original-'+sha(extra.id);
 assert.throws(()=>sql(`begin;select public.ingest_vnext_original_observation_candidate_v1('${extra.key}',${json(extra.input)});insert into vnext_private.observation_evidence values('${oid}','${extraId}');commit;`),e=>String(e.stderr).includes('ORIGINAL_EVIDENCE_SET_NOT_EXACT'));
 assert.equal(count(),extraBefore);checks.push('Deferred exact-set constraint rejects an extra valid same-symbol link appended later in the same transaction');
 const ambiguous=fixture();let dropped=true;
 await assert.rejects(()=>persistOriginalObservation(ambiguous.key,ambiguous.input,async(n,a)=>{const result=await rpc(n,a);if(dropped){dropped=false;throw Error('ISOLATED_REPLY_LOST');}return result;}),/REPLY_LOST/);
 const committed=count();assert((await persistOriginalObservation(ambiguous.key,ambiguous.input,rpc)).replayed);assert.equal(count(),committed);
 const futureExpiry=fixture();sql(`update vnext_runtime.runs set actionable_at=clock_timestamp()-interval '1 second' where id='${futureExpiry.runid}'`);
 const noLate=count();await assert.rejects(()=>persistOriginalObservation(futureExpiry.key,futureExpiry.input,rpc),/FORWARD_WINDOW_INVALID/);assert.equal(count(),noLate);
 checks.push('Lost response reconciles same immutable receipt; a new late Forward insertion is rejected');
 assert.equal(sql('select count(*) from vnext_private.publication_audit'),'0');assert.equal(sql('select count(*) from vnext_private.member_copy'),'0');
 assert.equal(sql('select count(*) from vnext_runtime.outcomes'),'0');
 assert.equal(sql("select public.get_vnext_member_v1()->'observations'"),'[]');
 assert.throws(()=>sql('set role authenticated;select * from vnext_private.original_ingress_receipts'));
 assert.throws(()=>sql('set role service_role;select * from vnext_private.original_ingress_receipts'));
 assert.throws(()=>sql("update vnext_private.original_ingress_receipts set request='{}'"));
 assert.throws(()=>sql("insert into vnext_private.observation_evidence select observation_id,repeat('f',64) from vnext_private.original_ingress_receipts limit 1"));
 checks.push('Private FORCE RLS, append-only audit and sealed membership; no quality/Owner publication/member copy/Outcome side effects');
 sql('revoke execute on function public.ingest_vnext_original_observation_candidate_v1(uuid,jsonb) from service_role');
 const stopped=count();assert([401,403].includes((await request('service_role',{p_request_key:first.key,p_request:first.input})).status));assert.equal(count(),stopped);
 checks.push('Exact stop/rollback revokes only new Writer RPC and preserves all sealed records');
 console.log(JSON.stringify({scope:'ISOLATED_SYNTHETIC_CONTROLS_NOT_PRODUCTION_E2E',checks,production_changed:false}));
}finally{
 for(const n of [rest,db])try{run(['rm','-f',n]);}catch{}
 try{run(['network','rm',name]);}catch{}
}

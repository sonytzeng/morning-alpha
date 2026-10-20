/** Exact candidate SQL in a disposable, network-disabled PostgreSQL17 FreshDB.
 * SYNTHETIC registry approvals/raw bytes/reviews/C lineage only. No Production,
 * natural producer, financial Actual, real right or licensed source is claimed.
 * No source onboarding authority is implemented. A private registeredSource
 * adapter + SQL row hash is NOT a formal V1 publisher or approved production data.
 * Uses no .env, credentials, remote DB, published port or persistent volume.
 */
import assert from 'node:assert/strict';
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createOriginalRegistryIngress,ORIGINAL_REGISTRY_INGRESS_RPC,originalRegistryRowHashes} from '../src/features/vnext/originalRegistryIngress.ts';
import {registryFixture,sha,cleanupOriginalRegistryContainer} from './fixtures/originalRegistryIngress.mjs';
const name='ma-registry-ingress-'+process.pid+'-'+randomUUID().slice(0,8),checks=[];
const docker=(args,input)=>execFileSync('docker',args,{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:16e6}).trim();
// The image's temporary initialization server is Unix-socket-only. Loopback
// TCP waits for the final server instead of falsely admitting that temp server.
const psql=['exec','-i',name,'psql','-h','127.0.0.1','-XqAt','-U','postgres','-v','ON_ERROR_STOP=1'];
const sql=q=>docker(psql,q),read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const quote=x=>"'"+String(x).replaceAll("'","''")+"'",json=x=>quote(JSON.stringify(x))+'::jsonb';
const execute=promisify(execFile);
const sqlAsync=async q=>{
 const child=execute('docker',psql,{encoding:'utf8',maxBuffer:16e6});child.child.stdin.end(q);
 return (await child).stdout.trim();
};
const epoch=Date.now(),at=ms=>new Date(epoch+ms).toISOString(),runId=randomUUID(),revision=sha('SYNTHETIC REGISTRY RUN ONLY');
const count=()=>sql(`select jsonb_build_object('sources',(select count(*) from vnext_private.event_sources),
 'licenses',(select count(*) from vnext_private.source_licenses),'obs',(select count(*) from vnext_private.stock_horizon_observations),
 'links',(select count(*) from vnext_private.observation_evidence),'receipts',(select count(*) from vnext_private.original_ingress_receipts),
 'publication',(select count(*) from vnext_private.publication_audit),'copy',(select count(*) from vnext_private.member_copy),
 'outcomes',(select count(*) from vnext_runtime.outcomes))`);
const query=(args,role='service_role')=>`set role ${role};select public.${ORIGINAL_REGISTRY_INGRESS_RPC}(${quote(args.p_request_key)},${json(args.p_request)},${json(args.p_sources)});`;
const rpc=async(name,args)=>{assert.equal(name,ORIGINAL_REGISTRY_INGRESS_RPC);try{return JSON.parse(await sqlAsync(query(args)));}
 catch(e){throw Error(String(e.stderr).match(/ERROR:\s*([^\n]+)/)?.[1]??'ISOLATED_RPC_FAILED');}};
let number=0,containerId='';
async function fixture({horizon='SHORT',omit=[],dbEvidence=r=>r,dbLicense=l=>l}={}){
 const f=await registryFixture({epoch,horizon,symbol:String(8000+number++)});
 const body={id:f.input.c_prediction_id,business_date:sql("select (clock_timestamp() at time zone 'Asia/Taipei')::date"),
  symbol:f.input.symbol,company:f.input.company,horizon,mode:'FORWARD_SHADOW',provenance:'RETAINED_REAL_EVIDENCE',
  strategy_version:'VNEXT_OBSERVATION_HYPOTHESIS_2.0.0',generated_at:at(-30000),evidence_cutoff:at(-60000),
  actionable_at:at(1800000),next_review_at:at(3600000),research:{status:'QUALIFIED',score:'NOT_CONSUMED'}};
 const text=JSON.stringify(body),hash=sha(text),payload={...body,lock_hash:hash};f.input.c_lock_hash=hash;
 sql(`insert into vnext_runtime.predictions(id,run_id,symbol,horizon,lock_hash,payload_text,payload,locked_at)
 values(${quote(body.id)},'${runId}',${quote(body.symbol)},'${horizon}','${hash}',${quote(text)},${json(payload)},${quote(at(-30000))});
 update vnext_runtime.runs set checkpoint=jsonb_set(checkpoint,'{locks}',(checkpoint->'locks')||${json([payload])}) where id='${runId}';`);
 const l=dbLicense(structuredClone(f.records.values().next().value.license));
 sql(`insert into vnext_private.source_licenses(id,source,document_url,reviewed_at,expires_at,storage_allowed,derived_allowed,commercial_allowed,redistribution_allowed,attribution)
 values(${quote(l.id)},${quote(l.source)},${quote(l.document_url)},${quote(l.reviewed_at)},${l.expires_at===null?'null':quote(l.expires_at)},
 ${l.storage},${l.derived},${l.commercial},${l.redistribution},${quote(l.attribution)});`);
 for(const r of f.records.values()){
  if(omit.includes(r.evidence.kind))continue;const e=dbEvidence(structuredClone(r.evidence));
  sql(`insert into vnext_private.event_sources(id,symbol,kind,source,source_ref,license_id,published_at,first_seen_at,available_at,as_of,last_verified_at,valid_until,snapshot_hash,classification,quality,relevant,summary)
   values(${['id','symbol','kind','source','source_ref','license_id','published_at','first_seen_at','available_at','as_of','last_verified_at','valid_until','snapshot_hash','classification','quality'].map(k=>quote(e[k])).join(',')},${e.relevant},${quote(e.summary)});`);
 }
 f.ports.rpc=rpc;f.ports.now=()=>new Date().toISOString();
 f.args=async(key=randomUUID())=>({p_request_key:key,p_request:f.input,p_sources:await Promise.all([...f.records].map(async([evidence_id,r])=>({evidence_id,...await originalRegistryRowHashes(r.evidence,r.license)})))});
 return f;
}
try{
 // Local image only; no pull/network access and no secret is needed in this DB.
 containerId=docker(['run','--pull=never','-d','--name',name,'--network','none','--tmpfs','/var/lib/postgresql/data:rw,size=268435456',
  '-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);
 assert.match(containerId,/^[a-f0-9]{64}$/,'ISOLATED_CONTAINER_ID_REQUIRED');
 let ready=false;for(let i=0;i<60;i++){try{sql('select 1');ready=true;break;}catch{}await new Promise(r=>setTimeout(r,200));}
 assert(ready,'ISOLATED_FRESH_DB_UNAVAILABLE');assert(sql('show server_version').startsWith('17.'));
 sql(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
 create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
 create function public.is_research_owner_v1() returns boolean language sql stable as $$select false$$;
 create schema academy_private;create function academy_private.access_v11() returns text language sql stable as $$select 'free'::text$$;
 create function public.market_calendar_session_v1(text,date) returns boolean language sql stable as $$select true$$;
 create function public.authoritative_market_calendar_v1() returns jsonb language sql stable as $$select '{}'::jsonb$$;
 create table public.market_checkpoint_batches(batch_id uuid,business_date date,checkpoint text,status text,expected_provider_count int,committed_provider_count int,committed_at timestamptz);
 create table public.decision_snapshots(id uuid,report_date date,session_type text,status text,created_at timestamptz,generated_text jsonb,market_regime text);
 create table public.recommendation_shadow_v2_runs(business_date date,source_batch_id uuid,cutoff timestamptz,evidence jsonb,input_sha256 text);`);
 for(const path of ['supabase/migrations/20261010061630_vnext_research_projection_candidate.sql',
  'supabase/migrations/20261012054120_vnext_daily_research_runtime_candidate.sql',
  'supabase/migrations/20261019123345_original_observation_ingress_candidate_v1.sql',
  'src/features/vnext/originalRegistryIngress.candidate.sql'])sql(read(path));
 checks.push('Exact three existing SQL candidates + single additive wrapper, isolated PostgreSQL17 only');
 sql(`insert into vnext_runtime.runs(id,business_date,upstream_batch,upstream_phase,created_at,actionable_at,source_revision,checkpoint)
 values('${runId}',(clock_timestamp() at time zone 'Asia/Taipei')::date,'${randomUUID()}','PREMARKET',${quote(at(-120000))},${quote(at(1800000))},'${revision}',
 ${json({acquired:{snapshot_hash:revision,evidence_cutoff:at(-60000)},locks:[]})});`);
 const first=await fixture(),args=await first.args(),initial=count();
 for(const role of ['anon','authenticated'])assert.throws(()=>sql(query(args,role)),e=>e.stderr.includes('permission denied'));
 assert.equal(count(),initial);checks.push('anon/authenticated including browser Owner cannot call wrapper; no writes');
 const ingress=createOriginalRegistryIngress(first.ports),key=args.p_request_key;
 const results=await Promise.all(Array.from({length:8},()=>ingress(key,first.input)));
 assert.equal(results.filter(r=>!r.replayed).length,1);assert(results.every(r=>r.state==='WATCHING'&&r.observation.publication_status==='RESEARCH_ONLY'));
 assert(results.every(r=>r.observation.snapshot_hash===results[0].observation.snapshot_hash));
 assert.equal(results[0].source_receipts.length,4);assert.equal(sql('select count(*) from vnext_private.original_ingress_receipts'),'1');
 assert.equal(sql('select count(*) from vnext_private.event_sources'),'4');assert.equal(sql('select count(*) from vnext_private.source_licenses'),'1');
 checks.push('Typed adapter -> exact SQL row hashes -> original ingress: eight concurrent calls, one sealed lock, no source/License creation');
 const saved=count();await assert.rejects(()=>ingress(key,{...first.input,reason:'changed'}),/IDEMPOTENCY_CONFLICT/);
 await assert.rejects(()=>ingress(randomUUID(),first.input),/ALREADY_LINKED/);assert.equal(count(),saved);
 for(const horizon of ['MEDIUM','LONG']){const f=await fixture({horizon}),out=await createOriginalRegistryIngress(f.ports)(randomUUID(),f.input);
  assert.equal(out.observation.horizon,horizon);assert.equal(out.state,'WATCHING');}
 checks.push('Original three-horizon required kinds, request-key conflict and C-prediction uniqueness remain unchanged');
 for(const opts of [{omit:['NEWS']},{dbEvidence:e=>({...e,summary:'different committed registry row'})},
  {dbEvidence:e=>({...e,last_verified_at:at(-69999)})},{dbLicense:l=>({...l,derived:false})},
  {dbLicense:l=>({...l,commercial:true})}]){
  const f=await fixture(opts),before=count();await assert.rejects(()=>createOriginalRegistryIngress(f.ports)(randomUUID(),f.input),/REGISTERED_EVIDENCE_MISSING|ROW_VERSION_MISMATCH/);
  assert.equal(count(),before);
 }
 checks.push('Missing sources, changed text/time/rights reject BEFORE the original write; no post-commit mismatch or partial rows');
 for(const mutate of [a=>a.p_sources=[],a=>a.p_sources.push(a.p_sources[0]),a=>a.p_sources[0].quality='PASS',
  a=>a.p_sources[0].evidence_record_hash=sha('fabricated'),a=>a.p_request.confirmation_conditions[0].state='CONFIRMED']){
  const f=await fixture(),a=await f.args(),before=count();mutate(a);
  await assert.rejects(()=>rpc(ORIGINAL_REGISTRY_INGRESS_RPC,a),/EXPECTATIONS_INVALID|EVIDENCE_SET_NOT_EXACT|ROW_VERSION_MISMATCH|CONDITION_INVALID/);assert.equal(count(),before);
 }
 checks.push('Direct RPC negatives: empty source enrollment, extra/duplicate sources, caller PASS, fake hashes and non-UNKNOWN condition rejected');
 for(const [kind,change] of [['quality',e=>({...e,quality:'REJECTED'})],['rights',l=>({...l,storage:false})]]){
  const f=await fixture(kind==='quality'?{dbEvidence:change}:{dbLicense:change}),a=await f.args();
  // Even exact hashes of a BAD registered row cannot authorize it. They prove
  // identity only; the original SQL still independently enforces its gate.
  for(const s of a.p_sources){const r=f.records.get(s.evidence_id);
   Object.assign(s,await originalRegistryRowHashes(kind==='quality'?change(r.evidence):r.evidence,kind==='rights'?change(r.license):r.license));}
  const before=count();await assert.rejects(()=>rpc(ORIGINAL_REGISTRY_INGRESS_RPC,a),/TIME_QUALITY_OR_STORAGE_RIGHTS/);assert.equal(count(),before);
 }
 checks.push('Matching row hashes are NOT approval: rejected quality or missing storage right still fails original SQL gate');
 const rollback=await fixture(),rollbackArgs=await rollback.args(),rollbackBefore=count();
 assert.throws(()=>sql(`begin;${query(rollbackArgs)}select 1/0;commit;`));assert.equal(count(),rollbackBefore);
 checks.push('Crash rolls back Observation, evidence links and immutable receipt atomically');
 const extra=await fixture(),extraArgs=await extra.args(),extraId=sha('SYNTHETIC EXTRA SAME TRANSACTION');
 sql(`insert into vnext_private.event_sources select '${extraId}',symbol,kind,source,source_ref,license_id,published_at,first_seen_at,
  available_at,as_of,last_verified_at,valid_until,snapshot_hash,classification,quality,relevant,summary
  from vnext_private.event_sources where id='${extra.input.evidence_ids[0]}'`);
 const extraBefore=count();
 assert.throws(()=>sql(`begin;${query(extraArgs)}reset role;insert into vnext_private.observation_evidence
  values('original-${sha(extra.input.c_prediction_id)}','${extraId}');commit;`),e=>e.stderr.includes('ORIGINAL_EVIDENCE_SET_NOT_EXACT'));
 assert.equal(count(),extraBefore);checks.push('Existing deferred exact-set seal also rejects a later extra link in the wrapper transaction');
 const lost=await fixture(),lostKey=randomUUID();let calls=0;
 lost.ports.rpc=async(n,a)=>{calls++;await rpc(n,a);throw Error('ISOLATED_REPLY_LOST');};
 await assert.rejects(()=>createOriginalRegistryIngress(lost.ports)(lostKey,lost.input),/REPLY_LOST/);assert.equal(calls,1);
 const afterLost=count();lost.ports.rpc=rpc;
 assert((await createOriginalRegistryIngress(lost.ports)(lostKey,lost.input)).replayed);assert.equal(count(),afterLost);
 checks.push('No automatic retry; explicit same-key reconciliation returns original sealed receipt');
 assert.equal(sql('select count(*) from vnext_private.publication_audit'),'0');assert.equal(sql('select count(*) from vnext_private.member_copy'),'0');
 assert.equal(sql('select count(*) from vnext_runtime.outcomes'),'0');assert.equal(sql("select public.get_vnext_member_v1()->'observations'"),'[]');
 assert.throws(()=>sql("set role service_role;select * from vnext_private.original_ingress_receipts"));
 assert.throws(()=>sql("update vnext_private.event_sources set quality='PASS'"));
 assert.throws(()=>sql("update vnext_private.source_licenses set commercial_allowed=true"));
 checks.push('Original immutable registry/RLS/receipt ACL preserved; member publication/Outcome remain empty');
 const stopped=count();sql(`revoke execute on function public.${ORIGINAL_REGISTRY_INGRESS_RPC}(uuid,jsonb,jsonb) from service_role`);
 await assert.rejects(()=>rpc(ORIGINAL_REGISTRY_INGRESS_RPC,args),/permission denied/);assert.equal(count(),stopped);
 checks.push('Stopping only wrapper execute preserves all sealed rows');
}finally{
 const cleanup=cleanupOriginalRegistryContainer({name,id:containerId,docker});
 console.log(JSON.stringify({cleanup}));
 if(cleanup!=='PASS')throw Error('ORIGINAL_REGISTRY_CLEANUP_FAILED');
}
// Do not print a successful controls receipt before verified cleanup succeeds.
console.log(JSON.stringify({scope:'ISOLATED_SYNTHETIC_REGISTRY_TO_ORIGINAL_SQL_NOT_PRODUCTION',checks,production_changed:false,new_schema:false}));

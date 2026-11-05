/** Exact candidate SQL in a disposable, network-disabled PostgreSQL17 FreshDB.
 * Uses the EXISTING local ma-runtime-sparse-ci image, never builds/pulls it.
 * Only this container's synthetic DB clock is controlled via libfaketime.
 * Expiry tests advance that clock; SQL predicates are NEVER removed/relaxed.
 * SYNTHETIC registry approvals/raw bytes/reviews/C lineage only. No Production,
 * natural producer, financial Actual, real right or licensed source is claimed.
 * Administrative authority installation below is SYNTHETIC ONLY. No real source
 * is admitted; the candidate is NOT a formal V1 publisher/approved production data.
 * Uses no .env, credentials, remote DB, published port or persistent volume.
 */
import assert from 'node:assert/strict';
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createOriginalRegistryIngress,createOriginalRegistryApprovedReader,ORIGINAL_REGISTRY_READ_RPC,ORIGINAL_REGISTRY_INGRESS_RPC,originalRegistryRowHashes} from '../src/features/vnext/originalRegistryIngress.ts';
import {registryFixture,sha,finishOriginalRegistryRun} from './fixtures/originalRegistryIngress.mjs';
const name='ma-registry-ingress-'+process.pid+'-'+randomUUID().slice(0,8),checks=[];
const docker=(args,input)=>execFileSync('docker',args,{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:16e6,timeout:30000}).trim();
// The image's temporary initialization server is Unix-socket-only. Loopback
// TCP waits for the final server instead of falsely admitting that temp server.
const psql=['exec','-i',name,'psql','-h','127.0.0.1','-XqAt','-U','postgres','-v','ON_ERROR_STOP=1'];
const sql=q=>docker(psql,q),read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const quote=x=>"'"+String(x).replaceAll("'","''")+"'",json=x=>quote(JSON.stringify(x))+'::jsonb';
const execute=promisify(execFile);
const sqlAsync=async q=>{
 const child=execute('docker',psql,{encoding:'utf8',maxBuffer:16e6,timeout:30000});child.child.stdin.end(q);
 return (await child).stdout.trim();
};
const epoch=Date.parse('2026-10-20T00:10:00Z'),at=ms=>new Date(epoch+ms).toISOString(),runId=randomUUID(),revision=sha('SYNTHETIC REGISTRY RUN ONLY');
let dbOffset=0;
const setClock=seconds=>{docker(['exec',name,'bash','-c','printf "%s\\n" "$1" > /tmp/registry-clock','_',at(seconds*1000).slice(0,19).replace('T',' ')]);dbOffset=seconds;};
const count=()=>sql(`select jsonb_build_object('sources',(select count(*) from vnext_private.event_sources),
 'licenses',(select count(*) from vnext_private.source_licenses),'obs',(select count(*) from vnext_private.stock_horizon_observations),
 'links',(select count(*) from vnext_private.observation_evidence),'receipts',(select count(*) from vnext_private.original_ingress_receipts),
 'publication',(select count(*) from vnext_private.publication_audit),'copy',(select count(*) from vnext_private.member_copy),
 'outcomes',(select count(*) from vnext_runtime.outcomes))`);
const query=(args,role='service_role')=>`set role ${role};select public.${ORIGINAL_REGISTRY_INGRESS_RPC}(${quote(args.p_request_key)},${json(args.p_request)},${json(args.p_sources)});`;
const rpc=async(name,args)=>{assert.equal(name,ORIGINAL_REGISTRY_INGRESS_RPC);try{return JSON.parse(await sqlAsync(query(args)));}
 catch(e){throw Error(String(e.stderr).match(/ERROR:\s*([^\n]+)/)?.[1]??'ISOLATED_RPC_FAILED');}};
const authorityIds=[randomUUID(),randomUUID(),randomUUID()];
const revokeSql=id=>`insert into original_registry_candidate.revocations(id,version_id,reason,document_hash) values('${randomUUID()}','${id}','SYNTHETIC REVOKE','${sha('SYNTHETIC REVOKE')}');`;
const dbRead=async(name,args)=>{assert.equal(name,ORIGINAL_REGISTRY_READ_RPC);return JSON.parse(sql(`set role service_role;select public.${name}(${quote(args.p_evidence_id)},${quote(args.p_version_id)});`));};
let number=0,containerId='',phase='IMAGE_CHECK',failure=null;
async function fixture({horizon='SHORT',omit=[],dbEvidence=r=>r,dbLicense=l=>l,installApproval=true,approval={}}={}){
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
 if(installApproval)for(const pin of f.pins){
  if(omit.includes(f.records.get(pin.evidence_id).evidence.kind))continue;
  const r=f.records.get(pin.evidence_id),hashes=await originalRegistryRowHashes(r.evidence,r.license);
  sql(`insert into original_registry_candidate.versions(id,evidence_id,source_authority,quality_authority,rights_authority,record_hash,evidence_record_hash,license_record_hash,record,status,valid_from,expires_at)
   values('${pin.approval_id}','${pin.evidence_id}','${approval.source??authorityIds[0]}','${approval.quality??authorityIds[1]}','${approval.rights??authorityIds[2]}',
   '${pin.record_hash}','${hashes.evidence_record_hash}','${hashes.license_record_hash}',${json(r)},${quote(approval.status??'APPROVED')},clock_timestamp()-interval '1 minute',
   clock_timestamp()+interval '${approval.seconds??1800} seconds');`);
 }
 f.ports.rpc=rpc;f.ports.now=()=>at(dbOffset*1000);
 f.ports.readApproved=createOriginalRegistryApprovedReader(f.pins,dbRead);
 f.args=async(key=randomUUID())=>({p_request_key:key,p_request:f.input,p_sources:await Promise.all(f.pins.map(async p=>({evidence_id:p.evidence_id,approval_id:p.approval_id,registry_record_hash:p.record_hash,...await originalRegistryRowHashes(f.records.get(p.evidence_id).evidence,f.records.get(p.evidence_id).license)})))});
 return f;
}
try{
 // CI prepares this exact existing Dockerfile/image first. Local execution
 // never builds/pulls; an unavailable image must remain a classified failure.
 docker(['image','inspect','--format','{{.Id}}','ma-runtime-sparse-ci:latest']);
 phase='CONTAINER_START';
 // Pre-existing libfaketime image only. The file belongs to this container;
 // neither the host clock nor Production time is changed. No jitter allowance.
 containerId=docker(['run','--pull=never','-d','--name',name,'--network','none','--tmpfs','/var/lib/postgresql/data:rw,size=268435456,uid=999,gid=999,mode=0700',
  '--tmpfs','/tmp:rw,size=16777216,mode=1777','--entrypoint','bash','ma-runtime-sparse-ci:latest','-c',
  'printf "%s\\n" "2026-10-20 00:10:00" > /tmp/registry-clock; initdb -D "$PGDATA" --auth=trust >/dev/null && exec env -u FAKETIME FAKETIME_TIMESTAMP_FILE=/tmp/registry-clock LD_PRELOAD=/usr/local/lib/libfaketime.so.1 postgres -D "$PGDATA" -c listen_addresses=127.0.0.1']);
 assert.match(containerId,/^[a-f0-9]{64}$/,'ISOLATED_CONTAINER_ID_REQUIRED');
 phase='DB_READY';
 let ready=false;for(let i=0;i<60;i++){try{sql('select 1');ready=true;break;}catch{}await new Promise(r=>setTimeout(r,200));}
 assert(ready,'ISOLATED_FRESH_DB_UNAVAILABLE');assert(sql('show server_version').startsWith('17.'));
 assert.equal(sql("select clock_timestamp()=timestamptz '2026-10-20T00:10:00Z'"),'t','test DB clock is exact and isolated');
 // Exercise the real Docker CLI failure against THIS captured container only.
 // An intentionally unsupported flag fails before deletion. The real object
 // must remain; ordinary exact-ID cleanup still runs once in the outer finally.
 const cleanupNegative=finishOriginalRegistryRun({name,id:containerId,docker:args=>docker(args[1]==='rm'
  ?[...args.slice(0,2),'--registry-cleanup-negative-control',...args.slice(2)]:args)});
 assert.equal(cleanupNegative.cleanup,'FAIL');assert(cleanupNegative.failed);
 assert.equal(docker(['container','inspect','--format','{{.Id}}',containerId]),containerId);
 const uncaptured=finishOriginalRegistryRun({name,id:'',docker,failure:{phase:'CONTAINER_START',error:Error('SYNTHETIC_START_FAILURE')}});
 assert.equal(uncaptured.cleanup,'FAIL','an existing object without captured ID cannot be deleted or called NOT_CREATED');
 phase='SQL_CONTROLS';
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
 assert.equal(sql('select count(*) from original_registry_candidate.authorities'),'0');
 assert.equal(sql('select count(*) from original_registry_candidate.versions'),'0');
 for(const [i,kind] of ['SOURCE','QUALITY','RIGHTS'].entries())sql(`insert into original_registry_candidate.authorities(id,kind,authority_ref,status,document_ref,document_hash,valid_from,expires_at)
  values('${authorityIds[i]}','${kind}','SYNTHETIC ${kind}','APPROVED','SYNTHETIC AUTHORITY DOCUMENT','${sha(kind)}',clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day');`);
 for(const role of ['anon','authenticated','service_role'])for(const table of ['authorities','versions','revocations','write_guards']){
  assert.throws(()=>sql(`set role ${role};select * from original_registry_candidate.${table}`));
  assert.throws(()=>sql(`set role ${role};insert into original_registry_candidate.${table} default values`));
  assert.throws(()=>sql(`set role ${role};update original_registry_candidate.${table} set recorded_at=clock_timestamp() where false`));
  assert.throws(()=>sql(`set role ${role};delete from original_registry_candidate.${table} where false`));
 }
 assert.equal(sql("select count(*) from pg_class where relnamespace='original_registry_candidate'::regnamespace and relkind='r' and relrowsecurity and relforcerowsecurity"),'4');
 checks.push('No seeds, four FORCE RLS tables, distinct synthetic administrative authorities; no app/member/service registry DML');
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
  const f=await fixture(opts),before=count();await assert.rejects(()=>createOriginalRegistryIngress(f.ports)(randomUUID(),f.input),opts.omit?/APPROVAL_MISSING/:/ROW_VERSION_MISMATCH/);
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
  const before=count();await assert.rejects(()=>rpc(ORIGINAL_REGISTRY_INGRESS_RPC,a),/TIME_QUALITY_OR_STORAGE_RIGHTS|APPROVAL_BINDING_INVALID/);assert.equal(count(),before);
 }
 checks.push('Matching row hashes are NOT approval: rejected quality or missing storage right still fails original SQL gate');
 for(const opts of [{installApproval:false},{approval:{status:'PENDING'}},{approval:{source:authorityIds[1],quality:authorityIds[0]}}]){
  const f=await fixture(opts),before=count();await assert.rejects(async()=>rpc(ORIGINAL_REGISTRY_INGRESS_RPC,await f.args()),/APPROVAL_MISSING|EXPIRED_OR_UNAPPROVED|AUTHORITY_KIND_INVALID/);assert.equal(count(),before);
 }
 const noAuthority=await fixture({installApproval:false});assert.throws(()=>sql(`insert into original_registry_candidate.versions(id,evidence_id,source_authority,quality_authority,rights_authority,record_hash,evidence_record_hash,license_record_hash,record,status,valid_from,expires_at)
  values('${randomUUID()}','${noAuthority.pins[0].evidence_id}','${randomUUID()}','${authorityIds[1]}','${authorityIds[2]}','${sha('x')}','${sha('y')}','${sha('z')}','{}','APPROVED',clock_timestamp(),clock_timestamp()+interval '1 day')`));
 for(const role of ['anon','authenticated'])assert.throws(()=>sql(`set role ${role};select public.${ORIGINAL_REGISTRY_READ_RPC}(null,null)`));
 assert.throws(()=>sql(`set role service_role;select public.${ORIGINAL_REGISTRY_READ_RPC}(null,null)`));
 assert.throws(()=>sql(`set role service_role;select public.ingest_vnext_original_observation_candidate_v1('${randomUUID()}',${json(first.input)})`),e=>e.stderr.includes('permission denied'));
 const nullArgs=await first.args();nullArgs.p_sources[0].approval_id=null;
 await assert.rejects(()=>rpc(ORIGINAL_REGISTRY_INGRESS_RPC,nullArgs),/EXPECTATIONS_INVALID/);
 checks.push('Direct base API is closed; NULL/unknown/missing authority/PENDING approval and member source reads deny');
 const afterRead=await fixture(),approvedRead=afterRead.ports.readApproved;let revoked=false;
 afterRead.ports.readApproved=async id=>{const r=await approvedRead(id);if(!revoked){revoked=true;sql(revokeSql(afterRead.pins[0].approval_id));}return r;};
 const beforeRevoke=count();await assert.rejects(()=>createOriginalRegistryIngress(afterRead.ports)(randomUUID(),afterRead.input),/REVOKED/);assert.equal(count(),beforeRevoke);
 const transit=await fixture({approval:{seconds:3}}),transitBefore=count();
 transit.ports.rpc=async(n,a)=>{setClock(4);return rpc(n,a);};
 try{await assert.rejects(()=>createOriginalRegistryIngress(transit.ports)(randomUUID(),transit.input),/EXPIRED_OR_UNAPPROVED/);assert.equal(count(),transitBefore);}finally{setClock(0);}
 const expiringAuthority=randomUUID();sql(`insert into original_registry_candidate.authorities(id,kind,authority_ref,status,document_ref,document_hash,valid_from,expires_at,recorded_at)
  values('${expiringAuthority}','SOURCE','SYNTHETIC EXPIRING SOURCE AUTHORITY','APPROVED','SYNTHETIC DOCUMENT','${sha('expiring-authority')}',clock_timestamp()-interval '1 day',clock_timestamp()+interval '2 seconds',timestamptz '2000-01-01Z')`);
 assert.equal(sql(`select recorded_at=clock_timestamp() from original_registry_candidate.authorities where id='${expiringAuthority}'`),'t','recorded time is sealed by DB, never caller');
 const expiringSource=await fixture({approval:{source:expiringAuthority}}),expiringSourceArgs=await expiringSource.args(),expiryBefore=count();
 try{setClock(4);await assert.rejects(()=>rpc(ORIGINAL_REGISTRY_INGRESS_RPC,expiringSourceArgs),/AUTHORITY_UNAPPROVED/);assert.equal(count(),expiryBefore);}finally{setClock(0);}
 const expiringReview=await fixture({approval:{seconds:7200}}),expiringReviewArgs=await expiringReview.args(),reviewBefore=count();
 try{setClock(1801);await assert.rejects(()=>rpc(ORIGINAL_REGISTRY_INGRESS_RPC,expiringReviewArgs),/REVIEW_EXPIRED/);assert.equal(count(),reviewBefore);}finally{setClock(0);}
 const atCommit=await fixture({approval:{seconds:2}}),commitArgs=await atCommit.args(),commitBefore=count();
 const guardBefore=sql('select count(*) from original_registry_candidate.write_guards');
 // psql-client delay uses real monotonic time; a frozen DB clock cannot run
 // pg_sleep reliably. This does not alter the database eligibility predicate.
 const pendingCommit=sqlAsync(`begin;${query(commitArgs)}\n\\! sleep 0.7\ncommit;`);
 try{await assert.rejects(async()=>{
  let locked=false;for(let i=0;i<30;i++){if(sql("select pg_try_advisory_xact_lock(hashtextextended('original-registry-approval-v1',0))")==='f'){locked=true;break;}await new Promise(r=>setTimeout(r,10));}
  assert(locked);setClock(4);await pendingCommit;
 },e=>e.stderr?.includes('EXPIRED_OR_UNAPPROVED'));assert.equal(count(),commitBefore);
 assert.equal(sql('select count(*) from original_registry_candidate.write_guards'),guardBefore);}finally{setClock(0);}
 checks.push('DB-sealed time, read-then-revoke, transport/authority/review expiry and deferred commit expiry reject with complete guard/Original rollback');
 const serial=await fixture(),serialArgs=await serial.args(),serialWrite=sqlAsync(`begin;${query(serialArgs)}\n\\! sleep 0.5\ncommit;`);
 let locked=false;for(let i=0;i<30;i++){
  if(sql("select pg_try_advisory_xact_lock(hashtextextended('original-registry-approval-v1',0))")==='f'){locked=true;break;}
  await new Promise(r=>setTimeout(r,10));
 }assert(locked,'writer must acquire the registry transaction lock');
 await Promise.all([serialWrite,sqlAsync(revokeSql(serial.pins[0].approval_id))]);
 const serialBefore=count();await assert.rejects(()=>rpc(ORIGINAL_REGISTRY_INGRESS_RPC,serialArgs),/REVOKED/);assert.equal(count(),serialBefore);
 const stale=await fixture(),staleArgs=await stale.args();
 assert.throws(()=>sql(`begin isolation level repeatable read;${query(staleArgs)}commit;`),e=>e.stderr.includes('ISOLATION_UNSUPPORTED'));
 const authorityRevoked=await fixture();sql(`insert into original_registry_candidate.revocations(id,authority_id,reason,document_hash)
  values('${randomUUID()}','${authorityIds[2]}','SYNTHETIC RIGHTS AUTHORITY REVOKED','${sha('SYNTHETIC AUTHORITY REVOKE')}')`);
 const authorityBefore=count();await assert.rejects(async()=>rpc(ORIGINAL_REGISTRY_INGRESS_RPC,await authorityRevoked.args()),/REVOKED/);assert.equal(count(),authorityBefore);
 // Restore no authority: immutable revocations stay forever. The remaining
 // old regressions use a new independent synthetic rights authority/version.
 authorityIds[2]=randomUUID();sql(`insert into original_registry_candidate.authorities(id,kind,authority_ref,status,document_ref,document_hash,valid_from,expires_at)
  values('${authorityIds[2]}','RIGHTS','SYNTHETIC RIGHTS SECOND VERSION','APPROVED','SYNTHETIC DOCUMENT','${sha('rights-v2')}',clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day')`);
 checks.push('Concurrent revoke serializes behind commit, revoked replay denies, stale snapshots and rights-authority revocation deny');
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
 for(const table of ['authorities','versions','revocations','write_guards']){
  assert.throws(()=>sql(`update original_registry_candidate.${table} set recorded_at=clock_timestamp()`),e=>e.stderr.includes('VNEXT_APPEND_ONLY'));
  assert.throws(()=>sql(`delete from original_registry_candidate.${table}`),e=>e.stderr.includes('VNEXT_APPEND_ONLY'));
 }
 checks.push('Original immutable registry/RLS/receipt ACL preserved; member publication/Outcome remain empty');
 const stopped=count();sql(`revoke execute on function public.${ORIGINAL_REGISTRY_INGRESS_RPC}(uuid,jsonb,jsonb) from service_role`);
 await assert.rejects(()=>rpc(ORIGINAL_REGISTRY_INGRESS_RPC,args),/permission denied/);assert.equal(count(),stopped);
 checks.push('Stopping only wrapper execute preserves all sealed rows');
}catch(error){
 failure={phase,error};
}finally{
 const result=finishOriginalRegistryRun({name,id:containerId,docker,failure});
 console.log(JSON.stringify(result));
 // Both primary and cleanup failures remain nonzero. Throw only a fixed code,
 // not the child-process exception (which contains raw Docker/SQL arguments).
 if(result.failed)throw Error('ORIGINAL_REGISTRY_RUN_FAILED');
}
// Do not print a successful controls receipt before verified cleanup succeeds.
console.log(JSON.stringify({scope:'ISOLATED_SYNTHETIC_REGISTRY_TO_ORIGINAL_SQL_NOT_PRODUCTION',checks,production_changed:false,new_private_candidate_schema:true}));

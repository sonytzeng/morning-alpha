/** Disposable PostgreSQL contract checks only. The deterministic RNG below is
 * a conspicuous test seam because this PGlite build omits pgcrypto. Production
 * uses extensions.gen_random_bytes(32); no entropy or live-key test is claimed.
 * No provider, GitHub, OIDC, production database or real key is accessed. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,copyFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {URL} from 'node:url';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import process from 'node:process';
import console from 'node:console';
import {marketStageCanonical} from '../research/daily-ai-market-stage.mjs';
import {beginWorkerCheckpoint,sealWorkerCheckpoint,readWorkerCheckpoint,
 inventoryCheckpointTree,copyCheckpointResume,encryptCheckpointBundle,restoreWorkerCheckpoint}
 from '../research/taiwan-market-checkpoint.mjs';

if(!process.env.MA_PGLITE_MODULE)throw Error('MA_PGLITE_MODULE_REQUIRED');
const {PGlite}=await import(process.env.MA_PGLITE_MODULE),db=new PGlite();await db.waitReady;
const sha=value=>createHash('sha256').update(value).digest('hex'),canonical=marketStageCanonical;
const get='get_daily_ai_market_worker_checkpoint_v2',begin='begin_daily_ai_market_worker_checkpoint_v2',seal='seal_daily_ai_market_worker_checkpoint_v2';
const methods=[get,begin,seal],sqlUrl=new URL('../research/daily-ai-market-checkpoints.candidate.sql',import.meta.url);
const sql=await readFile(sqlUrl,'utf8'),rollback=await readFile(new URL('../research/daily-ai-market-checkpoints.rollback.sql',import.meta.url),'utf8');
const tableNames=['worker_checkpoints','worker_checkpoint_archives','worker_checkpoint_stream'];
const context=(id,prior=null)=>({schema:'TAIWAN_MARKET_CHECKPOINT_BEGIN_V1',checkpoint_id:id,prior_checkpoint_id:prior,run_id:'123456789',run_attempt:1,git_commit:'a'.repeat(40)});
const beginArgs=body=>{const text=canonical(body);return {p_context_text:text,p_context_hash:sha(text)};};
function archives(id,contextHash){return {schema:'TAIWAN_MARKET_CHECKPOINT_ARCHIVES_V1',checkpoint_id:id,context_hash:contextHash,work_state:'PREPARED_REVIEW_REQUIRED',
 bundles:['AUDIT','RESUME'].map((kind,i)=>({kind,artifact_id:String(10000+i),artifact_name:'taiwan-market-'+kind.toLowerCase()+'-'+id,
  format:'TAR_GZIP_AES_256_GCM_V1',ciphertext_sha256:sha('synthetic cipher '+kind),ciphertext_bytes:4096,
  plaintext_sha256:sha('synthetic plain '+kind),plaintext_bytes:8192,manifest_sha256:sha('synthetic manifest '+kind),file_count:10,
  nonce_base64:Buffer.alloc(12,i+1).toString('base64'),tag_base64:Buffer.alloc(16,i+3).toString('base64')}))};}
const sealArgs=body=>{const text=canonical(body);return {p_checkpoint_id:body.checkpoint_id,p_archive_text:text,p_archive_hash:sha(text)};};
async function rpc(name,args={}){assert(methods.includes(name));const values=Object.values(args);
 return(await db.query('select public.'+name+'('+values.map((_,i)=>'$'+(i+1)).join(',')+') result',values)).rows[0].result;}
async function counts(){await db.exec('reset role');const values={};for(const table of tableNames)values[table]=(await db.query('select count(*)::int n from vnext_market.'+table)).rows[0].n;
 await db.exec('set role service_role');return values;}
const phases=[];function passed(label){phases.push(label);console.log(JSON.stringify({phase:phases.length,result:'PASS',label}));}
const idA=sha('SYNTHETIC_CHECKPOINT_A'),idB=sha('SYNTHETIC_CHECKPOINT_B'),idC=sha('SYNTHETIC_CHECKPOINT_C'),idD=sha('SYNTHETIC_CHECKPOINT_D');
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
  create schema auth;create table auth.users(id uuid primary key);create function auth.uid()returns uuid language sql as $$select null::uuid$$;
  create schema academy_private;create function academy_private.access_v11()returns text language sql as $$select 'denied'::text$$;
  create function public.is_research_owner_v1()returns boolean language sql as $$select false$$;
  create schema vnext_private;create table vnext_private.source_licenses(source text,storage_allowed boolean,derived_allowed boolean,
   commercial_allowed boolean,reviewed_at timestamptz,expires_at timestamptz,document_url text,attribution text);
  create schema extensions;create sequence extensions.synthetic_checkpoint_rng_counter;
  create function extensions.gen_random_bytes(n integer)returns bytea language plpgsql volatile set search_path=''as $$begin
   if n<>32 then raise exception 'SYNTHETIC_RNG_TEST_WIDTH';end if;
   return sha256(convert_to('SYNTHETIC_NONSECRET_RNG_FIXTURE:'||nextval('extensions.synthetic_checkpoint_rng_counter')::text,'UTF8'));
  end $$;`);
 await db.exec(await readFile(new URL('../research/daily-ai-market-v2.candidate.sql',import.meta.url),'utf8'));
 await db.exec(sql);
 const initialArgs=[{},beginArgs(context(idA)),sealArgs(archives(idA,beginArgs(context(idA)).p_context_hash))];
 for(const role of ['anon','authenticated']){await db.exec('set role '+role);
  for(const [i,name]of methods.entries())await assert.rejects(rpc(name,initialArgs[i]),e=>e.code==='42501');
  for(const table of tableNames)await assert.rejects(db.query('select * from vnext_market.'+table),e=>e.code==='42501');await db.exec('reset role');}
 const acl=(await db.query(`select bool_and(not has_function_privilege('anon',p.oid,'execute')and not has_function_privilege('authenticated',p.oid,'execute')
   and has_function_privilege('service_role',p.oid,'execute'))ok from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public'and p.proname=any($1::text[])`,[methods])).rows[0].ok;assert.equal(acl,true);
 await db.exec('set role service_role');for(const table of tableNames)await assert.rejects(db.query('select * from vnext_market.'+table),e=>e.code==='42501');
 assert.deepEqual(await rpc(get),{schema:'DAILY_AI_MARKET_WORKER_CHECKPOINT_V1',head:null,pending:null});
 passed('only service RPCs can read checkpoint keys; anon/authenticated and direct service table reads denied');

 for(const mutate of [m=>{delete m.prior_checkpoint_id;},m=>{m.prior_checkpoint_id=17;},m=>{m.run_attempt=0;},m=>{m.run_attempt=1001;},
  m=>{m.run_attempt='1';},m=>{m.run_attempt=1.5;},m=>{m.run_id=123;},m=>{m.git_commit='a'.repeat(39);},m=>{m.source_approved=true;}]){
  const m=context(idA);mutate(m);await assert.rejects(rpc(begin,beginArgs(m)),/MARKET_CHECKPOINT_CONTEXT_CONTRACT/);}
 await assert.rejects(rpc(begin,{...beginArgs(context(idA)),p_context_hash:'0'.repeat(64)}),/MARKET_CHECKPOINT_CONTEXT_HASH/);
 const spaced=JSON.stringify(context(idA),null,2);await assert.rejects(rpc(begin,{p_context_text:spaced,p_context_hash:sha(spaced)}),/MARKET_CHECKPOINT_CONTEXT_CONTRACT/);
 const duplicate=canonical(context(idA)).replace('"run_attempt":1','"run_attempt":1,"run_attempt":1');
 await assert.rejects(rpc(begin,{p_context_text:duplicate,p_context_hash:sha(duplicate)}),/MARKET_CHECKPOINT_CONTEXT_CONTRACT/);
 assert.equal((await counts()).worker_checkpoints,0);await db.exec('reset role');
 assert.equal((await db.query('select is_called from extensions.synthetic_checkpoint_rng_counter')).rows[0].is_called,false);await db.exec('set role service_role');
 passed('canonical exact context/hash/type/range checks reject before any key is issued');

 const argsA=beginArgs(context(idA)),issuedA=await rpc(begin,argsA),replayedA=await rpc(begin,argsA);
 assert.equal(issuedA.replayed,false);assert.equal(issuedA.sequence,1);assert.equal(issuedA.prior_checkpoint_id,null);
 assert.equal(Buffer.from(issuedA.key_base64,'base64').length,32);assert.deepEqual(replayedA,{...issuedA,replayed:true});
 let state=await rpc(get);assert.equal(state.head,null);assert.equal(state.pending.checkpoint_id,idA);assert.equal(state.pending.archive_text,null);
 assert.equal(state.pending.archive_hash,null);assert.equal(state.pending.sealed_at,null);assert.equal(state.pending.key_base64,issuedA.key_base64);
 assert.deepEqual(Object.keys(state.pending).sort(),['checkpoint_id','sequence','prior_checkpoint_id','context_text','context_hash','key_base64','issued_at','archive_text','archive_hash','sealed_at'].sort());
 await assert.rejects(rpc(begin,beginArgs({...context(idA),run_attempt:2})),/MARKET_CHECKPOINT_CONTEXT_REPLAY_CONFLICT/);
 await assert.rejects(rpc(begin,beginArgs(context(idB))),/MARKET_CHECKPOINT_PENDING_UNCONFIRMED/);
 await assert.rejects(rpc(begin,beginArgs(context(idB,idA))),/MARKET_CHECKPOINT_PENDING_UNCONFIRMED/);
 assert.equal((await counts()).worker_checkpoints,1);assert.equal((await rpc(get)).pending.key_base64,issuedA.key_base64);
 passed('lost begin ACK replays the same key; unknown pending blocks another checkpoint and old-seed fallback');

 const archiveA=archives(idA,argsA.p_context_hash);
 for(const mutate of [m=>{m.bundles[1].nonce_base64=m.bundles[0].nonce_base64;},m=>{m.bundles[1].artifact_id=m.bundles[0].artifact_id;},
  m=>{m.bundles.reverse();},m=>{m.bundles[0].artifact_name+='wrong';},m=>{m.bundles[0].ciphertext_bytes=2147483649;},
  m=>{m.bundles[0].plaintext_bytes=8589934593;},m=>{m.bundles[0].file_count=50001;},m=>{m.bundles[0].plaintext_bytes='8192';},
  m=>{m.bundles[0].ciphertext_bytes=null;},m=>{m.bundles[0].nonce_base64+='\n';},m=>{m.bundles[0].tag_base64=Buffer.alloc(15).toString('base64');},
  m=>{m.bundles[0].tag_base64='AAAAAAAAAAAAAAAAAAAAAB==';},m=>{m.bundles.pop();},m=>{m.work_state='';},m=>{m.key_base64='FORBIDDEN_EXTRA_FIELD';}]){
  const body=globalThis.structuredClone(archiveA);mutate(body);await assert.rejects(rpc(seal,sealArgs(body)),/MARKET_CHECKPOINT_/);}
 await assert.rejects(rpc(seal,{...sealArgs(archiveA),p_archive_hash:'0'.repeat(64)}),/MARKET_CHECKPOINT_ARCHIVE_HASH/);
 await assert.rejects(rpc(seal,sealArgs({...archiveA,context_hash:'0'.repeat(64)})),/MARKET_CHECKPOINT_ARCHIVE_CONTEXT/);
 assert.equal((await counts()).worker_checkpoint_archives,0);state=await rpc(get);assert.equal(state.head,null);assert.equal(state.pending.checkpoint_id,idA);
 const sealedA=await rpc(seal,sealArgs(archiveA));assert.equal(sealedA.replayed,false);assert.equal(sealedA.sequence,1);
 state=await rpc(get);assert.equal(state.pending,null);assert.equal(state.head.checkpoint_id,idA);assert.equal(state.head.archive_text,canonical(archiveA));
 assert.equal(state.head.archive_hash,sha(canonical(archiveA)));assert.match(state.head.sealed_at,/Z$/);
 passed('two distinct typed artifact bindings and canonical12-byte nonces/16-byte tags seal atomically; invalid seal retains pending');

 await assert.rejects(rpc(begin,beginArgs(context(idB))),/MARKET_CHECKPOINT_PRIOR_MISMATCH/);
 const argsB=beginArgs(context(idB,idA)),issuedB=await rpc(begin,argsB);assert.equal(issuedB.sequence,2);assert.notEqual(issuedB.key_base64,issuedA.key_base64);
 assert.deepEqual(await rpc(seal,sealArgs(archiveA)),{...sealedA,replayed:true});assert.deepEqual(await rpc(begin,argsA),{...issuedA,replayed:true});
 state=await rpc(get);assert.equal(state.head.checkpoint_id,idA);assert.equal(state.pending.checkpoint_id,idB);
 await assert.rejects(rpc(seal,sealArgs({...archiveA,work_state:'CHANGED'})),/MARKET_CHECKPOINT_ARCHIVE_REPLAY_CONFLICT/);
 await rpc(seal,sealArgs(archives(idB,argsB.p_context_hash)));assert.equal((await rpc(get)).head.checkpoint_id,idB);
 await assert.rejects(rpc(begin,beginArgs(context(idC,idA))),/MARKET_CHECKPOINT_PRIOR_MISMATCH/);
 const contenders=await Promise.allSettled([rpc(begin,beginArgs(context(idC,idB))),rpc(begin,beginArgs(context(idD,idB)))]);
 assert.equal(contenders.filter(r=>r.status==='fulfilled').length,1);assert.match(contenders.find(r=>r.status==='rejected').reason.message,/MARKET_CHECKPOINT_PENDING_UNCONFIRMED/);
 state=await rpc(get);assert.equal(state.head.checkpoint_id,idB);assert.equal(state.pending.sequence,3);
 assert.equal((await counts()).worker_checkpoints,3);assert.equal((await counts()).worker_checkpoint_archives,2);
 passed('prior-head CAS, monotonic sequence and serialized competing begins; old ACK replay never rewinds head or clears newer pending');

 // Exercise the real runtime/SQL wire contract, rather than giving the runtime
 // handcrafted receipts. A dropped acknowledgement happens after SQL commits;
 // the wrapper must reconcile by readback, without another write invocation.
 await rpc(seal,sealArgs(archives(state.pending.checkpoint_id,state.pending.context_hash)));
 const idE=sha('SYNTHETIC_RUNTIME_CHECKPOINT_E'),liveContext=context(idE,state.pending.checkpoint_id);
 const dropped=new Set([begin,seal]),wireCounts={};
 const wire=async(name,args)=>{wireCounts[name]=(wireCounts[name]??0)+1;const data=await rpc(name,args);
  if(dropped.delete(name))throw Error('SYNTHETIC_ACK_DROPPED_AFTER_SQL');return {data,error:null};};
 const live=await beginWorkerCheckpoint({rpc:wire,context:liveContext});
 assert.equal(live.reconciled,true);assert.equal(live.sequence,4);assert.equal(wireCounts[begin],1);
 const temporary=await mkdtemp(join(tmpdir(),'morning-alpha-checkpoint-sql-'));
 try{
  const source=join(temporary,'source'),resume=join(temporary,'resume'),restored=join(temporary,'restored');
  const attemptKey=sha('SYNTHETIC_UNKNOWN_SOURCE_ATTEMPT'),payload=Buffer.from('{"fixture":"SYNTHETIC_RAW_NO_REAL_DATA"}\n');
  await mkdir(join(source,'input-cache','objects'),{recursive:true});
  await mkdir(join(source,'input-cache','attempts',attemptKey,'1'),{recursive:true});
  const cache={schema:'TAIWAN_INPUT_CACHE_STATE_V1',runs:{},source_halts:['twse_daily'],
   captures:{fixture:{file:'objects/raw.json',bytes:payload.length,sha256:sha(payload)}},
   attempts:{[attemptKey]:[{ordinal:1,state:'UNCONFIRMED'}]}};
  const cacheText=canonical(cache)+'\n',unknown='{"state":"IN_PROGRESS","fixture":true}\n';
  await writeFile(join(source,'input-cache','cache-state.json'),cacheText);
  await writeFile(join(source,'input-cache','objects','raw.json'),payload);
  await writeFile(join(source,'input-cache','attempts',attemptKey,'1','provider-intent.json'),unknown);
  let fetches=0;
  await assert.rejects(restoreWorkerCheckpoint({rpc:wire,output:restored,fetchArtifact:()=>{fetches++;}}),/PENDING_REQUIRES_RECONCILIATION/);
  assert.equal(fetches,0);
  const inventory=await inventoryCheckpointTree(source),retention=await copyCheckpointResume({root:source,destination:resume,inventory});
  assert.equal(retention.originals_deleted,0);
  const paths={},bundles=[];
  for(const [index,kind]of ['AUDIT','RESUME'].entries()){
   paths[kind]=join(temporary,kind.toLowerCase()+'.bin');
   const bundle=await encryptCheckpointBundle({root:kind==='AUDIT'?source:resume,file:paths[kind],checkpointId:idE,
    contextHash:live.context_hash,kind,key:live.key});
   bundles.push({...bundle,artifact_id:String(20000+index)});
   const cipher=await readFile(paths[kind]);assert.equal(cipher.includes(payload),false);
   assert.equal(cipher.includes(Buffer.from(live.key.toString('base64'))),false);
  }
  assert.notEqual(bundles[0].nonce_base64,bundles[1].nonce_base64);
  const sealed=await sealWorkerCheckpoint({rpc:wire,checkpointId:idE,contextHash:live.context_hash,
   workState:'WORK_UNCONFIRMED',bundles});
  assert.equal(sealed.reconciled,true);assert.equal(sealed.sequence,4);assert.equal(wireCounts[seal],1);
  const persisted=await readWorkerCheckpoint(wire);assert.equal(persisted.pending,null);assert.equal(persisted.head.checkpoint_id,idE);
  assert.equal(persisted.head.archive_hash,sealed.archive_hash);
  const result=await restoreWorkerCheckpoint({rpc:wire,output:restored,fetchArtifact:async options=>{
   fetches++;assert.equal(options.bundle.kind,'RESUME');assert.equal(options.checkpointId,idE);
   assert.equal(options.runId,liveContext.run_id);await copyFile(paths.RESUME,options.output);
  }});
  assert.equal(result.state,'RESTORED');assert.equal(fetches,1);
  assert.equal(await readFile(join(restored,'input-cache','cache-state.json'),'utf8'),cacheText);
  assert.deepEqual(await readFile(join(restored,'input-cache','objects','raw.json')),payload);
  assert.equal(await readFile(join(restored,'input-cache','attempts',attemptKey,'1','provider-intent.json'),'utf8'),unknown);
  assert.equal(await readFile(join(source,'input-cache','cache-state.json'),'utf8'),cacheText);
 }finally{live.key.fill(0);await rm(temporary,{recursive:true,force:true});}
 passed('real service RPC adapter plus AES-GCM archive/restore preserves raw bytes, source halts and unknown attempts; lost begin/seal ACKs reconcile with no write retry');
 await rpc(begin,beginArgs(context(sha('SYNTHETIC_ROLLBACK_PENDING_F'),idE)));

 await db.exec('reset role');
 await assert.rejects(db.query('update vnext_market.worker_checkpoints set key_bytes=decode(repeat(\'00\',32),\'hex\') where checkpoint_id=$1',[idA]),/MARKET_IMMUTABLE/);
 await assert.rejects(db.query('delete from vnext_market.worker_checkpoint_archives where checkpoint_id=$1',[idA]),/MARKET_IMMUTABLE/);
 await assert.rejects(db.query('delete from vnext_market.worker_checkpoint_stream'),/MARKET_IMMUTABLE/);
 await assert.rejects(db.query('truncate vnext_market.worker_checkpoints cascade'),/MARKET_IMMUTABLE/);
 const rls=(await db.query('select bool_and(relrowsecurity and relforcerowsecurity)ok from pg_class where oid=any($1::regclass[])',[tableNames.map(t=>'vnext_market.'+t)])).rows[0].ok;
 assert.equal(rls,true);await db.exec('set role service_role');const preserved=await rpc(get),beforeCounts=await counts();
 await db.exec('reset role');await db.exec(rollback);await db.exec('set role service_role');
 for(const [i,name]of methods.entries())await assert.rejects(rpc(name,initialArgs[i]),e=>e.code==='42501');
 assert.deepEqual(await counts(),beforeCounts);await db.exec('reset role');
 const pointer=(await db.query("select head_checkpoint_id,pending_checkpoint_id from vnext_market.worker_checkpoint_stream where stream='TAIWAN_MARKET_DAILY_V1'")).rows[0];
 assert.equal(pointer.head_checkpoint_id,preserved.head.checkpoint_id);assert.equal(pointer.pending_checkpoint_id,preserved.pending.checkpoint_id);
 passed('keys/archive bindings cannot update/delete/truncate; rollback disables all RPCs while preserving keys, head, pending and forced RLS');
 const receipt={schema:'TAIWAN_MARKET_CHECKPOINT_SQL_VERIFICATION_V1',result:'PASS',phases:phases.length,checks:phases,
  candidate_sha256:sha(sql),rollback_sha256:sha(rollback),fixture:'SYNTHETIC',rng:'DETERMINISTIC_TEST_SEAM_NOT_ENTROPY_VERIFICATION',
  concurrency_scope:'PGLITE_SERIALIZED_CALLS_PLUS_POSTGRES_ROW_LOCK_CONTRACT',
  runtime_scope:'REAL_SQL_RPC_ADAPTER_AES_GCM_ARCHIVE_RESTORE_WITH_LOCAL_ARTIFACT_TRANSPORT',
  runtime_sha256:sha(await readFile(new URL('../research/taiwan-market-checkpoint.mjs',import.meta.url))),
  archive_helper_sha256:sha(await readFile(new URL('../scripts/operations/taiwan-market-checkpoint-archive.py',import.meta.url))),
  provider_calls:0,github_calls:0,production_database_calls:0,real_keys_accessed:0,production_written:false};
 if(process.env.MA_CHECKPOINT_SQL_RECEIPT)await writeFile(process.env.MA_CHECKPOINT_SQL_RECEIPT,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify(receipt));
}finally{await db.close();}

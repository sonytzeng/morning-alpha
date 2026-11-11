/** Synthetic private data, local files and injected RPC/HTTP only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {readFile,writeFile,mkdir,mkdtemp,rm,lstat,symlink,copyFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {checkpointCanonical as canonical,checkpointJson,inventoryCheckpointTree,copyCheckpointResume,copyTaiwanInputCacheResume,
 encryptCheckpointBundle,decryptCheckpointBundle,readWorkerCheckpoint,beginWorkerCheckpoint,
 restoreWorkerCheckpoint,fetchCheckpointArtifact,mayContinueCheckpointSegment,CHECKPOINT_RPCS as RPC}
 from '../research/taiwan-market-checkpoint.mjs';
import {startCheckpoint,runCheckpointSegments,prepareCheckpoint,sealCheckpoint,runCheckpointCli}
 from '../scripts/operations/taiwan-market-checkpoint.mjs';

const {Response,URL}=globalThis;
const sha=b=>createHash('sha256').update(b).digest('hex'),id=sha('synthetic checkpoint');
const at='2026-11-11T14:00:00.000Z',key=Buffer.alloc(32,7);
const context={schema:'TAIWAN_MARKET_CHECKPOINT_BEGIN_V1',checkpoint_id:id,prior_checkpoint_id:null,
 run_id:'12345',run_attempt:1,git_commit:'a'.repeat(40)},contextHash=sha(canonical(context));
const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'sonytzeng/morning-alpha',GITHUB_REF:'refs/heads/main',
 GITHUB_EVENT_NAME:'schedule',GITHUB_RUN_ID:'12345',GITHUB_RUN_ATTEMPT:'1',GITHUB_SHA:'a'.repeat(40),GITHUB_TOKEN:'SYNTHETIC_TOKEN',TAIWAN_MARKET_JOB_DEADLINE_MS:String(Date.now()+88*60_000)};
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'market-checkpoint-test-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
async function put(root,name,value){const b=Buffer.isBuffer(value)?value:Buffer.from(typeof value==='string'?value:canonical(value)+'\n');
 await mkdir(dirname(join(root,name)),{recursive:true});await writeFile(join(root,name),b);return {file:name,bytes:b.length,sha256:sha(b)};}
async function exists(p){try{await lstat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
function memoryRpc({loseBegin=false,loseSeal=false}={}){
 let pending=null,head=null,beginCount=0,sealCount=0;
 const rpc=async(name,args)=>{
  if(name===RPC.read)return {data:{schema:'DAILY_AI_MARKET_WORKER_CHECKPOINT_V1',head,pending},error:null};
  if(name===RPC.begin){beginCount++;const c=JSON.parse(args.p_context_text);assert.equal(args.p_context_hash,sha(args.p_context_text));
   assert.equal(pending,null);assert.equal(c.prior_checkpoint_id,head?.checkpoint_id??null);
   pending={checkpoint_id:c.checkpoint_id,sequence:(head?.sequence??0)+1,prior_checkpoint_id:c.prior_checkpoint_id,
    context_text:args.p_context_text,context_hash:args.p_context_hash,key_base64:key.toString('base64'),issued_at:at,archive_text:null,archive_hash:null,sealed_at:null};
   if(loseBegin)throw Error('SYNTHETIC_LOST_ACK');return {data:{schema:'DAILY_AI_MARKET_WORKER_CHECKPOINT_ISSUED_V1',checkpoint_id:pending.checkpoint_id,
    sequence:pending.sequence,prior_checkpoint_id:pending.prior_checkpoint_id,context_hash:pending.context_hash,key_base64:pending.key_base64,issued_at:at,replayed:false},error:null};}
  if(name===RPC.seal){sealCount++;assert.equal(args.p_checkpoint_id,pending.checkpoint_id);assert.equal(args.p_archive_hash,sha(args.p_archive_text));
   head={...pending,archive_text:args.p_archive_text,archive_hash:args.p_archive_hash,sealed_at:at};pending=null;
   if(loseSeal)throw Error('SYNTHETIC_LOST_ACK');return {data:{schema:'DAILY_AI_MARKET_WORKER_CHECKPOINT_SEALED_V1',checkpoint_id:head.checkpoint_id,
    sequence:head.sequence,archive_hash:head.archive_hash,replayed:false},error:null};}
  throw Error('UNEXPECTED_RPC');
 };
 return {rpc,counts:()=>({begin:beginCount,seal:sealCount})};
}

test('stream AES256-GCM packs real binary/unicode files and restores exact bytes without a key file',async t=>{
 const temp=await fixture(t),root=join(temp,'private'),file=join(temp,'resume.bin'),output=join(temp,'restored');
 await put(root,'raw/行情.json',{symbol:'2330',private_research:'待審 PRIVATE SENTINEL'});await put(root,'raw/original.bin',randomBytes(3*1024*1024));
 const bundle=await encryptCheckpointBundle({root,file,checkpointId:id,contextHash,kind:'RESUME',key});
 const ciphertext=await readFile(file);assert.equal(ciphertext.includes(Buffer.from('PRIVATE SENTINEL')),false);assert.equal(ciphertext.includes(key),false);
 assert.equal(ciphertext.length,bundle.ciphertext_bytes);assert.equal(sha(ciphertext),bundle.ciphertext_sha256);
 const manifest=await decryptCheckpointBundle({file,output,checkpointId:id,contextHash,bundle,key});
 assert.equal(manifest.files.length,2);assert.deepEqual((await inventoryCheckpointTree(output)).files,(await inventoryCheckpointTree(root)).files);
 await assert.rejects(decryptCheckpointBundle({file,output,checkpointId:id,contextHash,bundle,key}),/DECRYPT_ARGUMENTS/);
});

test('modified ciphertext, authentication tag, key and checkpoint scope fail before any installed output',async t=>{
 const temp=await fixture(t),root=join(temp,'private'),file=join(temp,'resume.bin');await put(root,'file.txt','PRIVATE');
 const bundle=await encryptCheckpointBundle({root,file,checkpointId:id,contextHash,kind:'RESUME',key});
 for(const [i,change]of [{key:Buffer.alloc(32,8)},{contextHash:sha('wrong')},
  {bundle:{...bundle,tag_base64:Buffer.alloc(16,8).toString('base64')}}].entries()){
  const output=join(temp,'bad'+i);await assert.rejects(decryptCheckpointBundle({file,output,checkpointId:id,contextHash,bundle,key,...change}));assert.equal(await exists(output),false);}
 const bad=join(temp,'tampered.bin'),b=await readFile(file);b[3]^=1;await writeFile(bad,b);
 await assert.rejects(decryptCheckpointBundle({file:bad,output:join(temp,'tampered'),checkpointId:id,contextHash,bundle,key}));
 assert.equal(await exists(join(temp,'tampered')),false);
});

test('inventory rejects symlinks, source-key filenames and source changes without uploading partial content',async t=>{
 const temp=await fixture(t),root=join(temp,'private');await put(root,'good.json','{}');await symlink(join(root,'good.json'),join(root,'alias'));
 await assert.rejects(inventoryCheckpointTree(root),/SYMLINK/);await rm(join(root,'alias'));await put(root,'credentials/token.txt','SYNTHETIC');
 await assert.rejects(inventoryCheckpointTree(root),/FILE_SCOPE/);
});

async function cacheFixture(root){
 const good=await put(root,'objects/current.json',{source:'original',available_at:at});
 const halt=await put(root,'objects/halt.json',{status:403,source_halted:true});
 const prior=await put(root,'objects/prior-state.json',{schema:'ORIGINAL_STATE_BYTES'});
 await put(root,'objects/unreferenced-old-derived.json',Buffer.alloc(20000,1));
 await put(root,'attempts/task/1/result.json',{state:'UNCONFIRMED'});await put(root,'attempts/task/1/original-response.bin','original uncertain response');
 const state={schema:'TAIWAN_INPUT_CACHE_STATE_V1',policy_version:'TAIWAN_DAILY_INPUT_CACHE_20261111_V3',
  captures:{current:{raw:good}},history_stocks:{},financial_documents:{},source_halts:{denied:{receipt:halt}},
  attempts:{task:[{ordinal:1,state:'UNCONFIRMED',task:good}]},policy_transitions:[{prior_state:prior}],runs:{},base_acquisition_files:[]};
 for(const [index,date]of ['2026-11-09','2026-11-10','2026-11-11'].entries()){
  const body={schema:'TAIWAN_DAILY_INPUT_MANIFEST_V1',parts:{},formed_at:date+'T10:00:00Z'},digest=sha(canonical(body)),file='manifest-'+digest+'.json';
  await put(root,file,{...body,manifest_hash:digest});state.runs[date+':POSTCLOSE']=file;
  if(index===2)await put(root,'latest.json',{schema:'TAIWAN_DAILY_INPUT_POINTER_V1',file,manifest_hash:digest});
 }
 await put(root,'cache-state.json',state);return state;
}
test('copy-only compaction keeps current hashes, complete UNKNOWN directories and halts, drops only archived duplicate derivations',async t=>{
 const temp=await fixture(t),root=join(temp,'source'),destination=join(temp,'resume'),cache=join(root,'input-cache');const original=await cacheFixture(cache);
 const done='snapshots/2026-11-10/POSTCLOSE/',unfinished='snapshots/2026-11-11/POSTCLOSE/';
 await put(root,done+'state.json',{schema:'TAIWAN_MARKET_DAILY_SNAPSHOT_V1',snapshot_key:'2026-11-10/POSTCLOSE',state:'STAGED_REVIEW_REQUIRED',
  stage:{finish:{outcome:{state:'STAGED_REVIEW_REQUIRED',edition_id:'synthetic'}}}});await put(root,done+'research.json','completed private derivation');
 await put(root,unfinished+'state.json',{schema:'TAIWAN_MARKET_DAILY_SNAPSHOT_V1',state:'STAGING_STOPPED',
  selected:{one:{raw_file:'objects/original.json'}},stage:{finish:{in_flight:true}}});await put(root,unfinished+'research.json','unfinished original derivation');
 await put(root,'objects/original.json','original source bytes');await put(root,'capture-index/a/first.json',{available_at:at});
 await put(root,'daily-run.lock',{hostname:'old stopped job'});const before=await inventoryCheckpointTree(root);
 const result=await copyCheckpointResume({root,destination,inventory:before});assert.equal(result.originals_deleted,0);
 assert.deepEqual(await inventoryCheckpointTree(root),before);assert.equal(await exists(join(destination,done+'research.json')),false);
 assert.equal(await exists(join(destination,unfinished+'research.json')),true);assert.equal(await exists(join(destination,'objects/original.json')),true);
 assert.equal(await exists(join(destination,'input-cache/objects/unreferenced-old-derived.json')),false);
 assert.equal(await exists(join(destination,'input-cache/attempts/task/1/original-response.bin')),true);
 const state=JSON.parse(await readFile(join(destination,'input-cache/cache-state.json')));
 assert.deepEqual(state.source_halts,original.source_halts);assert.deepEqual(state.attempts,original.attempts);assert.equal(Object.keys(state.runs).length,2);
 assert.equal(await exists(join(destination,'daily-run.lock')),false);assert.equal(await exists(join(root,'daily-run.lock')),true);
});

test('standalone input-cache compaction supplies the unchanged seed builder without raising its expansion guard',async t=>{
 const temp=await fixture(t),root=join(temp,'cache'),destination=join(temp,'compact');await cacheFixture(root);
 const before=await inventoryCheckpointTree(root),result=await copyTaiwanInputCacheResume({cacheRoot:root,destination});
 assert.ok(result.total_bytes<result.source_bytes);assert.equal(result.originals_deleted,0);assert.deepEqual(await inventoryCheckpointTree(root),before);
 assert.equal(await exists(join(destination,'cache-state.json')),true);assert.equal(await exists(join(destination,'objects/halt.json')),true);
});

test('lost begin ACK reads the same pending key exactly once and never sends another begin',async()=>{
 const f=memoryRpc({loseBegin:true}),issued=await beginWorkerCheckpoint({rpc:f.rpc,context});
 assert.equal(issued.reconciled,true);assert.deepEqual(issued.key,key);assert.equal((await readWorkerCheckpoint(f.rpc)).pending.checkpoint_id,id);
 assert.equal(f.counts().begin,1);
});

test('pending barrier blocks restore and fixed-seed fallback even when a bootstrap is available',async t=>{
 const temp=await fixture(t),f=memoryRpc();await beginWorkerCheckpoint({rpc:f.rpc,context});let bootstrap=0,restore=0;
 await assert.rejects(startCheckpoint({output:join(temp,'output'),control:join(temp,'control'),env,rpc:f.rpc,
  bootstrap:async()=>bootstrap++,restore:async()=>restore++}),/PENDING_REQUIRES_RECONCILIATION/);
 assert.equal(bootstrap,0);assert.equal(restore,0);assert.equal(f.counts().begin,1);
});

async function ownIntent(control,rpc){await mkdir(control,{recursive:true});await checkpointJson(join(control,'intent.json'),{context,context_hash:contextHash});
 await beginWorkerCheckpoint({rpc,context});}
test('two known resource segments reuse the exact day/snapshot; UNKNOWN and rejection never auto-resume',async t=>{
 const temp=await fixture(t),f=memoryRpc(),output=join(temp,'output'),control=join(temp,'control');await ownIntent(control,f.rpc);
 let calls=0;const seen=[];
 const r=await runCheckpointSegments({output,control,slot:'POSTCLOSE',rpc:f.rpc,now:()=>at,executeSegment:async options=>{
  calls++;seen.push(options);const state=calls===1?'STAGING_PAUSED_RESOURCE_LIMIT':'STAGED_REVIEW_REQUIRED';
  await put(output,'snapshots/2026-11-11/POSTCLOSE/state.json',{state,stage:{blocked:null,shards:[{request_key:'same-request',outcome:{state:'STAGED'}}]}});
  return {schema:'TAIWAN_MARKET_DAILY_RESULT_V1',state,snapshot_key:'2026-11-11/POSTCLOSE',expired:false};}});
 assert.equal(r.complete,true);assert.equal(calls,2);assert.equal(seen[0].businessDate,seen[1].businessDate);assert.equal(seen[0].checkpointId,seen[1].checkpointId);
 assert.equal(Object.hasOwn(seen[0],'resume'),false);
 for(const patch of [{in_flight:true},{state:'OUTCOME_UNKNOWN'},{state:'UNCONFIRMED'}])
  assert.equal(mayContinueCheckpointSegment({state:'STAGING_PAUSED_RESOURCE_LIMIT'},{state:'STAGING_PAUSED_RESOURCE_LIMIT',stage:{shards:[patch]}}),false);
 assert.equal(mayContinueCheckpointSegment({state:'STAGING_PAUSED_RESOURCE_LIMIT'},{state:'STAGING_PAUSED_RESOURCE_LIMIT',stage:{blocked:{state:'REJECTED'}}}),false);
});

test('a thrown/hard-deadline segment is journaled once and cannot become a green completed job',async t=>{
 const temp=await fixture(t),f=memoryRpc(),output=join(temp,'output'),control=join(temp,'control');await ownIntent(control,f.rpc);let calls=0;
 const r=await runCheckpointSegments({output,control,slot:'POSTCLOSE',rpc:f.rpc,now:()=>at,executeSegment:async()=>{calls++;throw Error('TAIWAN_CHECKPOINT_SEGMENT_HARD_DEADLINE_UNCONFIRMED');}});
 assert.equal(calls,1);assert.equal(r.complete,false);const journal=JSON.parse(await readFile(join(control,'work-result.json')));assert.equal(journal.segments[0].state,'IN_FLIGHT');
 await assert.rejects(runCheckpointCli(['finish','--control',control]));
});

test('one job deadline includes elapsed setup/restore and reserves checkpoint time before any new segment',async t=>{
 const temp=await fixture(t),f=memoryRpc(),output=join(temp,'output'),control=join(temp,'control');await ownIntent(control,f.rpc);
 let current=Date.parse(at),calls=0;
 await checkpointJson(join(control,'intent.json'),{context,context_hash:contextHash,job_deadline_ms:current+50*60_000});
 const r=await runCheckpointSegments({output,control,slot:'POSTCLOSE',rpc:f.rpc,now:()=>new Date(current).toISOString(),executeSegment:async options=>{
  calls++;assert.equal(options.timeoutMs,30*60_000);current+=31*60_000;
  await put(output,'snapshots/2026-11-11/POSTCLOSE/state.json',{state:'STAGING_PAUSED_RESOURCE_LIMIT',stage:{blocked:null}});
  return {schema:'TAIWAN_MARKET_DAILY_RESULT_V1',state:'STAGING_PAUSED_RESOURCE_LIMIT',snapshot_key:'2026-11-11/POSTCLOSE',expired:false};}});
 assert.equal(calls,1);assert.equal(r.complete,false);assert.equal(r.state,'WORK_BUDGET_EXHAUSTED');
 const fresh=memoryRpc();let bootstraps=0;
 await assert.rejects(startCheckpoint({output:join(temp,'no-time'),control:join(temp,'no-time-control'),rpc:fresh.rpc,
  env:{...env,TAIWAN_MARKET_JOB_DEADLINE_MS:String(Date.now()+10*60_000)},bootstrap:async()=>bootstraps++}),/JOB_DEADLINE/);
 assert.equal(bootstraps,0);assert.equal(fresh.counts().begin,0);
});

test('complete archive -> ciphertext readback -> lost seal ACK -> private pointer -> exact restore is executable',async t=>{
 const temp=await fixture(t),f=memoryRpc({loseSeal:true}),output=join(temp,'source'),control=join(temp,'control'),cipherDirectory=join(temp,'cipher');
 await cacheFixture(join(output,'input-cache'));await put(output,'unreviewed.json',{private:'SYNTHETIC PRIVATE CONTENT'});await ownIntent(control,f.rpc);
 await checkpointJson(join(control,'work-result.json'),{state:'STAGED_REVIEW_REQUIRED',complete:true});
 const prepared=await prepareCheckpoint({output,control,cipherDirectory,env:{},rpc:f.rpc});assert.ok(prepared.ciphertext_bytes>0);
 const copy=async({bundle,output:destination})=>{await copyFile(join(cipherDirectory,bundle.kind.toLowerCase()+'.bin'),destination);
  assert.equal(sha(await readFile(destination)),bundle.ciphertext_sha256);};
 const receipt=await sealCheckpoint({control,auditArtifactId:'1001',resumeArtifactId:'1002',env,rpc:f.rpc,fetchArtifact:copy});
 assert.equal(receipt.complete,true);assert.equal(f.counts().seal,1);assert.equal(JSON.stringify(receipt).includes(key.toString('base64')),false);
 const state=await readWorkerCheckpoint(f.rpc);assert.equal(state.pending,null);assert.equal(state.head.checkpoint_id,id);
 const restored=join(temp,'restored');await restoreWorkerCheckpoint({state,output:restored,token:'SYNTHETIC',fetchArtifact:copy});
 assert.equal(JSON.parse(await readFile(join(restored,'unreviewed.json'))).private,'SYNTHETIC PRIVATE CONTENT');
 assert.deepEqual(JSON.parse(await readFile(join(restored,'input-cache/cache-state.json'))).source_halts,
  JSON.parse(await readFile(join(output,'input-cache/cache-state.json'))).source_halts);
 assert.equal((await runCheckpointCli(['finish','--control',control])).complete,true);
 let bootstraps=0;await assert.rejects(startCheckpoint({output:join(temp,'missing-artifact'),control:join(temp,'othercontrol'),env,rpc:f.rpc,
  restore:async()=>{throw Error('ARTIFACT_MISSING');},bootstrap:async()=>bootstraps++}),/ARTIFACT_MISSING/);assert.equal(bootstraps,0);
});

test('GitHub readback validates fixed repository/run/name and never forwards authorization to storage',async t=>{
 const temp=await fixture(t),root=join(temp,'private'),file=join(temp,'resume.bin');await put(root,'test.txt','PRIVATE');
 const bundle={...await encryptCheckpointBundle({root,file,checkpointId:id,contextHash,kind:'RESUME',key}),artifact_id:'1001'};
 const zip=join(temp,'artifact.zip');execFileSync('python3',['-c','import sys,zipfile; z=zipfile.ZipFile(sys.argv[1],"w"); z.write(sys.argv[2],"resume.bin"); z.close()',zip,file]);
 const zipped=await readFile(zip),calls=[];
 const fetched=async(url,options)=>{calls.push({url:String(url),options});
  if(String(url).endsWith('/1001'))return Response.json({id:1001,name:bundle.artifact_name,expired:false,size_in_bytes:zipped.length,
   workflow_run:{id:12345,head_repository_id:1274909964,repository_id:1274909964}});
  if(String(url).endsWith('/zip'))return new Response(null,{status:302,headers:{location:'https://artifactstore.blob.core.windows.net/signed-test'}});
  assert.equal(options.headers,undefined);return new Response(zipped);};
 const output=join(temp,'downloaded.bin');await fetchCheckpointArtifact({bundle,checkpointId:id,runId:'12345',token:'SYNTHETIC_SECRET',output,fetchImpl:fetched});
 assert.deepEqual(await readFile(output),await readFile(file));assert.equal(calls.length,3);
 await assert.rejects(fetchCheckpointArtifact({bundle,checkpointId:id,runId:'999',token:'SYNTHETIC_SECRET',output:join(temp,'wrong.bin'),fetchImpl:fetched}),/ARTIFACT_METADATA/);
});

test('workflow exposes only the two ciphertext paths and rejects an unsealed/incomplete completion',async()=>{
 const workflow=await readFile(new URL('../research/taiwan-market-daily.workflow.candidate.yml',import.meta.url),'utf8');
 assert.equal(workflow.includes('actions/cache'),false);assert.equal(workflow.includes('path: ${{ runner.temp }}/taiwan-market-daily/'),false);
 assert.equal((workflow.match(/uses: actions\/upload-artifact@v4/g)??[]).length,2);assert.match(workflow,/timeout-minutes: 90/);
 assert.equal((workflow.match(/taiwan-market-ciphertext\/(?:audit|resume)\.bin/g)??[]).length,2);
 assert.equal(/--resume(?:\s|$)/.test(workflow),false);assert.match(workflow,/checkpoint\.mjs finish/);
});

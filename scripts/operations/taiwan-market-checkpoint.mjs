#!/usr/bin/env node
/** Only ciphertext and safe count/hash receipts may leave this local worker.
 * The database key is read through the pinned OIDC gateway into memory only.
 */
import process from 'node:process';
import console from 'node:console';
import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';
import {createWriteStream} from 'node:fs';
import {readFile,writeFile,mkdir,lstat,open,rm,mkdtemp} from 'node:fs/promises';
import {resolve,dirname,join,relative,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {setTimeout,clearTimeout} from 'node:timers';
import {finished} from 'node:stream/promises';
import {CHECKPOINT_LIMITS,checkpointCanonical,checkpointJson,readWorkerCheckpoint,restoreWorkerCheckpoint,
 beginWorkerCheckpoint,sealWorkerCheckpoint,newCheckpointId,inventoryCheckpointTree,copyCheckpointResume,
 encryptCheckpointBundle,fetchCheckpointArtifact,mayContinueCheckpointSegment,checkpointWorkSucceeded}
 from '../../research/taiwan-market-checkpoint.mjs';
import {bootstrapTaiwanMarketSeed} from '../../research/taiwan-market-seed.mjs';
import {createTaiwanMarketOidcRpc} from './taiwan-market-oidc-rpc.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export const REVIEWED_INPUT_SEED_ID='e98b83f8f74149d559d33218d50d43a0ef50b16ab74c42e54ec0be44277f5584';
const fail=code=>{throw Error('TAIWAN_CHECKPOINT_'+code);};
const hash=v=>createHash('sha256').update(v).digest('hex');
const clock=()=>new Date().toISOString();
const day=at=>new Date(Date.parse(at)+8*3600000).toISOString().slice(0,10);
async function exists(file){try{await lstat(file);return true;}catch(e){if(e.code!=='ENOENT')throw e;return false;}}
async function json(file){const s=await lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.size>16_000_000)fail('METADATA_FILE');return JSON.parse(await readFile(file,'utf8'));}
function separate(root,other){const r=relative(root,other);if(!r||!r.startsWith('..')&&!isAbsolute(r))fail('CONTROL_INSIDE_PRIVATE_ROOT');}
async function outputValue(env,key,value){if(!/^[a-z_]+$/.test(key)||!/^[A-Za-z0-9_.-]+$/.test(String(value)))fail('OUTPUT');
 if(env.GITHUB_OUTPUT)await writeFile(env.GITHUB_OUTPUT,key+'='+value+'\n',{flag:'a',mode:0o600});}
function safeCode(error){return /^TAIWAN_[A-Z0-9_]+$/.test(error?.message??'')?error.message:'TAIWAN_CHECKPOINT_OPERATION_UNCONFIRMED';}
function actionContext(env,prior){if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_REPOSITORY!=='sonytzeng/morning-alpha'
 ||env.GITHUB_REF!=='refs/heads/main'||!['schedule','workflow_dispatch'].includes(env.GITHUB_EVENT_NAME)
 ||!/^\d{1,20}$/.test(env.GITHUB_RUN_ID??'')||!/^[1-9]\d{0,3}$/.test(env.GITHUB_RUN_ATTEMPT??'')
 ||Number(env.GITHUB_RUN_ATTEMPT)>1000||!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA??''))fail('ACTIONS_CONTEXT');
 return {schema:'TAIWAN_MARKET_CHECKPOINT_BEGIN_V1',checkpoint_id:newCheckpointId(),prior_checkpoint_id:prior,
  run_id:env.GITHUB_RUN_ID,run_attempt:Number(env.GITHUB_RUN_ATTEMPT),git_commit:env.GITHUB_SHA};}
async function intentFor(control,rpc){const intent=await json(join(control,'intent.json')),state=await readWorkerCheckpoint(rpc);
 if(!state.pending||state.pending.checkpoint_id!==intent.context.checkpoint_id||state.pending.context_text!==checkpointCanonical(intent.context)
 ||state.pending.context_hash!==intent.context_hash)fail('OWN_PENDING_REQUIRED');return {intent,record:state.pending};}

/** No seed fallback is permitted when a head/pending record already exists. */
export async function startCheckpoint({output,control,env=process.env,rpc=createTaiwanMarketOidcRpc(),
 restore=restoreWorkerCheckpoint,bootstrap=bootstrapTaiwanMarketSeed}){
 output=resolve(output);control=resolve(control);separate(output,control);
 if(await exists(output)||await exists(control))fail('START_OUTPUT_EXISTS');
 const state=await readWorkerCheckpoint(rpc);if(state.pending)fail('PENDING_REQUIRES_RECONCILIATION');
 const jobDeadline=Number(env.TAIWAN_MARKET_JOB_DEADLINE_MS);
 if(!Number.isSafeInteger(jobDeadline)||jobDeadline<=Date.now()+CHECKPOINT_LIMITS.checkpoint_reserve_ms||jobDeadline>Date.now()+CHECKPOINT_LIMITS.job_ms+60_000)fail('JOB_DEADLINE');
 const context=actionContext(env,state.head?.checkpoint_id??null);await mkdir(dirname(output),{recursive:true,mode:0o700});
 const restored=await restore({state,rpc,output,token:env.GITHUB_TOKEN});
 if(restored.state==='NO_PRIOR_CHECKPOINT'){
  await mkdir(output,{mode:0o700});
  await bootstrap({seedId:REVIEWED_INPUT_SEED_ID,cacheDir:join(output,'input-cache'),rpc});
 }
 // A seed is a read-only prerequisite; pending begins before acquisition or
 // any staging write. No persisted key or broad service credential exists.
 if(jobDeadline<=Date.now()+CHECKPOINT_LIMITS.checkpoint_reserve_ms)fail('JOB_BUDGET_BEFORE_BEGIN');
 await mkdir(control,{mode:0o700});const context_hash=hash(checkpointCanonical(context));
 await checkpointJson(join(control,'intent.json'),{context,context_hash,restored_checkpoint_id:restored.checkpoint_id,started_at:clock(),job_deadline_ms:jobDeadline});
 const issued=await beginWorkerCheckpoint({rpc,context});issued.key.fill(0);
 await outputValue(env,'checkpoint_id',context.checkpoint_id);
 return {checkpoint_id:context.checkpoint_id,sequence:issued.sequence,restored:restored.state==='RESTORED'};
}

async function actualSegment({output,slot,businessDate,index,timeoutMs,checkpointId}){
 const directory=join(output,'worker-journal');await mkdir(directory,{recursive:true,mode:0o700});
 const prefix=join(directory,checkpointId+'-segment-'+index),stdout=createWriteStream(prefix+'.stdout',{flags:'wx',mode:0o600}),
  stderr=createWriteStream(prefix+'.stderr',{flags:'wx',mode:0o600});
 const args=['--experimental-strip-types',join(ROOT,'scripts/operations/run-taiwan-market-daily.mjs'),
  '--output',output,'--slot',slot,'--business-date',businessDate,'--input-cache',join(output,'input-cache'),
  '--stage','--rpc-module',join(ROOT,'scripts/operations/taiwan-market-oidc-rpc.mjs')];
 const child=spawn(process.execPath,args,{cwd:ROOT,stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});
 child.stdout.pipe(stdout);child.stderr.pipe(stderr);let timedOut=false,forced;
 const kill=signal=>{try{if(process.platform==='win32')child.kill(signal);else process.kill(-child.pid,signal);}catch(e){if(e.code!=='ESRCH')throw e;}};
 const timer=setTimeout(()=>{timedOut=true;kill('SIGTERM');forced=setTimeout(()=>kill('SIGKILL'),3000);},timeoutMs);
 let result;
 try{const code=await new Promise((resolveDone,reject)=>{child.once('error',reject);child.once('close',resolveDone);});
  if(timedOut)kill('SIGKILL');await Promise.all([finished(stdout),finished(stderr)]);
  if(timedOut)fail('SEGMENT_HARD_DEADLINE_UNCONFIRMED');if(code!==0)fail('SEGMENT_FAILED');
  result=await json(prefix+'.stdout');
 }finally{clearTimeout(timer);clearTimeout(forced);if(timedOut)kill('SIGKILL');}
 return result;
}

/** A resource pause may continue once with identical snapshot identity. A lost
 * receipt, rejection or in-flight operation never receives --resume here. */
export async function runCheckpointSegments({output,slot,control,rpc=createTaiwanMarketOidcRpc(),now=clock,
 executeSegment=actualSegment}){
 if(!['PREMARKET','POSTCLOSE'].includes(slot))fail('SLOT');output=resolve(output);control=resolve(control);
 const {intent}=await intentFor(control,rpc),started=Date.parse(now()),businessDate=day(now());
 const jobDeadline=intent.job_deadline_ms??started+CHECKPOINT_LIMITS.job_ms;
 if(!Number.isSafeInteger(jobDeadline))fail('JOB_DEADLINE');
 const deadline=Math.min(started+CHECKPOINT_LIMITS.work_ms,jobDeadline-CHECKPOINT_LIMITS.checkpoint_reserve_ms);
 const marker=await open(join(control,'work-started.json'),'wx',0o600);await marker.writeFile(checkpointCanonical({checkpoint_id:intent.context.checkpoint_id,business_date:businessDate,slot,started_at:now()}));await marker.close();
 const journal={schema:'TAIWAN_MARKET_CHECKPOINT_WORK_V1',checkpoint_id:intent.context.checkpoint_id,business_date:businessDate,slot,segments:[],state:'STARTED',complete:false};
 const path=join(output,'worker-journal','checkpoint-'+intent.context.checkpoint_id+'.json');
 await checkpointJson(path,journal);let result=null;
 try{
  for(let index=1;index<=CHECKPOINT_LIMITS.maximum_segments;index++){
   const remaining=deadline-Date.parse(now());if(remaining<60_000){journal.state='WORK_BUDGET_EXHAUSTED';break;}
   const entry={index,started_at:now(),state:'IN_FLIGHT'};journal.segments.push(entry);await checkpointJson(path,journal);
   result=await executeSegment({output,slot,businessDate,index,checkpointId:intent.context.checkpoint_id,timeoutMs:Math.min(CHECKPOINT_LIMITS.segment_ms,remaining)});
   if(result?.schema!=='TAIWAN_MARKET_DAILY_RESULT_V1'||result.snapshot_key!==businessDate+'/'+slot)fail('SEGMENT_IDENTITY');
   entry.finished_at=now();entry.state=result.state;entry.result_hash=hash(checkpointCanonical(result));
   journal.state=result.state;journal.complete=checkpointWorkSucceeded(result);await checkpointJson(path,journal);
   if(journal.complete)break;
   const snapshot=await json(join(output,'snapshots',businessDate,slot,'state.json'));
   if(!mayContinueCheckpointSegment(result,snapshot))break;
  }
 }catch(e){journal.state=safeCode(e);journal.complete=false;journal.error=safeCode(e);}
 journal.finished_at=now();await checkpointJson(path,journal);await checkpointJson(join(control,'work-result.json'),journal);
 return {complete:journal.complete,segments:journal.segments.length,state:journal.state};
}

export async function prepareCheckpoint({output,control,cipherDirectory,env=process.env,rpc=createTaiwanMarketOidcRpc()}){
 const phaseStarted=Date.now();
 output=resolve(output);control=resolve(control);cipherDirectory=resolve(cipherDirectory);separate(output,control);separate(output,cipherDirectory);
 if(await exists(cipherDirectory)||await exists(join(control,'prepared.json')))fail('PREPARE_ALREADY_ATTEMPTED');
 const {intent,record}=await intentFor(control,rpc),key=Buffer.from(record.key_base64,'base64');
 const deadline=Math.min(phaseStarted+CHECKPOINT_LIMITS.prepare_ms,(intent.job_deadline_ms??phaseStarted+CHECKPOINT_LIMITS.job_ms)-12*60_000);
 if(deadline-Date.now()<1000)fail('PREPARE_DEADLINE');
 const result=await exists(join(control,'work-result.json'))?await json(join(control,'work-result.json')):{state:'WORK_UNCONFIRMED',complete:false};
 const temporary=await mkdtemp(join(control,'resume-copy-')),resume=join(temporary,'working');
 await mkdir(cipherDirectory,{mode:0o700});
 try{
  const inventory=await inventoryCheckpointTree(output,{deadline}),retention=await copyCheckpointResume({root:output,destination:resume,inventory,deadline});
  const audit=await encryptCheckpointBundle({root:output,file:join(cipherDirectory,'audit.bin'),checkpointId:record.checkpoint_id,
   contextHash:record.context_hash,kind:'AUDIT',key,deadline,extra:{prior_checkpoint_id:record.prior_checkpoint_id,scope:'COMPLETE_CURRENT_WORK_TREE'}});
  const resumeBundle=await encryptCheckpointBundle({root:resume,file:join(cipherDirectory,'resume.bin'),checkpointId:record.checkpoint_id,
   contextHash:record.context_hash,kind:'RESUME',key,deadline,extra:{...retention,audit_manifest_sha256:audit.manifest_sha256}});
  if(audit.nonce_base64===resumeBundle.nonce_base64)fail('NONCE_REUSE');
  const prepared={checkpoint_id:record.checkpoint_id,context_hash:record.context_hash,work_state:result.state.slice(0,80),
   work_complete:result.complete===true,bundles:[audit,resumeBundle],retention};
  await checkpointJson(join(control,'prepared.json'),prepared);
  await outputValue(env,'ready','true');await outputValue(env,'checkpoint_id',intent.context.checkpoint_id);
  return {checkpoint_id:record.checkpoint_id,files:audit.file_count,resume_files:resumeBundle.file_count,
   ciphertext_bytes:audit.ciphertext_bytes+resumeBundle.ciphertext_bytes};
 }finally{key.fill(0);await rm(temporary,{recursive:true,force:true});}
}

export async function sealCheckpoint({control,auditArtifactId,resumeArtifactId,env=process.env,rpc=createTaiwanMarketOidcRpc(),fetchArtifact=fetchCheckpointArtifact}){
 const phaseStarted=Date.now();
 control=resolve(control);const {intent,record}=await intentFor(control,rpc),prepared=await json(join(control,'prepared.json'));
 if(prepared.checkpoint_id!==record.checkpoint_id||prepared.context_hash!==record.context_hash)fail('PREPARED_IDENTITY');
 const ids=[auditArtifactId,resumeArtifactId];if(ids.some(id=>!/^\d{1,20}$/.test(id))||ids[0]===ids[1])fail('ARTIFACT_IDS');
 const deadline=Math.min(phaseStarted+CHECKPOINT_LIMITS.seal_ms,(intent.job_deadline_ms??phaseStarted+CHECKPOINT_LIMITS.job_ms)-60_000);
 const bundles=prepared.bundles.map((b,i)=>({...b,artifact_id:ids[i]})),work=await mkdtemp(join(control,'readback-'));
 try{
  for(const b of bundles)await fetchArtifact({bundle:b,checkpointId:record.checkpoint_id,runId:intent.context.run_id,
   token:env.GITHUB_TOKEN,output:join(work,b.kind.toLowerCase()+'.bin'),deadline:deadline-190_000});
  if(deadline-Date.now()<190_000)fail('SEAL_DEADLINE');
  const receipt=await sealWorkerCheckpoint({rpc,checkpointId:record.checkpoint_id,contextHash:record.context_hash,
   workState:prepared.work_state,bundles});
  const safe={schema:'TAIWAN_MARKET_CHECKPOINT_SAFE_RECEIPT_V1',checkpoint_id:record.checkpoint_id,sequence:receipt.sequence,
   archive_hash:receipt.archive_hash,complete:prepared.work_complete,bundles:bundles.map(b=>({kind:b.kind,
    ciphertext_sha256:b.ciphertext_sha256,ciphertext_bytes:b.ciphertext_bytes,file_count:b.file_count})),plaintext_uploaded:false};
  await checkpointJson(join(control,'sealed-receipt.json'),safe);return safe;
 }finally{await rm(work,{recursive:true,force:true});}
}

export async function runCheckpointCli(args,dependencies={}){
 const command=args[0],flags={};for(let i=1;i<args.length;i++){
  if(!/^--[a-z-]+$/.test(args[i])||args[i+1]===undefined||flags[args[i]])fail('ARGUMENTS');flags[args[i]]=args[++i];}
 const keys={start:['--output','--control'],work:['--output','--control','--slot'],prepare:['--output','--control','--cipher-directory'],
  seal:['--control','--audit-artifact-id','--resume-artifact-id'],finish:['--control']}[command];
 if(!keys||Object.keys(flags).sort().join('|')!==keys.sort().join('|'))fail('ARGUMENTS');
 const options={...dependencies,output:flags['--output'],control:flags['--control'],slot:flags['--slot'],cipherDirectory:flags['--cipher-directory'],
  auditArtifactId:flags['--audit-artifact-id'],resumeArtifactId:flags['--resume-artifact-id']};
 if(command==='start')return startCheckpoint(options);if(command==='work')return runCheckpointSegments(options);
 if(command==='prepare')return prepareCheckpoint(options);if(command==='seal')return sealCheckpoint(options);
 const receipt=await json(join(resolve(flags['--control']),'sealed-receipt.json'));
 if(receipt.schema!=='TAIWAN_MARKET_CHECKPOINT_SAFE_RECEIPT_V1'||receipt.complete!==true)fail('WORK_NOT_COMPLETE');
 return {checkpoint_id:receipt.checkpoint_id,archive_hash:receipt.archive_hash,complete:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{console.log(JSON.stringify(await runCheckpointCli(process.argv.slice(2))));}
 catch(error){console.error(safeCode(error));process.exitCode=1;}
}

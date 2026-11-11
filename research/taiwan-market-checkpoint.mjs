/** Private checkpoint transport for the public-repository daily worker.
 * Only authenticated ciphertext enters Actions artifacts. No source deletion,
 * provider calls, permission changes, review verdicts, or automatic RPC retries.
 */
import {createHash,createCipheriv,createDecipheriv,randomBytes,randomUUID} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {createReadStream,createWriteStream} from 'node:fs';
import {readFile,writeFile,lstat,readdir,mkdir,copyFile,rename,rm,mkdtemp,unlink} from 'node:fs/promises';
import {resolve,relative,dirname,join,isAbsolute,posix} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {Transform,Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const ARCHIVER=join(ROOT,'scripts/operations/taiwan-market-checkpoint-archive.py');
const fail=code=>{throw Error('TAIWAN_CHECKPOINT_'+code);};
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const hash=v=>createHash('sha256').update(v).digest('hex');
const isHash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const time=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
export const checkpointCanonical=v=>Array.isArray(v)?'['+v.map(checkpointCanonical).join(',')+']':object(v)
 ?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+checkpointCanonical(v[k])).join(',')+'}':JSON.stringify(v);
export const CHECKPOINT_RPCS=Object.freeze({read:'get_daily_ai_market_worker_checkpoint_v2',
 begin:'begin_daily_ai_market_worker_checkpoint_v2',seal:'seal_daily_ai_market_worker_checkpoint_v2'});
export const CHECKPOINT_LIMITS=Object.freeze({files:50000,file_bytes:256*1024*1024,audit_bytes:8*1024*1024*1024,
 resume_bytes:4*1024*1024*1024,ciphertext_bytes:2*1024*1024*1024,metadata_bytes:16*1024*1024,
 maximum_segments:2,work_ms:80*60_000,segment_ms:42*60_000,archive_ms:7*60_000,download_ms:180_000,
 job_ms:88*60_000,checkpoint_reserve_ms:20*60_000,prepare_ms:8*60_000,seal_ms:7*60_000,
 cache_runs:2,repository:'sonytzeng/morning-alpha'});
const exact=(v,keys)=>object(v)&&Object.keys(v).sort().join('|')===[...keys].sort().join('|');
function base64(value,bytes){if(typeof value!=='string')fail('BASE64');const b=Buffer.from(value,'base64');
 if(b.length!==bytes||b.toString('base64')!==value)fail('BASE64');return b;}
function local(root,file){if(typeof file!=='string'||!file||file.includes('\\')||file.includes('\0')||isAbsolute(file)
 ||posix.normalize(file)!==file||file==='..'||file.startsWith('../'))fail('PATH');return join(root,file);}
async function absent(path){try{await lstat(path);return false;}catch(e){if(e.code!=='ENOENT')throw e;return true;}}
async function bytes(file,limit=CHECKPOINT_LIMITS.metadata_bytes){const s=await lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.size>limit)fail('FILE');
 const b=await readFile(file);if(b.length!==s.size)fail('FILE_CHANGED');return b;}
async function json(file,limit){return JSON.parse((await bytes(file,limit)).toString('utf8'));}
export async function checkpointJson(file,value){await mkdir(dirname(file),{recursive:true,mode:0o700});
 const temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,checkpointCanonical(value)+'\n',{flag:'wx',mode:0o600});await rename(temp,file);}
const timeLeft=deadline=>{const left=deadline-Date.now();if(left<1000)fail('DEADLINE');return left;};
async function hashFile(file,maximum=CHECKPOINT_LIMITS.file_bytes,deadline=Infinity){const s=await lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.size>maximum)fail('FILE');
 const digest=createHash('sha256');let count=0;for await(const chunk of createReadStream(file)){timeLeft(deadline);count+=chunk.length;if(count>maximum)fail('FILE_SIZE');digest.update(chunk);}
 if(count!==s.size)fail('FILE_CHANGED');return {bytes:count,sha256:digest.digest('hex')};}

/** Fail rather than silently truncating a full input/journal closure. */
export async function inventoryCheckpointTree(root,{maximumBytes=CHECKPOINT_LIMITS.audit_bytes,deadline=Infinity}={}){
 root=resolve(root);const rootStat=await lstat(root);if(!rootStat.isDirectory()||rootStat.isSymbolicLink())fail('ROOT');
 const files=[];let total=0;
 async function walk(directory,prefix=''){
  for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
   timeLeft(deadline);const name=prefix+entry.name;local(root,name);if(entry.isSymbolicLink())fail('SYMLINK');
   if(/(^|\/)(?:\.env(?:\.[^/]*)?|node_modules|\.git|credentials?|secrets?)(\/|$)|\.(?:pem|key|p12|pfx)$/i.test(name))fail('FILE_SCOPE');
   if(entry.isDirectory()){await walk(join(directory,entry.name),name+'/');continue;}
   if(!entry.isFile()||name==='checkpoint-manifest.json')fail('FILE_SCOPE');
   if(files.length+2>CHECKPOINT_LIMITS.files)fail('FILE_COUNT');const checked=await hashFile(join(directory,entry.name),CHECKPOINT_LIMITS.file_bytes,deadline);total+=checked.bytes;
   if(total>maximumBytes)fail('TREE_SIZE');files.push({file:name,...checked});
  }
 }
 await walk(root);return {files,total_bytes:total};
}
function hasUnknown(v){if(!v||typeof v!=='object')return false;
 if(v.in_flight===true||['IN_FLIGHT','IN_PROGRESS','UNCONFIRMED','OUTCOME_UNKNOWN'].includes(v.state))return true;
 return Object.values(v).some(hasUnknown);}
function completedSnapshot(s){return s?.schema==='TAIWAN_MARKET_DAILY_SNAPSHOT_V1'&&!hasUnknown(s)
 &&(s.state==='STAGED_REVIEW_REQUIRED'&&s.stage?.finish?.outcome?.state==='STAGED_REVIEW_REQUIRED'
  &&typeof s.stage.finish.outcome.edition_id==='string'||s.state==='SKIPPED_MARKET_CLOSED');}

/** Builds a COPY. Original state, captures and derived files remain untouched.
 * The returned copy must not become the durable head until AUDIT and RESUME
 * ciphertexts have both been uploaded and read back successfully.
 */
export async function copyCheckpointResume({root,destination,inventory,cacheOnly=false,deadline=Infinity}){
 root=resolve(root);destination=resolve(destination);if(!await absent(destination))fail('RESUME_EXISTS');
 if(!relative(root,destination).startsWith('..')&&!isAbsolute(relative(root,destination)))fail('RESUME_INSIDE_SOURCE');
 const all=new Map(inventory.files.map(f=>[f.file,f])),selected=new Set(),rewrites=new Map(),archived=[];
 const cachePrefix=cacheOnly?'':'input-cache/';
 const include=name=>{timeLeft(deadline);local(root,name);if(!all.has(name))fail('CLOSURE_MISSING');selected.add(name);};
 const includePrefix=prefix=>{timeLeft(deadline);for(const name of all.keys())if(name.startsWith(prefix))selected.add(name);};
 const descriptor=(v,prefix)=>{if(!exact(v,['file','bytes','sha256']))return false;
  const name=prefix+v.file;include(name);const actual=all.get(name);if(actual.bytes!==v.bytes||actual.sha256!==v.sha256)fail('CLOSURE_HASH');return true;};
 function references(v,prefix){if(!v||typeof v!=='object')return;if(descriptor(v,prefix))return;
  for(const child of Object.values(v))references(child,prefix);}
 if(!cacheOnly)includePrefix('snapshots/'); // An unrecognized/incomplete directory stays intact.
 for(const f of inventory.files){
  if(!cacheOnly&&/^snapshots\/\d{4}-\d\d-\d\d\/(?:PREMARKET|POSTCLOSE)\/state\.json$/.test(f.file)){
   const state=await json(local(root,f.file)),prefix=f.file.slice(0,-'state.json'.length);
   if(completedSnapshot(state)){for(const name of [...selected])if(name.startsWith(prefix))selected.delete(name);
    include(f.file);archived.push({snapshot_key:state.snapshot_key,state_sha256:f.sha256});}
   else{includePrefix(prefix);references(state,'');
    for(const c of [...Object.values(state.selected??{}),...(state.extra_captures??[])])if(c.raw_file)include(c.raw_file);}
  }
 }
 // A root first-seen index is small, and is needed when identical raw bytes
 // recur. A fresh capture writes/validates those bytes before reusing the index.
 if(!cacheOnly)includePrefix('capture-index/');
 const cacheFile=cachePrefix+'cache-state.json';if(cacheOnly&&!all.has(cacheFile))fail('CACHE_STATE_REQUIRED');
 if(all.has(cacheFile)){
  const state=await json(local(root,cacheFile));if(state.schema!=='TAIWAN_INPUT_CACHE_STATE_V1'||!object(state.runs))fail('CACHE_STATE');
  const copy=globalThis.structuredClone(state),keys=Object.keys(copy.runs).sort().slice(-CHECKPOINT_LIMITS.cache_runs);
  copy.runs=Object.fromEntries(keys.map(k=>[k,copy.runs[k]]));references(copy,cachePrefix);
  include(cacheFile);rewrites.set(cacheFile,Buffer.from(checkpointCanonical(copy)+'\n'));
  includePrefix(cachePrefix+'seed-acquisition/');
  const manifests=new Set(Object.values(copy.runs));
  if(all.has(cachePrefix+'latest.json')){include(cachePrefix+'latest.json');const latest=await json(local(root,cachePrefix+'latest.json'));
   if(latest.schema!=='TAIWAN_DAILY_INPUT_POINTER_V1'||!isHash(latest.manifest_hash))fail('CACHE_POINTER');manifests.add(latest.file);}
  for(const file of manifests){include(cachePrefix+file);const manifest=await json(local(root,cachePrefix+file));
   const {manifest_hash,...body}=manifest;if(manifest.schema!=='TAIWAN_DAILY_INPUT_MANIFEST_V1'||hash(checkpointCanonical(body))!==manifest_hash)fail('CACHE_MANIFEST');
   references(manifest,cachePrefix);
   for(const part of Object.values(manifest.parts??{})){
    const content=await json(local(root,cachePrefix+part.file),CHECKPOINT_LIMITS.file_bytes);
    references(content,cachePrefix);
    if(content.schema==='TAIWAN_HISTORY_CHECKPOINT_V1')for(const stock of content.stocks??[]){
     const path=cachePrefix+stock.file;include(path);const original=await json(local(root,path));const {history_hash,...rest}=original;
     if(history_hash!==stock.history_hash||history_hash!==hash(checkpointCanonical(rest)))fail('HISTORY_HASH');}
    if(content.schema==='TAIWAN_FINANCIAL_CSV_MANIFEST_V1')for(const d of content.documents??[])
     for(const field of ['file','public_receipt_file','raw_csv_file'])include(cachePrefix+d[field]);
    if(['TAIWAN_RETAINED_CAPTURES_V1','TAIWAN_ACTION_ORIGINAL_CAPTURE_SET_V1'].includes(content.schema))
     for(const capture of content.captures??[])include(cachePrefix+capture.raw_path);
   }
  }
  // Completed child payloads already have immutable, hash-addressed copies in
  // state. Every uncertain attempt keeps its entire original output directory.
  for(const [key,attempts]of Object.entries(state.attempts??{}))for(const a of attempts){
   const prefix=cachePrefix+'attempts/'+key+'/'+a.ordinal+'/';
   if(['IN_PROGRESS','UNCONFIRMED'].includes(a.state))includePrefix(prefix);
   else for(const name of all.keys())if(name.startsWith(prefix)&&(/\/result\.json$/.test(name)||/-receipt\.json$/.test(name)))include(name);
  }
 }
 // Small work/status logs are encrypted too. Unknown top-level payloads cannot
 // silently disappear; only the known derived/object namespaces are compacted.
 if(!cacheOnly)for(const f of inventory.files)if(!/^(?:snapshots|objects|input-cache)\//.test(f.file))include(f.file);
 for(const name of [...selected])if(['daily-run.lock',cachePrefix+'input-update.lock.json'].includes(name))selected.delete(name);
 const total=[...selected].reduce((n,k)=>n+(rewrites.get(k)?.length??all.get(k).bytes),0);
 if(total>CHECKPOINT_LIMITS.resume_bytes||selected.size+1>CHECKPOINT_LIMITS.files)fail('RESUME_CAPACITY');
 await mkdir(destination,{mode:0o700});
 try{for(const name of [...selected].sort()){
   timeLeft(deadline);const path=local(destination,name);await mkdir(dirname(path),{recursive:true,mode:0o700});
   if(rewrites.has(name))await writeFile(path,rewrites.get(name),{flag:'wx',mode:0o600});
   else{await copyFile(local(root,name),path);const checked=await hashFile(path,CHECKPOINT_LIMITS.file_bytes,deadline);if(checked.sha256!==all.get(name).sha256||checked.bytes!==all.get(name).bytes)fail('COPY_CHANGED');}
  }
  return {archived_completed_snapshots:archived,retained_files:selected.size,total_bytes:total,
   omitted_derived_files:inventory.files.length-selected.size,originals_deleted:0,
   input_state_sha256_before:all.get(cacheFile)?.sha256??null,input_state_sha256_after:rewrites.has(cacheFile)?hash(rewrites.get(cacheFile)):null};
 }catch(e){await rm(destination,{recursive:true,force:true});throw e;}
}
export async function copyTaiwanInputCacheResume({cacheRoot,destination}){
 const inventory=await inventoryCheckpointTree(cacheRoot);
 const result=await copyCheckpointResume({root:cacheRoot,destination,inventory,cacheOnly:true});
 return {...result,source_file_count:inventory.files.length,source_bytes:inventory.total_bytes};
}
function meter(maximum){const digest=createHash('sha256');let count=0;
 const stream=new Transform({transform(chunk,_encoding,done){count+=chunk.length;if(count>maximum)return done(Error('TAIWAN_CHECKPOINT_STREAM_SIZE'));
  digest.update(chunk);done(null,chunk);}});return {stream,result:()=>({bytes:count,sha256:digest.digest('hex')})};}
function child(command,request,{stdout='pipe',timeout=CHECKPOINT_LIMITS.archive_ms}={}){
 const process=spawn('python3',[ARCHIVER,command],{stdio:['pipe',stdout,'pipe'],timeout,killSignal:'SIGKILL'});
 let errorBytes=0;process.stderr.on('data',chunk=>{errorBytes+=chunk.length;if(errorBytes>4096)process.kill('SIGKILL');});
 const done=new Promise((resolveDone,reject)=>{process.once('error',()=>reject(Error('TAIWAN_CHECKPOINT_ARCHIVE_PROCESS')));
  process.once('close',code=>code===0?resolveDone():reject(Error('TAIWAN_CHECKPOINT_ARCHIVE_PROCESS')));});
 // Keep the rejection observed while pipelines are still draining.
 done.catch(()=>{});process.stdin.on('error',()=>{});process.stdin.end(JSON.stringify(request));return {process,done};
}
const aad=(checkpointId,contextHash,kind,manifestHash)=>Buffer.from(checkpointCanonical({
 schema:'TAIWAN_MARKET_CHECKPOINT_AAD_V1',checkpoint_id:checkpointId,context_hash:contextHash,kind,manifest_sha256:manifestHash}));

export async function encryptCheckpointBundle({root,file,checkpointId,contextHash,kind,key,nonce=randomBytes(12),extra={},deadline=Infinity}){
 if(!isHash(checkpointId)||!isHash(contextHash)||!['AUDIT','RESUME'].includes(kind)||!Buffer.isBuffer(key)||key.length!==32||nonce.length!==12)fail('ENCRYPT_ARGUMENTS');
 const inventory=await inventoryCheckpointTree(root,{maximumBytes:kind==='AUDIT'?CHECKPOINT_LIMITS.audit_bytes:CHECKPOINT_LIMITS.resume_bytes,deadline});
 const manifest={schema:'TAIWAN_MARKET_CHECKPOINT_FILES_V1',checkpoint_id:checkpointId,context_hash:contextHash,kind,
  ...inventory,retention:extra};const manifestHash=hash(checkpointCanonical(manifest));
 const cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(aad(checkpointId,contextHash,kind,manifestHash));
 const plain=meter(CHECKPOINT_LIMITS.ciphertext_bytes),encrypted=meter(CHECKPOINT_LIMITS.ciphertext_bytes);
 await mkdir(dirname(file),{recursive:true,mode:0o700});const task=child('pack',{root,manifest},{timeout:Math.min(CHECKPOINT_LIMITS.archive_ms,timeLeft(deadline))});
 try{await Promise.all([pipeline(task.process.stdout,plain.stream,cipher,encrypted.stream,createWriteStream(file,{flags:'wx',mode:0o600})),task.done]);}
 catch(e){task.process.kill('SIGKILL');await task.done.catch(()=>{});await rm(file,{force:true});throw e;}
 const p=plain.result(),c=encrypted.result();return {kind,artifact_name:'taiwan-market-'+kind.toLowerCase()+'-'+checkpointId,
  format:'TAR_GZIP_AES_256_GCM_V1',ciphertext_sha256:c.sha256,ciphertext_bytes:c.bytes,
  plaintext_sha256:p.sha256,plaintext_bytes:p.bytes,manifest_sha256:manifestHash,file_count:inventory.files.length+1,
  nonce_base64:nonce.toString('base64'),tag_base64:cipher.getAuthTag().toString('base64')};
}
export function parseCheckpointBundle(b,id,{requireArtifact=true}={}){
 const keys=['kind','artifact_name','format','ciphertext_sha256','ciphertext_bytes','plaintext_sha256','plaintext_bytes','manifest_sha256','file_count','nonce_base64','tag_base64'];
 if(requireArtifact)keys.push('artifact_id');if(!exact(b,keys)||!['AUDIT','RESUME'].includes(b.kind)
  ||b.artifact_name!=='taiwan-market-'+b.kind.toLowerCase()+'-'+id||b.format!=='TAR_GZIP_AES_256_GCM_V1'
  ||!['ciphertext_sha256','plaintext_sha256','manifest_sha256'].every(k=>isHash(b[k]))
  ||!Number.isSafeInteger(b.ciphertext_bytes)||b.ciphertext_bytes<1||b.ciphertext_bytes>CHECKPOINT_LIMITS.ciphertext_bytes
  ||!Number.isSafeInteger(b.plaintext_bytes)||b.plaintext_bytes<1||b.plaintext_bytes>CHECKPOINT_LIMITS.audit_bytes
  ||!Number.isSafeInteger(b.file_count)||b.file_count<1||b.file_count>CHECKPOINT_LIMITS.files
  ||requireArtifact&&!/^[0-9]{1,20}$/.test(b.artifact_id))fail('BUNDLE');
 base64(b.nonce_base64,12);base64(b.tag_base64,16);return b;
}
export async function decryptCheckpointBundle({file,output,checkpointId,contextHash,bundle,key}){
 parseCheckpointBundle(bundle,checkpointId,{requireArtifact:Object.hasOwn(bundle,'artifact_id')});
 if(!Buffer.isBuffer(key)||key.length!==32||!await absent(output))fail('DECRYPT_ARGUMENTS');
 await mkdir(dirname(output),{recursive:true,mode:0o700});const work=await mkdtemp(join(dirname(output),'.checkpoint-verify-'));
 const compressed=join(work,'payload.tgz'),extracted=join(work,'extracted');
 try{const cipher=meter(bundle.ciphertext_bytes),plain=meter(bundle.plaintext_bytes);
  const decrypt=createDecipheriv('aes-256-gcm',key,base64(bundle.nonce_base64,12));decrypt.setAuthTag(base64(bundle.tag_base64,16));
  decrypt.setAAD(aad(checkpointId,contextHash,bundle.kind,bundle.manifest_sha256));
  await pipeline(createReadStream(file),cipher.stream,decrypt,plain.stream,createWriteStream(compressed,{flags:'wx',mode:0o600}));
  const a=cipher.result(),b=plain.result();if(a.bytes!==bundle.ciphertext_bytes||a.sha256!==bundle.ciphertext_sha256
   ||b.bytes!==bundle.plaintext_bytes||b.sha256!==bundle.plaintext_sha256)fail('CIPHER_HASH');
  const task=child('unpack',{archive:compressed,output:extracted,checkpoint_id:checkpointId,kind:bundle.kind,manifest_sha256:bundle.manifest_sha256,
   maximum_total_bytes:bundle.kind==='RESUME'?CHECKPOINT_LIMITS.resume_bytes:CHECKPOINT_LIMITS.audit_bytes},{stdout:'ignore'});await task.done;
  const manifest=await json(join(extracted,'checkpoint-manifest.json'));
  if(manifest.context_hash!==contextHash||manifest.files.length+1!==bundle.file_count)fail('MANIFEST_BINDING');
  await unlink(join(extracted,'checkpoint-manifest.json')); // generated envelope, never a source file
  if(!await absent(output))fail('RESTORE_EXISTS');await rename(extracted,output);return manifest;
 }finally{await rm(work,{recursive:true,force:true});}
}

function parseRecord(r,sealed){if(r===null)return null;
 if(!exact(r,['checkpoint_id','sequence','prior_checkpoint_id','context_text','context_hash','key_base64','issued_at','archive_text','archive_hash','sealed_at'])
  ||!isHash(r.checkpoint_id)||!Number.isSafeInteger(r.sequence)||r.sequence<1
  ||r.prior_checkpoint_id!==null&&!isHash(r.prior_checkpoint_id)||!isHash(r.context_hash)||hash(r.context_text)!==r.context_hash||!time(r.issued_at))fail('RECORD');
 const c=JSON.parse(r.context_text);if(checkpointCanonical(c)!==r.context_text||c.schema!=='TAIWAN_MARKET_CHECKPOINT_BEGIN_V1'
  ||c.checkpoint_id!==r.checkpoint_id||c.prior_checkpoint_id!==r.prior_checkpoint_id)fail('RECORD_CONTEXT');base64(r.key_base64,32);
 if(sealed){if(!isHash(r.archive_hash)||typeof r.archive_text!=='string'||hash(r.archive_text)!==r.archive_hash||!time(r.sealed_at))fail('SEALED_RECORD');
  parseArchive(r.archive_text,r.checkpoint_id,r.context_hash);
 }else if(r.archive_hash!==null||r.archive_text!==null||r.sealed_at!==null)fail('PENDING_RECORD');return r;}
export function parseCheckpointState(v){if(!exact(v,['schema','head','pending'])||v.schema!=='DAILY_AI_MARKET_WORKER_CHECKPOINT_V1')fail('STATE');
 const head=parseRecord(v.head,true),pending=parseRecord(v.pending,false);
 if(head&&pending&&(pending.prior_checkpoint_id!==head.checkpoint_id||pending.sequence!==head.sequence+1)
  ||!head&&pending&&(pending.prior_checkpoint_id!==null||pending.sequence!==1))fail('STATE_POINTER');return {head,pending};}
function parseArchive(text,id,contextHash){const a=JSON.parse(text);
 if(!exact(a,['schema','checkpoint_id','context_hash','work_state','bundles'])||checkpointCanonical(a)!==text
  ||a.schema!=='TAIWAN_MARKET_CHECKPOINT_ARCHIVES_V1'||a.checkpoint_id!==id||a.context_hash!==contextHash
  ||typeof a.work_state!=='string'||a.work_state.length<1||a.work_state.length>80||!Array.isArray(a.bundles)||a.bundles.length!==2)fail('ARCHIVE');
 a.bundles.forEach(b=>parseCheckpointBundle(b,id));if(a.bundles[0].kind!=='AUDIT'||a.bundles[1].kind!=='RESUME'
  ||a.bundles[0].nonce_base64===a.bundles[1].nonce_base64||a.bundles[0].artifact_id===a.bundles[1].artifact_id)fail('ARCHIVE_BUNDLES');return a;}
async function rpcData(rpc,name,args){const r=await rpc(name,args);if(!object(r)||r.error||r.data===null||r.data===undefined)fail('RPC_UNCONFIRMED');return r.data;}
export async function readWorkerCheckpoint(rpc){return parseCheckpointState(await rpcData(rpc,CHECKPOINT_RPCS.read,{}));}
export async function beginWorkerCheckpoint({rpc,context}){
 const text=checkpointCanonical(context),digest=hash(text);let response;
 try{response=await rpcData(rpc,CHECKPOINT_RPCS.begin,{p_context_text:text,p_context_hash:digest});}
 catch{const state=await readWorkerCheckpoint(rpc);if(state.pending?.checkpoint_id!==context.checkpoint_id||state.pending.context_text!==text)fail('BEGIN_ACK_UNKNOWN');
  const p=state.pending;return {checkpoint_id:p.checkpoint_id,sequence:p.sequence,prior_checkpoint_id:p.prior_checkpoint_id,context_hash:digest,
   key:base64(p.key_base64,32),issued_at:p.issued_at,reconciled:true};}
 if(!exact(response,['schema','checkpoint_id','sequence','prior_checkpoint_id','context_hash','key_base64','issued_at','replayed'])
  ||response.schema!=='DAILY_AI_MARKET_WORKER_CHECKPOINT_ISSUED_V1'||response.checkpoint_id!==context.checkpoint_id
  ||response.context_hash!==digest||response.prior_checkpoint_id!==context.prior_checkpoint_id||!Number.isSafeInteger(response.sequence)
  ||response.sequence<1||!time(response.issued_at)||typeof response.replayed!=='boolean')fail('BEGIN_RECEIPT');
 return {checkpoint_id:response.checkpoint_id,sequence:response.sequence,prior_checkpoint_id:response.prior_checkpoint_id,
  context_hash:digest,key:base64(response.key_base64,32),issued_at:response.issued_at,reconciled:false};
}
export async function sealWorkerCheckpoint({rpc,checkpointId,contextHash,workState,bundles}){
 const body={schema:'TAIWAN_MARKET_CHECKPOINT_ARCHIVES_V1',checkpoint_id:checkpointId,context_hash:contextHash,work_state:workState,bundles};
 const text=checkpointCanonical(body),digest=hash(text);parseArchive(text,checkpointId,contextHash);let response;
 try{response=await rpcData(rpc,CHECKPOINT_RPCS.seal,{p_checkpoint_id:checkpointId,p_archive_text:text,p_archive_hash:digest});}
 catch{const state=await readWorkerCheckpoint(rpc);if(state.head?.checkpoint_id!==checkpointId||state.head.archive_hash!==digest||state.pending)fail('SEAL_ACK_UNKNOWN');
  return {checkpoint_id:checkpointId,sequence:state.head.sequence,archive_hash:digest,reconciled:true};}
 if(!exact(response,['schema','checkpoint_id','sequence','archive_hash','replayed'])||response.schema!=='DAILY_AI_MARKET_WORKER_CHECKPOINT_SEALED_V1'
  ||response.checkpoint_id!==checkpointId||response.archive_hash!==digest||!Number.isSafeInteger(response.sequence)||response.sequence<1||typeof response.replayed!=='boolean')fail('SEAL_RECEIPT');
 return {checkpoint_id:checkpointId,sequence:response.sequence,archive_hash:digest,reconciled:false};
}

async function boundedResponse(response,maximum){const limit=meter(maximum),chunks=[];
 const collect=new Transform({transform(chunk,_e,done){chunks.push(chunk);done();}});
 await pipeline(Readable.fromWeb(response.body),limit.stream,collect);return Buffer.concat(chunks);}
/** Only the fixed repository's immutable artifact ID can select a download.
 * Authorization is never forwarded to the GitHub-issued storage redirect. */
export async function fetchCheckpointArtifact({bundle,checkpointId,runId,token,output,fetchImpl=globalThis.fetch,deadline=Infinity}){
 parseCheckpointBundle(bundle,checkpointId);if(typeof token!=='string'||!token||!/^[0-9]{1,20}$/.test(runId)||!await absent(output))fail('ARTIFACT_ARGUMENTS');
 const url='https://api.github.com/repos/'+CHECKPOINT_LIMITS.repository+'/actions/artifacts/'+bundle.artifact_id;
 const headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
 const metadata=await fetchImpl(url,{headers,redirect:'error',signal:globalThis.AbortSignal.timeout(Math.min(15_000,timeLeft(deadline)))});if(!metadata.ok)fail('ARTIFACT_UNAVAILABLE');
 const info=JSON.parse((await boundedResponse(metadata,128_000)).toString('utf8'));
 if(String(info.id)!==bundle.artifact_id||info.name!==bundle.artifact_name||info.expired!==false||String(info.workflow_run?.id)!==runId
  ||info.workflow_run?.head_repository_id!==1274909964||info.workflow_run?.repository_id!==1274909964
  ||!Number.isSafeInteger(info.size_in_bytes)||info.size_in_bytes<bundle.ciphertext_bytes||info.size_in_bytes>bundle.ciphertext_bytes+1_000_000)fail('ARTIFACT_METADATA');
 const response=await fetchImpl(url+'/zip',{headers,redirect:'manual',signal:globalThis.AbortSignal.timeout(Math.min(15_000,timeLeft(deadline)))});
 if(response.status!==302)fail('ARTIFACT_REDIRECT');const location=new globalThis.URL(response.headers.get('location')??'https://invalid.invalid');
 if(location.protocol!=='https:'||location.username||location.password||location.port
  ||!(location.hostname.endsWith('.blob.core.windows.net')||location.hostname.endsWith('.actions.githubusercontent.com')
   ||location.hostname.endsWith('.githubusercontent.com')||location.hostname==='productionresultssa0.blob.core.windows.net'))fail('ARTIFACT_STORAGE_SCOPE');
 await mkdir(dirname(output),{recursive:true,mode:0o700});const archive=output+'.'+randomUUID()+'.zip';
 try{const payload=await fetchImpl(location,{redirect:'error',signal:globalThis.AbortSignal.timeout(Math.min(CHECKPOINT_LIMITS.download_ms,timeLeft(deadline)))});if(!payload.ok)fail('ARTIFACT_DOWNLOAD');
  const zipped=meter(bundle.ciphertext_bytes+1_000_000);
  await pipeline(Readable.fromWeb(payload.body),zipped.stream,createWriteStream(archive,{flags:'wx',mode:0o600}));
  const task=child('unwrap',{zip:archive,output,filename:bundle.kind.toLowerCase()+'.bin',bytes:bundle.ciphertext_bytes,sha256:bundle.ciphertext_sha256},{stdout:'ignore',timeout:Math.min(CHECKPOINT_LIMITS.archive_ms,timeLeft(deadline))});await task.done;
 }catch(e){await rm(output,{force:true});throw e;}finally{await rm(archive,{force:true});}
 return {artifact_id:bundle.artifact_id,ciphertext_sha256:bundle.ciphertext_sha256,ciphertext_bytes:bundle.ciphertext_bytes};
}
export async function restoreWorkerCheckpoint({state,rpc,output,token,fetchArtifact=fetchCheckpointArtifact}){
 const checked=state??await readWorkerCheckpoint(rpc);if(checked.pending)fail('PENDING_REQUIRES_RECONCILIATION');
 if(!await absent(output))fail('RESTORE_EXISTS');if(!checked.head)return {state:'NO_PRIOR_CHECKPOINT',checkpoint_id:null};
 const h=checked.head,a=parseArchive(h.archive_text,h.checkpoint_id,h.context_hash),bundle=a.bundles[1];
 await mkdir(dirname(output),{recursive:true,mode:0o700});const work=await mkdtemp(join(dirname(output),'.checkpoint-download-')),key=base64(h.key_base64,32);
 try{const file=join(work,'resume.bin');await fetchArtifact({bundle,checkpointId:h.checkpoint_id,runId:JSON.parse(h.context_text).run_id,token,output:file});
  const manifest=await decryptCheckpointBundle({file,output,checkpointId:h.checkpoint_id,contextHash:h.context_hash,bundle,key});
  return {state:'RESTORED',checkpoint_id:h.checkpoint_id,manifest_sha256:bundle.manifest_sha256,file_count:manifest.files.length,bytes:manifest.total_bytes};
 }finally{key.fill(0);await rm(work,{recursive:true,force:true});}
}
export function mayContinueCheckpointSegment(result,snapshot){
 return ['ACQUISITION_PAUSED_RESOURCE_LIMIT','STAGING_PAUSED_RESOURCE_LIMIT'].includes(result?.state)
  &&result.expired!==true&&snapshot?.state===result.state&&!snapshot.last_error&&!hasUnknown(snapshot)&&!snapshot.stage?.blocked;
}
export function checkpointWorkSucceeded(result){return result?.state==='STAGED_REVIEW_REQUIRED'||result?.state==='SKIPPED_MARKET_CLOSED';}
export const newCheckpointId=()=>randomBytes(32).toString('hex');

// Test-only, synchronous lifetime. This is not a reusable admission proof or
// authority to substitute Git bytes for an unverified current source.
import assert from 'node:assert/strict';
import {constants,openSync,closeSync,readFileSync,lstatSync,fstatSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,dirname,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isAsyncFunction,isGeneratorFunction} from 'node:util/types';
import {INTEGRATION_BASE,INTEGRATION_MANIFEST,integrationHash,
 verifyIntegrationCandidate} from './integrationAdmission.mjs';
import {forwardAwareReader} from './recommendationV2ForwardIntegrity.mjs';
import {readRecommendationPredecessor} from './recommendationPhaseIntegrity.mjs';
import {readAnalysisIntelligencePredecessor} from './premarketAtomicReadinessIntegrity.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const FREEZE='docs/10k-program/phase1-core-freeze.json';
// Do not inherit GIT_DIR/WORK_TREE/OBJECT_DIRECTORY, config injection, alternate
// object stores, credentials or other caller environment. Local immutable Git
// facts are the only subprocess purpose; missing objects fail without fetching.
const gitEnv=Object.freeze({PATH:'/usr/bin:/bin',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',
 GIT_CONFIG_GLOBAL:'/dev/null',GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0'});
const git=args=>execFileSync('git',['--no-replace-objects',...args],{
 cwd:root,env:gitEnv,maxBuffer:64e6,
});
let baselineFacts;
function immutableBaselineFacts(){
 if(!baselineFacts){
  const rows=git(['ls-tree','-rz',INTEGRATION_BASE]).toString().split('\0').filter(Boolean).map(row=>{
   const [meta,path]=row.split('\t'),[mode,type,oid]=meta.split(' ');
   assert.equal(type,'blob');assert.match(mode,/^100(644|755)$/);assert.match(oid,/^[a-f0-9]{40}$/);
   return {path,mode,oid};
  });
  const output=execFileSync('git',['--no-replace-objects','cat-file','--batch'],{
   cwd:root,env:gitEnv,
   input:rows.map(row=>row.oid).join('\n')+'\n',maxBuffer:64e6,
  });
  const facts=new Map();let offset=0;
  for(const row of rows){
   const end=output.indexOf(10,offset);assert(end>=offset);
   const [oid,type,sizeText]=output.subarray(offset,end).toString().split(' '),size=Number(sizeText);
   assert.equal(oid,row.oid);assert.equal(type,'blob');assert(Number.isSafeInteger(size)&&size>=0);
   offset=end+1;assert.equal(output[offset+size],10);
   facts.set(row.path,Object.freeze({mode:row.mode,sha256:integrationHash(output.subarray(offset,offset+size))}));
   offset+=size+1;
  }
  assert.equal(offset,output.length);baselineFacts=facts;
 }
 // Immutable Git metadata only; no live bytes, admission result or reader is
 // retained between invocations, and the private map never escapes.
 return new Map(baselineFacts);
}
function sameStat(a,b){
 for(const key of ['dev','ino','mode','size','mtimeNs','ctimeNs'])
  assert.equal(a[key],b[key],'HISTORICAL_BATCH_CHANGED_DURING_READ');
}
function regularBytes(path,mode){
 const file=resolve(root,path),rel=relative(root,file);
 assert.equal(rel,path);assert(!rel.startsWith('..'+sep)&&!rel.startsWith(sep));
 for(let dir=dirname(file);dir!==resolve(root);dir=dirname(dir)){
  const stat=lstatSync(dir);assert(stat.isDirectory()&&!stat.isSymbolicLink(),'HISTORICAL_BATCH_REGULAR_PARENT');
 }
 const before=lstatSync(file,{bigint:true});
 assert(before.isFile()&&!before.isSymbolicLink(),'HISTORICAL_BATCH_REGULAR_FILE');
 assert.equal(before.mode&0o111n? '100755':'100644',mode,'HISTORICAL_BATCH_MODE:'+path);
 const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  sameStat(before,fstatSync(fd,{bigint:true}));
  const bytes=readFileSync(fd);
  sameStat(before,fstatSync(fd,{bigint:true}));sameStat(before,lstatSync(file,{bigint:true}));
  return bytes;
 }finally{closeSync(fd);}
}
function physical(path,facts){
 // Check membership before resolving a path or touching the filesystem.
 const expected=facts.get(path);assert(expected,'HISTORICAL_BATCH_UNKNOWN_PATH:'+path);
 const bytes=regularBytes(path,expected.mode);
 assert.equal(integrationHash(bytes),expected.sha256,'HISTORICAL_BATCH_SOURCE_DRIFT:'+path);
 return bytes;
}
function requireSync(fn,role){
 assert.equal(typeof fn,'function','HISTORICAL_BATCH_'+role+'_REQUIRED');
 const code=role==='SOURCE'?'HISTORICAL_BATCH_SYNC_SOURCE_ONLY':'HISTORICAL_BATCH_SYNC_ONLY';
 assert(!isAsyncFunction(fn)&&!isGeneratorFunction(fn),code);
 assert.equal(Object.prototype.toString.call(fn),'[object Function]',code);
}
const typedArrayPrototype=Object.getPrototypeOf(Uint8Array.prototype);
const bufferOf=Object.getOwnPropertyDescriptor(typedArrayPrototype,'buffer').get;
const offsetOf=Object.getOwnPropertyDescriptor(typedArrayPrototype,'byteOffset').get;
const sizeOf=Object.getOwnPropertyDescriptor(typedArrayPrototype,'byteLength').get;
const setBytes=Uint8Array.prototype.set;
function copySourceBuffer(value){
 // Buffer.from(value) invokes a custom valueOf, which could replace the bytes
 // or rethrow a previously genuine mismatch. Read only intrinsic byte storage.
 const size=sizeOf.call(value),copy=Buffer.alloc(size);
 setBytes.call(copy,new Uint8Array(bufferOf.call(value),offsetOf.call(value),size));
 return copy;
}
const ownMismatches=new WeakSet();
/** Origin check only, never admission or freshness proof. Callers must still
 * match the exact case path, representation and original expected/mutated hash.
 * A source throwing even a genuine older error is sanitized independently.
 */
export function isHistoricalSourceMismatch(error){return ownMismatches.has(error);}
function sourceMismatch(path,expected,actual,representation){
 // Hash the actual representation, not normalized source text. In particular,
 // UTF-16 code-unit hashing distinguishes unpaired surrogates from U+FFFD.
 const error=Object.freeze(Object.assign(Error('HISTORICAL_SOURCE_MISMATCH'),{
  code:'HISTORICAL_SOURCE_MISMATCH',path,representation,
  expected_sha256:integrationHash(expected),actual_sha256:integrationHash(actual),
 }));
 ownMismatches.add(error);return error;
}

/** Synchronous checked CURRENT source only: no Forward/LINE factory, historical
 * substitution, caller-selected tree or reusable admission proof. The consumer
 * must construct any required factory afresh for its own original source and
 * must not return/retain a factory reader as a cross-invocation proof.
 * Physical admission is unconditional before and in finally after the batch.
 * Caller/source values are checked independently before historical restoration,
 * including paths whose current bytes a restored reader would otherwise hide.
 * This bounded test contract is NOT equivalent to 142 complete live-tree gates
 * under every possible interleaving. It neither replaces a public release gate
 * nor authorizes reuse/removal of the original per-row negative controls.
 */
export function withCheckedHistoricalSource(source,consume){
 requireSync(source,'SOURCE');requireSync(consume,'CONSUMER');
 let active=false,checkCompleteSource,admitted,receipt,callbackFailure;
 try{
  admitted=verifyIntegrationCandidate();const facts=immutableBaselineFacts();
  for(const row of admitted.files)facts.set(row.path,Object.freeze({mode:row.mode,sha256:row.after_sha256}));
  receipt=regularBytes(INTEGRATION_MANIFEST,'100644');
  assert.deepEqual(JSON.parse(receipt),admitted,'HISTORICAL_BATCH_RECEIPT_CHANGED');
  facts.set(INTEGRATION_MANIFEST,Object.freeze({mode:'100644',sha256:integrationHash(receipt)}));
  const current=path=>{
   assert(facts.has(path),'HISTORICAL_BATCH_UNKNOWN_PATH:'+path);
   physical(INTEGRATION_MANIFEST,facts);
   const bytes=physical(path,facts);let value,copy;
   try{
    value=source(path);
    copy=Buffer.isBuffer(value)?copySourceBuffer(value):value;
   }catch{
    // Never pass through user-supplied fields, messages, causes or an older
    // genuine mismatch. No candidate bytes were returned by this callback.
    callbackFailure??=Object.freeze(Object.assign(Error('HISTORICAL_SOURCE_CALLBACK_FAILURE'),{
     code:'HISTORICAL_SOURCE_CALLBACK_FAILURE',path,
    }));
    throw callbackFailure;
   }
   assert(typeof value==='string'||Buffer.isBuffer(value),'HISTORICAL_BATCH_SOURCE_TYPE');
   physical(path,facts);physical(INTEGRATION_MANIFEST,facts);
   if(typeof copy==='string'){
    const expected=bytes.toString('utf8');
    if(copy!==expected)throw sourceMismatch(path,Buffer.from(expected,'utf16le'),Buffer.from(copy,'utf16le'),'UTF16LE_CODE_UNITS');
   }else if(!copy.equals(bytes))throw sourceMismatch(path,bytes,copy,'BYTES');
   return copy;
  };
  // Check the complete supplied source, not just the first requested Core file.
  // This also catches mutations performed by callbacks during construction.
  checkCompleteSource=()=>{for(const path of facts.keys())current(path);};
  checkCompleteSource();
  verifyIntegrationCandidate();
  let reading=false;
  const checked=path=>{
   assert(active,'HISTORICAL_BATCH_CLOSED');
   assert(typeof path==='string'&&facts.has(path),'HISTORICAL_BATCH_UNKNOWN_PATH:'+path);
   assert(!reading,'HISTORICAL_BATCH_REENTRANT');reading=true;
   try{return current(path);}finally{reading=false;}
  };
  active=true;const result=consume(checked);active=false;
  assert.equal(result,undefined,'HISTORICAL_BATCH_SYNC_VOID_ONLY');
 }finally{
  active=false;
  // Attempt all final gates independently. A first source throw is sticky even
  // if a later source pass returns mismatched bytes: cleanup must never turn a
  // callback failure into branded evidence that a V2 mapper could accept.
  let finalError;
  try{checkCompleteSource?.();}catch(error){finalError=error;}
  try{
   const finalAdmission=verifyIntegrationCandidate();
   if(admitted)assert.deepEqual(finalAdmission,admitted,'HISTORICAL_BATCH_FINAL_ADMISSION_CHANGED');
  }catch(error){finalError=error;}
  try{
   if(receipt)assert.deepEqual(regularBytes(INTEGRATION_MANIFEST,'100644'),receipt,'HISTORICAL_BATCH_FINAL_RECEIPT_CHANGED');
  }catch(error){finalError=error;}
  if(callbackFailure)throw callbackFailure;
  if(finalError)throw finalError;
 }
}

/** Preserve the original 142 per-file hash assertions and original predecessor
 * function. No public release gate or original negative case is replaced.
 */
export function withRecommendationHistoricalBatch(source,consume){
 return withHistoricalBatch(source,consume,'recommendation');
}

/** Phase 2 retains its own original reader and 169-path coverage contract. */
export function withAnalysisHistoricalBatch(source,consume){
 return withHistoricalBatch(source,consume,'analysis');
}

function withHistoricalBatch(source,consume,view){
 requireSync(consume,'CONSUMER');
 return withCheckedHistoricalSource(source,checkedSource=>{
  const freeze=JSON.parse(checkedSource(FREEZE));
  assert.equal(freeze.base_sha,'3b33db3688ba350da0372b50f3391da922b639ea');
  const allowed=new Set(Object.keys(freeze.protected_files));assert.equal(allowed.size,142);
  if(view==='analysis'){
   const analysis=JSON.parse(checkedSource('docs/10k-program/phase2-candidate-integrity.json'));
   assert.equal(analysis.base_sha,'1fcf24a7a2d7d7a602e555639a200f3b002a31ce');
   assert.equal(Object.keys(analysis.files).length,25);assert.equal(Object.keys(analysis.predecessors).length,2);
   for(const path of [...Object.keys(analysis.files),...Object.keys(analysis.predecessors)])allowed.add(path);
   assert.equal(allowed.size,169);
  }
  // Invocation-local only. Existing transition factories perform their complete
  // scope/hash/lineage checks; no WeakMap/module cache of this reader is allowed.
  const historical=forwardAwareReader(checkedSource);
  const seen=new Set();let reading=false;
  let active=true;
  const read=path=>{
   assert(active,'HISTORICAL_BATCH_CLOSED');
   assert(typeof path==='string'&&allowed.has(path),'HISTORICAL_BATCH_UNKNOWN_PATH:'+path);
   assert(!reading,'HISTORICAL_BATCH_REENTRANT');
   assert(!seen.has(path),'HISTORICAL_BATCH_DUPLICATE_PATH');seen.add(path);
   reading=true;
   try{
    checkedSource(INTEGRATION_MANIFEST);checkedSource(path);
    const value=view==='analysis'?readAnalysisIntelligencePredecessor(path,historical)
     :readRecommendationPredecessor(path,historical);
    checkedSource(path);checkedSource(INTEGRATION_MANIFEST);
    return typeof value==='string'?value:Buffer.from(value);
   }finally{reading=false;}
  };
  try{
   const result=consume(read);active=false;
   assert.equal(result,undefined,'HISTORICAL_BATCH_SYNC_VOID_ONLY');
   // Read coverage is not assertion coverage: each caller retains its original
   // expected-hash assertions. An empty/partial callback is never success.
   assert.equal(seen.size,allowed.size,'HISTORICAL_BATCH_INCOMPLETE');
  }finally{active=false;}
 });
}

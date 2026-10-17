// Test-only bounded source view, not a release gate or reusable admission proof.
// Live source admission belongs to the shared guard; historical factories and
// their branded readers remain private to one synchronous callback here.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {isAsyncFunction,isGeneratorFunction} from 'node:util/types';
import {withCheckedHistoricalSource,isHistoricalSourceMismatch} from './recommendationHistoricalBatch.mjs';
import {LINE_CARD_MANIFEST,LINE_CARD_PATHS,lineCardTransition} from './lineDecisionIntegrity.mjs';
import {V2_FORWARD_MANIFEST,V2_FORWARD_PATHS,v2ForwardTransition} from './recommendationV2ForwardIntegrity.mjs';
import {V2_MANIFEST,V2_PATHS,v2Transition} from './recommendationV2Integrity.mjs';
import {V2_RUNTIME_MANIFEST,V2_RUNTIME_PATHS,V2_SEALED_MANIFEST,
 v2RuntimeManifest,v2RuntimeTransition,readV2RuntimePredecessor} from './recommendationV2RuntimeIntegrity.mjs';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const linePaths=[LINE_CARD_MANIFEST,...LINE_CARD_PATHS];
const forwardPaths=[V2_FORWARD_MANIFEST,...V2_FORWARD_PATHS];
const shadowPaths=[V2_MANIFEST,...V2_PATHS];
const runtimePaths=[V2_RUNTIME_MANIFEST,V2_SEALED_MANIFEST,...V2_RUNTIME_PATHS];
function requireConsumer(consume){
 assert.equal(typeof consume,'function','V2_BATCH_CONSUMER_REQUIRED');
 assert(!isAsyncFunction(consume)&&!isGeneratorFunction(consume),'V2_BATCH_SYNC_ONLY');
 assert.equal(Object.prototype.toString.call(consume),'[object Function]','V2_BATCH_SYNC_ONLY');
}

/** Only real CURRENT-source cases belong here. Intentionally historical or
 * synthetic Runtime fixtures keep their original injected-source semantics.
 * The shared guard checks the complete ORIGINAL source before and in finally;
 * every exposed historical read also checks fresh current bytes/mode first and
 * afterwards, including paths hidden by a restored predecessor map.
 */
export function withV2HistoricalBatch(source,consume){
 requireConsumer(consume);
 return withCheckedHistoricalSource(source,checkedSource=>{
  let active=true,busy=false,line,forward;
  // Existing factories validate every successor row, hash and lineage link.
  // Passing their exact private identities preserves the existing WeakSet
  // recognition. No live reader/proof is retained between invocations.
  const getLine=()=>line??=lineCardTransition(checkedSource);
  const getForward=()=>forward??=v2ForwardTransition(getLine().predecessorRead);
  const guarded=(paths,operation)=>{
   assert(active,'V2_BATCH_CLOSED');
   assert(!busy,'V2_BATCH_REENTRANT');busy=true;
   const unique=[...new Set(paths)];
   try{
    for(const path of unique)checkedSource(path);
    return operation();
   }finally{
    try{for(const path of unique)checkedSource(path);}finally{busy=false;}
   }
  };
  const read=(path,reader)=>guarded([path],()=>{
   const value=reader(path);
   assert(typeof value==='string'||Buffer.isBuffer(value),'V2_BATCH_SOURCE_TYPE');
   return typeof value==='string'?value:Buffer.from(value);
  });
  const transition=value=>Object.freeze({
   manifest:structuredClone(value.manifest),
   ...(value.hashes?{hashes:new Map(value.hashes)}:{}),
   // Never expose a factory-produced branded reader, even through a return
   // object. Capturing this facade does not retain a usable historical proof.
   predecessorRead:path=>read(path,value.predecessorRead),
  });
  const view=Object.freeze({
   lineCardTransition:()=>guarded(linePaths,()=>transition(getLine())),
   v2ForwardTransition:()=>guarded(forwardPaths,()=>transition(getForward())),
   v2Transition:()=>guarded(shadowPaths,()=>transition(v2Transition(getForward().predecessorRead))),
   v2RuntimeTransition:()=>guarded(runtimePaths,()=>transition(v2RuntimeTransition(getForward().predecessorRead))),
   v2RuntimeManifest:()=>guarded(runtimePaths,()=>structuredClone(v2RuntimeManifest(getForward().predecessorRead))),
   readForward:path=>read(path,p=>getForward().predecessorRead(p)),
   readV2RuntimePredecessor:path=>read(path,p=>readV2RuntimePredecessor(p,getForward().predecessorRead)),
  });
  try{
   const result=consume(view);active=false;
   assert.equal(result,undefined,'V2_BATCH_SYNC_VOID_ONLY');
  }finally{active=false;}
 });
}

/** A narrowly described ORIGINAL per-row mutation, not a trusted stage flag.
 * Each call sends that case's original injected source through a NEW complete
 * shared guard. Only a byte-for-byte identified row mismatch can be expressed
 * as the old fixed drift reason. Physical/mode/receipt, other-path, other-byte,
 * representation and cleanup errors propagate unchanged.
 */
export function checkV2InjectedRowDrift(stage,row,source,originalBytes,mutatedBytes){
 assert(stage==='shadow'||stage==='forward','V2_BATCH_DRIFT_STAGE');
 const paths=stage==='shadow'?V2_PATHS:V2_FORWARD_PATHS;
 assert(row&&paths.includes(row.path),'V2_BATCH_DRIFT_PATH');
 assert(Buffer.isBuffer(originalBytes)&&Buffer.isBuffer(mutatedBytes),'V2_BATCH_DRIFT_BYTES');
 const original=Buffer.from(originalBytes),mutated=Buffer.from(mutatedBytes);
 const suffix=Buffer.from(stage==='shadow'?'DRIFT':'drift');
 assert(mutated.equals(Buffer.concat([original,suffix])),'V2_BATCH_MUTATED_BYTES');
 const expected=digest(original),actual=digest(mutated);
 try{
  withV2HistoricalBatch(source,view=>{
   if(stage==='shadow')view.v2Transition();
   else view.v2ForwardTransition();
  });
 }catch(error){
  // Identity must come from the guard's private mismatch set BEFORE reading
  // caller-forgeable fields. The guard separately sanitizes source exceptions,
  // including a genuine old mismatch thrown back by a later source callback.
  if(!isHistoricalSourceMismatch(error)||error.code!=='HISTORICAL_SOURCE_MISMATCH'||error.representation!=='BYTES'||
   error.path!==row.path||error.expected_sha256!==expected||error.actual_sha256!==actual)throw error;
  throw new assert.AssertionError({expected,actual,operator:'strictEqual',
   message:'unreviewed candidate drift ('+(stage==='shadow'?'V2':'Forward')+'): '+row.path});
 }
}

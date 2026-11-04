// Append CI execution changes after the unchanged recovery source receipts.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstatSync} from 'node:fs';
import * as prior from './recoverySourceSuccessor.mjs';
import {CI_SHARD_SOURCE_BASE,CI_SHARD_SOURCE_CATALOG,CI_SHARD_SOURCE_CATALOG_SHA256,CI_SHARD_SOURCE_MANIFEST,CI_SHARD_SOURCE_SUPPORT,ciShardSourceDefinition,ciShardSourcePriorPatch} from './ciShardSourceCatalog.mjs';
export const REVIEWED_SUCCESSOR_MANIFEST=CI_SHARD_SOURCE_MANIFEST;
export const REVIEWED_SUCCESSOR_SUPPORT=Object.freeze([...prior.REVIEWED_SUCCESSOR_SUPPORT,...CI_SHARD_SOURCE_SUPPORT]);
const root=new URL('../../',import.meta.url),hash=b=>createHash('sha256').update(Buffer.from(b)).digest('hex');
export function ciShardPriorRead(path,bytes){
 const row=ciShardSourceDefinition().local_support_patch.find(r=>r.path===path);
 if(!row||bytes===null||bytes===undefined)return bytes;
 if(typeof bytes==='string'&&Buffer.from(bytes).toString('utf8')!==bytes)return bytes;
 if(hash(bytes)!==row.after.sha256)return bytes;
 const st=lstatSync(new URL(path,root));assert(st.isFile()&&!st.isSymbolicLink(),'CI_SHARD_SOURCE_REGULAR_FILE:'+path);
 assert.equal(st.mode&0o111?'100755':'100644',row.after.mode,'CI_SHARD_SOURCE_CHANGED_MODE:'+path);
 assert.equal(hash(prior.readRecoveryRegularFile(path)),row.after.sha256,'CI_SHARD_SOURCE_CHANGED_AFTER_ADMISSION:'+path);
 const before=ciShardSourcePriorPatch(path);return typeof bytes==='string'?before.toString('utf8'):before;
}
// This internal adapter validates the true current physical image first. The
// recovery verifier independently checks that it receives its fixed 748 image.
const recoveryPhysicalBefore=path=>ciShardPriorRead(path,prior.readRecoveryRegularFile(path));
export function recoveryPriorRead(path,bytes){
 const reflected=ciShardPriorRead(path,bytes);
 // A caller-supplied old image is not evidence of the current after-image.
 // Only a successful new-layer translation may enter the older reflection.
 if(ciShardSourceDefinition().local_support_patch.some(row=>row.path===path)&&reflected===bytes)return bytes;
 return prior.recoveryPriorReadWithVerifiedPhysical(path,reflected,recoveryPhysicalBefore);
}
export function verifyReviewedSuccessorCatalog(read,mode){
 prior.readRecoveryRegularFile(CI_SHARD_SOURCE_CATALOG);assert.equal(mode(CI_SHARD_SOURCE_CATALOG),'100644','CI_SHARD_SOURCE_CATALOG_MODE');
 const c=ciShardSourceDefinition(read(CI_SHARD_SOURCE_CATALOG));
 for(const row of c.local_support_patch){
  const prefix=prior.REVIEWED_SUCCESSOR_SUPPORT.includes(row.path)?'SUCCESSOR_SUPPORT_SOURCE_DRIFT:':'INTEGRATION_SOURCE_DRIFT:';
  assert.equal(hash(read(row.path)),row.after.sha256,prefix+row.path);
  assert.equal(hash(prior.readRecoveryRegularFile(row.path)),row.after.sha256,prefix+row.path);
  assert.equal(mode(row.path),row.after.mode,'INTEGRATION_MODE_DRIFT:'+row.path);
 }
 prior.verifyRecoverySuccessorWithVerifiedPhysical(path=>ciShardPriorRead(path,read(path)),mode,recoveryPhysicalBefore);
 for(const pin of [c.prior_manifest,c.prior_catalog]){assert.equal(hash(read(pin.path)),pin.sha256,'CI_SHARD_SOURCE_PRIOR_DRIFT:'+pin.path);assert.equal(mode(pin.path),'100644','CI_SHARD_SOURCE_PRIOR_MODE');}
 for(const path of CI_SHARD_SOURCE_SUPPORT){prior.readRecoveryRegularFile(path);assert.equal(mode(path),'100644','CI_SHARD_SOURCE_SUPPORT_MODE');}
}
let immutablePaths;
export function reviewedSuccessorPaths(){
 if(!immutablePaths){const c=ciShardSourceDefinition();immutablePaths=Object.freeze([...new Set([...prior.reviewedSuccessorPaths(),...c.local_support_patch.map(r=>r.path),c.prior_manifest.path,CI_SHARD_SOURCE_CATALOG,...CI_SHARD_SOURCE_SUPPORT])].sort());}
 return [...immutablePaths];
}
export function reviewedSuccessorLineage(){
 const c=ciShardSourceDefinition();return {...prior.reviewedSuccessorLineage(),ci_shard_successor:{base:CI_SHARD_SOURCE_BASE,base_tree:c.base_tree,
  prior_manifest:{...c.prior_manifest},prior_catalog:{...c.prior_catalog},catalog:{path:CI_SHARD_SOURCE_CATALOG,sha256:CI_SHARD_SOURCE_CATALOG_SHA256},
  scope_review:structuredClone(c.scope_review),local_support_patch:c.local_support_patch.map(({path,before,after})=>({path,before:{...before},after:{...after}})),trusted_verifier_boundary:structuredClone(c.trusted_verifier_boundary),support_paths:[...CI_SHARD_SOURCE_SUPPORT],...c.authority}};
}
export function applyReviewedSuccessor(expected,historicalSupport=[]){
 prior.applyReviewedSuccessor(expected,historicalSupport);const c=ciShardSourceDefinition(),support=new Set(prior.REVIEWED_SUCCESSOR_SUPPORT);
 for(const row of c.local_support_patch){if(support.has(row.path))continue;
  assert.equal(expected.get(row.path)?.sha256??null,row.before.sha256,'CI_SHARD_SOURCE_BEFORE_COMPOSITION:'+row.path);
  assert.equal(expected.get(row.path)?.mode??null,row.before.mode,'CI_SHARD_SOURCE_BEFORE_MODE:'+row.path);expected.set(row.path,{sha256:row.after.sha256,mode:row.after.mode});
 }
 assert(!expected.has(c.prior_manifest.path));expected.set(c.prior_manifest.path,{sha256:c.prior_manifest.sha256,mode:'100644'});
 assert(!expected.has(CI_SHARD_SOURCE_CATALOG));expected.set(CI_SHARD_SOURCE_CATALOG,{sha256:CI_SHARD_SOURCE_CATALOG_SHA256,mode:'100644'});
 for(const path of REVIEWED_SUCCESSOR_SUPPORT)expected.delete(path);
}

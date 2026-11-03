// Append the complete new Git delta after the unchanged prior composition.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as prior from './reviewedSourceSuccessor.mjs';
import {CURRENT_SOURCE_BASE,CURRENT_SOURCE_HEAD,CURRENT_SOURCE_CATALOG,CURRENT_SOURCE_CATALOG_SHA256,CURRENT_SOURCE_MANIFEST,CURRENT_SOURCE_SUPPORT,currentSourceDefinition,currentSourcePriorPatch} from './currentSourceCatalog.mjs';
export const REVIEWED_SUCCESSOR_MANIFEST=CURRENT_SOURCE_MANIFEST;
export const REVIEWED_SUCCESSOR_SUPPORT=Object.freeze([...prior.REVIEWED_SUCCESSOR_SUPPORT,...CURRENT_SOURCE_SUPPORT]);
const hash=b=>createHash('sha256').update(Buffer.from(b)).digest('hex');
export function verifyReviewedSuccessorCatalog(read,mode){
 assert.equal(mode(CURRENT_SOURCE_CATALOG),'100644','CURRENT_SOURCE_CATALOG_MODE');
 const c=currentSourceDefinition(read(CURRENT_SOURCE_CATALOG));
 prior.verifyReviewedSuccessorCatalogIdentity(read,mode);
 for(const row of [...c.files,...c.local_support_patch]){assert.equal(hash(read(row.path)),row.after.sha256,'INTEGRATION_SOURCE_DRIFT:'+row.path);assert.equal(mode(row.path),row.after.mode,'INTEGRATION_MODE_DRIFT:'+row.path);}
 // Only exact admitted local replacements are reflected to their immutable
 // Git before-images for the prior validator. Reread mutable bytes every time.
 prior.verifyReviewedSuccessorCatalog(path=>{
  const row=c.local_support_patch.find(r=>r.path===path);if(!row)return read(path);
  assert.equal(hash(read(path)),row.after.sha256,'INTEGRATION_SOURCE_DRIFT:'+path);assert.equal(mode(path),row.after.mode,'INTEGRATION_MODE_DRIFT:'+path);
  return currentSourcePriorPatch(path);
 },mode);
 assert.equal(hash(read(c.prior_manifest.path)),c.prior_manifest.sha256,'CURRENT_SOURCE_PRIOR_MANIFEST_DRIFT');
 assert.equal(mode(c.prior_manifest.path),'100644','CURRENT_SOURCE_PRIOR_MODE');
 for(const path of CURRENT_SOURCE_SUPPORT)assert.equal(mode(path),'100644','CURRENT_SOURCE_SUPPORT_MODE');
}
let immutablePaths;
export function reviewedSuccessorPaths(){
 if(!immutablePaths){const c=currentSourceDefinition();immutablePaths=Object.freeze([...new Set([...prior.reviewedSuccessorPaths(),...c.files.map(r=>r.path),...c.local_support_patch.map(r=>r.path),c.prior_manifest.path,CURRENT_SOURCE_CATALOG,...CURRENT_SOURCE_SUPPORT])].sort());}
 // Only immutable path metadata is retained. Live catalogs, source bytes,
 // modes and inventories are still verified by every admission invocation.
 return [...immutablePaths];
}
export function reviewedSuccessorLineage(){
 const c=currentSourceDefinition();return {...prior.reviewedSuccessorLineage(),current_git_successor:{base:CURRENT_SOURCE_BASE,head:CURRENT_SOURCE_HEAD,
  base_tree:c.base_tree,head_tree:c.head_tree,exact_git_delta:c.files.length,prior_manifest:{...c.prior_manifest},
  catalog:{path:CURRENT_SOURCE_CATALOG,sha256:CURRENT_SOURCE_CATALOG_SHA256},scope_review:structuredClone(c.scope_review),local_support_patch:structuredClone(c.local_support_patch),support_paths:[...CURRENT_SOURCE_SUPPORT],...c.authority}};
}
export function applyReviewedSuccessor(expected,historicalSupport=[]){
 prior.applyReviewedSuccessor(expected,historicalSupport);const c=currentSourceDefinition();
 for(const row of [...c.files,...c.local_support_patch]){
  assert.equal(expected.get(row.path)?.sha256??null,row.before?.sha256??null,'CURRENT_SOURCE_BEFORE_COMPOSITION:'+row.path);
  assert.equal(expected.get(row.path)?.mode??null,row.before?.mode??null,'CURRENT_SOURCE_BEFORE_MODE:'+row.path);
  expected.set(row.path,{sha256:row.after.sha256,mode:row.after.mode});
 }
 assert(!expected.has(c.prior_manifest.path));expected.set(c.prior_manifest.path,{sha256:c.prior_manifest.sha256,mode:'100644'});
 assert(!expected.has(CURRENT_SOURCE_CATALOG));expected.set(CURRENT_SOURCE_CATALOG,{sha256:CURRENT_SOURCE_CATALOG_SHA256,mode:'100644'});
 for(const p of REVIEWED_SUCCESSOR_SUPPORT)expected.delete(p);
}

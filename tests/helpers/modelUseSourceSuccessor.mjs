// Verify the complete new physical tree before entering older pinned views.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstatSync} from 'node:fs';
import * as prior from './ciShardSourceSuccessor.mjs';
import {readRecoveryRegularFile} from './recoverySourceSuccessor.mjs';
import {ciShardSourceDefinition} from './ciShardSourceCatalog.mjs';
import {MODEL_USE_SOURCE_BASE,MODEL_USE_SOURCE_HEAD,MODEL_USE_SOURCE_CATALOG,MODEL_USE_SOURCE_CATALOG_SHA256,MODEL_USE_SOURCE_MANIFEST,MODEL_USE_SOURCE_SUPPORT,modelUseSourceDefinition,modelUseSourcePriorPatch} from './modelUseSourceCatalog.mjs';
export const REVIEWED_SUCCESSOR_MANIFEST=MODEL_USE_SOURCE_MANIFEST;
export const REVIEWED_SUCCESSOR_SUPPORT=Object.freeze([...prior.REVIEWED_SUCCESSOR_SUPPORT,...MODEL_USE_SOURCE_SUPPORT]);
const root=new URL('../../',import.meta.url),hash=b=>createHash('sha256').update(Buffer.from(b)).digest('hex');
const changed=path=>{const c=modelUseSourceDefinition();return [...c.files,...c.local_support_patch].find(row=>row.path===path);};
export function modelUsePriorRead(path,bytes){
 const row=changed(path);if(!row?.before||bytes===null||bytes===undefined)return bytes;
 if(typeof bytes==='string'&&Buffer.from(bytes).toString('utf8')!==bytes)return bytes;
 if(hash(bytes)!==row.after.sha256)return bytes;
 const st=lstatSync(new URL(path,root));assert(st.isFile()&&!st.isSymbolicLink(),'MODEL_USE_SOURCE_REGULAR_FILE:'+path);
 assert.equal(st.mode&0o111?'100755':'100644',row.after.mode,'MODEL_USE_SOURCE_CHANGED_MODE:'+path);
 assert.equal(hash(readRecoveryRegularFile(path)),row.after.sha256,'MODEL_USE_SOURCE_CHANGED_AFTER_ADMISSION:'+path);
 const before=modelUseSourcePriorPatch(path);return typeof bytes==='string'?before.toString('utf8'):before;
}
const modelPhysicalBefore=path=>modelUsePriorRead(path,readRecoveryRegularFile(path));
export function ciShardPriorRead(path,bytes){
 const reflected=modelUsePriorRead(path,bytes);if(changed(path)&&reflected===bytes)return bytes;
 return prior.ciShardPriorReadWithVerifiedPhysical(path,reflected,modelPhysicalBefore);
}
export function recoveryPriorRead(path,bytes){
 const reflected=modelUsePriorRead(path,bytes);if(changed(path)&&reflected===bytes)return bytes;
 return prior.recoveryPriorReadWithVerifiedPhysical(path,reflected,modelPhysicalBefore);
}
export function verifyReviewedSuccessorCatalog(read,mode){
 readRecoveryRegularFile(MODEL_USE_SOURCE_CATALOG);assert.equal(mode(MODEL_USE_SOURCE_CATALOG),'100644','MODEL_USE_SOURCE_CATALOG_MODE');
 const c=modelUseSourceDefinition(read(MODEL_USE_SOURCE_CATALOG));
 // Check the older immutable catalog identity before comparing shared bodies.
 // This validates metadata only; it does not admit any current source image.
 ciShardSourceDefinition(read(c.prior_catalog.path));
 for(const row of [...c.files,...c.local_support_patch]){
  const prefix=prior.REVIEWED_SUCCESSOR_SUPPORT.includes(row.path)?'SUCCESSOR_SUPPORT_SOURCE_DRIFT:':'INTEGRATION_SOURCE_DRIFT:';
  assert.equal(hash(read(row.path)),row.after.sha256,prefix+row.path);assert.equal(hash(readRecoveryRegularFile(row.path)),row.after.sha256,prefix+row.path);
  assert.equal(mode(row.path),row.after.mode,'INTEGRATION_MODE_DRIFT:'+row.path);
 }
 prior.verifyCiShardSuccessorWithVerifiedPhysical(path=>modelUsePriorRead(path,read(path)),mode,modelPhysicalBefore);
 for(const pin of [c.prior_manifest,c.prior_catalog]){assert.equal(hash(read(pin.path)),pin.sha256,'MODEL_USE_SOURCE_PRIOR_DRIFT:'+pin.path);assert.equal(mode(pin.path),'100644','MODEL_USE_SOURCE_PRIOR_MODE');}
 for(const path of MODEL_USE_SOURCE_SUPPORT){readRecoveryRegularFile(path);assert.equal(mode(path),'100644','MODEL_USE_SOURCE_SUPPORT_MODE');}
}
let immutablePaths;
export function reviewedSuccessorPaths(){
 if(!immutablePaths){const c=modelUseSourceDefinition();immutablePaths=Object.freeze([...new Set([...prior.reviewedSuccessorPaths(),...c.files.map(row=>row.path),...c.local_support_patch.map(row=>row.path),c.prior_manifest.path,MODEL_USE_SOURCE_CATALOG,...MODEL_USE_SOURCE_SUPPORT])].sort());}
 return [...immutablePaths];
}
export function reviewedSuccessorLineage(){
 const c=modelUseSourceDefinition();return {...prior.reviewedSuccessorLineage(),model_source_use_successor:{base:MODEL_USE_SOURCE_BASE,head:MODEL_USE_SOURCE_HEAD,base_tree:c.base_tree,head_tree:c.head_tree,exact_git_delta:c.files.length,
  prior_manifest:{...c.prior_manifest},prior_catalog:{...c.prior_catalog},catalog:{path:MODEL_USE_SOURCE_CATALOG,sha256:MODEL_USE_SOURCE_CATALOG_SHA256},scope_review:structuredClone(c.scope_review),
  files:c.files.map(row=>({path:row.path,before:row.before?{...row.before}:null,after:{...row.after}})),local_support_patch:c.local_support_patch.map(({path,before,after})=>({path,before:{...before},after:{...after}})),
  trusted_verifier_boundary:structuredClone(c.trusted_verifier_boundary),support_paths:[...MODEL_USE_SOURCE_SUPPORT],...c.authority}};
}
export function applyReviewedSuccessor(expected,historicalSupport=[]){
 prior.applyReviewedSuccessor(expected,historicalSupport);const c=modelUseSourceDefinition(),support=new Set(prior.REVIEWED_SUCCESSOR_SUPPORT);
 for(const row of [...c.files,...c.local_support_patch]){if(support.has(row.path))continue;
  assert.equal(expected.get(row.path)?.sha256??null,row.before?.sha256??null,'MODEL_USE_SOURCE_BEFORE_COMPOSITION:'+row.path);
  assert.equal(expected.get(row.path)?.mode??null,row.before?.mode??null,'MODEL_USE_SOURCE_BEFORE_MODE:'+row.path);expected.set(row.path,{sha256:row.after.sha256,mode:row.after.mode});
 }
 assert(!expected.has(c.prior_manifest.path));expected.set(c.prior_manifest.path,{sha256:c.prior_manifest.sha256,mode:'100644'});
 assert(!expected.has(MODEL_USE_SOURCE_CATALOG));expected.set(MODEL_USE_SOURCE_CATALOG,{sha256:MODEL_USE_SOURCE_CATALOG_SHA256,mode:'100644'});
 for(const path of REVIEWED_SUCCESSOR_SUPPORT)expected.delete(path);
}

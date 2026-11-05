// Exact code identity for the source-use change; never a source-use grant.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,lstatSync} from 'node:fs';
import {ciShardSourceHash} from './ciShardSourceCatalog.mjs';
export const MODEL_USE_SOURCE_BASE='25df732f369350e82054bea7ba28b2115313b0d4';
export const MODEL_USE_SOURCE_HEAD='3f84382a4fe5a3c0799f7e3a60e4dce01778b474';
export const MODEL_USE_SOURCE_CATALOG='docs/operations/evidence/model-use-source-successor-20261105-catalog.json';
export const MODEL_USE_SOURCE_CATALOG_SHA256='ab07d3985184a47115894e4e6aef5fc80628bfc1d6ffa13b8b1baa01ad788996';
export const MODEL_USE_SOURCE_MANIFEST='docs/operations/evidence/core-member-integration-20261105-model-use.json';
export const MODEL_USE_SOURCE_SUPPORT=Object.freeze(['tests/helpers/modelUseSourceCatalog.mjs','tests/helpers/modelUseSourceSuccessor.mjs','tests/modelUseSourceSuccessor.test.mjs']);
const root=new URL('../../',import.meta.url),hash=b=>createHash('sha256').update(Buffer.from(b)).digest('hex');
const git=args=>execFileSync('git',['--no-replace-objects',...args],{cwd:root,maxBuffer:32e6});
const patches=Object.freeze(['.github/workflows/vnext-candidate.yml','tests/currentSourceSuccessor.test.mjs','tests/reviewedSourceSuccessor.test.mjs','tests/officialPublicAdmission.test.mjs','tests/originalIngressAdmission.test.mjs','tests/recoverySourceSuccessor.test.mjs','tests/ciShardSourceSuccessor.test.mjs','tests/helpers/ciShardSourceSuccessor.mjs']);
const flags=['source_admission','canonical_admission','quality_approval','rights_gate_changed','publication_approval','production_authorized','thresholds_changed','existing_release_payloads_changed'];
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
function original(revision,path){
 const rows=git(['ls-tree','-z',revision,'--',path]).toString().split('\0').filter(Boolean);
 if(!rows.length)return null;assert.equal(rows.length,1);
 const [meta,name]=rows[0].split('\t'),[mode,type,oid]=meta.split(' ');assert.equal(name,path);assert.equal(mode,'100644');assert.equal(type,'blob');
 return {oid,mode,sha256:hash(git(['cat-file','blob',oid]))};
}
let immutable;
export function modelUseSourceDefinition(bytes){
 if(bytes===undefined){if(immutable)return immutable;const url=new URL(MODEL_USE_SOURCE_CATALOG,root),st=lstatSync(url);assert(st.isFile()&&!st.isSymbolicLink());bytes=readFileSync(url);}
 assert.equal(hash(bytes),MODEL_USE_SOURCE_CATALOG_SHA256,'MODEL_USE_SOURCE_CATALOG_DRIFT');
 if(!immutable){
  const c=JSON.parse(bytes);assert.equal(c.schema,'MODEL_USE_EXACT_GIT_SOURCE_SUCCESSOR_V1');assert.equal(c.base,MODEL_USE_SOURCE_BASE);assert.equal(c.head,MODEL_USE_SOURCE_HEAD);
  assert.deepEqual(git(['rev-list','--parents','-n','1',c.head]).toString().trim().split(' '),[c.head,c.base],'MODEL_USE_SOURCE_DIRECT_PARENT');
  for(const [ref,key]of [[c.base,'base_tree'],[c.head,'head_tree']])assert.equal(git(['rev-parse',ref+'^{tree}']).toString().trim(),c[key],'MODEL_USE_SOURCE_TREE');
  const paths=git(['diff','--no-renames','--name-only','-z',c.base,c.head,'--']).toString().split('\0').filter(Boolean).sort();
  assert.equal(paths.length,12);assert.deepEqual(c.files.map(row=>row.path),paths,'MODEL_USE_SOURCE_EXACT_GIT_DELTA');
  assert.equal(c.scope_review.kind,'EXACT_ENGINEERING_SOURCE_NOT_MODEL_RIGHTS_OR_RELEASE_APPROVAL');assert.equal(c.scope_review.independent_review,false);
  assert.deepEqual(Object.values(c.scope_review.groups).flat().sort(),paths,'MODEL_USE_SOURCE_REVIEW_SCOPE');
  for(const row of c.files){assert.deepEqual(row.before,original(c.base,row.path),'MODEL_USE_SOURCE_BEFORE:'+row.path);assert.deepEqual(row.after,original(c.head,row.path),'MODEL_USE_SOURCE_AFTER:'+row.path);assert(row.after,'MODEL_USE_SOURCE_DELETE_FORBIDDEN');}
  assert.deepEqual(c.local_support_patch.map(row=>row.path),patches,'MODEL_USE_SOURCE_EXACT_SUPPORT_SCOPE');
  for(const row of c.local_support_patch){
   assert(!paths.includes(row.path));assert.deepEqual(row.before,original(c.head,row.path),'MODEL_USE_SOURCE_SUPPORT_BEFORE:'+row.path);
   let text=git(['cat-file','blob',row.before.oid]).toString('utf8');assert(row.exact_edits.length>0);
   for(const edit of row.exact_edits){assert(edit.before.length>0);assert.equal(text.split(edit.before).length,2,'MODEL_USE_SOURCE_EXACT_EDIT:'+row.path);text=text.replace(edit.before,edit.after);}
   assert.deepEqual(row.after,{mode:'100644',sha256:hash(text)},'MODEL_USE_SOURCE_EXACT_SUPPORT_PATCH:'+row.path);
  }
  for(const [key,path]of [['prior_manifest','docs/operations/evidence/core-member-integration-20261105-ci-shards.json'],['prior_catalog','docs/operations/evidence/ci-shard-source-successor-20261105-catalog.json']]){assert.equal(c[key].path,path);const {path:_,...pin}=c[key];assert.deepEqual(pin,original(c.base,path),'MODEL_USE_SOURCE_PRIOR_IDENTITY');}
  assert.deepEqual(c.trusted_verifier_boundary,{path:'tests/helpers/integrationAdmission.mjs',before:original(c.base,'tests/helpers/integrationAdmission.mjs'),purpose:'APPEND_MODEL_USE_SOURCE_KEEP_ALL_PRIOR_SOURCE_PINS'});
  assert.deepEqual(Object.keys(c.authority).sort(),flags.slice().sort());for(const flag of flags)assert.equal(c.authority[flag],false,'MODEL_USE_SOURCE_AUTHORITY');
  immutable=freeze(c);
 }
 return immutable;
}
export function modelUseSourceHash(path,fallback){const c=modelUseSourceDefinition();return [...c.files,...c.local_support_patch].find(row=>row.path===path)?.after.sha256??ciShardSourceHash(path,fallback);}
const priorBytes=new Map();
export function modelUseSourcePriorPatch(path){
 const c=modelUseSourceDefinition(),row=[...c.files,...c.local_support_patch].find(row=>row.path===path);assert(row?.before,'MODEL_USE_SOURCE_PRIOR_PATCH');
 if(!priorBytes.has(path)){const bytes=git(['cat-file','blob',row.before.oid]);assert.equal(hash(bytes),row.before.sha256);priorBytes.set(path,bytes);}
 return Buffer.from(priorBytes.get(path));
}

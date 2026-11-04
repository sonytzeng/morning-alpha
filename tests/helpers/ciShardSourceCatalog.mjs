// Exact CI-only successor. No runtime caching or operational authority.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,lstatSync} from 'node:fs';
import {recoverySourceHash} from './recoverySourceCatalog.mjs';
export const CI_SHARD_SOURCE_BASE='7480821c26b35c6ac83f254e83ed786699cd6f42';
export const CI_SHARD_SOURCE_CATALOG='docs/operations/evidence/ci-shard-source-successor-20261105-catalog.json';
export const CI_SHARD_SOURCE_CATALOG_SHA256='8d33bc92a4f681c1a47e653cc8033892df958b774980dab31f3561a31daa475a';
export const CI_SHARD_SOURCE_MANIFEST='docs/operations/evidence/core-member-integration-20261105-ci-shards.json';
export const CI_SHARD_SOURCE_SUPPORT=Object.freeze(['tests/helpers/ciShardSourceCatalog.mjs','tests/helpers/ciShardSourceSuccessor.mjs','tests/ciShardSourceSuccessor.test.mjs']);
const root=new URL('../../',import.meta.url),hash=b=>createHash('sha256').update(Buffer.from(b)).digest('hex');
const git=args=>execFileSync('git',['--no-replace-objects',...args],{cwd:root,maxBuffer:32e6});
const patches=Object.freeze(['.github/workflows/vnext-candidate.yml','tests/currentSourceSuccessor.test.mjs','tests/reviewedSourceSuccessor.test.mjs','tests/officialPublicAdmission.test.mjs','tests/originalIngressAdmission.test.mjs','tests/recoverySourceSuccessor.test.mjs','tests/helpers/recoverySourceSuccessor.mjs']);
const flags=['source_admission','canonical_admission','quality_approval','rights_gate_changed','publication_approval','production_authorized','thresholds_changed','existing_release_payloads_changed'];
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
function original(path){
 const rows=git(['ls-tree','-z',CI_SHARD_SOURCE_BASE,'--',path]).toString().split('\0').filter(Boolean);assert.equal(rows.length,1);
 const [meta,name]=rows[0].split('\t'),[mode,type,oid]=meta.split(' ');assert.equal(name,path);assert.equal(mode,'100644');assert.equal(type,'blob');
 return {oid,mode,sha256:hash(git(['cat-file','blob',oid]))};
}
let immutable;
export function ciShardSourceDefinition(bytes){
 if(bytes===undefined){if(immutable)return immutable;const url=new URL(CI_SHARD_SOURCE_CATALOG,root),st=lstatSync(url);assert(st.isFile()&&!st.isSymbolicLink());bytes=readFileSync(url);}
 assert.equal(hash(bytes),CI_SHARD_SOURCE_CATALOG_SHA256,'CI_SHARD_SOURCE_CATALOG_DRIFT');
 if(!immutable){
  const c=JSON.parse(bytes);assert.equal(c.schema,'CI_SHARD_EXACT_SOURCE_SUCCESSOR_V1');assert.equal(c.base,CI_SHARD_SOURCE_BASE);
  assert.equal(git(['rev-parse',c.base+'^{tree}']).toString().trim(),c.base_tree,'CI_SHARD_SOURCE_TREE');
  assert.deepEqual(c.local_support_patch.map(r=>r.path),patches,'CI_SHARD_SOURCE_EXACT_PATCH_SCOPE');
  assert.equal(c.scope_review.kind,'CI_EXECUTION_TOPOLOGY_AND_ENGINEERING_SOURCE_ONLY');assert.equal(c.scope_review.independent_review,false);
  assert.deepEqual(Object.values(c.scope_review.groups).flat().sort(),patches.slice().sort(),'CI_SHARD_SOURCE_REVIEW_SCOPE');
  for(const row of c.local_support_patch){
   assert.deepEqual(row.before,original(row.path),'CI_SHARD_SOURCE_BEFORE:'+row.path);let text=git(['cat-file','blob',row.before.oid]).toString('utf8');
   assert(row.exact_edits.length>0);for(const edit of row.exact_edits){assert(edit.before.length>0);assert.equal(text.split(edit.before).length,2,'CI_SHARD_SOURCE_EXACT_EDIT:'+row.path);text=text.replace(edit.before,edit.after);}
   assert.deepEqual(row.after,{mode:'100644',sha256:hash(text)},'CI_SHARD_SOURCE_EXACT_PATCH:'+row.path);
  }
  for(const [key,path]of [['prior_manifest','docs/operations/evidence/core-member-integration-20261105-recovery-source.json'],['prior_catalog','docs/operations/evidence/recovery-source-successor-20261105-catalog.json']]){
   assert.equal(c[key].path,path);const {path:_,...pin}=c[key];assert.deepEqual(pin,original(path),'CI_SHARD_SOURCE_PRIOR_IDENTITY');
  }
  assert.deepEqual(c.trusted_verifier_boundary,{path:'tests/helpers/integrationAdmission.mjs',before:original('tests/helpers/integrationAdmission.mjs'),purpose:'SWITCH_DEFAULT_SUCCESSOR_KEEP_ALL_PRIOR_PINS_NO_RUNTIME_SCOPE_CACHE'});
  assert.deepEqual(Object.keys(c.authority).sort(),flags.slice().sort());for(const flag of flags)assert.equal(c.authority[flag],false,'CI_SHARD_SOURCE_AUTHORITY');
  immutable=freeze(c);
 }
 return immutable;
}
export function ciShardSourceHash(path,fallback){return ciShardSourceDefinition().local_support_patch.find(r=>r.path===path)?.after.sha256??recoverySourceHash(path,fallback);}
const priorBytes=new Map();
export function ciShardSourcePriorPatch(path){
 const row=ciShardSourceDefinition().local_support_patch.find(r=>r.path===path);assert(row?.before,'CI_SHARD_SOURCE_EXACT_PRIOR_PATCH');
 if(!priorBytes.has(path)){const bytes=git(['cat-file','blob',row.before.oid]);assert.equal(hash(bytes),row.before.sha256);priorBytes.set(path,bytes);}
 return Buffer.from(priorBytes.get(path));
}

import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {LINE_USABILITY_BASE,lineUsabilityAwareReader} from './lineFinalUsabilityIntegrity.mjs';
export const LINE_COPY_BASE='09b0d96052c6ba698b8a69eb9a5112f93e300385';
export const LINE_COPY_MANIFEST='docs/operations/evidence/line-final-copy-transition.json';
export const LINE_COPY_PATHS=[
 'docs/operations/line-final-copy.md',
 'src/features/line/decisionCard.ts',
 'src/pages/admin/analysis/LineDecisionPreview.tsx',
 'tests/helpers/lineDecisionIntegrity.mjs',
 'tests/helpers/lineFinalCopyIntegrity.mjs',
 'tests/lineDecisionCardV2.test.mjs',
 'tests/lineDecisionFinalCopy.test.mjs',
 'tests/lineFinalCopyIntegrity.test.mjs',
].sort();
const root=fileURLToPath(new URL('../../',import.meta.url)),read=p=>readFileSync(new URL('../../'+p,import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex'),cache=new Map(),restored=new WeakSet();
export function lineCopyPrior(p){
 if(!cache.has(p)){
  const exists=execFileSync('git',['ls-tree','--name-only',LINE_COPY_BASE,'--',p],{cwd:root,encoding:'utf8'}).trim();
  cache.set(p,exists?execFileSync('git',['show',LINE_COPY_BASE+':'+p],{cwd:root,maxBuffer:16*1024*1024}):null);
 }
 return cache.get(p);
}
export function lineCopyTransition(source=read){
 source=lineUsabilityAwareReader(source);
 const m=JSON.parse(source(LINE_COPY_MANIFEST));assert.equal(m.schema_version,'LINE_FINAL_COPY_OWNER_PREVIEW_V1');
 assert.equal(m.base,LINE_COPY_BASE);assert.deepEqual(m.files.map(r=>r.path).sort(),LINE_COPY_PATHS);
 for(const k of ['function_deploy','migration','cron','auth_change','rls_change','secret_change','member_template_promotion','v2_promotion','production_data_write','line_send'])assert.equal(m[k],false,k);
 assert.equal(m.recommendation_source,'PRODUCTION_V1');assert.equal(m.sony_line_usability,'PENDING');
 const predecessor='docs/operations/evidence/line-decision-card-v2-transition.json';
 assert.equal(hash(source(predecessor)),hash(lineCopyPrior(predecessor)),'immutable PR210 baseline');
 assert.equal(m.predecessor_sha256,hash(lineCopyPrior(predecessor)));
 const before=new Map();
 for(const r of m.files){const b=lineCopyPrior(r.path);assert.equal(r.operation,b===null?'ADD':'MODIFY');assert.equal(r.predecessor_sha256,b===null?null:hash(b));
  assert.equal(hash(source(r.path)),r.candidate_sha256,'unreviewed candidate drift (final copy): '+r.path);before.set(r.path,b);}
 const predecessorRead=p=>{if(p===LINE_COPY_MANIFEST)throw Object.assign(Error('absent predecessor'),{code:'ENOENT'});if(!before.has(p))return source(p);const b=before.get(p);if(b===null)throw Object.assign(Error('absent predecessor'),{code:'ENOENT'});return b;};
 restored.add(predecessorRead);return {manifest:m,predecessorRead};
}
export function lineCopyAwareReader(source=read){
 if(restored.has(source))return source;
 try{source(LINE_COPY_MANIFEST);}catch(e){if(e.code==='ENOENT')return source;throw e;}
 return lineCopyTransition(source).predecessorRead;
}
export function lineCopyChangedPaths(){return execFileSync('git',['diff','--name-only','-z',LINE_COPY_BASE,LINE_USABILITY_BASE,'--'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean).sort();}

import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {LINE_COMPACT_BASE,lineCompactAwareReader} from './lineCompactIntegrity.mjs';
export const LINE_USABILITY_BASE='d849c28893371dd7e07de597123de569f45fc7c3';
export const LINE_USABILITY_MANIFEST='docs/operations/evidence/line-final-usability-transition.json';
export const LINE_USABILITY_PATHS=[
 'docs/operations/line-final-usability.md',
 'src/features/line/decisionCard.ts',
 'src/pages/admin/analysis/LineDecisionPreview.tsx',
 'tests/helpers/lineFinalCopyIntegrity.mjs',
 'tests/helpers/lineFinalUsabilityIntegrity.mjs',
 'tests/lineDecisionFinalCopy.test.mjs',
 'tests/lineFinalUsability.test.mjs',
 'tests/lineFinalUsabilityIntegrity.test.mjs',
].sort();
const root=fileURLToPath(new URL('../../',import.meta.url)),read=p=>readFileSync(new URL('../../'+p,import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex'),cache=new Map(),restored=new WeakSet();
export function lineUsabilityPrior(p){
 if(!cache.has(p)){
  const exists=execFileSync('git',['ls-tree','--name-only',LINE_USABILITY_BASE,'--',p],{cwd:root,encoding:'utf8'}).trim();
  cache.set(p,exists?execFileSync('git',['show',LINE_USABILITY_BASE+':'+p],{cwd:root,maxBuffer:16*1024*1024}):null);
 }
 return cache.get(p);
}
export function lineUsabilityTransition(source=read){
 source=lineCompactAwareReader(source);
 const m=JSON.parse(source(LINE_USABILITY_MANIFEST));assert.equal(m.schema_version,'LINE_FINAL_USABILITY_OWNER_PREVIEW_V1');
 assert.equal(m.base,LINE_USABILITY_BASE);assert.deepEqual(m.files.map(r=>r.path).sort(),LINE_USABILITY_PATHS);
 for(const k of ['function_deploy','migration','cron','auth_change','rls_change','secret_change','member_template_promotion','v2_promotion','production_data_write','line_send'])assert.equal(m[k],false,k);
 assert.equal(m.recommendation_source,'PRODUCTION_V1');assert.equal(m.sony_line_usability,'PENDING');
 const predecessor='docs/operations/evidence/line-final-copy-transition.json';
 assert.equal(hash(source(predecessor)),hash(lineUsabilityPrior(predecessor)),'immutable PR211 baseline');
 assert.equal(m.predecessor_sha256,hash(lineUsabilityPrior(predecessor)));
 const before=new Map();
 for(const r of m.files){const b=lineUsabilityPrior(r.path);assert.equal(r.operation,b===null?'ADD':'MODIFY');assert.equal(r.predecessor_sha256,b===null?null:hash(b));
  assert.equal(hash(source(r.path)),r.candidate_sha256,'unreviewed candidate drift (final usability): '+r.path);before.set(r.path,b);}
 const predecessorRead=p=>{if(p===LINE_USABILITY_MANIFEST)throw Object.assign(Error('absent predecessor'),{code:'ENOENT'});if(!before.has(p))return source(p);const b=before.get(p);if(b===null)throw Object.assign(Error('absent predecessor'),{code:'ENOENT'});return b;};
 restored.add(predecessorRead);return {manifest:m,predecessorRead};
}
export function lineUsabilityAwareReader(source=read){
 if(restored.has(source))return source;
 try{source(LINE_USABILITY_MANIFEST);}catch(e){if(e.code==='ENOENT')return source;throw e;}
 return lineUsabilityTransition(source).predecessorRead;
}
export function lineUsabilityChangedPaths(){return execFileSync('git',['diff','--name-only','-z',LINE_USABILITY_BASE,LINE_COMPACT_BASE,'--'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean).sort();}

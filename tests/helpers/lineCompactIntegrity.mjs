import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const LINE_COMPACT_BASE='50a6e3b248c768d275a1950d1aaa4da7db346fd7';
export const LINE_COMPACT_MANIFEST='tests/fixtures/line-compact-transition.json';
export const LINE_COMPACT_PATHS=[
 'src/features/line/decisionCard.ts',
 'src/pages/admin/analysis/LineDecisionPreview.tsx',
 'tests/helpers/lineFinalUsabilityIntegrity.mjs',
 'tests/helpers/lineCompactIntegrity.mjs',
 'tests/lineDecisionCardV2.test.mjs',
 'tests/lineDecisionFinalCopy.test.mjs',
 'tests/lineFinalUsability.test.mjs',
 'tests/lineCompactCopy.test.mjs',
].sort();
const root=fileURLToPath(new URL('../../',import.meta.url)),read=p=>readFileSync(new URL('../../'+p,import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex'),cache=new Map(),restored=new WeakSet();
export function lineCompactPrior(p){
 if(!cache.has(p)){
  const exists=execFileSync('git',['ls-tree','--name-only',LINE_COMPACT_BASE,'--',p],{cwd:root,encoding:'utf8'}).trim();
  cache.set(p,exists?execFileSync('git',['show',LINE_COMPACT_BASE+':'+p],{cwd:root,maxBuffer:16*1024*1024}):null);
 }
 return cache.get(p);
}
export function lineCompactTransition(source=read){
 const m=JSON.parse(source(LINE_COMPACT_MANIFEST));assert.equal(m.schema_version,'LINE_COMPACT_OWNER_PREVIEW_V1');
 assert.equal(m.base,LINE_COMPACT_BASE);assert.deepEqual(m.files.map(r=>r.path).sort(),LINE_COMPACT_PATHS);
 for(const k of ['function_deploy','migration','cron','auth_change','rls_change','secret_change','member_template_promotion','v2_promotion','production_data_write','line_send'])assert.equal(m[k],false,k);
 assert.equal(m.recommendation_source,'PRODUCTION_V1');assert.equal(m.sony_line_usability,'PENDING');
 const predecessor='docs/operations/evidence/line-final-usability-transition.json';
 assert.equal(hash(source(predecessor)),hash(lineCompactPrior(predecessor)),'immutable PR212 baseline');
 assert.equal(m.predecessor_sha256,hash(lineCompactPrior(predecessor)));
 const before=new Map();
 for(const r of m.files){const b=lineCompactPrior(r.path);assert.equal(r.operation,b===null?'ADD':'MODIFY');assert.equal(r.predecessor_sha256,b===null?null:hash(b));
  assert.equal(hash(source(r.path)),r.candidate_sha256,'unreviewed candidate drift (compact copy): '+r.path);before.set(r.path,b);}
 const predecessorRead=p=>{if(p===LINE_COMPACT_MANIFEST)throw Object.assign(Error('absent predecessor'),{code:'ENOENT'});if(!before.has(p))return source(p);const b=before.get(p);if(b===null)throw Object.assign(Error('absent predecessor'),{code:'ENOENT'});return b;};
 restored.add(predecessorRead);return {manifest:m,predecessorRead};
}
export function lineCompactAwareReader(source=read){
 if(restored.has(source))return source;
 try{source(LINE_COMPACT_MANIFEST);}catch(e){if(e.code==='ENOENT')return source;throw e;}
 return lineCompactTransition(source).predecessorRead;
}
export function lineCompactChangedPaths(){const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);return [...new Set([...git(['diff','--name-only','-z',LINE_COMPACT_BASE,'--']),...git(['ls-files','--others','--exclude-standard','-z'])])].sort();}

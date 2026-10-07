import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const LINE_CARD_BASE='9fba2d6ea5caa06046b76ba10eaab79d5a3f5088';
export const LINE_CARD_MANIFEST='docs/operations/evidence/line-decision-card-v2-transition.json';
export const LINE_CARD_PATHS=[
 'docs/operations/line-decision-card-v2.md',
 'src/features/line/decisionCard.ts',
 'src/pages/admin/analysis/LineDecisionPreview.tsx',
 'src/pages/admin/analysis/page.tsx',
 'tests/browser/lineDecision.vite.ts',
 'tests/browser/lineDecisionHarness.tsx',
 'tests/browser/lineDecisionMock.ts',
 'tests/helpers/lineDecisionFixture.mjs',
 'tests/helpers/lineDecisionReplay.mjs',
 'tests/helpers/lineDecisionIntegrity.mjs',
 'tests/helpers/recommendationV2ForwardIntegrity.mjs',
 'tests/lineDecisionCardV2.test.mjs',
 'tests/lineDecisionIntegrity.test.mjs',
 'tests/analysisIntelligenceUI.test.mjs',
 'tests/ownerAccountAnalysisNavigation.test.mjs',
 'tests/recommendationV2ForwardIntegrity.test.mjs',
].sort();
const root=fileURLToPath(new URL('../../',import.meta.url)),read=p=>readFileSync(new URL('../../'+p,import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex'),cache=new Map(),restored=new WeakSet();
export function lineCardPrior(p){
 if(!cache.has(p)){
  const exists=execFileSync('git',['ls-tree','--name-only',LINE_CARD_BASE,'--',p],{cwd:root,encoding:'utf8'}).trim();
  cache.set(p,exists?execFileSync('git',['show',LINE_CARD_BASE+':'+p],{cwd:root,maxBuffer:16*1024*1024}):null);
 }
 return cache.get(p);
}
export function lineCardTransition(source=read){
 const m=JSON.parse(source(LINE_CARD_MANIFEST));assert.equal(m.schema_version,'LINE_DECISION_CARD_OWNER_PREVIEW_V1');
 assert.equal(m.base,LINE_CARD_BASE);assert.deepEqual(m.files.map(r=>r.path).sort(),LINE_CARD_PATHS);
 for(const k of ['function_deploy','migration','cron','auth_change','rls_change','secret_change','member_template_promotion','v2_promotion','production_data_write','line_send'])assert.equal(m[k],false,k);
 assert.equal(m.recommendation_source,'PRODUCTION_V1');assert.equal(m.sony_line_usability,'PENDING');
 const predecessor='docs/10k-program/recommendation-v2-forward-transition.json';
 assert.equal(hash(source(predecessor)),hash(lineCardPrior(predecessor)),'sealed Forward manifest unchanged');
 assert.equal(m.predecessor_sha256,hash(lineCardPrior(predecessor)));
 const before=new Map();
 for(const r of m.files){const b=lineCardPrior(r.path);assert.equal(r.operation,b===null?'ADD':'MODIFY');assert.equal(r.predecessor_sha256,b===null?null:hash(b));
  assert.equal(hash(source(r.path)),r.candidate_sha256,'unreviewed candidate drift (LINE preview): '+r.path);before.set(r.path,b);}
 const predecessorRead=p=>{if(p===LINE_CARD_MANIFEST)throw Object.assign(Error('absent predecessor'),{code:'ENOENT'});if(!before.has(p))return source(p);const b=before.get(p);if(b===null)throw Object.assign(Error('absent predecessor'),{code:'ENOENT'});return b;};
 restored.add(predecessorRead);return {manifest:m,predecessorRead};
}
export function lineCardAwareReader(source=read){
 if(restored.has(source))return source;
 try{source(LINE_CARD_MANIFEST);}catch(e){if(e.code==='ENOENT')return source;throw e;}
 return lineCardTransition(source).predecessorRead;
}
export function lineCardChangedPaths(){const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);return [...new Set([...git(['diff','--name-only','-z',LINE_CARD_BASE,'--']),...git(['ls-files','--others','--exclude-standard','-z'])])].sort();}

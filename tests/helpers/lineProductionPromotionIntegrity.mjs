import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {OWNER_BACKEND_BASE,ownerBackendAwareReader} from './ownerBackendIntegrity.mjs';
export const LINE_PROMOTION_BASE='8be2d3a575b9a3813eb1919b77a7e1f9a0755e53';
export const LINE_PROMOTION_MANIFEST='tests/fixtures/line-v659-promotion-transition.json';
export const LINE_PROMOTION_PATHS=[
 "docs/operations/line-v659-production-promotion.md",
 "src/features/line/decisionCard.ts",
 "supabase/functions/_shared/line-decision-card-v659.ts",
 "supabase/functions/_shared/line-production-template.ts",
 "supabase/functions/line-daily-push/index.ts",
 "tests/consolidationLineProjection.test.mjs",
 "tests/fixtures/line-v659-real-replay-receipt.json",
 "tests/helpers/lineCompactIntegrity.mjs",
 "tests/helpers/lineProductionPromotionIntegrity.mjs",
 "tests/lineCompactCopy.test.mjs",
 "tests/lineDecisionIntegrity.test.mjs",
 "tests/lineFinalCopyIntegrity.test.mjs",
 "tests/lineFinalUsabilityIntegrity.test.mjs",
 "tests/lineProductionPromotion.test.mjs",
 "tests/lineProductionPromotionIntegrity.test.mjs",
 "tests/lineProductionRealReplay.mjs",
 "tests/marketPublicationDelivery.test.mjs",
 "tests/productContract.test.mjs",
 "tests/publicRelease.test.mjs",
 "tests/recommendationV2ForwardIntegrity.test.mjs"
];
const root=fileURLToPath(new URL('../../',import.meta.url)),read=p=>readFileSync(new URL('../../'+p,import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex'),cache=new Map(),restored=new WeakSet();
export function linePromotionPrior(p){
 if(!cache.has(p)){
  const exists=execFileSync('git',['ls-tree','--name-only',LINE_PROMOTION_BASE,'--',p],{cwd:root,encoding:'utf8'}).trim();
  cache.set(p,exists?execFileSync('git',['show',LINE_PROMOTION_BASE+':'+p],{cwd:root,maxBuffer:16*1024*1024}):null);
 }return cache.get(p);
}
export function linePromotionTransition(source=read){
 source=ownerBackendAwareReader(source);
 const m=JSON.parse(source(LINE_PROMOTION_MANIFEST));assert.equal(m.schema_version,'LINE_V659_MEMBER_TEMPLATE_PROMOTION_V1');
 assert.equal(m.base,LINE_PROMOTION_BASE);assert.deepEqual(m.files.map(r=>r.path).sort(),LINE_PROMOTION_PATHS);
 assert.deepEqual(m.functions,['line-daily-push']);
 for(const k of ['migration','cron','auth_change','rls_change','secret_change','v2_promotion','production_data_write','manual_line_send'])assert.equal(m[k],false,k);
 assert.equal(m.member_template_promotion,true);assert.equal(m.recommendation_source,'PRODUCTION_V1');assert.equal(m.sony_line_usability,'PASS');
 const predecessor='tests/fixtures/line-compact-transition.json';
 assert.equal(hash(source(predecessor)),hash(linePromotionPrior(predecessor)),'immutable PR214 baseline');
 assert.equal(m.predecessor_sha256,hash(linePromotionPrior(predecessor)));
 const before=new Map();
 for(const r of m.files){const b=linePromotionPrior(r.path);assert.equal(r.operation,b===null?'ADD':'MODIFY');assert.equal(r.predecessor_sha256,b===null?null:hash(b));
  assert.equal(hash(source(r.path)),r.candidate_sha256,'unreviewed candidate drift (V659 promotion): '+r.path);before.set(r.path,b);}
 const predecessorRead=p=>{if(p===LINE_PROMOTION_MANIFEST)throw Object.assign(Error('absent predecessor'),{code:'ENOENT'});if(!before.has(p))return source(p);const b=before.get(p);if(b===null)throw Object.assign(Error('absent predecessor'),{code:'ENOENT'});return b;};
 restored.add(predecessorRead);return {manifest:m,predecessorRead};
}
export function linePromotionAwareReader(source=read){
 if(restored.has(source))return source;
 try{source(LINE_PROMOTION_MANIFEST);}catch(e){if(e.code==='ENOENT')return source;throw e;}
 return linePromotionTransition(source).predecessorRead;
}
export function linePromotionChangedPaths(){return execFileSync('git',['diff','--name-only','-z',LINE_PROMOTION_BASE,OWNER_BACKEND_BASE,'--'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean).sort();}

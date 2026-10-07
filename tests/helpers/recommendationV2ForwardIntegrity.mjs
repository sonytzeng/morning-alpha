import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {lineCardAwareReader} from './lineDecisionIntegrity.mjs';
export const V2_FORWARD_BASE='10208c0817718d29f9f86284c32cff5c3ffb39e6';
export const V2_FORWARD_MANIFEST='docs/10k-program/recommendation-v2-forward-transition.json';
export const V2_FORWARD_PATHS=[
 '.github/workflows/recommendation-v2-shadow.yml',
 'docs/10k-program/recommendation-v2-forward-design.md',
 'docs/10k-program/recommendation-v2-universe-candidate.md',
 'scripts/audit-v2-universe.mjs',
 'src/features/research/recommendation-shadow-v2-summary.ts',
 'src/features/research/recommendation-v2-forward.ts',
 'src/features/research/tradingLab.ts',
 'src/pages/admin/analysis/ForwardBrief.tsx',
 'src/pages/admin/analysis/OwnerExperiment.tsx',
 'src/pages/admin/analysis/RecommendationShadow.tsx',
 'src/pages/admin/analysis/TradingLab.tsx',
 'supabase/functions/_shared/recommendation-producer.ts',
 'supabase/functions/_shared/recommendation-shadow-v2-runtime.ts',
 'supabase/functions/_shared/recommendation-v2-acquisition-cache.ts',
 'supabase/functions/_shared/recommendation-v2-forward-outcomes.ts',
 'supabase/functions/_shared/recommendation-v2-forward-trigger.ts',
 'supabase/functions/fetch-market-data-v10/index.ts',
 'supabase/functions/generate-daily-report-v7/index.ts',
 'supabase/functions/owner-trading-lab-v1/index.ts',
 'supabase/functions/recommendation-stock-evidence-v1/index.ts',
 'supabase/functions/recommendation-v2-forward-worker-v1/index.ts',
 'supabase/migrations/20261007125316_recommendation_v2_forward_lifecycle.sql',
 'tests/browser/recommendationV2.e2e.mjs',
 'tests/browser/recommendationV2.vite.ts',
 'tests/browser/recommendationV2SupabaseMock.ts',
 'tests/helpers/premarketAtomicReadinessIntegrity.mjs',
 'tests/helpers/recommendationV2ForwardIntegrity.mjs',
 'tests/helpers/recommendationV2RuntimeIntegrity.mjs',
 'tests/ownerTradingLabUI.test.mjs',
 'tests/recommendationProducer.test.mjs',
 'tests/recommendationV2Forward.test.mjs',
 'tests/recommendationV2ForwardDatabase.integration.mjs',
 'tests/recommendationV2ForwardHandler.test.mjs',
 'tests/recommendationV2ForwardIntegrity.test.mjs',
 'tests/recommendationV2ForwardOutcomes.test.mjs',
 'tests/recommendationV2FugleRuntime.test.mjs',
 'tests/recommendationV2Prospective.test.mjs',
 'tests/recommendationV2RuntimeIntegrity.test.mjs',
 'tests/recommendationV2UI.test.mjs',
].sort();
export const V2_FORWARD_FUNCTIONS=['fetch-market-data-v10','generate-daily-report-v7','owner-trading-lab-v1','recommendation-stock-evidence-v1','recommendation-v2-forward-worker-v1'];
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(new URL('../../'+p,import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex'),priorCache=new Map(),restored=new WeakSet();
export function forwardPrior(p){if(!priorCache.has(p)){const exists=execFileSync('git',['ls-tree','--name-only',V2_FORWARD_BASE,'--',p],{cwd:root,encoding:'utf8'}).trim();priorCache.set(p,exists?execFileSync('git',['show',V2_FORWARD_BASE+':'+p],{cwd:root,maxBuffer:16*1024*1024}):null);}return priorCache.get(p);}
export function v2ForwardTransition(source=read){
 source=lineCardAwareReader(source);
 const m=JSON.parse(source(V2_FORWARD_MANIFEST));
 assert.equal(m.schema_version,'RECOMMENDATION_V2_FORWARD_TRANSITION_V1');assert.equal(m.base,V2_FORWARD_BASE);
 assert.deepEqual(m.files.map(r=>r.path).sort(),V2_FORWARD_PATHS,'exact named Forward candidate set');
 assert.deepEqual(m.functions,V2_FORWARD_FUNCTIONS);assert.deepEqual(m.migrations,['20261007125316_recommendation_v2_forward_lifecycle.sql']);
 for(const k of ['new_secrets','cron_changes','core_auth_changes','rls_policy_changes','v1_threshold_changes','promotion','member_access','business_backfill'])assert.equal(m[k],false,k);
 assert.equal(m.engine_sha256,'5d934bb7c2be21ff66a0043a945b0d91edcbeb2a57166882715e8813da31766e');
 assert.equal(hash(source('supabase/functions/_shared/recommendation-shadow-v2-engine.ts')),m.engine_sha256,'unreviewed candidate drift: frozen methodology');
 const predecessor='docs/10k-program/recommendation-v2-runtime-transition.json';
 assert.equal(hash(source(predecessor)),hash(forwardPrior(predecessor)),'sealed runtime manifest remains byte-identical');
 assert.equal(m.predecessor_sha256,hash(forwardPrior(predecessor)));
 const hashes=new Map(),before=new Map();
 for(const row of m.files){const b=forwardPrior(row.path);assert.equal(row.operation,b===null?'ADD':'MODIFY');assert.equal(row.predecessor_sha256,b===null?null:hash(b));assert.equal(hash(source(row.path)),row.candidate_sha256,'unreviewed candidate drift (Forward): '+row.path);hashes.set(row.path,row.candidate_sha256);before.set(row.path,b);}
 const predecessorRead=p=>{if(p===V2_FORWARD_MANIFEST)throw Object.assign(Error('not in Forward predecessor'),{code:'ENOENT'});if(!before.has(p))return source(p);const b=before.get(p);if(b===null)throw Object.assign(Error('not in Forward predecessor'),{code:'ENOENT'});return b;};
 restored.add(predecessorRead);return {manifest:m,hashes,predecessorRead};
}
// Historical synthetic readers may deliberately predate this successor. The
// release entry point always calls v2ForwardTransition first and cannot omit it.
export function forwardAwareReader(source=read){
 if(restored.has(source))return source;
 try{source(V2_FORWARD_MANIFEST);}catch(e){if(e.code==='ENOENT')return source;throw e;}
 return v2ForwardTransition(source).predecessorRead;
}
export function forwardChangedPaths(){const git=a=>execFileSync('git',a,{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);return [...new Set([...git(['diff','--name-only','-z',V2_FORWARD_BASE,'--']),...git(['ls-files','--others','--exclude-standard','-z'])])].sort();}

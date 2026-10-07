import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const V2_BASE='b00856329d8edd5467c9470cb147c85b8819908c';
export const V2_MANIFEST='docs/10k-program/recommendation-v2-shadow-transition.json';
export const V2_PATHS=[
 '.github/workflows/recommendation-v2-shadow.yml',
 'docs/10k-program/recommendation-v2-shadow-design.md',
 'docs/10k-program/recommendation-v2-source-observation.json',
 'src/pages/admin/analysis/RecommendationShadow.tsx',
 'src/pages/admin/analysis/page.tsx',
 'supabase/functions/_shared/recommendation-shadow-v2-engine.ts',
 'supabase/functions/_shared/recommendation-shadow-v2-outcomes.ts',
 'supabase/functions/_shared/recommendation-shadow-v2-runtime.ts',
 'supabase/functions/_shared/recommendation-shadow-v2-sources.ts',
 'supabase/functions/_shared/recommendation-shadow-v2-summary.ts',
 'supabase/functions/generate-daily-report-v7/index.ts',
 'supabase/functions/recommendation-stock-evidence-v1/index.ts',
 'supabase/migrations/20261007092045_recommendation_v2_owner_shadow.sql',
 'tests/browser/recommendationV2.e2e.mjs',
 'tests/analysisIntelligenceUI.test.mjs',
 'tests/browser/recommendationV2.vite.ts',
 'tests/browser/recommendationV2Harness.tsx',
 'tests/browser/recommendationV2SupabaseMock.ts',
 'tests/helpers/premarketAtomicReadinessIntegrity.mjs',
 'tests/helpers/recommendationCompletedCloseIntegrity.mjs',
 'tests/helpers/recommendationV2Fixtures.mjs',
 'tests/helpers/recommendationV2Integrity.mjs',
 'tests/recommendationCompletedCloseIntegrity.test.mjs',
 'tests/recommendationGatewayIntegrity.test.mjs',
 'tests/ownerAccountAnalysisNavigation.test.mjs',
 'tests/recommendationV2Database.integration.mjs',
 'tests/recommendationV2Integrity.test.mjs',
 'tests/recommendationV2Prospective.test.mjs',
 'tests/recommendationV2Runtime.test.mjs',
 'tests/recommendationV2UI.test.mjs'
].sort();
const paths=new Set(V2_PATHS),root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(new URL('../../'+p,import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex'),cache=new Map();
function prior(path){if(!cache.has(path)){let b=null;try{b=execFileSync('git',['show',V2_BASE+':'+path],{cwd:root,stdio:['ignore','pipe','pipe']});}catch(e){if(e.status!==128)throw e;}cache.set(path,b);}return cache.get(path);}
function manifest(readSource){
 const m=JSON.parse(readSource(V2_MANIFEST));assert.equal(m.schema_version,'RECOMMENDATION_V2_SHADOW_TRANSITION_V1');assert.equal(m.candidate_base_git_sha,V2_BASE);
 assert.deepEqual(m.files.map(r=>r.path).sort(),V2_PATHS,'exact reviewed Shadow candidate set');
 assert.deepEqual(m.functions,['generate-daily-report-v7','recommendation-stock-evidence-v1']);
 assert.deepEqual(m.migrations,['20261007092045_recommendation_v2_owner_shadow.sql']);assert.deepEqual(m.new_secret_names,[]);
 for(const k of ['core_auth_change','core_rls_change','cron_change','v1_threshold_change','business_strategy_change','methodology_promotion','member_access'])assert.equal(m[k],false);
 assert.equal(m.owner_shadow_only,true);assert.equal(m.forward_lock_prospective_only,true);return m;
}
function checked(row,readSource){
 assert.equal(hash(readSource(row.path)),row.candidate_sha256,'unreviewed candidate drift (V2): '+row.path);const before=prior(row.path);
 if(row.operation==='ADD'){assert.equal(before,null);assert.equal(row.predecessor_sha256,null);}else{assert.equal(row.operation,'MODIFY');assert(before);assert.equal(row.predecessor_git_sha,V2_BASE);assert.equal(hash(before),row.predecessor_sha256);}return before;
}
export function v2Transition(readSource=read){const m=manifest(readSource),restored=new Map();for(const row of m.files)restored.set(row.path,checked(row,readSource));return {manifest:m,predecessorRead:p=>{if(!restored.has(p))return readSource(p);const b=restored.get(p);if(b===null)throw Object.assign(Error('absent from V2 predecessor'),{code:'ENOENT'});return b;}};}
export function readV2Predecessor(path,readSource=read){if(!paths.has(path))return readSource(path);const row=manifest(readSource).files.find(r=>r.path===path),b=checked(row,readSource);if(b===null)throw Object.assign(Error('absent from V2 predecessor'),{code:'ENOENT'});return b;}

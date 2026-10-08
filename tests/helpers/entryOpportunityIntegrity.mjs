import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const ENTRY_BASE='97d219ddf75a7edd788de5272533e17ffcaaf686';
export const ENTRY_MANIFEST='docs/operations/evidence/entry-opportunity-transition.json';
export const ENTRY_MIGRATION='supabase/migrations/20261008081315_entry_opportunity_owner_shadow_v1.sql';
export const ENTRY_PATHS=[
 '.github/workflows/entry-opportunity.yml',
 'docs/10k-program/entry-opportunity-v1.md',
 'research/entry-opportunity.ts','research/entry-outcomes.ts','research/entry-v2-adapter.ts','research/entry-worker.ts',
 'src/pages/admin/analysis/EntryOpportunity.tsx','src/pages/admin/analysis/page.tsx',
 'supabase/functions/entry-opportunity-shadow-v1/index.ts',ENTRY_MIGRATION,
 'tests/browser/entryOpportunity.e2e.mjs','tests/browser/entryOpportunity.vite.ts',
 'tests/browser/entryOpportunityHarness.tsx','tests/browser/entryOpportunitySupabaseMock.ts',
 'tests/entryOpportunity.test.mjs','tests/entryOpportunityDatabase.integration.mjs','tests/entryOpportunityIntegrity.test.mjs',
 'tests/entryOpportunityWorker.test.mjs','tests/helpers/entryFixtures.mjs','tests/helpers/entryOpportunityIntegrity.mjs',
 'tests/entryOpportunityProjection.test.mjs','tests/entryOpportunityRealReplay.integration.mjs','tests/helpers/entryRetainedProjection.mjs',
 'tests/analysisIntelligenceUI.test.mjs',
 'tests/ownerAccountAnalysisNavigation.test.mjs',
 'tests/helpers/marketNewsIntegrity.mjs','tests/marketNewsIntegrity.test.mjs','tests/productContract.test.mjs',
].sort();
const root=fileURLToPath(new URL('../../',import.meta.url)),read=p=>readFileSync(new URL('../../'+p,import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex'),cache=new Map(),restored=new WeakSet();
export function entryPrior(p){
 if(!cache.has(p)){
  const exists=execFileSync('git',['ls-tree','--name-only',ENTRY_BASE,'--',p],{cwd:root,encoding:'utf8'}).trim();
  cache.set(p,exists?execFileSync('git',['show',ENTRY_BASE+':'+p],{cwd:root,maxBuffer:16*1024*1024}):null);
 }return cache.get(p);
}
export function entryTransition(source=read){
 const m=JSON.parse(source(ENTRY_MANIFEST));
 assert.equal(m.schema_version,'ENTRY_OPPORTUNITY_CANDIDATE_TRANSITION_V1');assert.equal(m.base,ENTRY_BASE);
 assert.deepEqual(m.files.map(r=>r.path).sort(),ENTRY_PATHS,'exact named Entry candidate scope');
 assert.deepEqual(m.functions,['entry-opportunity-shadow-v1']);assert.deepEqual(m.migrations,[ENTRY_MIGRATION]);
 assert.equal(m.owner_only,true);assert.equal(m.shadow_only,true);
 for(const k of ['production_release_authorized','production_data_write','existing_auth_change','existing_rls_change','secret_change',
  'cron_change','core_change','v1_change','v2_change','line_change','report_change','member_access'])assert.equal(m[k],false,k);
 const seal='docs/operations/evidence/market-news-transition-20261008.json';
 assert.equal(m.predecessor_sha256,hash(entryPrior(seal)));assert.equal(hash(source(seal)),m.predecessor_sha256,'immutable Market News predecessor');
 const before=new Map();
 for(const r of m.files){const b=entryPrior(r.path);assert.equal(r.operation,b===null?'ADD':'MODIFY');
  assert.equal(r.predecessor_sha256,b===null?null:hash(b));assert.equal(hash(source(r.path)),r.candidate_sha256,'unreviewed candidate drift (Entry): '+r.path);before.set(r.path,b);
 }
 const predecessorRead=p=>{
  if(p===ENTRY_MANIFEST)throw Object.assign(Error('absent predecessor'),{code:'ENOENT'});
  if(!before.has(p))return source(p);const b=before.get(p);if(b===null)throw Object.assign(Error('absent predecessor'),{code:'ENOENT'});return b;
 };restored.add(predecessorRead);return {manifest:m,predecessorRead};
}
export function entryAwareReader(source=read){
 if(restored.has(source))return source;
 try{source(ENTRY_MANIFEST);}catch(e){if(e.code==='ENOENT')return source;throw e;}
 return entryTransition(source).predecessorRead;
}
export function entryChangedPaths(){return [...new Set([
 ...execFileSync('git',['diff','--name-only','-z',ENTRY_BASE,'--'],{cwd:root,encoding:'utf8'}).split('\0'),
 ...execFileSync('git',['ls-files','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0'),
 ].filter(Boolean))].sort();}

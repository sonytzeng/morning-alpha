import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,normalize} from 'node:path';
import {PUBLIC_EXPORT_ARTIFACT_PATH,resolveRuntimeSparseRecoveryIntegrity} from './helpers/premarketAtomicReadinessIntegrity.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url));
test('public projection successor preserves exact predecessor hashes and freezes the core release scope',()=>{
 const result=resolveRuntimeSparseRecoveryIntegrity(JSON.parse(read('docs/operations/core-stability-incident-amendment-20260908.json')),read(PUBLIC_EXPORT_ARTIFACT_PATH),read);
 const m=result.publicProjectionCandidateIntegrity.reviewedBaselineTransition;
 assert.equal(m.transition_id,'MORNING_ALPHA_PUBLIC_MARKET_PROJECTION_20261002');
 assert.equal(m.candidate_base_git_sha,'646dc01baced83d34afd314506622798c2047544');
 assert.deepEqual(m.files.filter(x=>x.path.startsWith('supabase/migrations/')).map(x=>x.path),['supabase/migrations/20261002130000_public_market_projection_v1.sql']);
 assert.deepEqual(m.files.filter(x=>/^supabase\/functions\/[^/]+\/index.ts$/.test(x.path)).map(x=>x.path).sort(),[
  'supabase/functions/content-os-morning-alpha-source/index.ts','supabase/functions/get-report-payload/index.ts']);
 assert.equal(result.operationalMarketCandidateIntegrity.reviewedBaselineTransition.transition_id,'MORNING_ALPHA_OPERATIONAL_MARKET_20261001');
 for(const forbidden of ['fetch-market-data','generate-daily-report','daily-delivery','market-readiness','line-daily-push','closing-verification','continuous-learning'])
  assert(!m.files.some(x=>x.path.startsWith('supabase/functions/'+forbidden)));
});
test('only two public read/export bundles are candidates; no inferred deployment of core consumers',()=>{
 const m=JSON.parse(read('docs/operations/evidence/public-market-projection-bundles-20261002.json'));
 assert.deepEqual(m.deployment_functions,['content-os-morning-alpha-source','get-report-payload']);
 assert.equal(m.production_change_authorized,false);assert.equal(m.cron_change,false);
 const all=new Set();
 function walk(path,seen){if(seen.has(path))return;seen.add(path);all.add(path);
  for(const match of read(path).toString().matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g))walk(normalize(dirname(path)+'/'+match[1]),seen);}
 for(const [name,expected]of Object.entries(m.functions)){const actual=new Set();walk('supabase/functions/'+name+'/index.ts',actual);assert.deepEqual([...actual].sort(),expected);}
 assert.deepEqual([...all].sort(),Object.keys(m.files).sort());
 for(const [path,hash]of Object.entries(m.files))assert.equal(createHash('sha256').update(read(path)).digest('hex'),hash,path);
});

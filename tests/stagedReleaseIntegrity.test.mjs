import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {stagedTransition,stagedChangedPaths,stagedViews,stagedPrior,STAGED_BASE,STAGED_SCOPES,stagedManifestPath}from'./helpers/stagedReleaseIntegrity.mjs';
import {coreEvidenceHistoricalRead,verifyCoreEvidenceCandidate}from'./helpers/coreEvidenceCandidateIntegrity.mjs';
const read=p=>coreEvidenceHistoricalRead(p,readFileSync(new URL('../'+p,import.meta.url)));
test('exact scoped patches verify all live bytes; untouched Production baseline remains protected',()=>{
 const t=stagedTransition();assert(t);assert(t.manifests.length>=1);
 for(const m of t.manifests){assert.equal(m.base,STAGED_BASE);assert.deepEqual(m.files.map(r=>r.path).sort(),STAGED_SCOPES[m.batch].filter(p=>!stagedPrior(p)||!read(p).equals(stagedPrior(p))));}
 const v=stagedViews();v.verify();
 for(const m of t.manifests)for(const f of m.files){if(f.before_sha256===null)assert.throws(()=>v.predecessorRead(f.path),/ABSENT/);else assert.equal(v.predecessorRead(f.path).equals(read(f.path)),false);}
});
test('merged B1 remains a protected dependency, never an active candidate or mutable receipt',()=>{
 verifyCoreEvidenceCandidate();
 const path=stagedManifestPath('B1'),t=stagedTransition();assert(!t.manifests.some(m=>m.batch==='B1'));
 assert(read(path).equals(stagedPrior(path)));
 assert.throws(()=>stagedTransition(p=>p===path?Buffer.concat([read(p),Buffer.from('DRIFT')]):read(p)),/OLD_RECEIPT|JSON/);
 for(const p of ['supabase/functions/get-report-payload/index.ts','supabase/functions/_shared/decision-v1-evidence.ts','supabase/functions/_shared/recommendation-stock-evidence.ts'])assert(read(p).equals(stagedPrior(p)));
});
test('unknown paths, tampered files, fake permission, changed baseline and invalid scope are denied',()=>{
 const t=stagedTransition(),m=t.manifests[0],path=stagedManifestPath(m.batch);
 for(const f of m.files)assert.throws(()=>stagedTransition(p=>p===f.path?Buffer.concat([read(p),Buffer.from('DRIFT')]):read(p)));
 for(const change of [x=>x.production_authorized=true,x=>x.secret_change=true,x=>x.cron_change=true,x=>x.auth_model_change=true,x=>x.recommendation_threshold_change=true,x=>x.member_publication_authorized=true,x=>x.historical_data_change=true,x=>x.files.pop(),x=>x.base='HEAD']){
  const mutated=structuredClone(m);change(mutated);assert.throws(()=>stagedTransition(p=>p===path?Buffer.from(JSON.stringify(mutated)):read(p)));
 }
 assert.throws(()=>stagedTransition(read,[...stagedChangedPaths(),'unknown.ts']),/UNKNOWN/);
});

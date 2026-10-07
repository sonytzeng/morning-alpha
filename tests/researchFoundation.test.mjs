import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';
const read = path => readFileSync(new URL('../'+path, import.meta.url),'utf8');
const moduleSource=ts.transpileModule(read('src/features/research/foundation.ts'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {sampleBand,QUALITY_WINDOWS,readFoundation}=await import('data:text/javascript;base64,'+Buffer.from(moduleSource).toString('base64'));
const migration=read('supabase/migrations/20261004033642_intelligence_foundation_owner_shadow_v1.sql');
const base={schema_version:'RESEARCH_FOUNDATION_V1',mode:'SHADOW',production_eligible:false,features:[],method_versions:0,graphs:0,observations:0};
for(const [count,band] of [[0,'INSUFFICIENT_SAMPLE'],[4,'INSUFFICIENT_SAMPLE'],[5,'EARLY_SIGNAL'],[19,'EARLY_SIGNAL'],[20,'PRELIMINARY'],[59,'PRELIMINARY'],[60,'MEANINGFUL_SAMPLE'],[90,'MEANINGFUL_SAMPLE']])
  test(`independent trading-day sample boundary ${count}`,()=>assert.equal(sampleBand(count),band));
test('sample count cannot use fractional/invalid observations',()=>{
  for(const n of [-1,NaN,Infinity,1.2])assert.throws(()=>sampleBand(n));
  assert.deepEqual(QUALITY_WINDOWS,[5,20,60,90]);
});
test('presentation accepts only the isolated Shadow response contract',()=>{
  assert.deepEqual(readFoundation(base),base);
  for(const patch of [{mode:'PRODUCTION'},{production_eligible:true},{schema_version:'UNKNOWN'},{observations:-1},{features:[{feature_key:'TAIEX'}]}])
    assert.throws(()=>readFoundation({...base,...patch}));
});
test('all 11 required provider roles are present without a second adapter implementation',()=>{
  for(const key of ['TAIEX','2330','TXF','SPX','IXIC','SOX','NVDA','TSM','VIX','DXY','US10Y'])assert.match(migration,new RegExp("\\('"+key+"','"));
  assert.match(migration,/UNAVAILABLE_NO_IMPUTATION/);
  assert.match(migration,/SHADOW_ONLY_UNCALIBRATED/);
  assert.doesNotMatch(migration,/net\.http_|cron\.(schedule|unschedule)|vault\.|decrypted_secret|alter table public\.(reports|profiles|decision_snapshots)/i);
});
test('no new prediction/outcome engine or production approval path',()=>{
  for(const name of ['learning_predictions','prediction_outcomes','learning_rules','rule_backtests','learning_cases'])assert.doesNotMatch(migration,new RegExp('create table\\s+(?:if not exists\\s+)?public\\.'+name+'\\s*\\('));
  assert.match(migration,/references public\.learning_predictions/);assert.match(migration,/references public\.prediction_outcomes/);
  assert.doesNotMatch(migration,/'APPROVED'|'AUTO_APPLIED'|promote_learning_rule/);
  assert.match(migration,/check \(not production_eligible\)/);
});
test('owner identity is DB-enrolled, not inferred from browser claims or all admins',()=>{
  assert.match(migration,/a\.principal_id = \(select auth\.uid\(\)\)/);
  assert.match(migration,/a\.enabled and lower\(p\.role\) = 'admin'/);
  assert.doesNotMatch(migration,/insert into research_private\.owner_access|user_metadata|grant.*to anon/i);
  assert.match(migration,/security invoker set search_path=''/);
});
test('legacy outcome is snapshotted before later mutable CLE corrections',()=>{
  assert.match(migration,/new\.source_outcome_hash:=md5\(new\.source_outcome::text\)/);
  assert.match(migration,/RESEARCH_OUTCOME_LINEAGE_MISMATCH/);
  assert.match(migration,/RESEARCH_CANONICAL_PROVENANCE_UNAVAILABLE_OR_MISMATCH/);
  assert.match(migration,/RESEARCH_FORWARD_CANNOT_BE_BACKDATED/);
});
test('owner UI never renders errors/raw payloads or writes metrics, rules, reports or secrets',()=>{
  const page=read('src/pages/admin/analysis/page.tsx');
  assert.match(page,/get_research_foundation_v1/);
  assert.match(page,/generation !== identityGeneration/);
  assert.doesNotMatch(page,/localStorage|dangerouslySetInnerHTML|\.insert\(|\.update\(|\.upsert\(|functions\.invoke/);
  assert.match(page,/尚未量測/);assert.match(page,/觀測筆數不是有效交易日數/);
});
test('core freeze: exact existing provider/atomic/retry/research/report/LINE/shared bytes are preserved',()=>{
  const manifest=JSON.parse(read('docs/10k-program/phase1-core-freeze.json'));
  assert.equal(manifest.base_sha,'3b33db3688ba350da0372b50f3391da922b639ea');
  assert.equal(Object.keys(manifest.protected_files).length,142);
  for(const [path,hash] of Object.entries(manifest.protected_files)) assert.equal(createHash('sha256').update(readRecommendationPredecessor(path,read)).digest('hex'),hash,path);
});
test('fresh DB/RLS is a required Release CI step, not an optional skipped test',()=>{
  assert.match(read('.github/workflows/research-foundation.yml'),/run: node tests\/researchFoundationDatabase\.integration\.mjs/);
});
import { readRecommendationPredecessor } from './helpers/recommendationPhaseIntegrity.mjs';

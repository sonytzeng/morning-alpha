// Source/packaging controls only, not natural Forward or Production acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyIntegrationCandidate,createOfficialPublicComposition as createForwardCutoffComposition,INTEGRATION_MANIFEST,OFFICIAL_PUBLIC_BASE as FORWARD_CUTOFF_BASE,
 OFFICIAL_PUBLIC_DELTAS,integrationInventory,integrationPhysicalRead,integrationPhysicalMode,integrationHash} from './helpers/integrationAdmission.mjs';
import {BASE,CHANGED,TIMING_TEST,TIMING_TEST_SHA256,CATALOG,CATALOG_SHA256,WORKER4_ESZIP_SHA256,WORKER4_READBACK,worker4Baseline,readSource,
 proposeReleaseCatalog,catalog,assemble} from '../scripts/operations/forward-cutoff-20261020/materialize.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const read=integrationPhysicalRead;
const FORWARD_CUTOFF_DELTAS=Object.freeze([
 '.github/workflows/core-member-integration.yml','docs/operations/forward-cutoff-20261020.md',
 'docs/operations/evidence/worker4-exact-readback-20261020.json','docs/operations/evidence/forward-cutoff-acceptance-20261020.json',
 'scripts/operations/forward-cutoff-20261020/materialize.mjs','scripts/operations/forward-cutoff-20261020/release-catalog.json',
 'src/features/vnext/dailyRuntime.ts','tests/forwardCutoffAdmission.test.mjs','tests/vnextForwardCutoffRuntime.test.mjs',
]);

test('Worker4 packaging baseline is rebuilt only from 7bfc fixed sources, never the Worker3 rollback',()=>{
 const a=worker4Baseline(),b=worker4Baseline();
 assert.equal(BASE,FORWARD_CUTOFF_BASE);assert.equal(BASE,'7bfcfcd8fd0dd2fb2303dae58be1a4e0a86485a3');
 assert.equal(a.sha256,'34a0fe4a0b17dc56a72c43d7687738047b59d695ae1bbda676b85f321d9c0762');
 assert.deepEqual(a.bytes,b.bytes);assert.equal(a.payload.files.length,78);assert.equal(a.source_rows.filter(r=>!r.static).length,44);
 assert.equal(a.payload.verify_jwt,true);assert.equal(a.payload.name,'vnext-daily-research-v1');
 assert.equal(WORKER4_ESZIP_SHA256,'91bf73939e5dfde0740f7ba1ebf43830789d08b46cc1f8885583e451764501db');
 assert.equal(WORKER4_READBACK.physical_sha256,'7d01ded5896cfaecd3f7b41b1f54f2c9b5284f14a9ef3150f6b4112a1edec1e8');
 assert.equal(WORKER4_READBACK.matched,44);assert.equal(WORKER4_READBACK.exact_inventory,true);
 assert.equal(sha(read('docs/operations/evidence/worker4-exact-readback-20261020.json')),WORKER4_READBACK.physical_sha256);
 assert.equal(WORKER4_READBACK.status,'ACTIVE');assert.equal(WORKER4_READBACK.import_map,false);
 assert.equal(a.payload.files.find(f=>f.name===CHANGED).content,readSource(CHANGED).toString());
 assert.equal(a.payload.files.find(f=>f.name==='src/features/vnext/dailyAdapter.ts').content,readSource('src/features/vnext/dailyAdapter.ts').toString());
});
test('complete current composition and exact release catalogue are sealed independently of historical proofs',()=>{
 const m=verifyIntegrationCandidate();assert.deepEqual(createForwardCutoffComposition(),m);
 assert.equal(INTEGRATION_MANIFEST,'docs/operations/evidence/core-member-integration-20261020-v1-actual-canonical.json');
 assert.equal(new Set(FORWARD_CUTOFF_DELTAS).size,FORWARD_CUTOFF_DELTAS.length);
 for(const p of FORWARD_CUTOFF_DELTAS){assert(!p.includes('*')&&!p.includes('official-actuals')&&!p.includes('recommendation-official-source-join'));assert(OFFICIAL_PUBLIC_DELTAS.includes(p),'forward subset must be admitted by the complete combined source seal');}
 for(const f of ['production_authorized','migration_execution','auth_rls_change','member_rights_activation','caller_activation','research_publication','line_send','payment_enabled'])assert.equal(m[f],false);
 const c=catalog();assert.equal(sha(read(CATALOG)),CATALOG_SHA256);assert.equal(c.baseline.version,4);assert.equal(c.baseline.sdk,'2.57.4');
 assert.equal(c.scope.forward_backfill,false);assert.equal(c.scope.sql,false);assert.equal(c.scope.caller_activation,false);
 assert.equal(c.current_timing_controls.path,TIMING_TEST);assert.equal(sha(read(TIMING_TEST)),TIMING_TEST_SHA256);
 assert.equal(c.current_timing_controls.dynamic_controls,22);assert.equal(c.current_timing_controls.current_tree_not_historical,true);
 assert.equal(c.current_timing_controls.initial_attempt_snapshot_immutable,true);
 assert.equal(c.current_timing_controls.late_bootstrap_required,true);assert.equal(c.current_timing_controls.successful_pre_cutoff_commit_reply_after_cutoff_required,true);
 assert.equal(c.prior_morning_observation.scope,'AUTHORIZED_READONLY_PRODUCTION_SUMMARY');
 assert.equal(c.baseline.readback.scope,'AUTHORIZED_READONLY_PRODUCTION_READBACK');
});
test('source drift, unknown or missing inventory paths and changed modes fail before historical translation',()=>{
 const paths=integrationInventory();
 const drift=p=>p===CHANGED?Buffer.concat([read(p),Buffer.from('DRIFT')]):read(p);
 assert.throws(()=>verifyIntegrationCandidate(drift,paths),/SOURCE_DRIFT/);
 assert.throws(()=>verifyIntegrationCandidate(read,[...paths,'UNREVIEWED_FILE']),/UNKNOWN_PATH/);
 assert.throws(()=>verifyIntegrationCandidate(read,paths.filter(p=>p!==CHANGED)),/UNKNOWN_PATH/);
 assert.throws(()=>verifyIntegrationCandidate(read,paths,p=>p===CHANGED?'100755':integrationPhysicalMode(p)),/MODE_DRIFT/);
 assert.throws(()=>verifyIntegrationCandidate(read,paths,p=>p===INTEGRATION_MANIFEST?'100755':integrationPhysicalMode(p)),/MANIFEST_MODE_DRIFT/);
 const immutable='supabase/functions/_shared/decision-v1-evidence.ts',mutate=p=>p===immutable?Buffer.concat([read(p),Buffer.from('DRIFT')]):read(p);
 const m=JSON.parse(read(INTEGRATION_MANIFEST));m.files.find(r=>r.path===immutable).after_sha256=integrationHash(mutate(immutable));
 assert.throws(()=>verifyIntegrationCandidate(p=>p===INTEGRATION_MANIFEST?Buffer.from(JSON.stringify(m)):mutate(p),paths),/SOURCE_DRIFT/);
 assert.throws(()=>createForwardCutoffComposition(mutate,paths),/SOURCE_DRIFT/);
 // Re-sealing a changed executable bit is not permission to change mode.
 assert.throws(()=>createForwardCutoffComposition(read,paths,p=>p===CHANGED?'100755':integrationPhysicalMode(p)),/MODE_DRIFT/);
});
test('historical timing workflow, SQL, Auth and evaluator stay immutable; later financial changes have an independent exact seal',()=>{
 const workflow='.github/workflows/core-member-integration.yml',anchor='      - name: Check out the immutable Worker3 and Producer16 source proofs\n';
 const added='      - name: Current forward-cutoff timing and exact-source payload controls\n        env:\n          NODE_OPTIONS: --experimental-strip-types\n        run: node --experimental-strip-types --test --test-concurrency=1 tests/vnextForwardCutoffRuntime.test.mjs tests/forwardCutoffAdmission.test.mjs\n';
 const before=readSource(workflow).toString();assert.equal(before.split(anchor).length,2);
 const runtimeAnchor='      - run: deno test --no-lock --allow-read tests/researchOwnerFieldAccess.sdk.test.ts tests/providerCapabilityEntry.sdk.test.ts\n';
 const runtimeAdded='      - name: Materialize and check the exact forward-cutoff candidate and Worker4 recovery\n        run: |\n          node scripts/operations/forward-cutoff-20261020/materialize.mjs candidate\n          node scripts/operations/forward-cutoff-20261020/materialize.mjs recovery\n          deno check --no-lock build/forward-cutoff-20261020/candidate/supabase/functions/vnext-daily-research-v1/index.ts build/forward-cutoff-20261020/recovery/supabase/functions/vnext-daily-research-v1/index.ts\n';
 assert.equal(before.split(runtimeAnchor).length,2);
 const coldAnchor='      - name: Materialize and check the exact Worker3 plus source-order-only candidate and recovery\n';
 const financialAdded='      - name: Current financial-period runtime and cold offline SDK refusal controls\n        run: node --experimental-strip-types --test tests/v1FinancialPeriodRelease.test.mjs\n      - name: Check out the immutable 7bfc cold-order payloads, not current financial sources\n        uses: actions/checkout@v4\n        with:\n          ref: 7bfcfcd8fd0dd2fb2303dae58be1a4e0a86485a3\n          path: build/cold-source-order-immutable-7bfc\n          fetch-depth: 0\n          persist-credentials: false\n';
 assert.equal(before.split(coldAnchor).length,2);
 assert.equal(read(workflow).toString(),before.replace(anchor,added+anchor).replace(runtimeAnchor,runtimeAnchor+runtimeAdded)
  .replace(coldAnchor,financialAdded+coldAnchor+'        working-directory: build/cold-source-order-immutable-7bfc\n'));
 const financial=JSON.parse(read('scripts/operations/financial-response-period-20261020/release-catalog.json'));
 const financialOnly=new Set(['src/features/vnext/dailyAdapter.ts','src/features/vnext/dailyIntelligence.ts']);
 for(const path of ['supabase/functions/vnext-daily-research-v1/index.ts','supabase/functions/vnext-daily-research-v1/handler.ts',
  'src/features/vnext/dailyAdapter.ts','src/features/vnext/contracts.ts','src/features/vnext/engine.ts','src/features/vnext/dailyIntelligence.ts','src/features/vnext/researchFunnel.ts',
  'supabase/functions/_shared/decision-v1-evidence.ts','supabase/functions/get-report-payload/index.ts','supabase/functions/line-daily-push/index.ts',
  'supabase/functions/member-access/index.ts','supabase/migrations/20261012054120_vnext_daily_research_runtime_candidate.sql',
  'supabase/config.toml','package.json','package-lock.json']){
  if(financialOnly.has(path)){
   const row=financial.changes.find(r=>r.path===path);assert(row,path);
   assert.equal(row.before_sha256,sha(readSource(path)),path+':historical source retained');
   assert.equal(row.after_sha256,sha(read(path)),path+':explicit later financial source seal');
   assert.notEqual(row.before_sha256,row.after_sha256,path+':never pretend unchanged');
  }else assert.deepEqual(read(path),readSource(path),path);
 }
});
test('candidate replaces exactly dailyRuntime while recovery reproduces the complete Worker4 payload',()=>{
 const c=catalog(),a=assemble('candidate'),b=assemble('recovery'),old=worker4Baseline();
 assert.deepEqual(b.bytes,old.bytes);assert.equal(b.sha256,c.payloads.recovery.sha256);
 assert.equal(a.payload.files.length,78);assert.equal(c.files.filter(f=>!f.static).length,44);
 assert.deepEqual(a.payload.files.map(f=>f.name),old.payload.files.map(f=>f.name));
 const changed=[];
 for(const [i,f]of a.payload.files.entries()){
  const previous=b.payload.files[i],row=c.files[i];assert.equal(f.name,row.name);
  assert.equal(sha(f.content),row.after_sha256);assert.equal(sha(previous.content),row.before_sha256);
  assert.equal(Buffer.byteLength(f.content),row.after_bytes);assert.equal(Buffer.byteLength(previous.content),row.before_bytes);
  if(f.content!==previous.content)changed.push(f.name);
 }
 assert.deepEqual(changed,[CHANGED]);assert.equal(a.payload.files.find(f=>f.name===CHANGED).content,read(CHANGED).toString());
 assert.equal(a.sha256,c.payloads.candidate.sha256);assert.equal(a.payload.verify_jwt,true);
 assert.match(c.recovery_meaning,/NOT_PHYSICAL_ESZIP_REBUILD/);
});
test('both payload variants reject altered current source/catalogue and unknown variants; no hash guessing',()=>{
 for(const variant of ['candidate','recovery']){
  assert.throws(()=>assemble(variant,p=>p===CHANGED?Buffer.concat([read(p),Buffer.from(' ') ]):read(p)),/SOURCE_DRIFT/);
  assert.throws(()=>assemble(variant,p=>p===CATALOG?Buffer.concat([read(p),Buffer.from(' ') ]):read(p)),/SOURCE_DRIFT|CATALOG_DRIFT/);
 }
 for(const variant of ['latest','../recovery','main','repair','candidate@HEAD'])assert.throws(()=>assemble(variant),/FIXED_VARIANT/);
 assert.throws(()=>proposeReleaseCatalog('UNCONFIRMED'),/SEAL_REQUIRED/);
 assert.throws(()=>proposeReleaseCatalog('a'.repeat(64)),/NOT_CONFIRMED/);
 assert.throws(()=>proposeReleaseCatalog(sha(read(CHANGED)),p=>p===TIMING_TEST?Buffer.concat([read(p),Buffer.from(' ') ]):read(p)),/CURRENT_TIMING_TEST_DRIFT/);
});

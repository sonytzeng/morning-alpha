import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {ctoTransition,ctoPrior,ctoChangedPaths,CTO_PATHS,CTO_MANIFEST,memoizedScopeInventory,scopeInventorySignature} from './helpers/ctoCommercialIntegrity.mjs';
const raw=path=>readFileSync(new URL('../'+path,import.meta.url));
test('CTO exact UI/test candidate preserves every other byte and has no Production authority',()=>{
 const t=ctoTransition();assert.deepEqual(t.manifest.migrations,[]);assert.deepEqual(t.manifest.functions,[]);
 for(const path of CTO_PATHS){const prior=ctoPrior(path);if(prior===null)assert.throws(()=>t.predecessorRead(path),{code:'ENOENT'});else assert.deepEqual(t.predecessorRead(path),prior);}
});
test('unknown file, omitted file, changed candidate or protected business source fails closed',()=>{
 assert.throws(()=>ctoTransition(raw,[...ctoChangedPaths(),'unknown.sql']));assert.throws(()=>ctoTransition(raw,ctoChangedPaths().slice(1)));
 for(const path of CTO_PATHS)assert.throws(()=>ctoTransition(p=>p===path?Buffer.concat([raw(p),Buffer.from('\nUNREVIEWED')]):raw(p)));
 for(const path of ['supabase/functions/_shared/decision-v1-evidence.ts','supabase/functions/line-daily-push/index.ts','supabase/functions/get-report-payload/index.ts','supabase/functions/generate-daily-report-v7/index.ts'])assert.throws(()=>ctoTransition(p=>p===path?Buffer.concat([raw(p),Buffer.from('\nDRIFT')]):raw(p)),/historical CTO baseline/);
});
test('manifest cannot authorize a migration, worker, strategy, secret or publication',()=>{
 const m=JSON.parse(raw(CTO_MANIFEST));for(const patch of [{production_authorized:true},{migrations:['new.sql']},{functions:['worker']},{strategy_change:true},{secret_change:true},{cron_change:true},{member_publication_authorized:true}])assert.throws(()=>ctoTransition(p=>p===CTO_MANIFEST?Buffer.from(JSON.stringify({...m,...patch})):raw(p)));
});
test('inventory memoization is invalidated by directory or index stamps and cannot hide a new path',()=>{
 let stamp='directory1:index1',paths=['known.ts'],calls=0;
 const read=memoizedScopeInventory(()=>stamp,()=>{calls++;return paths;});
 assert.deepEqual(read(),['known.ts']);read().push('caller-mutation');assert.deepEqual(read(),['known.ts']);assert.equal(calls,1);
 paths=['known.ts','unknown.sql'];stamp='directory2:index1';assert.deepEqual(read(),paths);assert.equal(calls,2);
 paths=['known.ts'];stamp='directory2:index2';assert.deepEqual(read(),paths);assert.equal(calls,3);
 // The existing drift tests above still exercise EVERY real candidate hash and
 // every protected source byte on each admission; no admission is memoized.
});
test('confirmed timeout budgets preserve all commands, steps, permissions and assertions',()=>{
 const normalize=bytes=>bytes.toString().split('\n').filter(line=>!line.trimStart().startsWith('#')).join('\n').replace(/timeout-minutes: \d+/g,'timeout-minutes: BOUNDED');
 for(const path of ['.github/workflows/research-foundation.yml','.github/workflows/owner-trading-lab.yml','.github/workflows/recommendation-v2-shadow.yml']){
  assert.equal(normalize(raw(path)),normalize(ctoPrior(path)));assert.match(raw(path).toString(),/timeout-minutes: 30\n/);
 }
});
test('full release CI retains every downstream check and requires all exhaustive public partitions',()=>{
 const path='.github/workflows/validate-release.yml';
 const strip=bytes=>bytes.toString().split('\n').filter(line=>!line.trimStart().startsWith('#')).join('\n');
 const before=strip(ctoPrior(path)).slice(strip(ctoPrior(path)).indexOf('  validate:'));
 const workflow=raw(path).toString(),after=strip(raw(path)).slice(strip(raw(path)).indexOf('  validate:'));
 const expected=before.replace('timeout-minutes: 60','timeout-minutes: 120')
  .replace('      - run: npm run build\n','')
  .replace('      - run: npm run test:public\n','')
  .replace('      - run: npm run lint','      - run: npm run lint\n      - run: npm run build')
  .replace('  validate:\n','  validate:\n    needs: public-regression\n    if: ${{ always() }}\n')
  .replace('    steps:\n','    steps:\n      - name: Require every public regression partition to pass\n        run: test \'${{ needs.public-regression.result }}\' = success\n');
 assert.equal(after,expected,'every original downstream SQL/Edge/RLS command and permission remains exact');
 assert.equal((after.match(/- run: npm run build/g)||[]).length,1);
 const partition=workflow.slice(workflow.indexOf('  public-regression:'),workflow.indexOf('  validate:'));
 assert.match(partition,/fail-fast: false/);assert.match(partition,/shard: \[0, 1, 2, 3\]/);
 assert.match(partition,/timeout-minutes: 120/);assert.match(partition,/fetch-depth: 0/);
 assert.match(partition,/run: node scripts\/cto\/public-regression-shard\.mjs/);
 assert.ok(partition.indexOf('npm run build')<partition.indexOf('node scripts/cto/public-regression-shard.mjs'));
 assert.doesNotMatch(partition,/continue-on-error|secrets\.|\sif:|test-name-pattern|test-skip-pattern/);
});
test('existing empty untracked directories never hide a later deeply nested unknown file',()=>{
 let paths=['known.ts'],calls=0,nonce=0;
 const read=memoizedScopeInventory(()=>scopeInventorySignature('unchanged-tracked-stamps',['empty/'],()=>++nonce),()=>{calls++;return paths;});
 assert.deepEqual(read(),['known.ts']);paths=['known.ts','empty/deep/unknown.sql'];assert.deepEqual(read(),paths);assert.equal(calls,2);
 assert.equal(scopeInventorySignature('metadata',[],()=>{throw Error('must not use nonce');}),'metadata');
});
test('entry isolation waits for final TCP daemon and retains every original SQL, RLS and UI check',()=>{
 const path='.github/workflows/entry-opportunity.yml',before=ctoPrior(path).toString(),after=raw(path).toString();
 const normalized=after.split('\n').filter(line=>!line.trimStart().startsWith('#')&&!/^          docker exec ma-entry-ci-1 pg_isready -h 127\.0\.0\.1 -U postgres$/.test(line)).join('\n').replace('pg_isready -h 127.0.0.1 -U postgres','pg_isready -U postgres');
 assert.equal(normalized,before);assert.match(after,/for attempt in \$\(seq 1 30\)/);
 assert.match(after,/done\n          docker exec ma-entry-ci-1 pg_isready -h 127\.0\.0\.1 -U postgres\n          node --experimental-strip-types tests\/entryOpportunityDatabase\.integration\.mjs/);
});
test('official Auth image retry is bounded and cannot bypass the original real Auth/RLS checks',()=>{
 const path='.github/workflows/academy-v11.yml',before=ctoPrior(path).toString(),after=raw(path).toString();
 const block=`      - name: Bounded official Auth image acquisition\n        timeout-minutes: 3\n        run: |\n          acquired=false\n          for attempt in 1 2 3; do\n            if docker pull public.ecr.aws/supabase/gotrue:v2.194.0; then\n              acquired=true\n              break\n            fi\n            if [ "$attempt" -lt 3 ]; then sleep 20; fi\n          done\n          test "$acquired" = true\n`;
 assert.ok(after.includes(block));assert.equal(after.replace(block,''),before);
 assert.match(after,/run: node scripts\/academy-v11\/auth-environment\.mjs/);
});
test('large Academy spy retains every original counter, mutation, denial and restoration assertion',()=>{
 const path='tests/academyV11Integrity.test.mjs',marker="test('V1 integration verifies the real successor before restoring historical bytes and diagnostics'";
 const before=execFileSync('git',['show','3ee7339ad7f65b3f4b15f9763c9961d715603379:'+path],{encoding:'utf8'});
 const after=raw(path).toString();let restored=after.slice(after.indexOf(marker));
 restored=restored.replace('  // These counters, not MockFunctionContext.calls, are the asserted evidence.\n  // A tracking Proxy retains every returned raw Buffer throughout the deep\n  // baseline scans. Use the same process-local behavior without that unused\n  // history, restoring both builtins unconditionally below.\n','')
  .replace("  fs.readFileSync = function(path, ...args) {","  t.mock.method(fs, 'readFileSync', function(path, ...args) {")
  .replace("  };\n  childProcess.execFileSync = function(command, args, ...options) {","  });\n  t.mock.method(childProcess, 'execFileSync', function(command, args, ...options) {")
  .replace('  };\n  syncBuiltinESMExports();','  });\n  syncBuiltinESMExports();')
  .replace('    fs.readFileSync = realRead;\n    childProcess.execFileSync = realExec;','    t.mock.restoreAll();');
 assert.equal(restored,before.slice(before.indexOf(marker)),'all original control branches, repetitions and assertions stay exact');
 assert.equal(after.slice(0,after.indexOf(marker)),before.slice(0,before.indexOf(marker)),'all other eight Academy tests stay exact');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {vnextTransition,vnextChangedPaths,vnextPrior,VNEXT_MANIFEST,VNEXT_PATHS} from './helpers/vnextIntegrity.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url));
test('VNext exact candidate preserves every Production byte and previous release seal',()=>{
 const result=vnextTransition();assert.equal(result.manifest.production_authorized,false);
 assert.deepEqual(result.predecessorRead('tests/helpers/academyV11Integrity.mjs'),vnextPrior('tests/helpers/academyV11Integrity.mjs'));
 assert.throws(()=>result.predecessorRead('src/features/vnext/engine.ts'),{code:'ENOENT'});
});
test('existing Validate workflow changes only execution budget, never steps or permissions',()=>{
 const path='.github/workflows/validate-release.yml',prior=vnextPrior(path).toString();
 const expected=prior.replace('    timeout-minutes: 20','    # Full protected-baseline integrity plus all existing fresh-DB incident\n    # regressions exceed the former 20-minute budget. No steps are skipped.\n    timeout-minutes: 40');
 assert.notEqual(expected,prior);assert.equal(read(path).toString(),expected);
});
test('unknown paths, changed evidence policy and deployment flags cannot enter through successor view',()=>{
 assert.throws(()=>vnextTransition(read,[...vnextChangedPaths(),'src/rogue.ts']));
 for(const path of ['src/features/vnext/engine.ts','src/router/config.tsx'])assert.throws(()=>vnextTransition(p=>p===path?Buffer.concat([read(p),Buffer.from('\n// drift')]):read(p)));
 for(const field of ['production_authorized','member_publication_authorized','strategy_change','secret_change','cron_change']){
  const m=JSON.parse(read(VNEXT_MANIFEST));m[field]=true;
  assert.throws(()=>vnextTransition(p=>p===VNEXT_MANIFEST?JSON.stringify(m):read(p)));
 }
 const m=JSON.parse(read(VNEXT_MANIFEST));m.files=m.files.slice(1);
 assert.throws(()=>vnextTransition(p=>p===VNEXT_MANIFEST?JSON.stringify(m):read(p)));
 assert.equal(new Set(VNEXT_PATHS).size,VNEXT_PATHS.length);
});

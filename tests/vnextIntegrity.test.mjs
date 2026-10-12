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
test('Validate preserves main news replay and budget, only changes prebuild order and TCP readiness',()=>{
 const path='.github/workflows/validate-release.yml',prior=vnextPrior(path).toString();
 const expected=prior.replace('      - run: npm run build\n','')
  .replace('      - run: npm run test:public','      # Prebuild before parallel tests: preserve generated-file integrity.\n      - run: npm run build\n      - run: npm run test:public')
  .replaceAll('pg_isready -U postgres','pg_isready -h 127.0.0.1 -U postgres');
 assert.notEqual(expected,prior);assert.equal(read(path).toString(),expected);
 const commands=s=>[...s.matchAll(/^      - run: (.+)$/gm)].map(m=>m[1]).sort();
 assert.deepEqual(commands(expected),commands(prior));
 assert.ok(expected.indexOf('- run: npm run build')<expected.indexOf('- run: npm run test:public'));
 assert.equal((expected.match(/pg_isready -h 127\.0\.0\.1 -U postgres/g)||[]).length,8);
 assert.match(expected,/timeout-minutes: 45/);assert.match(expected,/MA_TEST_PSQL/);
});
test('Cockpit CI only checks final TCP server, not the socket-only bootstrap; product and security unchanged',()=>{
 const path='.github/workflows/owner-cockpit.yml',prior=vnextPrior(path).toString(),current=read(path).toString();
 assert.equal(current,prior.replaceAll('pg_isready -U postgres','pg_isready -h 127.0.0.1 -U postgres'));
 assert.equal((current.match(/pg_isready -h 127\.0\.0\.1 -U postgres/g)||[]).length,2);
 assert.match(current,/--network none/);assert.doesNotMatch(current,/pg_isready -U postgres/);
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

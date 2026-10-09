import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import './browser/academy.test.mjs';

const root = process.cwd();
const read = p => readFileSync(path.join(root, p), 'utf8');
test('Academy is a separate lazy route and does not replace member routes', () => {
  const routes = read('src/router/config.tsx');
  assert.match(routes, /lazy\(\(\) => import\(['"]\.\.\/pages\/academy\/page['"]\)\)/);
  assert.equal((routes.match(/path: "\/academy"/g) || []).length, 1);
  assert.match(routes, /path: "\/account"/);
});
test('Academy source cannot write production data or invoke trading/business functions', () => {
  const files = readdirSync(path.join(root, 'src/pages/academy')).filter(x => /\.(ts|tsx)$/.test(x));
  for (const file of files) {
    const source = read('src/pages/academy/' + file);
    // Array.from builds UI lists; it is not a database table accessor.
    assert.doesNotMatch(source, /(?<!\bArray)\.from\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(|functions\.invoke|service_role|SERVICE_ROLE|SUPABASE_SERVICE/);
    assert.doesNotMatch(source, /dangerouslySetInnerHTML|eval\(|new Function\(/);
  }
  const guard = read('src/pages/academy/useOwnerAccess.ts');
  const calls = [...guard.matchAll(/\.rpc\('([^']+)'/g)].map(x => x[1]);
  assert.deepEqual(calls, ['is_research_owner_v1']);
});
test('AI is an explicitly disabled adapter without fabricated generated answers', () => {
  const model = read('src/features/academy/model.ts');
  assert.doesNotMatch(model, /fetch\(|axios|process\.env|import\.meta\.env|apiKey/);
  assert.match(model, /disabled/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';

test('Core v64 natural-acceptance freeze: producers, migrations, cron and canonical readers unchanged', () => {
  const files = execFileSync('git',['ls-files','supabase','.github/workflows','src/lib/decisionEvidence.ts','src/lib/runtimeDecisionTimeline.ts','src/services/resolveActiveReport.ts'],{encoding:'utf8'}).trim().split('\n');
  const hash = createHash('sha256');
  for (const file of files) hash.update(file+'\0').update(readFileSync(file)).update('\0');
  assert.equal(files.length,110);
  assert.equal(hash.digest('hex'),'a766fdff32e9fa18f6bdd2a1386a159e9ca370cfad6ae06f70685fa071fb6e67');
});
test('subscriber CSS parses, remains scoped, and has no fixed-height clipping or forced global overrides', () => {
  const css = readFileSync('src/features/decision-v1/subscriber.css','utf8');
  const ast = postcss.parse(css); const selectors = new Set();
  ast.walkRules(rule => {
    const context = rule.parent.type === 'atrule' ? rule.parent.params : 'base';
    for(const selector of rule.selectors) {
      assert.match(selector,/^\.ma-subscriber-/);
      const key = context+':'+selector; assert.equal(selectors.has(key),false,key); selectors.add(key);
    }
  });
  assert.doesNotMatch(css,/!important|(?:linear|radial)-gradient|backdrop-filter|max-height|overflow:\s*hidden|line-clamp/);
});
test('product engine stays a pure browser-safe read model, never a second publication pipeline', () => {
  const engine=readFileSync('src/features/decision-v1/engine.ts','utf8');
  assert.doesNotMatch(engine,/fetch\(|supabase|\.rpc\(|\.from\(|setInterval|Date\.now\(/);
  const contract=readFileSync('docs/product-contract-v1.md','utf8');
  for(const phrase of ['2026-09-08','NO_QUALIFIED_OPPORTUNITY','INSUFFICIENT_DATA','Direction Probability','Production writes','33 slugs','5/20/60']) assert.ok(contract.includes(phrase));
});

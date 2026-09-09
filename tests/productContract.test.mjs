import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { readSubscriberProjectionIntegrity } from './helpers/subscriberProjectionIntegrity.mjs';

test('Core freeze plus explicitly authorized 9/8 incident: unapproved producers, Cron and canonical readers unchanged', () => {
  // Read-side get-report-payload and exactly two new evidence modules are the
  // only approved exception. Remaining Core bytes stay pinned to pre-work HEAD.
  const approved = new Set(['supabase/functions/get-report-payload/index.ts','supabase/functions/_shared/decision-v1-data.ts','supabase/functions/_shared/decision-v1-evidence.ts']);
  const incident=JSON.parse(readFileSync('docs/operations/core-stability-incident-amendment-20260908.json','utf8'));
  const subscriberApproval = readSubscriberProjectionIntegrity(incident);
  assert.equal(incident.baseline_commit,'ce3ff722c7247e1949b4740b20d2ccb96b1c77cf');
  const additions=new Set(incident.files.filter(row=>row.baseline_sha256===null).map(row=>row.path));
  const files = execFileSync('git',['ls-files','supabase','.github/workflows','src/lib/decisionEvidence.ts','src/lib/runtimeDecisionTimeline.ts','src/services/resolveActiveReport.ts'],{encoding:'utf8'}).trim().split('\n').filter(f=>!approved.has(f));
  const hash = createHash('sha256');
  for(const row of incident.files)assert.equal(createHash('sha256').update(readFileSync(row.path)).digest('hex'),subscriberApproval.fileHash(row),row.path);
  for (const file of files.filter(file=>!additions.has(file))){
    const amendment=incident.files.find(row=>row.path===file);
    const bytes=amendment?execFileSync('git',['show',incident.baseline_commit+':'+file]):readFileSync(file);
    if(amendment)assert.equal(createHash('sha256').update(bytes).digest('hex'),amendment.baseline_sha256);
    hash.update(file+'\0').update(bytes).update('\0');
  }
  assert.equal(files.filter(file=>!additions.has(file)).length,109);
  assert.equal(hash.digest('hex'),'d0e0959ccc86b8b0d8480aa7f56e55385e5bb48477f1971704fa901c1073c08c');
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

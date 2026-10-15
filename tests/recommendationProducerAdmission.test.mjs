import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyRecommendationProducerBundle,manifestPath} from '../scripts/releases/recommendation-v1-preflight.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url));
test('Producer admission retains V14 root/SDK/Auth and only already-merged B1 dependency corrections',()=>{
 const result=verifyRecommendationProducerBundle();assert.equal(result.files,20);assert.equal(result.unchanged,18);
 const m=JSON.parse(read(manifestPath));assert.equal(m.production_baseline.eszip_sha256,'ed268b666e33b60d2b0d0ee4e5e807e8454a7e67dc5dff2a6561d7fba7c8c3fd');
});
test('bundle drift, widened runtime set and any unauthorized operation fail closed',()=>{
 const m=JSON.parse(read(manifestPath));
 for(const mutate of [x=>x.production_authorized=true,x=>x.functions.push('line-daily-push'),x=>x.verify_jwt=false,
 x=>x.migrations.push('unapproved.sql'),x=>x.files.pop(),x=>x.secret_change=true,x=>x.threshold_change=true,
 x=>x.files[0].path='../credential',x=>x.files[1].after_sha256='0'.repeat(64)]){
  const copy=structuredClone(m);mutate(copy);assert.throws(()=>verifyRecommendationProducerBundle(p=>p===manifestPath?Buffer.from(JSON.stringify(copy)):read(p)));
 }
 for(const f of m.files)assert.throws(()=>verifyRecommendationProducerBundle(p=>p===f.path?Buffer.concat([read(p),Buffer.from('DRIFT')]):read(p)));
});
test('saved 72-symbol audit is complete, disjoint, no missing evidence relabeled as failed investment',()=>{
 const audit=JSON.parse(read('docs/operations/evidence/recommendation-v1-gap-matrix-20261015.json'));
 assert.equal(audit.rows.length,72);assert.equal(new Set(audit.rows.map(r=>r.symbol)).size,72);
 assert.equal(audit.funnel.evaluated_count,0);assert.equal(audit.funnel.blocked_count,72);
 assert.equal(audit.funnel.ready_count+audit.funnel.watch_count+audit.funnel.none_count,0);
 assert(audit.rows.every(r=>r.status==='BLOCKED'&&r.reasons.includes('THREE_INSTITUTIONS_MISSING')&&r.reasons.includes('FOUR_QUARTER_FUNDAMENTAL_EVIDENCE_MISSING')));
 assert.equal(audit.funnel.reason_distribution['20_DAILY_VOLUMES_MISSING'],1);
 assert.equal(audit.rows.find(r=>r.symbol==='2330').data_pipe_class,'PRODUCER_COMPILED_DEPENDENCY_DRIFT');
 assert.equal(audit.counts.flows,0);assert.equal(audit.counts.earnings,0);
 assert.equal(audit.formal_outcome_changed,false);assert.equal(audit.hypothetical_replay_not_forward,true);
});

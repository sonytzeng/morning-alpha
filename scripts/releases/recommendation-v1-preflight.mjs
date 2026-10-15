/** Read-only immutable bundle admission. No credentials, network, deploy or writes. */
import assert from 'node:assert/strict';
import {readFileSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export const manifestPath='docs/operations/evidence/recommendation-v1-producer-release-20261015.json';
const root=new URL('../../',import.meta.url);
const hash=b=>createHash('sha256').update(b).digest('hex');
export function verifyRecommendationProducerBundle(read=p=>readFileSync(new URL(p,root))){
 const m=JSON.parse(read(manifestPath));
 assert.equal(m.schema,'RECOMMENDATION_V1_PRODUCER_RELEASE_ADMISSION_1');
 assert.equal(m.production_authorized,false);
 assert.equal(m.production_baseline.version,14);
 assert.equal(m.production_baseline.slug,'recommendation-stock-evidence-v1');
 assert.equal(m.verify_jwt,true);
 assert.equal(m.gateway_auth_change,false);
 assert.deepEqual(m.functions,['recommendation-stock-evidence-v1']);
 assert.deepEqual(m.migrations,[]);
 for(const key of ['secret_change','cron_change','rls_change','threshold_change','historical_report_rewrite','line_send','member_publication'])assert.equal(m[key],false);
 const expected=['supabase/functions/_shared/decision-v1-evidence.ts','supabase/functions/_shared/recommendation-stock-evidence.ts'].sort();
 assert.deepEqual(m.files.filter(x=>x.before_sha256!==x.after_sha256).map(x=>x.path).sort(),expected);
 assert.equal(m.files.length,20);assert.equal(new Set(m.files.map(x=>x.path)).size,20);
 for(const row of m.files){
  assert.match(row.path,/^(supabase\/functions\/|src\/features\/research\/)[a-zA-Z0-9_.\/-]+$/);
  assert(!row.path.split('/').includes('..'));
  assert.match(row.before_sha256,/^[a-f0-9]{64}$/);assert.match(row.after_sha256,/^[a-f0-9]{64}$/);
  assert.equal(hash(read(row.path)),row.after_sha256,'UNSEALED_RUNTIME_DEPENDENCY:'+row.path);
 }
 const entry=m.files.find(x=>x.path==='supabase/functions/recommendation-stock-evidence-v1/index.ts');
 assert.equal(entry.before_sha256,entry.after_sha256);
 const text=read(entry.path).toString();
 assert(text.includes('https://esm.sh/@supabase/supabase-js@2.57.4'));
 assert(!/\.insert\(|\.update\(|\.upsert\(/.test(text));
 return {scope:'READ_ONLY_SOURCE_ADMISSION_NOT_DEPLOYMENT',files:20,unchanged:18,changed:expected,source:m.source_commit,production_verified:false};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 for(const path of [manifestPath,...JSON.parse(readFileSync(new URL(manifestPath,root))).files.map(r=>r.path)])assert(lstatSync(new URL(path,root)).isFile());
 console.log(JSON.stringify(verifyRecommendationProducerBundle()));
}

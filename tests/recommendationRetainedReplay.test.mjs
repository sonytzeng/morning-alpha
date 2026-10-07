import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {emptyEvidenceData,loadDecisionEvidence,DATA_QUERIES} from '../supabase/functions/_shared/decision-v1-data.ts';
import {buildRecommendationProof} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';
const capsule=JSON.parse(readFileSync(new URL('./fixtures/recommendation-retained-20261006.json',import.meta.url)));
const raw=gunzipSync(Buffer.from(capsule.data,'base64'));
assert.equal(createHash('sha256').update(raw).digest('hex'),capsule.sha256);
const data={...emptyEvidenceData(),...JSON.parse(raw)};
function audit(v){if(Array.isArray(v))return v.forEach(audit);if(v&&typeof v==='object')for(const[k,x]of Object.entries(v)){assert.doesNotMatch(k,/^(authorization|cookie|email|password|token|api_key|service_role_key)$/i);audit(x);}}
audit(data);
for(const[date,cutoff]of Object.entries({'2026-10-02':'2026-10-01T23:05:19.521Z','2026-10-05':'2026-10-04T23:05:25.164Z','2026-10-06':'2026-10-05T23:05:13.729Z'}))test(`${date} retained read-model replay, no new acquisition or lookahead`,async()=>{
 const identity={report_date:date,today_date:date,generated_at:cutoff,data_as_of:cutoff,revision_id:`counterfactual:${date}`,is_trading_day:true};
 const input=await loadDecisionEvidence(async q=>{
  const key=Object.keys(DATA_QUERIES).find(k=>DATA_QUERIES[k].table===q.table);
  return {data:data[key].filter(r=>q.filters.every(f=>f.operator==='lte'?Date.parse(r[f.column])<=Date.parse(f.value):Date.parse(r[f.column])>=Date.parse(f.value))).sort((a,b)=>Date.parse(b[q.order])-Date.parse(a[q.order])).slice(0,q.limit),error:null};
 },identity);
 const a=await buildRecommendationProof(input,identity);
 assert.equal(a.decision.phase_evaluation.universe_count,72);assert.equal(a.decision.phase_evaluation.status,'BLOCKED');
 assert.equal(a.decision.phase_evaluation.blocked_count,72);assert.equal(a.decision.phase_evaluation.ready_count,0);
 assert.equal(a.decision.phase_evaluation.reason_distribution.FOUR_QUARTER_FUNDAMENTAL_EVIDENCE_MISSING,72);
 assert.equal(a.decision.phase_evaluation.reason_distribution['20_DAILY_VOLUMES_MISSING'],72);
 assert.equal(a.decision.phase_evaluation.reason_distribution.FRESH_QUOTE_MISSING,71,'2330 latest legal session survives the weekend, other actual quote gaps remain');
 assert.equal(a.acquisition.captures.length,0);assert.deepEqual(a.business_writes,[]);
 assert(a.decision.evidence.every(e=>Date.parse(e.available_at)<=Date.parse(cutoff)&&Date.parse(e.observed_at)<=Date.parse(cutoff)));
 const reversed=structuredClone(input);Object.values(reversed).forEach(v=>Array.isArray(v)&&v.reverse());
 assert.deepEqual(await buildRecommendationProof(reversed,identity),a);
});

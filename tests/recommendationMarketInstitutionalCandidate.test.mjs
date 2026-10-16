import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { normalizeMarketInstitutionalTwd, acquireMarketInstitutionalTwd, withMarketInstitutionalEvidence, marketFlowSource } from '../supabase/functions/_shared/recommendation-market-institutional-candidate.ts';
import { buildEvidenceDecision } from '../supabase/functions/_shared/decision-v1-evidence.ts';
import { evidenceRows } from './fixtures/decision-evidence-rows.mjs';
import { buildRecommendationFoundationCandidate, persistedFoundationCandidateInput } from '../supabase/functions/_shared/recommendation-foundation-candidate.ts';
import { persistedRecommendationReaderInput } from '../supabase/functions/_shared/recommendation-stock-evidence.ts';
import { sharedV2Acquisition } from '../supabase/functions/_shared/recommendation-v2-acquisition-cache.ts';
// Explicitly SYNTHETIC controls, not official flows or investing performance.
const DATE='2026-09-04', RECEIVED='2026-09-06T22:50:00Z';
const identity={report_date:'2026-09-07',today_date:'2026-09-07',generated_at:'2026-09-06T23:00:00Z',data_as_of:'2026-09-06T23:00:00Z',revision_id:'synthetic-candidate',is_trading_day:true};
function payload(){return {stat:'OK',date:'20260904',hints:'單位：元',fields:['單位名稱','買進金額','賣出金額','買賣差額'],data:[
 ['自營商(自行買賣)','20','10','10'],['自營商(避險)','30','20','10'],['投信','50','20','30'],
 ['外資及陸資(不含外資自營商)','100','50','50'],['外資自營商','8','3','5'],['合計','200','100','100']]};}
test('market amount schema preserves TWD, combines dealers once, never creates stock amounts',async()=>{
 const c=await normalizeMarketInstitutionalTwd(payload(),DATE,RECEIVED);
 assert.equal(c.rows.length,3);assert(c.rows.every(r=>r.symbol==='TAIEX'&&r.currency==='TWD'));
 assert.equal(c.rows.find(r=>r.institution_type==='dealer').net_amount,20);
 assert.equal(c.rows.reduce((n,r)=>n+r.net_amount,0),100);
 assert.equal(c.published_at,null);assert.equal(c.available_at,RECEIVED);assert.match(c.source_revision,/^[a-f0-9]{64}$/);
 const reordered=payload();reordered.data.reverse();assert.equal((await normalizeMarketInstitutionalTwd(reordered,DATE,RECEIVED)).source_revision,c.source_revision);
});
test('wrong date/unit, shares schema, duplicates, non-reconciling amounts and missing data reject',async()=>{
 for(const mutate of [p=>p.date='20260903',p=>p.hints='單位：股',p=>p.fields[1]='買進股數',p=>p.data.pop(),
 p=>p.data[0][1]=null,p=>p.data[0][1]='',p=>p.data[0][1]='9e10',p=>p.data[0][1]='1,00',
 p=>p.data[0][1]='9007199254740992',p=>p.data[1]=p.data[0],p=>p.data[0][3]='999',p=>p.data[5][3]='105']){
  const p=payload();mutate(p);await assert.rejects(()=>normalizeMarketInstitutionalTwd(p,DATE,RECEIVED));
 }
 assert.throws(()=>marketFlowSource('2026-09-05'));
});
test('newly downloaded history cannot remove an old premarket blocker; no cutoff backfill',async()=>{
 const c=await normalizeMarketInstitutionalTwd(payload(),DATE,'2026-09-07T10:00:00Z');
 const data=evidenceRows();data.flows=[];const before=structuredClone(data);
 const merged=await withMarketInstitutionalEvidence(data,identity,c);
 assert.equal(merged.flows.length,0);assert.deepEqual(data,before);assert(merged.failures.includes('MARKET_FLOW_NOT_ADMISSIBLE'));
});
test('admitted source feeds the unchanged evaluator; individual stock gates remain mandatory',async()=>{
 const c=await normalizeMarketInstitutionalTwd(payload(),DATE,RECEIVED),data=evidenceRows();data.flows=[];
 const merged=await withMarketInstitutionalEvidence(data,identity,c);
 assert.equal(merged.failures.length,0);assert.equal(merged.flows.length,3);
 assert.equal((await withMarketInstitutionalEvidence(merged,identity,c)).flows.length,3);
 const decision=buildEvidenceDecision(merged,identity);
 assert.equal(decision.phase_evaluation.evaluated_count,0);assert.equal(decision.stock_opportunities.length,0);
 assert(decision.phase_evaluation.candidates.every(c=>c.reasons.includes('THREE_INSTITUTIONS_MISSING')));
 assert(decision.phase_evaluation.candidates.every(c=>!c.reasons.includes('MARKET_REQUIRED_INSTITUTIONAL')));
});
test('version tamper, fake stock scope, conflict and wrong identity fail closed',async()=>{
 const c=await normalizeMarketInstitutionalTwd(payload(),DATE,RECEIVED),data=evidenceRows();data.flows=[];
 for(const change of [x=>x.rows[0].net_amount++,x=>x.rows[0].symbol='2330',x=>x.source_revision='0'.repeat(64),x=>x.rows[0].created_at='2020-01-01T00:00:00Z']){
  const bad=structuredClone(c);change(bad);assert((await withMarketInstitutionalEvidence(data,identity,bad)).failures.length);
 }
 const old={...c.rows[0],provider:'other'};data.flows=[old];
 assert((await withMarketInstitutionalEvidence(data,identity,c)).failures.includes('MARKET_FLOW_CONFLICT'));
 for(const malformed of [null,{}, {...c,rows:null}, {...c,rows:[null]}])assert((await withMarketInstitutionalEvidence(data,identity,malformed)).failures.includes('MARKET_FLOW_INVALID'));
});
test('fixed-source acquisition is one credential-free bounded read, drains failures and never retries',async()=>{
 let calls=0,cancelled=0;
 const options={date:DATE,now:()=>RECEIVED,signal:AbortSignal.timeout(1000),fetcher:async(url,init)=>{
  calls++;assert.equal(url,marketFlowSource(DATE));assert.equal(init.redirect,'error');assert.equal(init.headers,undefined);return Response.json(payload());
 }};
 assert.equal((await acquireMarketInstitutionalTwd(options)).status,'PASS');assert.equal(calls,1);
 calls=0;const failed=await acquireMarketInstitutionalTwd({...options,fetcher:async()=>{calls++;return new Response(new ReadableStream({cancel(){cancelled++;}}),{status:429});}});
 assert.equal(calls,1);assert.equal(cancelled,1);assert.equal(failed.status,'SOURCE_UNAVAILABLE');assert.deepEqual(failed.rows,[]);
 const oversized=await acquireMarketInstitutionalTwd({...options,fetcher:async()=>new Response('x'.repeat(64001))});assert.equal(oversized.status,'SOURCE_INVALID');
 const secret=await acquireMarketInstitutionalTwd({...options,fetcher:async()=>{throw Error('SYNTHETIC_PRIVATE_HEADER');}});assert.doesNotMatch(JSON.stringify(secret),/SYNTHETIC_PRIVATE_HEADER/);
});
test('candidate proof and saved Reader preserve lineage; no promotion or silent fallback',async()=>{
 const flow=await normalizeMarketInstitutionalTwd(payload(),DATE,RECEIVED),data=evidenceRows();data.flows=[];
 const proof=await buildRecommendationFoundationCandidate({data,identity,captures:[],officialActuals:[],marketFlow:flow});
 assert.equal(proof.candidate_only,true);assert.equal(proof.acquisition.foundation_candidate.member_publication_approved,false);
 assert.deepEqual(proof.business_writes,[]);assert.equal(data.flows.length,0);
 const ai={revision_id:identity.revision_id,correlation_id:identity.revision_id,generated_at:identity.generated_at,
  decision_v1:proof.decision,recommendation_stock_evidence:proof.acquisition};
 const read=await persistedFoundationCandidateInput(data,identity,ai);
 assert.equal(read.data.flows.length,3);assert.equal(read.data.failures.length,0);
 const laterReader={...identity,generated_at:new Date(Date.parse(identity.generated_at)+2000).toISOString()};
 assert.equal((await persistedFoundationCandidateInput(data,laterReader,ai)).data.flows.length,3);
 const late=structuredClone(ai),lateFlow=late.recommendation_stock_evidence.foundation_candidate.market_flow;
 const afterProducer=new Date(Date.parse(identity.generated_at)+500).toISOString();
 lateFlow.available_at=afterProducer;lateFlow.first_seen_at=afterProducer;
 for(const row of lateFlow.rows){row.captured_at=afterProducer;row.created_at=afterProducer;}
 const deniedLate=await persistedFoundationCandidateInput(data,laterReader,late);
 assert.equal(deniedLate.data.flows.length,0);assert(deniedLate.data.failures.includes('MARKET_FLOW_NOT_ADMISSIBLE'));
 for(const mutate of [a=>a.correlation_id='other',a=>a.recommendation_stock_evidence.foundation_candidate.market_flow.rows[0].net_amount++,
  a=>a.recommendation_stock_evidence.foundation_candidate.contract='WRONG',a=>a.recommendation_stock_evidence.foundation_candidate.market_flow.available_at='2099-01-01T00:00:00Z']){
  const bad=structuredClone(ai);mutate(bad);const denied=await persistedFoundationCandidateInput(data,identity,bad);
  assert.equal(denied.data.flows.length,0);assert(denied.data.failures.length);
 }
});
test('shared cache carries one immutable market capture; legacy caches never trigger a late fetch',async()=>{
 const flow=await normalizeMarketInstitutionalTwd(payload(),DATE,RECEIVED),data=evidenceRows();data.flows=[];
 let acquired=0,finished=0,saved;
 const options={signal:AbortSignal.timeout(2000),shadowOnly:false,
  claim:async()=>({data:saved?{status:'CACHED',payload:saved}:{status:'ACQUIRED',lease_id:'isolated-lease'},error:null}),
  finish:async(_lease,value)=>{finished++;saved=structuredClone(value);return {error:null};},
  acquire:async()=>{acquired++;return {business_date:identity.report_date,acquisition_cutoff:identity.generated_at,marketFlow:flow,captures:[]};}};
 const first=await sharedV2Acquisition(options),second=await sharedV2Acquisition(options);
 assert.deepEqual(second,first);assert.equal(acquired,1);assert.equal(finished,1);
 const proof=await buildRecommendationFoundationCandidate({data,identity,captures:[],officialActuals:[],marketFlow:second.marketFlow,evidenceCutoff:second.acquisition_cutoff});
 const ai={revision_id:identity.revision_id,correlation_id:identity.revision_id,generated_at:identity.generated_at,decision_v1:proof.decision,recommendation_stock_evidence:proof.acquisition};
 assert.equal((await persistedFoundationCandidateInput(data,identity,ai)).data.flows.length,3);
 const legacy=structuredClone(ai);delete legacy.recommendation_stock_evidence.foundation_candidate;
 assert.deepEqual(await persistedFoundationCandidateInput(data,identity,legacy),await persistedRecommendationReaderInput(data,identity,legacy));
 const invalid=structuredClone(ai);invalid.recommendation_stock_evidence.foundation_candidate.evidence_cutoff='2099-01-01T00:00:00Z';
 assert((await persistedFoundationCandidateInput(data,identity,invalid)).data.failures.includes('MARKET_FLOW_ACQUISITION_CUTOFF_INVALID'));
 const late=await buildRecommendationFoundationCandidate({data,identity,captures:[],officialActuals:[],marketFlow:flow,evidenceCutoff:'2026-09-06T22:49:59Z'});
 assert(late.decision.phase_evaluation.candidates.every(c=>c.reasons.includes('MARKET_REQUIRED_INSTITUTIONAL')));
});
test('candidate entrypoints preserve all auth, cache, Report/publication and member gates outside the exact source wiring',()=>{
 const root=new URL('../',import.meta.url),read=p=>readFileSync(new URL(p,root),'utf8');
 const reader='supabase/functions/get-report-payload/index.ts';
 const base=execFileSync('git',['show','754850ba1c66329d12eac8e98ab799e0a0c9123e:'+reader],{cwd:root,encoding:'utf8'});
 assert.equal(read(reader),base.replace('supabase-js@2"','supabase-js@2.115.0"').replace('import { persistedRecommendationReaderInput } from "../_shared/recommendation-stock-evidence.ts";','import { persistedFoundationCandidateInput as persistedRecommendationReaderInput } from "../_shared/recommendation-foundation-candidate.ts";'));
 const producer=read('supabase/functions/recommendation-stock-evidence-v1/index.ts');
 assert.match(producer,/scope==='SMOKE_2330'\|\|!marketDate\|\|evaluationPhase\(started\)!=='PREMARKET'\?Promise\.resolve\(null\):acquireMarketInstitutionalTwd/);
 assert.match(producer,/const proof=bundle\.marketFlow&&evaluationPhase\(identity\.generated_at\)==='PREMARKET'/);
 assert.match(producer,/marketFlow:bundle\.marketFlow,evidenceCutoff:bundle\.acquisition_cutoff/);
 assert.match(producer,/sharedV2Acquisition/);assert.match(producer,/authorizeInternalRequest/);
 assert.doesNotMatch(producer,/from\('institutional_flows'\)\.insert|\.upsert\(|create function|\.rpc\('.*publication/);
});

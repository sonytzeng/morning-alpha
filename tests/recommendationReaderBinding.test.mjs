// Synthetic negative controls; real Production readsets are verified DB-side only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {persistedRecommendationReaderInput} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';
import {buildEvidenceDecision,projectEvidenceDecision} from '../supabase/functions/_shared/decision-v1-evidence.ts';
import {evidenceRows,IDENTITY} from './fixtures/decision-evidence-rows.mjs';
const hash=async v=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(v)))),n=>n.toString(16).padStart(2,'0')).join('');
async function fixture(){
 const data=evidenceRows();
 const rows=data.quotes.filter(q=>q.symbol==='2330'&&q.phase==='close').map(q=>({...q,id:'stock:'+q.id,
  session:'REGULAR_COMPLETED',available_at:IDENTITY.generated_at,ingested_at:IDENTITY.generated_at,freshness_status:'provider_returned',
  raw_payload:{contract:'RECOMMENDATION_STOCK_EVIDENCE_V1',endpoint:'historical/candles',source_hash:'a'.repeat(64),evidence_session_date:q.trading_date,
   volume_unit:'SHARES',volume_shares:1000000,amount_unit:'TWD',amount_twd:100000000}}));
 for(const q of data.quotes.filter(q=>q.symbol==='2330'&&q.phase==='close')){q.id='a-core:'+q.id;q.raw_payload={};}
 const capture={symbol:'2330',endpoint:'historical/candles',status:'PASS',received_at:IDENTITY.generated_at,rows,payload_hash:await hash(rows.map(q=>q.raw_payload.source_hash))};
 const ai={revision_id:IDENTITY.revision_id,correlation_id:'ISOLATED_PRODUCER_RUN_ID',generated_at:IDENTITY.generated_at,
  decision_v1:{schema_version:'decision-evidence-v1',revision_id:'ISOLATED_PRODUCER_RUN_ID',report_date:IDENTITY.report_date,generated_at:IDENTITY.generated_at,phase_evaluation:{evaluation_phase:'PREMARKET',candidates:[]}},
  recommendation_stock_evidence:{contract:'RECOMMENDATION_STOCK_EVIDENCE_V1',business_date:IDENTITY.report_date,cutoff:IDENTITY.generated_at,captures:[capture]}};
 return {data,ai,rows};
}
test('same-revision saved capture restores whole candle volume; partial Core quote never overwrites it',async()=>{
 const {data,ai,rows}=await fixture(),before=structuredClone(data),result=await persistedRecommendationReaderInput(data,IDENTITY,ai);
 assert.equal(result.data.quotes.length,data.quotes.length+rows.length);assert.deepEqual(data,before);
 const old=buildEvidenceDecision(data,IDENTITY),fixed=buildEvidenceDecision(result.data,IDENTITY);
 assert(old.screening.rejected.find(r=>r.symbol==='2330').reasons.includes('20_DAILY_VOLUMES_MISSING'));
 assert(!fixed.screening.rejected.some(r=>r.symbol==='2330'&&r.reasons.includes('20_DAILY_VOLUMES_MISSING')));
 assert.equal(fixed.schema_version,old.schema_version);assert.equal(fixed.direction_probability,null);
});
test('revision/date/cutoff/generated-at mismatches never reuse producer data',async()=>{
 for(const mutate of [x=>x.revision_id='other',x=>x.correlation_id='other',x=>x.decision_v1.revision_id='other',x=>x.decision_v1.report_date='2026-09-08',x=>x.recommendation_stock_evidence.cutoff='2026-09-07T02:01:00Z',x=>x.decision_v1.generated_at='2026-09-07T02:01:00Z']){
  const {data,ai}=await fixture();mutate(ai);const r=await persistedRecommendationReaderInput(data,IDENTITY,ai);assert.equal(r.data.quotes.length,data.quotes.length);assert(r.data.failures.includes('PERSISTED_RECOMMENDATION_REVISION_MISMATCH'));
 }
});
test('hash, availability, session and duplicate capture tampering is denied',async()=>{
 for(const mutate of [c=>c.payload_hash='b'.repeat(64),c=>c.rows[0].available_at='2026-09-07T02:01:00Z',c=>c.rows[0].session='UNKNOWN',c=>c.rows[0].raw_payload.source_hash='not-a-hash']){
  const {data,ai}=await fixture();mutate(ai.recommendation_stock_evidence.captures[0]);const r=await persistedRecommendationReaderInput(data,IDENTITY,ai);assert.equal(r.data.quotes.length,data.quotes.length);assert(r.data.failures.some(x=>/HASH_MISMATCH|PROVENANCE_INVALID/.test(x)));
 }
 const {data,ai}=await fixture();ai.recommendation_stock_evidence.captures.push(ai.recommendation_stock_evidence.captures[0]);
 assert((await persistedRecommendationReaderInput(data,IDENTITY,ai)).data.failures.includes('PERSISTED_RECOMMENDATION_DUPLICATE_CAPTURE'));
});
test('price conflicts remain fail-closed; missing TWD/consensus remains insufficient',async()=>{
 const {data,ai}=await fixture(),result=await persistedRecommendationReaderInput(data,IDENTITY,ai);data.flows=[];data.earnings=[];
 const missing=buildEvidenceDecision({...result.data,flows:[],earnings:[]},IDENTITY);
 assert.equal(missing.action,'INSUFFICIENT_DATA');assert(missing.screening.rejected.every(r=>r.reasons.includes('THREE_INSTITUTIONS_MISSING')&&r.reasons.includes('FOUR_QUARTER_FUNDAMENTAL_EVIDENCE_MISSING')));
 const conflict=structuredClone(result.data);conflict.quotes.find(q=>q.symbol==='2330'&&q.phase==='close').value*=1.1;
 const denied=buildEvidenceDecision(conflict,IDENTITY);assert(denied.issues.includes('CONFLICTING_QUOTES'));assert.equal(denied.stock_opportunities.length,0);
});
test('Free/unpublished and unapproved symbols remain hidden; canonical STOP is never overridden',async()=>{
 const {data,ai}=await fixture(),result=await persistedRecommendationReaderInput(data,IDENTITY,ai),decision=buildEvidenceDecision(result.data,IDENTITY);
 assert.equal(projectEvidenceDecision(decision,{companyContentAllowed:false,canonicalAction:'WAIT',publishedSymbols:[]}).stock_opportunities.length,0);
 assert.equal(projectEvidenceDecision(decision,{companyContentAllowed:true,canonicalAction:'STOP',publishedSymbols:['2330']}).stock_opportunities.length,0);
 assert.deepEqual(projectEvidenceDecision(decision,{companyContentAllowed:true,canonicalAction:'ACT',publishedSymbols:[]}).stock_opportunities,[]);
});
test('actual Reader wire remains read-side only and every original publication/entitlement gate remains',()=>{
 const page=readFileSync(new URL('../supabase/functions/get-report-payload/index.ts',import.meta.url),'utf8');
 assert(page.includes('persistedRecommendationReaderInput(realEvidence, decisionIdentity, parseAi(report.ai_strategy_json))'));
 for(const s of ['tier !== "free"','publicMetadata.premium_content_status === "eligible"','isCanonicalMemberRevisionEligible(context)','MARKET_ANALYSIS_UNPUBLISHED'])assert(page.includes(s));
 const helper=readFileSync(new URL('../supabase/functions/_shared/recommendation-stock-evidence.ts',import.meta.url),'utf8').split('export async function persistedRecommendationReaderInput')[1];
 assert.doesNotMatch(helper,/fetch\(|\.insert\(|\.update\(|Deno\.env/);
});

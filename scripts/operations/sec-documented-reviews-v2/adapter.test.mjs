import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseDocumentedReviewRegistry,stripVerifiedDocumentedReviews,applyDocumentedReviews,
 documentedReviewState,withDocumentedReviewV2Financials,withDocumentedReviewV2SourceRpc} from '../../../research/documented-review-replay-v2.candidate.ts';
import {DOCUMENTED_REVIEW_V2_CONTRACT as C} from '../../../research/documented-review-v2-contract.candidate.ts';
import {evaluateResearch} from '../../../src/features/vnext/researchFunnel.ts';
const registry=JSON.parse(await readFile(new URL('./sealed-registry.json',import.meta.url),'utf8'));
const all=JSON.parse(await readFile('/workspace/scratch/3d0c86e17b1f/evidence/2330-long-bound-reviews-v2-new72.inputs.json','utf8'));
const cutoff='2026-10-31T12:00:00Z',signal=()=>new AbortController().signal;
const base=()=>all.map(i=>({...structuredClone(i),cutoff}));
const facts=inputs=>inputs.find(s=>s.symbol==='2330').facts;
const reviews=inputs=>facts(inputs).filter(f=>f.id.startsWith('own-documented-review:'));
const financial=inputs=>({inputs,cutoff,additionalGaps:[],gapsBySymbol:{'2330':['SEC_RELEASE_NOT_BOARD_APPROVED_AT_RELEASE_REVISIONS_AND_QUALITATIVE_REVIEW_PENDING']},
 receipts:[],removed:[],proof:{schema:'DAILY_AI_FINANCIAL_REFRESH_V1',observed_at:cutoff,responses:[],additions:[],removals:[],company_names:[],sec_replay:{unchanged:'V1'}}});
test('sealed three-fact registry has visible quote/expiry/scenario limits and unchanged judgments',async()=>{
 const parsed=await parseDocumentedReviewRegistry(registry,cutoff);assert.deepEqual(parsed,registry.facts);
 assert.deepEqual(parsed.map(f=>f.values.verdict),['SUPPORTED','SUPPORTED','NOT_SUPPORTED']);
 for(const f of parsed){assert.equal(f.values.review_valid_until,C.review_valid_until);assert.equal(f.values.review_price_close_twd,2370);
  assert(f.values.source_authority_zh.includes('不是SEC'));assert.equal(f.source_admitted,false);assert.equal(f.member_publication_approved,false);}
 const v=parsed[2].values;assert(v.optimistic_model_value_twd>2370);assert(v.optimistic_discount_25_threshold_twd<2370);
 assert(v.optimistic_r8_counterexample_discount25_twd>2370);assert(v.distribution_limitations_zh.includes('不是已核實FCFE'));
});
test('V2 financial wrapper strips only exact reviews before invoking unchanged V1',async()=>{
 const inputs=base(),before=structuredClone(inputs);let called=0;
 const wrapped=withDocumentedReviewV2Financials(async req=>{called++;assert.equal(reviews(req.inputs).length,0);
  assert.equal(facts(req.inputs).filter(f=>f.id.startsWith('sec-quarter:')).length,12);return financial(req.inputs);});
 const result=await wrapped({inputs,businessDate:'2026-10-31',clock:()=>cutoff,fetcher:()=>assert.fail('no HTTP'),signal:signal()});
 assert.equal(called,1);assert.equal(reviews(result.inputs).length,0);assert.deepEqual(inputs,before);
});
test('current price/date/expiry activate reviews once and invalidation returns LONG to insufficient',async()=>{
 const clean=await stripVerifiedDocumentedReviews(base());
 const active=await applyDocumentedReviews(clean,registry.facts,cutoff);assert.equal(reviews(active.inputs).length,3);
 const long=evaluateResearch(active.inputs.find(s=>s.symbol==='2330'),'LONG');assert.equal(long.evaluated,true);assert.deepEqual(long.reasons,['VALUATION:NOT_SUPPORTED']);
 for(const [at,change,expected] of [
  [C.review_valid_until,()=>{},'EXPIRED_NOT_APPLIED'],
  [cutoff,i=>{const s=i.find(s=>s.symbol==='2330');s.bars.find(b=>b.date===s.through).close=2371;},'PRICE_CHANGED_NOT_APPLIED'],
  [cutoff,i=>{i.find(s=>s.symbol==='2330').through='2026-10-29';},'PRICE_DATE_CHANGED_NOT_APPLIED'],
  [cutoff,i=>{const s=i.find(s=>s.symbol==='2330');s.bars=s.bars.filter(b=>b.date!==s.through);},'PRICE_DATE_UNVERIFIED_NOT_APPLIED'],
  [cutoff,i=>{const s=i.find(s=>s.symbol==='2330');s.facts=s.facts.filter(f=>!f.id.startsWith('sec-quarter:'));},'FINANCIAL_BASE_INCOMPLETE_NOT_APPLIED'],
 ]){const input=base();change(input);const result=await applyDocumentedReviews(input,registry.facts,at);
  assert.equal(result.proof.state,expected);assert.equal(reviews(result.inputs).length,0);
  assert.equal(evaluateResearch(result.inputs.find(s=>s.symbol==='2330'),'LONG').state,'INSUFFICIENT');}
});
test('final SOURCE RPC uses merged price, preserves V1 proof, and passes other RPCs unchanged',async()=>{
 const input=await stripVerifiedDocumentedReviews(base()),target=input.find(s=>s.symbol==='2330');target.bars.find(b=>b.date===target.through).close=2371;
 const args={p_op:'SOURCE',p_inputs:input,p_financial_refresh:financial(input).proof,p_symbol_gaps:{'2330':['PRICE_GAP','SEC_RELEASE_NOT_BOARD_APPROVED_AT_RELEASE_REVISIONS_AND_QUALITATIVE_REVIEW_PENDING']}},before=structuredClone(args),abort=signal();
 let sourceArgs,otherArgs;
 const wrapped=withDocumentedReviewV2SourceRpc(async(name,a,s)=>{
  if(name==='load_daily_stock_ai_documented_reviews_v2')return registry;
  if(name==='daily_stock_ai_intake_v1'&&a.p_op==='SOURCE'){sourceArgs=a;assert.equal(s,abort);return {state:'SOURCED'};}
  otherArgs=a;assert.equal(s,abort);return {unchanged:true};
 },()=>cutoff);
 await wrapped('daily_stock_ai_intake_v1',args,abort);
 assert.equal(sourceArgs.p_financial_refresh.documented_review_replay.state,'PRICE_CHANGED_NOT_APPLIED');
 assert.deepEqual(sourceArgs.p_financial_refresh.sec_replay,args.p_financial_refresh.sec_replay);assert.equal(reviews(sourceArgs.p_inputs).length,0);
 assert(sourceArgs.p_symbol_gaps['2330'].includes('DOCUMENTED_REVIEWS_STALE_OR_UNAVAILABLE_NOT_APPLIED_LONG_REQUIRES_REFRESH'));
 assert.deepEqual(args,before);const other={p_op:'CLAIM'};await wrapped('daily_stock_ai_intake_v1',other,abort);assert.equal(otherArgs,other);
 // CLAIM passes straight through the original function, without registry load.
});
test('transport loss removes application without fabrication; invalid seals remain hard failures',async()=>{
 const args={p_op:'SOURCE',p_inputs:base(),p_financial_refresh:financial(base()).proof,p_symbol_gaps:{'2330':[]}};let saved;
 const wrapped=withDocumentedReviewV2SourceRpc(async(name,a)=>{if(name==='load_daily_stock_ai_documented_reviews_v2')throw Error('unavailable');saved=a;return {};},()=>cutoff);
 await wrapped('daily_stock_ai_intake_v1',args,signal());assert.equal(saved.p_financial_refresh.documented_review_replay.state,'REGISTRY_UNAVAILABLE_NOT_APPLIED');assert.equal(reviews(saved.p_inputs).length,0);
 for(const change of [r=>r.facts[0].source_admitted=true,r=>r.facts[2].values.verdict='SUPPORTED',r=>r.review_valid_until='2030-01-01T00:00:00Z']){
  const r=structuredClone(registry);change(r);await assert.rejects(()=>parseDocumentedReviewRegistry(r,cutoff),/INVALID/);}
 const bad=base();reviews(bad)[0].values.verdict='NOT_SUPPORTED';await assert.rejects(()=>stripVerifiedDocumentedReviews(bad),/INVALID/);
});

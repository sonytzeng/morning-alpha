/** Real pinned financial reference and policy; synthetic acquisition controls. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {evaluateResearch} from '../src/features/vnext/researchFunnel.ts';
import {mergeIssuerDocumentedReviews} from '../src/features/vnext/issuerDocumentedReviewIntake.ts';
import {retainedIssuerDocumentedReviews as binding} from '../supabase/functions/_shared/retained-documented-reviews.ts';
import {RECOMMENDATION_UNIVERSE} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';
const clone=v=>structuredClone(v),{packet}=binding,base=Date.parse(packet.reviewed_at),at=n=>new Date(base+n).toISOString();
async function fixture({cutoff=at(1000),price=2330,extra=[],date='2026-11-02',next='2026-11-03'}={}){
 const bar={id:'synthetic-quote-control',date,source:'https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=20261101&stockNo=2330',
  open:2310,high:2345,low:2310,close:price,volume:41165068,amount:95950896264,session_scope:'OFFICIAL_STOCK_DAY',evidence_hash:'a'.repeat(64),published_at:null,
  first_seen_at:'2026-11-02T23:01:01.847Z',available_at:'2026-11-02T23:01:01.847Z',as_of:date+'T13:30:00+08:00'};
 const input={inputs:RECOMMENDATION_UNIVERSE.map(symbol=>({symbol,company:symbol,cutoff,through:date,next_session:next,expected_sessions:[],
  facts:symbol==='2330'?[...clone(packet.financial_reference),...clone(extra)]:[],bars:symbol==='2330'?[bar]:[],v1_missing:{SHORT:['NOT_EVALUATED'],MEDIUM:['NOT_EVALUATED'],LONG:['NOT_EVALUATED']}})),
  entry:null,evidence_cutoff:cutoff};return {...input,snapshot_hash:await snapshotHash(input)};
}
const stock=x=>x.inputs.find(i=>i.symbol==='2330');
const rehash=async x=>{const {snapshot_hash,...body}=x;return {...body,snapshot_hash:await snapshotHash(body)};};
const clock=(...times)=>()=>times.length>1?times.shift():times[0];

test('fresh policy reconstructs the original three scenarios and complete LONG waits only for valuation',async()=>{
 assert.equal(await snapshotHash(packet),binding.expectedHash);assert.equal(packet.source_documents.length,9);
 assert.equal(packet.financial_reference.length,12);assert.equal(packet.max_age_days,7);
 const input=await fixture(),before=clone(input),out=await mergeIssuerDocumentedReviews(input,binding,clock(at(2000),at(3000)));
 assert.deepEqual(input,before);assert.equal(out.evidence_cutoff,at(3000));assert(out.inputs.every(i=>i.cutoff===at(3000)));
 const facts=stock(out).facts.filter(f=>['DEMAND','MOAT','VALUATION'].includes(f.kind));assert.equal(facts.length,3);
 for(const f of facts){const {evidence_hash,...body}=f;assert.equal(evidence_hash,await snapshotHash(body));
  assert.equal(f.reviewed_at,packet.reviewed_at);assert.equal(f.evaluated_at,at(2000));assert.equal(f.available_at,at(2000));
  assert.equal(f.source_admitted,false);assert.equal(f.member_publication_approved,false);assert.equal(f.review_price_basis.close_twd,2330);
  assert.match(f.values.computation,/NOT_NEW_INDEPENDENT_REVIEW/);assert.equal(f.policy_expires_at,packet.expires_at);}
 const v=facts.find(f=>f.kind==='VALUATION').values;
 assert(Math.abs(v.conservative_discount_25_threshold_twd-650.9725)<1e-8);
 assert(Math.abs(v.base_discount_25_threshold_twd-1174.17409309445)<1e-8);
 assert(Math.abs(v.optimistic_discount_25_threshold_twd-2055.3516666651776)<1e-8);
 assert.equal(v.verdict,'NOT_SUPPORTED');
 const long=evaluateResearch(stock(out),'LONG');assert.equal(long.evaluated,true);assert.equal(long.state,'REJECTED');assert.deepEqual(long.reasons,['VALUATION:NOT_SUPPORTED']);
 assert.deepEqual(out.inputs.filter(i=>i.symbol!=='2330').map(i=>i.facts),input.inputs.filter(i=>i.symbol!=='2330').map(i=>i.facts));
});

test('new arithmetic uses the new quote and receipt time, never an inherited quote verdict',async()=>{
 const x=await fixture({price:2100}),out=await mergeIssuerDocumentedReviews(x,binding,clock(at(2000),at(3000))),v=stock(out).facts.find(f=>f.kind==='VALUATION');
 assert.equal(v.review_price_basis.close_twd,2100);assert.match(v.values.analysis_zh,/2100/);
 const y=await fixture({price:2000}),held=await mergeIssuerDocumentedReviews(y,binding,clock(at(2000),at(3000)));
 assert.equal(stock(held).facts.length,12);assert(held.source_issues.some(s=>s.reason==='SCENARIO_SELECTION_REQUIRES_NEW_REVIEW'));
 assert.equal(evaluateResearch(stock(held),'LONG').state,'INSUFFICIENT');
});

test('exact independent policy expiry and future review hold out all three decisions',async()=>{
 for(const [time,reason]of [[at(-1),'POLICY_NOT_YET_AVAILABLE'],[packet.expires_at,'POLICY_REVIEW_EXPIRED']]){
  const input=await fixture({cutoff:at(-1000)}),out=await mergeIssuerDocumentedReviews(input,binding,clock(time));
  assert.equal(stock(out).facts.length,12);assert(out.source_issues.some(s=>s.reason===reason));
 }
});

test('changed financial originals, mixed quarter, and newer reported quarter require semantic review',async()=>{
 for(const change of [f=>f.values.value+=1,f=>f.source_sha256='b'.repeat(64),f=>f.evidence_hash='b'.repeat(64),f=>f.period='2026-Q4']){
  const input=await fixture();change(stock(input).facts[0]);const out=await mergeIssuerDocumentedReviews(await rehash(input),binding,clock(at(2000)));
  assert.equal(stock(out).facts.length,12);assert(out.source_issues.some(s=>s.reason==='FINANCIAL_QUARTER_OR_FINGERPRINT_CHANGED_REQUIRES_REVIEW'));
 }
 const next={...clone(packet.financial_reference[0]),id:'synthetic-newer-reported',kind:'EPS_AS_REPORTED',period:'2026-Q4'};
 const out=await mergeIssuerDocumentedReviews(await fixture({extra:[next]}),binding,clock(at(2000)));
 assert.equal(stock(out).facts.length,13);assert(out.source_issues.some(s=>s.reason==='NEW_FINANCIAL_PERIOD_REQUIRES_REVIEW'));
});

test('duplicate, future or same-day incomplete quote cannot be repriced',async()=>{
 for(const change of [s=>s.bars.push(clone(s.bars[0])),s=>s.bars[0].available_at=at(4000),s=>s.through='2026-11-03']){
  const input=await fixture();change(stock(input));const out=await mergeIssuerDocumentedReviews(await rehash(input),binding,clock(at(2000)));
  assert.equal(stock(out).facts.length,12);assert(out.source_issues.some(s=>s.reason==='SOLE_COMPLETED_QUOTE_REQUIRED'));
 }
});

test('new cutoff follows actual evaluation and a reversed clock cannot insert future facts',async()=>{
 const input=await fixture();await assert.rejects(()=>mergeIssuerDocumentedReviews(input,binding,clock(at(2000),at(1999))),/FINAL_CUTOFF/);
 await assert.rejects(()=>mergeIssuerDocumentedReviews(input,binding,clock(at(999))),/EVALUATION_TIME/);
 const p=clone(packet);p.scenarios[0].r=.11;
 const changed={packet:p,expectedHash:await snapshotHash(p)};await assert.rejects(()=>mergeIssuerDocumentedReviews(input,changed,clock(at(2000))),/POLICY_PARAMETERS/);
 const expired=await fixture();const closed=await mergeIssuerDocumentedReviews(expired,binding,clock('2026-11-03T13:30:00+08:00'));
 assert.equal(stock(closed).facts.length,12);assert(closed.source_issues.some(s=>s.reason==='QUOTE_REVIEW_SESSION_CLOSED'));
});

test('a policy expiring mid-session cannot create a LONG lock that survives to13:30',async()=>{
 const input=await fixture({date:'2026-11-09',next:'2026-11-10',cutoff:'2026-11-10T00:30:00Z'});
 const out=await mergeIssuerDocumentedReviews(input,binding,clock('2026-11-10T00:30:01Z'));
 assert.equal(stock(out).facts.length,12);assert(out.source_issues.some(s=>s.reason==='POLICY_EXPIRES_BEFORE_SESSION_REVIEW'));
 assert.equal(evaluateResearch(stock(out),'LONG').state,'INSUFFICIENT');
});

test('source and evaluation metadata preserve exact microsecond order',async()=>{
 const input=await fixture(),cutoff=at(1000).replace('.860Z','.860001Z');input.evidence_cutoff=cutoff;for(const i of input.inputs)i.cutoff=cutoff;
 const changed=await rehash(input);await assert.rejects(()=>mergeIssuerDocumentedReviews(changed,binding,clock(at(1000))),/EVALUATION_TIME/);
 const p=clone(packet);p.source_documents[0].received_at=p.reviewed_at.replace('.860Z','.860001Z');
 const b={packet:p,expectedHash:await snapshotHash(p)};
 const current=await fixture();await assert.rejects(()=>mergeIssuerDocumentedReviews(current,b,clock(at(2000))),/SOURCE_SCOPE/);
 const crosses=await fixture();await assert.rejects(()=>mergeIssuerDocumentedReviews(crosses,binding,clock(at(2000),'2026-11-10T00:39:12.860Z')),/FINAL_CUTOFF/);
});

test('the seven-day hard limit cannot gain a microsecond through millisecond truncation',async()=>{
 const p=clone(packet);p.expires_at=p.expires_at.replace('.860Z','.860001Z');const b={packet:p,expectedHash:await snapshotHash(p)},input=await fixture();
 await assert.rejects(()=>mergeIssuerDocumentedReviews(input,b,clock(at(2000))),/PACKET_SCOPE/);
});

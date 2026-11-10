import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {parseRetained2330LongObservations,longObservationEvidence,prepareDailyAiLongRationale} from '../research/daily-ai-long-rationale.ts';
import {authorDailyResearchWithLongPreparation} from '../research/daily-ai-long-author-preparation.mjs';
import {authorDailyResearch} from '../research/daily-ai-zero-paid-author.mjs';
import {buildDailyAiActualPriceInput} from '../research/daily-ai-financial-inputs.ts';
import {LONG_EPS_DIVIDEND_METHOD} from '../research/daily-ai-price-calculation.ts';
import {canonical,nextEntrySession} from '../research/entry-opportunity.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {evaluateResearch} from '../src/features/vnext/researchFunnel.ts';
import {validateAnalysisPacket} from '../research/daily-ai-analysis.ts';
import {previousMarketTradingDate} from '../supabase/functions/_shared/market-session-contract.mjs';
import {validateReviewedAnalysisSnapshot} from '../research/reviewed-snapshot-validator.mjs';

const periods=['2025-Q4','2026-Q1','2026-Q2','2026-Q3'];
const now=Date.parse('2026-11-10T00:10:00Z'),asOf='2026-11-10T00:05:00Z',expiry='2026-11-10T05:30:00Z';
const sha=x=>createHash('sha256').update(x).digest('hex');
function document(period,kind,body){const [year,q]=period.split('-Q'),n=Number(q),file=kind==='release'?`a${n}q${year.slice(-2)}e_withguidancexfinal.htm`:`a${n}q${year.slice(-2)}presentatione.htm`;
 return {period,kind,url:`https://www.sec.gov/Archives/edgar/data/1046179/000104617926000008/${file}`,body,bytes:Buffer.byteLength(body),sha256:sha(body),received_at:'2026-11-07T12:00:00Z'};}
function rawSources(){
 const quarters=periods.map((period,i)=>{const [y,q]=period.split('-Q'),year=Number(y),n=Number(q),label=q+'Q'+y.slice(-2),previous=n===1?'4Q'+String(year-1).slice(-2):(n-1)+'Q'+y.slice(-2),prior=q+'Q'+String(year-1).slice(-2);
  const end=new Date(Date.UTC(year,n*3,0)).getUTCDate(),month=['March','June','September','December'][n-1],word=['first','second','third','fourth'][n-1];
  const release=document(period,'release',`<p>EX-99.1 TSMC (TWSE: 2330, NYSE: TSM) announced consolidated revenue of NT$1,000.00 billion for the ${word} quarter ended ${month} ${end}, ${year}. All figures were prepared in accordance with TIFRS on a consolidated basis. diluted earnings per share of NT$2.50 (US$0.40 per ADR unit) Gross margin for the quarter was 50.0%, operating margin was 40.0%, and net profit margin was 30.0% Year-over-year, ${word} quarter revenue ${i===2?'decreased 2.0':'increased 10.0'}% Advanced technologies, defined as 7-nanometer and more advanced technologies, accounted for ${70+i}% of total wafer revenue</p>`);
  const presentation=document(period,'presentation',`EX-99.2 Cash Flows * Free cash flow = Cash from operating activities (In NT$ billions) ${label} ${previous} ${prior} Beginning Balance Cash from operating activities 100.00 99.00 90.00 Capital expenditures (40.00) (30.00) (20.00) Free Cash Flow * 60.00 69.00 70.00 Guidance`);
  return {release,presentation};
 });
 const body='In 2023 , 2024 , and 2025 , we spent NT$ 100 million, NT$ 110 million, and NT$ 120 million (US$ 4 million), respectively, on research and development. In 2025 , our annual capacity (in 12-inch equivalent wafers) exceeded 17 million wafers. Competition Risks';
 const annual={period:'2025-FY',kind:'annual',url:'https://www.sec.gov/Archives/edgar/data/1046179/000162828026025362/tsm-20251231.htm',body,bytes:Buffer.byteLength(body),sha256:sha(body),received_at:'2026-11-07T12:01:00Z'};
 return {quarters,annual,source_cutoff:'2026-11-08T12:00:00Z',derived_at:'2026-11-09T12:00:00Z'};
}
const evidence=(id,kind,body)=>({id,symbol:'2330',kind,source:'https://www.sec.gov/synthetic-long-rationale',published_at:'2026-11-07T12:00:00Z',
 available_at:'2026-11-07T12:00:00Z',time_basis:'PUBLISHED',content:JSON.stringify(body)});
function packet(supplement=null){
 const price=evidence('quote','PRICE',{date:'2026-11-09',open:99,high:101,low:98,close:100,volume:1000000,amount:100000000,currency:'TWD',session_scope:'SYNTHETIC_COMPLETE_SESSION'});
 price.published_at=price.available_at='2026-11-09T09:05:00Z';
 return {symbol:'2330',company:'合成財務條件公司',cutoff:'2026-11-09T22:00:00Z',data_through:'2026-11-09',evidence:[price,
  ...periods.map((period,i)=>evidence('eps-'+i,'FINANCIAL',{kind:'EPS',period,basis:'SINGLE_QUARTER',values:{value:2.5,reported_decimal:'2.50',unit:'TWD_PER_COMMON_SHARE',measurement_basis:'DILUTED',consolidation:'CONSOLIDATED'}})),
  ...periods.map((period,i)=>evidence('margin-'+i,'FINANCIAL',{kind:'MARGIN',period,basis:'SINGLE_QUARTER',values:{value:i===3?49:50,unit:'PERCENT'}})),
  ...periods.map((period,i)=>evidence('cash-'+i,'FINANCIAL',{kind:'CAPEX',period,basis:'SINGLE_QUARTER',values:{value:1000000000,unit:'TWD',
   operating_cashflow_twd:2000000000,free_cashflow_twd:1000000000,measurement_basis:'DIRECTLY_REPORTED_QUARTER_CAPITAL_EXPENDITURES',amount_resolution_twd:10000000}})),
  ...(supplement?supplement.facts.map(longObservationEvidence):[]),
 ]};
}
function policy(){return {schema:'DAILY_AI_ACTUAL_PRICE_POLICY_V1',version:'SYNTHETIC_LONG_REVIEW_ARITHMETIC_V1',symbol:'2330',horizon:'LONG',method_id:LONG_EPS_DIVIDEND_METHOD,
 formed_at:'2026-11-10T00:00:00Z',description:'Synthetic scenario assumptions for review-pipeline tests only; no real method endorsement.',evidence_ids:periods.map((_,i)=>'eps-'+i),
 earnings_period:{start:'2025-10-01',end:'2026-09-30'},scenarios:['conservative','base','upside'].map((name,i)=>({name,eps_growth_rates:[0,0],payout_ratios:[.5,.5],required_return:.1,terminal_pe:10+i*2})),
 entry_scenarios:['conservative','base'],margin_of_safety:.2,invalidation:'來源或假設更新時重新計算與審查。'};}
async function inputFor(p){const result=await buildDailyAiActualPriceInput({packet:p,as_of:asOf,expires_at:expiry,policy:policy()});assert.equal(result.status,'INPUT_READY_REVIEW_REQUIRED');return result.calculation_input;}
const prepare=(p,input=null,source=null)=>prepareDailyAiLongRationale({packet:p,calculation_input:input,source_supplement:source,as_of:asOf,expires_at:expiry,now});

test('the source parser retains signed reported changes and precision without making review judgments',async()=>{
 const sources=rawSources(),before=structuredClone(sources),result=await parseRetained2330LongObservations(sources);
 assert.deepEqual(result.observations.operating.map(o=>o.revenue_yoy_percent),[10,10,-2,10]);
 assert.equal(result.observations.capability.research_development_twd_million,120);
 assert.equal(result.observations.capability.wafer_capacity_12inch_equivalent_lower_bound,17000000);
 assert.equal(result.observations.capability.capacity_comparison,'GREATER_THAN');
 assert.equal(result.facts.length,2);assert.equal(result.admission_status,'PENDING_SOURCE_INTAKE');
 for(const f of result.facts){assert.equal(f.available_at,sources.derived_at);assert.notEqual(f.available_at,f.first_seen_at);
  assert.notEqual(f.basis,'DOCUMENTED_REVIEW');assert.equal(f.values.verdict,undefined);assert.equal(f.source_admitted,false);}
 const {supplement_hash,...body}=result;assert.equal(supplement_hash,await snapshotHash(body));assert.deepEqual(sources,before);assert(Object.isFrozen(result));
});

test('raw hash, issuer, ambiguous locations and source/derivation chronology are verified before extraction',async()=>{
 for(const edit of [s=>{s.quarters[0].release.body+='tamper';},s=>{s.annual.url=s.annual.url.replace('1046179','1234567');},
  s=>{s.derived_at='2026-11-08T11:59:59.999999Z';},s=>{s.quarters[0].release.received_at='2026-11-08T12:00:00.000001Z';},
  s=>{const d=s.quarters[0].release;d.body+=' Advanced technologies, defined as 7-nanometer and more advanced technologies, accounted for 99% of total wafer revenue';d.bytes=Buffer.byteLength(d.body);d.sha256=sha(d.body);},
 ]){const source=rawSources();edit(source);await assert.rejects(()=>parseRetained2330LongObservations(source),/LONG_RATIONALE_INVALID|SEC_QUARTER_SOURCE_INVALID/);}
});

test('already available financials are separated from missing sources and unperformed reviews',async()=>{
 const p=packet();p.evidence.push(evidence('expired-old-review','FINANCIAL',{kind:'MOAT',period:'2026-Q3',basis:'DOCUMENTED_REVIEW',values:{verdict:'SUPPORTED',review_valid_until:'2026-11-02T05:30:00Z'}}));
 const result=await prepare(p);assert.equal(result.financial_observations.reported_eps.value,10);assert.equal(result.financial_observations.reported_cashflow.issuer_free_cashflow_twd,4000000000);
 assert.equal(result.status,'DATA_REQUIRED_REVIEW_PREPARATION');assert(result.missing.some(x=>x.code==='LONG_TECHNOLOGY_MIX_OBSERVATIONS_REQUIRED'));
 assert.equal(result.existing_review_context.state,'NOT_REUSED_FOR_NEW_JUDGMENT');assert.deepEqual(result.existing_review_context.evidence_ids,['expired-old-review']);
 assert(result.review_items.every(x=>x.review_status==='REVIEW_REQUIRED'&&x.verdict===null));assert.equal(result.review,null);assert.equal(result.selection_qualified,false);
});

test('new raw-source observations stay pending intake and do not silently appear in the original packet',async()=>{
 const source=await parseRetained2330LongObservations(rawSources()),p=packet(),before=structuredClone(p);
 const result=await prepare(p,await inputFor(p),source);assert.equal(result.pending_source_intake.length,2);
 assert.equal(result.review_items.find(x=>x.kind==='MOAT').observation_status,'SOURCE_REQUIRED');assert.deepEqual(p,before);
 const forged=structuredClone(source);forged.facts[0].values.observations_json='[]';await assert.rejects(()=>prepare(p,null,forged),/LONG_RATIONALE_INVALID: supplement/);
});

test('current packet observations and a real calculation create review material even when no old qualitative verdict exists',async()=>{
 const source=await parseRetained2330LongObservations(rawSources()),p=packet(source),input=await inputFor(p),result=await prepare(p,input,source);
 assert.equal(result.status,'READY_FOR_REVIEW');assert.deepEqual(result.pending_source_intake,[]);assert.deepEqual(result.missing,[]);
 assert.equal(result.review_items[0].observations.quarterly[2].revenue_yoy_percent,-2,'negative observations are preserved, not suppressed to obtain support');
 assert.equal(result.review_items[2].observations.relation,'ABOVE_SELECTED_RANGE');assert.deepEqual(result.review_items[2].observations.entry_range,[73.05,86.28]);
 assert(result.limitations.includes('LATEST_MARGIN_BELOW_PREVIOUS_QUARTER'));assert.equal(result.valuation_calculation.trace.scenarios[0].terminal.year,2);
 assert.equal(result.review_items[2].calculation_hash,result.valuation_calculation.calculation_hash);assert.equal(result.packet_hash,await snapshotHash(p));
 assert(result.review_items.every(x=>x.verdict===null));assert.equal(result.selection_qualified,false);assert.equal(result.member_published,false);
 const {preparation_hash,...body}=result;assert.equal(preparation_hash,await snapshotHash(body));
});

test('reprice preparation changes the exact calculation commitment without renewing demand or moat verdicts',async()=>{
 const supplement=await parseRetained2330LongObservations(rawSources()),p=packet(supplement),input=await inputFor(p),first=await prepare(p,input);
 const changed=structuredClone(p),quote=JSON.parse(changed.evidence[0].content);quote.close=101;changed.evidence[0].content=JSON.stringify(quote);
 await assert.rejects(()=>prepare(changed,input),/calculation.packet_binding/);
 const next=await prepare(changed,await inputFor(changed));assert.notEqual(first.preparation_hash,next.preparation_hash);
 assert.notEqual(first.valuation_calculation.calculation_hash,next.valuation_calculation.calculation_hash);
 assert.deepEqual(first.review_items[0],next.review_items[0]);assert.deepEqual(first.review_items[1],next.review_items[1]);
 const bad=structuredClone(input);bad.parameters.scenarios[0].required_return=0;
 await assert.rejects(()=>prepare(p,bad),/PRICE_CALCULATION_INVALID_INPUT/);
});

test('a conflicting or older operating series cannot silently substitute for the current earnings window',async()=>{
 const source=await parseRetained2330LongObservations(rawSources()),p=packet(source);
 const duplicate=structuredClone(p.evidence.find(e=>JSON.parse(e.content).kind==='LONG_DEMAND_OBSERVATIONS'));duplicate.id+='-conflicting';p.evidence.push(duplicate);
 await assert.rejects(()=>prepare(p),/operating.ambiguous_period/);
 const older=packet(source),e=older.evidence.find(e=>JSON.parse(e.content).kind==='LONG_DEMAND_OBSERVATIONS'),body=JSON.parse(e.content);
 const observations=JSON.parse(body.values.observations_json),oldPeriods=['2025-Q3','2025-Q4','2026-Q1','2026-Q2'];
 observations.forEach((o,i)=>{o.period=oldPeriods[i];});body.period='2026-Q2';body.values.observations_json=JSON.stringify(observations);e.content=JSON.stringify(body);
 const result=await prepare(older);assert(result.missing.some(x=>x.code==='LONG_OPERATING_EARNINGS_PERIOD_MISMATCH'));assert.equal(result.selection_qualified,false);
});

test('daily author wrapper executes the existing 72-stock validator and preserves the sealed snapshot while returning fresh review preparation',async()=>{
 const source=await parseRetained2330LongObservations(rawSources()),p=packet(source),input=await inputFor(p);
 const packet_texts={},packet_hashes={};
 for(let i=0;i<72;i++){const symbol=i===0?'2330':String(1000+i),item=structuredClone(p);item.symbol=symbol;item.company='合成公司 '+symbol;
  for(const e of item.evidence){e.symbol=symbol;e.id=symbol+':'+e.id;}
  if(i===0){item.evidence=p.evidence;item.company=p.company;}
  packet_texts[symbol]=canonical(item);packet_hashes[symbol]=await snapshotHash(item);
 }
 const batchText=canonical({schema:'DAILY_AI_BATCH_INPUT_V1',cutoff:p.cutoff,through:p.data_through,packet_texts,packet_hashes,gaps:[]});
 const args={batchText,prepared_at:asOf,expires_at:'2026-11-10T06:30:00Z',now},deps={canonical,snapshotHash,validateAnalysisPacket,evaluateResearch,previousMarketTradingDate,nextEntrySession,validateSnapshot:validateReviewedAnalysisSnapshot};
 const base=await authorDailyResearch(args,deps),wrapped=await authorDailyResearchWithLongPreparation(args,deps,{as_of:asOf,calculation_inputs:{'2330':input},source_supplements:{'2330':source},symbols:['2330']});
 assert.deepEqual(wrapped.body,base.body);assert.deepEqual(wrapped.prepared_request,base.prepared_request);
 assert.equal(wrapped.body.cards.find(c=>c.symbol==='2330'&&c.horizon==='LONG').status,'INSUFFICIENT');
 assert.equal(wrapped.long_review_preparation.items[0].status,'READY_FOR_REVIEW');assert.equal(wrapped.long_review_preparation.source_batch_unchanged,true);
 assert.equal(wrapped.long_review_preparation.member_published,false);assert.equal(wrapped.long_review_preparation.items[0].selection_qualified,false);
 assert.equal(wrapped.long_review_preparation.source_snapshot_hash,wrapped.validation.snapshot_hash);
 assert.equal(wrapped.long_review_preparation.expires_at,expiry,'An author edition cannot extend the explicitly shorter calculation lifetime.');
 await assert.rejects(()=>authorDailyResearchWithLongPreparation(args,deps,{as_of:asOf,calculation_inputs:{'9999':input},symbols:['2330']}),/LONG_AUTHOR_UNIVERSE/);
});

test('matching retained SEC originals reproduce the actual 2330 demand and capability observations',async t=>{
 const root=process.env.MA_FINANCIAL_RETAINED_ROOT;if(!root){t.skip('Set MA_FINANCIAL_RETAINED_ROOT to the already retained local source workspace.');return;}
 const directory=join(root,'long-evidence-20261108'),manifest=JSON.parse(await readFile(join(directory,'documents.json'),'utf8'));
 const load=async(period,kind)=>{const d=manifest.find(x=>x.period===period&&x.kind===kind),body=await readFile(join(directory,d.file),'utf8');
  return {period,kind,url:d.url,sha256:d.sha256,bytes:d.bytes,received_at:d.received_at,body};};
 const quarters=[];for(const period of periods)quarters.push({release:await load(period,'release'),presentation:await load(period,'presentation')});
 const result=await parseRetained2330LongObservations({quarters,annual:await load('2025-FY','annual'),source_cutoff:'2026-11-07T16:21:18.579Z',derived_at:new Date().toISOString()});
 assert.deepEqual(result.observations.operating.map(o=>o.revenue_twd_billion),[1046.09,1134.10,1270.38,1494.24]);
 assert.deepEqual(result.observations.operating.map(o=>o.revenue_yoy_percent),[20.5,35.1,36,50.9]);
 assert.deepEqual(result.observations.operating.map(o=>o.leading_edge_wafer_revenue_percent),[77,74,77,79]);
 assert.equal(result.observations.capability.research_development_twd_million,246427);assert.equal(result.observations.capability.wafer_capacity_12inch_equivalent_lower_bound,17000000);
 assert.equal(result.source_bindings.length,9);assert.equal(result.facts[0].values.verdict,undefined);assert.equal(result.source_admitted,false);
 if(process.env.MA_LONG_RATIONALE_RECEIPT)await writeFile(process.env.MA_LONG_RATIONALE_RECEIPT,JSON.stringify({scope:'ACTUAL_RETAINED_BYTES_NEW_DERIVATION_PENDING_INTAKE_NOT_REVIEW',new_data_acquired:false,production_written:false,supplement:result},null,2)+'\n');
});

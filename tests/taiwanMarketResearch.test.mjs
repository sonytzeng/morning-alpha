import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {marketSnapshotHash,planTaiwanMarketAnalysis} from '../research/taiwan-market-universe.mjs';
import {runTaiwanMarketResearch,peerRelativePrice,quantile,expectedTaiwanResearchQuoteDate} from '../research/taiwan-market-research.mjs';
const cutoff='2026-11-11T09:40:00.000Z',observed='2026-11-11T09:10:00.000Z';
const sha=v=>createHash('sha256').update(v).digest('hex');
function fixture(count=80){
 const companies=Array.from({length:count},(_,i)=>{const market=i<count-2?'TWSE':i===count-2?'TPEX':'EMERGING',symbol=String(1000+i);return {
  security_id:market+':'+symbol,symbol,market,company:'測試公司'+i,short_name:'測試簡稱'+i,industry_code:'24',instrument_kind:'ORDINARY_COMPANY_EQUITY',
  listing_status:'IN_OFFICIAL_COMPANY_ROSTER',listed_at:'2020-01-01'};});
 const body={schema:'TAIWAN_MARKET_UNIVERSE_V1',scope:'ALL_OFFICIAL_LISTED_OTC_EMERGING_COMPANY_EQUITIES',formed_at:'2026-11-11T08:00:00Z',
  total:count,companies,counts:Object.fromEntries(['TWSE','TPEX','EMERGING'].map(m=>[m,companies.filter(c=>c.market===m).length])),coverage_complete:true};
 const universe={...body,universe_hash:marketSnapshotHash(body)};
 const securities=companies.map((company,index)=>{
  const make=(family,values)=>{const source_capture={source_id:family,source_url:'https://openapi.twse.com.tw/v1/example',
    source_sha256:'b'.repeat(64),source_bytes:100,received_at:observed,row_index:index,row_path:[index],source_row_hash:'c'.repeat(64),symbol_field:'Code'};
   source_capture.capture_id=marketSnapshotHash({source_id:family,url:source_capture.source_url,source_sha256:source_capture.source_sha256,received_at:observed});
   return {schema:'TAIWAN_MARKET_OBSERVATION_V1',kind:family,source_as_of:'2026-11-11',symbol:company.symbol,market:company.market,
   family,available_at:observed,source_capture,...values};};
  return {security_id:company.security_id,company,issues:[],observations:[
   make('ROSTER',{company:company.company}),make('PRICE',{date:'2026-11-11',valid_trade:true,open:100,high:102,low:99,close:100,
    average:100,last:100,volume:1000000,amount:100000000}),
   make('REVENUE',{period:'2026-10',yoy_percent:20,yoy_arithmetic_verified:true}),
   make('INCOME',{period:'2026Q3',eps_basic:2}),make('BALANCE',{period:'2026Q3',assets:200,liabilities:50,equity:150,balance_identity_verified:true}),
   make('VALUATION',{date:'2026-11-11',financial_period:'2026Q2',pe:20,pb:2,close:100})]};
 });
 const fbody={schema:'TAIWAN_MARKET_FACT_SET_V1',universe_hash:universe.universe_hash,cutoff,securities};
 return {universe,plan:planTaiwanMarketAnalysis({universe,business_date:'2026-11-11',cutoff,shard_size:64}),facts:{...fbody,facts_hash:marketSnapshotHash(fbody)}};
}
function rehash(f){const {facts_hash,...body}=f.facts;void facts_hash;f.facts.facts_hash=marketSnapshotHash(body);return f;}
const resultStock=(run,id)=>run.shards.flatMap(s=>s.stocks).find(s=>s.security_id===id);
test('full-market runner exceeds legacy 72 safely, preserves all 3 horizons and cited content hashes',()=>{
 const input=fixture(),run=runTaiwanMarketResearch(input);
 assert.equal(run.coverage.cards_analyzed,240);assert.equal(run.coverage.security_count,80);assert.equal(run.shards.length,2);
 assert.equal(run.coverage.state,'ALL_SECURITIES_ANALYZED');assert.equal(run.member_published,false);assert.equal(run.coverage.formal_recommendations,0);
 for(const r of run.shards.flatMap(s=>s.stocks)){
  assert.equal(r.packet.company,input.universe.companies.find(c=>c.security_id===r.security_id).short_name);
  assert.equal(r.analysis.model_generated,false);assert.equal(r.analysis.input_hash,marketSnapshotHash(r.packet));
  const ids=new Set(r.packet.evidence.map(e=>e.id));for(const e of r.packet.evidence)assert.equal(e.evidence_hash,sha(e.content));
  assert.deepEqual(r.analysis.horizons.map(h=>h.horizon),['SHORT','MEDIUM','LONG']);
  for(const h of r.analysis.horizons)for(const c of [h.reason,...h.counter_evidence])assert.ok(c.evidence_ids.length&&c.evidence_ids.every(id=>ids.has(id)));
 }
});
test('peer prices use leave-one-out exact-date exact-period quantiles and remain research',()=>{
 const f=fixture(8),target=f.facts.securities[0],peers=f.facts.securities.slice(1,6),values=[10,12,14,16,18];
 peers.forEach((s,i)=>s.observations.find(o=>o.family==='VALUATION').pe=values[i]);
 const r=peerRelativePrice({security:target,securities:f.facts.securities});
 assert.equal(r.peer_count,5);assert.deepEqual(r.multiple_scenarios,[12,14,16]);assert.deepEqual(r.price_scenarios,[60,70,80]);
 assert.equal(r.buy_ready,false);assert.equal(r.forecast,false);assert.equal(r.production_eligible,false);
 peers[0].observations.find(o=>o.family==='VALUATION').financial_period=null;
 assert.equal(peerRelativePrice({security:target,securities:f.facts.securities}).state,'UNAVAILABLE');
});
test('quantiles handle real interpolation without pretending a confidence interval',()=>{
 assert.equal(quantile([10,20],0.25),12.5);assert.equal(quantile([3],0.75),3);assert.throws(()=>quantile([NaN],0.5));assert.throws(()=>quantile([],0.5));
});
test('old quotes cannot be WATCH after the official complete-session cutoff',()=>{
 const f=fixture(3),s=f.facts.securities[0];s.observations.find(o=>o.family==='PRICE').date='2026-11-10';rehash(f);
 const run=runTaiwanMarketResearch(f),h=resultStock(run,s.security_id).analysis.horizons.find(h=>h.horizon==='MEDIUM');
 assert.equal(run.expected_quote_date,'2026-11-11');assert.equal(h.status,'WAIT');assert.ok(h.gaps.includes('EXPECTED_COMPLETED_SESSION_QUOTE_REQUIRED'));
 assert.equal(expectedTaiwanResearchQuoteDate('2026-11-11T08:00:00Z'),'2026-11-10');
 assert.equal(expectedTaiwanResearchQuoteDate('2030-11-11T09:40:00Z'),null);
 assert.throws(()=>runTaiwanMarketResearch({...f,expected_quote_date:'2026-11-10'}),/EXPECTED_SESSION_MISMATCH/);
});
test('null financial periods cannot compare as a valid same-period positive-equity signal',()=>{
 const f=fixture(3),s=f.facts.securities[0];s.observations.find(o=>o.family==='INCOME').period=null;s.observations.find(o=>o.family==='BALANCE').period=null;rehash(f);
 const h=resultStock(runTaiwanMarketResearch(f),s.security_id).analysis.horizons.find(h=>h.horizon==='MEDIUM');
 assert.equal(h.status,'INSUFFICIENT');assert.ok(h.gaps.includes('PERIOD_IDENTIFIED_REPORTED_EARNINGS_REQUIRED'));
});
test('unverified corporate-action completion flags do not activate a short recommendation',()=>{
 const f=fixture(3);assert.throws(()=>runTaiwanMarketResearch({...f,corporate_actions:{'TWSE:1000':{complete:true}}}),/VERIFIED_CORPORATE_ACTION_ADAPTER_NOT_CONNECTED/);
});
test('long research requires actual annual statements; parent and total profit remain distinct',()=>{
 const f=fixture(3),s=f.facts.securities[0],records=[];
 for(const year of [2023,2024,2025])for(const family of ['INCOME','BALANCE','CASHFLOW']){
  const fields=family==='INCOME'?{'營業收入':'1000','本期淨利（淨損）':'100','淨利（淨損）歸屬於母公司業主':'80','基本每股盈餘（元）':'2'}:
   family==='BALANCE'?{'資產總計':'1000','權益總計':'500'}:{'營業活動之淨現金流入（流出）':'150'};
  const source_url='https://mopsov.twse.com.tw/server-java/t105sb02',source_id=family+year;
  const capture={source_id,source_url,source_sha256:'d'.repeat(64),source_bytes:100,received_at:observed,row_index:1,row_path:[1],symbol_field:'3',
   source_row_hash:'e'.repeat(64),parent_html_sha256:'f'.repeat(64),parent_html_record_hash:'a'.repeat(64),decoded_text_sha256:'b'.repeat(64)};
  capture.capture_id=marketSnapshotHash({source_id,url:source_url,source_sha256:capture.source_sha256,received_at:observed});
  const record={security_id:s.security_id,symbol:s.company.symbol,market:s.company.market,period:year+'Q4',family,fields,normalized_fields:fields,
   field_units:Object.fromEntries(Object.keys(fields).map(k=>[k,k.includes('每股')?'TWD_PER_SHARE':'TWD_THOUSANDS'])),
   period_basis:family==='BALANCE'?'POINT_IN_TIME_AS_REPORTED':'YTD_AS_REPORTED',period_identity_basis:'CSV_RESPONSE_YEAR_QUARTER_MATCHED_PARENT_REQUEST',
   period_scope:family==='BALANCE'?'POINT_IN_TIME':'FULL_FISCAL_YEAR_AS_REPORTED',period_definition_source:family==='BALANCE'?null:{url:'https://mopsfin.twse.com.tw/'},
   amount_unit:'TWD_THOUSANDS',amount_unit_basis:'MATCHED_PARENT_HTML_EXPLICIT_UNIT',source_cells_matched_parent_html:true,
   source_url,available_at:observed,first_seen_at:observed,source_capture:capture};records.push({...record,record_hash:marketSnapshotHash(record)});
 }
 const run=runTaiwanMarketResearch({...f,financial_history:{records}}),long=resultStock(run,s.security_id).analysis.horizons.find(h=>h.horizon==='LONG');
 assert.equal(long.status,'WATCH');const d=run.diagnostics.find(d=>d.security_id===s.security_id).long;
 assert.equal(d.annuals[0].parent_net_profit,80);assert.equal(d.annuals[0].net_profit,100);assert.equal(d.free_cash_flow_inferred,false);
 assert.equal(run.price_research.find(p=>p.security_id===s.security_id).long.state,'UNAVAILABLE');
 const incomplete=runTaiwanMarketResearch({...f,financial_history:{records:records.filter(r=>!(r.period==='2024Q4'&&r.family==='CASHFLOW'))}});
 assert.equal(resultStock(incomplete,s.security_id).analysis.horizons.find(h=>h.horizon==='LONG').status,'INSUFFICIENT');
});
test('changed issuer identity and future source-set cutoffs are rejected before processing',()=>{
 const f=fixture(3);f.facts.securities[0].company={...f.facts.securities[0].company,company:'changed'};rehash(f);
 assert.throws(()=>runTaiwanMarketResearch(f),/DUPLICATE_OR_CHANGED_SECURITY/);
 const future=fixture(3);future.facts.cutoff='2026-11-12T10:00:00Z';rehash(future);assert.throws(()=>runTaiwanMarketResearch(future),/BATCH_BINDING/);
});

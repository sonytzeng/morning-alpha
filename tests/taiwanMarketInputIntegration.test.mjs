// SYNTHETIC values exercise provenance/price contracts, not a stock recommendation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {marketSnapshotHash as hash} from '../research/taiwan-market-universe.mjs';
import {compactTaiwanPriceReference,expandTaiwanPriceReference} from '../research/taiwan-market-price-reference.mjs';
import {prepareDailyAiMarketPriceInputs,prepareDailyAiMarketPriceReferenceBatches} from '../research/daily-ai-market-references-stage.mjs';
import {addTaiwanLatestHistoryQuotes,addTaiwanTwseDatedValuation} from '../research/taiwan-market-postclose.mjs';
import {annualFinancialInputs,verifiedFinancialRecord} from '../research/taiwan-market-financial-inputs.mjs';
const cutoff='2026-11-11T11:00:00Z',at='2026-11-11T10:00:00Z';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function capture(symbol='1000'){
 const c={source_id:'SYNTHETIC_PRICE',source_url:'https://openapi.twse.com.tw/v1/synthetic',source_sha256:'a'.repeat(64),
  source_bytes:100,received_at:at,row_path:[Number(symbol)-1000],row_index:Number(symbol)-1000,symbol_field:'Code',source_row_hash:sha(symbol)};
 return {...c,capture_id:hash({source_id:c.source_id,url:c.source_url,source_sha256:c.source_sha256,received_at:at})};
}
function reference(){const body={schema:'SYNTHETIC_REFERENCE',security_id:'TWSE:1000',state:'CALCULATED_RESEARCH_ONLY',
 issuer_source_captures:[capture()],peers:[{security_id:'TWSE:1001',source_capture:capture('1001')}],
 method:'CURRENT_PRICE_TIMES_PEER_PE_DIVIDED_BY_CURRENT_OFFICIAL_PE',method_version:'TAIWAN_PEER_RERATING_V1',
 quote_date:'2026-11-11',current_price:100,price_scenarios:[80,100,120],peer_count:5};return {...body,reference_hash:hash(body)};}
test('shared input encoding is lossless, interns arrays, preserves issuer/peer identity and binds every byte',()=>{
 const pool={},bindings={},r=reference(),encoded=compactTaiwanPriceReference(r,pool,bindings);
 assert.ok(encoded.issuer_source_captures.$price_input_ref);assert.deepEqual(expandTaiwanPriceReference(encoded,pool),r);
 assert.equal(bindings[hash(capture())],'TWSE:1000');assert.equal(bindings[hash(capture('1001'))],'TWSE:1001');
 const changed=structuredClone(encoded);changed.current_price=101;assert.throws(()=>expandTaiwanPriceReference(changed,pool),/ENCODED_HASH/);
 const poolKey=encoded.issuer_source_captures.$price_input_ref;pool[poolKey]=[];assert.throws(()=>expandTaiwanPriceReference(encoded,pool),/POOL_BINDING/);
});
test('a copied raw row cannot acquire a second issuer identity through price compression',()=>{
 const pool={},bindings={};compactTaiwanPriceReference(reference(),pool,bindings);
 const second={...reference(),security_id:'TWSE:2000'};assert.throws(()=>compactTaiwanPriceReference(second,pool,bindings),/SOURCE_IDENTITY/);
});
test('reference staging binds the pool, a bounded batch and all three summary slots',()=>{
 const pool={},bindings={},r=compactTaiwanPriceReference(reference(),pool,bindings),poolHash=hash(pool),planHash='f'.repeat(64);
 const prepared=prepareDailyAiMarketPriceInputs({planHash,inputs:pool,bindings,inputPoolHash:poolHash});
 assert.equal(sha(prepared.args.p_body_text),prepared.body_hash);
 const batches=prepareDailyAiMarketPriceReferenceBatches({planHash,inputPoolHash:poolHash,references:[{security_id:'TWSE:1000',short:null,medium:r,long:null}]});
 assert.equal(batches.batches.length,1);assert.equal(batches.batches[0].items,1);
 assert.equal(batches.bySecurity['TWSE:1000'].SHORT,null);assert.equal(batches.bySecurity['TWSE:1000'].MEDIUM.lower,80);
 assert.throws(()=>prepareDailyAiMarketPriceInputs({planHash,inputs:pool,bindings,inputPoolHash:'e'.repeat(64)}),/REFERENCE_INPUTS/);
});
function facts(){const body={schema:'TAIWAN_MARKET_FACT_SET_V1',cutoff:'2026-11-11T09:00:00Z',datasets:[],captured_dataset_count:0,expected_dataset_count:0,
 securities:[{security_id:'TWSE:1000',company:{market:'TWSE',symbol:'1000'},observations:[{family:'PRICE',date:'2026-11-10',close:90}]}]};return {...body,facts_hash:hash(body)};}
function history(scope='TWSE_REPORTED_EXCLUDES_BLOCK_TRADES'){
 const body={schema:'TAIWAN_SECURITY_HISTORY_V1',security_id:'TWSE:1000',bars:[{market:'TWSE',symbol:'1000',date:'2026-11-11',
  open:99,high:102,low:98,close:100,volume:10000,amount:1000000,available_at:at,price_basis:'RAW_UNADJUSTED',
  session_scope:scope,all_trades_session_complete:false,source_capture:capture()}]};return {stocks:[{...body,history_hash:hash(body)}]};
}
test('dated closing quote supplements a stale snapshot while preserving incomplete-session history semantics',()=>{
 const original=history(),before=structuredClone(original);const f=addTaiwanLatestHistoryQuotes({facts:facts(),history:original,cutoff});
 const q=f.securities[0].observations.at(-1);assert.equal(q.date,'2026-11-11');assert.equal(q.close,100);
 assert.equal(q.all_trades_session_complete,false);assert.equal(q.session_scope,'TWSE_REPORTED_EXCLUDES_BLOCK_TRADES');
 assert.deepEqual(original,before);const {facts_hash,...body}=f;assert.equal(facts_hash,hash(body));
});
test('forged history hash, unknown session scope and invalid dates cannot replace a real quote',()=>{
 const h=history();h.stocks[0].bars[0].close=101;
 assert.throws(()=>addTaiwanLatestHistoryQuotes({facts:facts(),history:h,cutoff}),/HISTORY_BINDING/);
 assert.throws(()=>addTaiwanLatestHistoryQuotes({facts:facts(),history:history('INVENTED_FULL_SESSION'),cutoff}),/HISTORY_QUOTE/);
 const invalid=history();invalid.stocks[0].bars[0].date='2026-99-99';const {history_hash,...body}=invalid.stocks[0];void history_hash;invalid.stocks[0].history_hash=hash(body);
 assert.throws(()=>addTaiwanLatestHistoryQuotes({facts:facts(),history:invalid,cutoff}),/HISTORY_QUOTE|DATE/);
});
test('official dated valuation retains exact financial quarter and raw array binding without deriving EPS',()=>{
 const payload={stat:'OK',date:'20261111',fields:['證券代號','證券名稱','收盤價','殖利率(%)','股利年度','本益比','股價淨值比','財報年/季'],data:[['1000','測試','100','2',114,'20','2','115/2']]};
 const bytes=Buffer.from(JSON.stringify(payload)),receipt={schema:'TAIWAN_PUBLIC_SOURCE_RECEIPT_V1',state:'CAPTURED',status:200,
  format:'json',source_id:'TWSE_VALUATION_20261111',url:'https://www.twse.com.tw/rwd/zh/afterTrading/BWIBBU_d?date=20261111&selectType=ALL&response=json',
  sha256:sha(bytes),bytes:bytes.length,started_at:at,received_at:at,row_count:1};
 const f=addTaiwanTwseDatedValuation({facts:facts(),receipt,bytes,cutoff}),v=f.securities[0].observations.at(-1);
 assert.equal(v.financial_period,'2026Q2');assert.equal(v.eps_inferred_from_price,null);assert.deepEqual(v.source_capture.row_path,['data',0]);
 assert.equal(v.source_capture.source_row_hash,hash(payload.data[0]));
 assert.throws(()=>addTaiwanTwseDatedValuation({facts:facts(),receipt,bytes:Buffer.from('{}'),cutoff}),/VALUATION_CAPTURE/);
});
function financial(year,family,fields){
 const c={...capture(),source_id:'SYNTHETIC_'+family+'_'+year,source_url:'https://mopsov.twse.com.tw/server-java/t105sb02',
  row_index:1,row_path:[1],symbol_field:'3',parent_html_sha256:'b'.repeat(64),parent_html_record_hash:'c'.repeat(64),decoded_text_sha256:'d'.repeat(64)};
 c.capture_id=hash({source_id:c.source_id,url:c.source_url,source_sha256:c.source_sha256,received_at:c.received_at});
 const b={security_id:'TWSE:1000',market:'TWSE',symbol:'1000',period:year+'Q4',family,fields,
  field_units:Object.fromEntries(Object.keys(fields).map(k=>[k,'TWD_THOUSANDS'])),period_identity_basis:'CSV_RESPONSE_YEAR_QUARTER_MATCHED_PARENT_REQUEST',
  source_cells_matched_parent_html:true,amount_unit:'TWD_THOUSANDS',amount_unit_basis:'MATCHED_PARENT_HTML_EXPLICIT_UNIT',
  source_capture:c,source_url:c.source_url,available_at:at,first_seen_at:at,
  period_basis:family==='BALANCE'?'POINT_IN_TIME_AS_REPORTED':'YTD_AS_REPORTED',period_scope:family==='BALANCE'?'POINT_IN_TIME':'FULL_FISCAL_YEAR_AS_REPORTED',
  period_definition_source:{url:'https://mopsfin.twse.com.tw/'}};
 return {...b,record_hash:hash(b)};
}
test('annual cash cross-check uses reported balances, preserves unknowns and detects discontinuity',()=>{
 const records=[financial(2023,'CASHFLOW',{'營業活動之淨現金流入（流出）':'50','期初現金及約當現金餘額':'100','期末現金及約當現金餘額':'150','本期現金及約當現金增加（減少）數':'50'}),
  financial(2024,'CASHFLOW',{'營業活動之淨現金流入（流出）':'50','期初現金及約當現金餘額':'190','期末現金及約當現金餘額':'240','本期現金及約當現金增加（減少）數':'50'})];
 const {metrics}=annualFinancialInputs(records,cutoff);assert.equal(metrics[0].cashflow_reconciliation.within_year,true);
 assert.equal(metrics[0].cashflow_reconciliation.opening_matches_previous_closing,null);
 assert.equal(metrics[1].cashflow_reconciliation.opening_matches_previous_closing,false);assert.equal(metrics[2].operating_cashflow,null);
 assert.equal(metrics[2].cashflow_reconciliation.within_year,null);
 assert.equal(verifiedFinancialRecord(records[0]),true);records[0].fields['期末現金及約當現金餘額']='999';assert.throws(()=>verifiedFinancialRecord(records[0]),/RECORD_HASH/);
});

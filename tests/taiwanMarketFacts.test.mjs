import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {officialNumber,officialMonth,readOfficialMarketCapture,normalizeTaiwanMarketFacts,marketObservationEvidence} from '../research/taiwan-market-facts.mjs';
import {marketSnapshotHash} from '../research/taiwan-market-universe.mjs';
const sha=v=>createHash('sha256').update(v).digest('hex'),cutoff='2026-11-11T09:30:00.000Z';
const spec=(id,market,family)=>({id,market,family,industry_statement:'ci',url:'https://openapi.twse.com.tw/v1/'+id,format:'json',byte_limit:16000000});
function capture(s,rows,at='2026-11-11T09:00:00.000Z'){
 const bytes=Buffer.from(JSON.stringify(rows));return {bytes,receipt:{schema:'TAIWAN_PUBLIC_SOURCE_RECEIPT_V1',source_id:s.id,url:s.url,format:'json',
  status:200,state:'CAPTURED',started_at:'2026-11-11T08:59:59.000Z',received_at:at,bytes:bytes.length,sha256:sha(bytes),row_count:rows.length}};
}
function fixture(s,rows){const body={schema:'TAIWAN_MARKET_UNIVERSE_V1',companies:[{security_id:s.market+':2330',market:s.market,symbol:'2330',
 company:'測試公司',industry_code:'24',instrument_kind:'ORDINARY_COMPANY_EQUITY',listing_status:'IN_OFFICIAL_COMPANY_ROSTER',listed_at:'1994-09-05'}]};
 return {universe:{...body,universe_hash:marketSnapshotHash(body)},catalog:{schema:'TAIWAN_OFFICIAL_DATASET_CATALOG_V1',sources:[s]},captures:[capture(s,rows)],cutoff};}
test('numbers preserve missing, negatives and strict grouping; dates reject impossible months',()=>{
 assert.equal(officialNumber(''),null);assert.equal(officialNumber('--'),null);assert.equal(officialNumber('0'),0);
 assert.equal(officialNumber('(1,234.50)'),-1234.5);assert.equal(officialNumber('12,34'),null);assert.equal(officialNumber('1e3'),null);
 assert.equal(officialMonth('11510'),'2026-10');assert.throws(()=>officialMonth('11513'));
});
test('capture integrity binds bytes, URL, real availability and exact row count',()=>{
 const s=spec('q','TWSE','PRICE'),c=capture(s,[{Code:'2330'}]);
 assert.equal(readOfficialMarketCapture({...c,spec:s,cutoff}).rows.length,1);
 for(const altered of [{...c,bytes:Buffer.from('[]')},{...c,receipt:{...c.receipt,url:'https://example.com/'}},
  {...c,receipt:{...c.receipt,received_at:'2026-11-12T00:00:00Z'}},{...c,receipt:{...c.receipt,row_count:2}}])assert.throws(()=>readOfficialMarketCapture({...altered,spec:s,cutoff}));
});
test('emerging averages never become open or close and foreign-market symbols are not joined',()=>{
 const s=spec('q','EMERGING','PRICE');const f=normalizeTaiwanMarketFacts(fixture(s,[{Date:'1151111',SecuritiesCompanyCode:'2330',
  Highest:'12',Lowest:'10',Average:'11',LatestPrice:'11.5',TransactionVolume:'1200',BuyingPrice:'10.5',SellingPrice:'11.5'}]));
 const q=f.securities[0].observations[0];assert.equal(q.valid_trade,true);assert.equal(q.open,null);assert.equal(q.close,null);assert.equal(q.average,11);
 const mismatched=fixture(s,[{Date:'1151111',SecuritiesCompanyCode:'2330'}]);mismatched.universe.companies[0].security_id='TWSE:2330';
 const {universe_hash,...body}=mismatched.universe;void universe_hash;mismatched.universe.universe_hash=marketSnapshotHash(body);
 assert.equal(normalizeTaiwanMarketFacts(mismatched).datasets[0].matched,0);
});
test('reported basic cumulative EPS is not silently converted to diluted, quarterly, annual or TTM EPS',()=>{
 const s=spec('income','TWSE','INCOME'),f=normalizeTaiwanMarketFacts(fixture(s,[{'出表日期':'1151111','公司代號':'2330','年度':'115','季別':'3','基本每股盈餘（元）':'12.34','營業收入':'0','本期淨利（淨損）':'-10'}]));
 const q=f.securities[0].observations[0];assert.equal(q.period,'2026Q3');assert.equal(q.eps_basic,12.34);assert.equal(q.ttm_eps,null);
 assert.equal(q.diluted_eps,null);assert.equal(q.annualized_eps,null);assert.match(q.period_basis,/NOT_ASSUMED/);assert.equal(q.revenue,0);
});
test('TWSE EPS dataset explicit ASCII parentheses are parsed as reported BASIC EPS',()=>{
 const s=spec('eps','TWSE','EPS_AS_REPORTED');const f=normalizeTaiwanMarketFacts(fixture(s,[{'出表日期':'1151111','公司代號':'2330','年度':'115','季別':'3','基本每股盈餘(元)':'0.48'}]));
 const q=f.securities[0].observations[0];assert.equal(q.eps_basic,0.48);assert.equal(q.diluted_eps,null);assert.equal(q.ttm_eps,null);assert.equal(q.period,'2026Q3');
});
test('future announced ex dates are events, never falsely labelled current published financial data',()=>{
 const s=spec('actions','TWSE','ACTION_ANNOUNCEMENT');const f=normalizeTaiwanMarketFacts(fixture(s,[{Date:'1151113',Code:'2330',CashDividend:'5'}]));
 const q=f.securities[0].observations[0];assert.equal(q.source_as_of,null);assert.equal(q.event_date,'2026-11-13');assert.equal(q.coverage_complete,false);
 const e=marketObservationEvidence(q);assert.equal(e.published_at,null);assert.equal(e.first_seen_at,'2026-11-11T09:00:00.000Z');assert.equal(e.evidence_hash,sha(e.content));
 assert.equal(JSON.parse(e.content).source_capture.row_index,0);assert.equal(JSON.parse(e.content).source_capture.symbol_field,'Code');
});
test('duplicate quote rows invalidate both; empty financial placeholders are counted',()=>{
 const s=spec('q','TWSE','PRICE'),row={Date:'1151111',Code:'2330',OpeningPrice:'10',HighestPrice:'11',LowestPrice:'9',ClosingPrice:'10',TradeVolume:'1',TradeValue:'10'};
 const f=normalizeTaiwanMarketFacts(fixture(s,[row,{...row},{}]));assert.equal(f.datasets[0].placeholder_rows,1);
 assert.equal(f.securities[0].observations.filter(o=>!o.invalidated).length,0);assert.equal(f.securities[0].issues.length,1);
});
test('invalid revenue percentages do not silently pass the arithmetic check',()=>{
 const s=spec('revenue','TWSE','REVENUE');const f=normalizeTaiwanMarketFacts(fixture(s,[{'出表日期':'1151111','公司代號':'2330','資料年月':'11510','營業收入-當月營收':'150','營業收入-去年當月營收':'100','營業收入-去年同月增減(%)':'25'}]));
 assert.equal(f.securities[0].observations[0].yoy_arithmetic_verified,false);
});

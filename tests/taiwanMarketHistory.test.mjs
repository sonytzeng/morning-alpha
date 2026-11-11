import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {taiwanHistoryUrl,decodeTaiwanHistoryCapture,normalizeTaiwanHistoryCapture,assembleTaiwanSecurityHistory,taiwanHistoryAnalysisPackets} from '../research/taiwan-market-history.mjs';
import {marketSnapshotHash} from '../research/taiwan-market-universe.mjs';

const sha=v=>createHash('sha256').update(v).digest('hex');
const date='2026-11-10',at='2026-11-11T09:00:00.123456Z';
function universe(){const body={schema:'TAIWAN_MARKET_UNIVERSE_V1',coverage_complete:true,total:4,companies:[
 {security_id:'TWSE:2330',symbol:'2330',market:'TWSE',company:'Synthetic TWSE'},
 {security_id:'TWSE:2454',symbol:'2454',market:'TWSE',company:'Synthetic missing'},
 {security_id:'TPEX:5347',symbol:'5347',market:'TPEX',company:'Synthetic TPEX'},
 {security_id:'EMERGING:7777',symbol:'7777',market:'EMERGING',company:'Synthetic emerging'}]};return {...body,universe_hash:marketSnapshotHash(body)};}
function fixture(source_id='twse_daily',gzip=false){
 const market=source_id==='twse_daily'?'TWSE':'TPEX';
 const fields=market==='TWSE'?['證券代號','證券名稱','成交股數','成交筆數','成交金額','開盤價','最高價','最低價','收盤價']:
  ['代號','名稱','收盤','漲跌','開盤','最高','最低','均價','成交股數','成交金額(元)'];
 const rows=market==='TWSE'?[
  ['2330','Synthetic','1,234','2','12,340','10','12','9','11'],
  ['2454','Suspended','0','0','0','--','--','--','--']]:[['5347','Synthetic','11','+1','10','12','9','10.5','1,234','12,340']];
 const payload={stat:'OK',date:'20261110',tables:[{title:market==='TWSE'?'115年11月10日 每日收盤行情(全部)':'上櫃股票行情',
  fields,data:rows,notes:market==='TWSE'?['本統計資訊含一般、零股、盤後定價、鉅額交易，不含拍賣、標購。']:[]}]};
 const entity=Buffer.from(JSON.stringify(payload,null,1)+'\n'),bytes=gzip?gzipSync(entity):entity;
 const receipt={schema:'TAIWAN_HISTORY_SOURCE_RECEIPT_V1',source_id,market,family:'PRICE',url:taiwanHistoryUrl(source_id,date),date,
  state:'CAPTURED',status:200,started_at:'2026-11-11T08:59:00Z',received_at:at,bytes:bytes.length,sha256:sha(bytes),
  raw_bytes_complete:true,content_encoding:gzip?'gzip':'identity',fixture_provenance:'SYNTHETIC_TEST'};
 return {receipt,bytes,entity,payload,universe:universe()};
}

test('daily whole-market rows keep native shares/TWD and exact original nested array bindings',()=>{
 for(const source of ['twse_daily','tpex_daily']){const f=fixture(source),r=normalizeTaiwanHistoryCapture(f),bar=r.observations[0];
  assert.equal(bar.volume,1234);assert.equal(bar.amount,12340);assert.equal(bar.open,10);assert.equal(bar.close,11);
  assert.deepEqual(bar.source_capture.row_path,['tables',0,'data',0]);assert.equal(bar.source_capture.symbol_field,'0');
  assert.equal(bar.source_capture.source_row_hash,marketSnapshotHash(f.payload.tables[0].data[0]));
  assert.equal(bar.source_capture.source_id,r.market+'_DAILY_20261110');
  assert.equal(bar.source_capture.capture_id,marketSnapshotHash({source_id:bar.source_capture.source_id,url:f.receipt.url,source_sha256:sha(f.entity),received_at:at}));
  assert.equal(bar.available_at,at);assert.equal(bar.published_at,null);assert.equal(r.historical_membership_established,false);
 }
 const r=normalizeTaiwanHistoryCapture(fixture());assert.equal(r.missing[0].reason,'NO_VALID_TRADING_OHLCV_AMOUNT');assert.equal(r.missing[0].symbol,'2454');
});

test('gzip wire and decoded HTTP entity have distinct exact byte hashes, without JSON reserialization',()=>{
 const f=fixture('twse_daily',true),d=decodeTaiwanHistoryCapture(f);
 assert(d.entity_bytes.equals(f.entity));assert.notEqual(sha(f.bytes),sha(f.entity));assert.equal(d.public_receipt.sha256,sha(f.entity));
 assert.equal(d.public_receipt.wire_capture.source_sha256,sha(f.bytes));assert.equal(d.public_receipt.bytes,f.entity.length);
 assert.equal(d.public_receipt.row_count,null);assert.equal(d.public_receipt.source_id,'TWSE_DAILY_20261110');
});

test('altered bytes, identity, incomplete receipts and unit changes never become valid daily bars',()=>{
 const changed=fixture();changed.bytes=Buffer.concat([changed.bytes,Buffer.from(' ')]);assert.throws(()=>normalizeTaiwanHistoryCapture(changed),/SOURCE_RECEIPT/);
 const wrong=fixture();wrong.receipt.url=wrong.receipt.url.replace('20261110','20261109');assert.throws(()=>normalizeTaiwanHistoryCapture(wrong),/SOURCE_RECEIPT/);
 const incomplete=fixture();incomplete.receipt.raw_bytes_complete=false;assert.throws(()=>normalizeTaiwanHistoryCapture(incomplete),/SOURCE_RECEIPT/);
 const unit=fixture('tpex_daily');unit.payload.tables[0].fields[8]='成交仟股';unit.bytes=Buffer.from(JSON.stringify(unit.payload));
 unit.receipt.bytes=unit.bytes.length;unit.receipt.sha256=sha(unit.bytes);assert.throws(()=>normalizeTaiwanHistoryCapture(unit),/DAILY_SCHEMA_CHANGED/);
 const early=fixture();early.receipt.started_at='2026-11-10T14:00:00+08:00';early.receipt.received_at='2026-11-10T16:00:00+08:00';assert.throws(()=>normalizeTaiwanHistoryCapture(early),/SOURCE_RECEIPT/);
});

test('checkpoint preserves all stocks and uncollected dates; emerging averages are never fabricated into OHLC',()=>{
 const u=universe(),days=['twse_daily','tpex_daily'].map(s=>normalizeTaiwanHistoryCapture(fixture(s))),
  r=assembleTaiwanSecurityHistory({universe:u,days,expected_dates:['2026-11-09','2026-11-10'],formed_at:'2026-11-11T10:00:00Z'});
 assert.equal(r.counts.securities,4);assert.equal(r.counts.normalized_market_dates,2);assert.equal(r.counts.expected_market_dates,4);
 assert.equal(r.state,'PARTIAL_MARKET_HISTORY');assert.equal(r.counts.complete_price_histories,0);
 assert.equal(r.stocks.find(s=>s.symbol==='2330').missing[0].date,'2026-11-09');
 const emerging=r.stocks.find(s=>s.market==='EMERGING');assert.equal(emerging.bars.length,0);
 assert(emerging.missing.every(m=>m.reason==='NATIVE_EMERGING_PRICE_HAS_NO_AUCTION_OPEN_CLOSE_METHOD_REQUIRED'));
 assert.equal(r.historical_universe_backtest_claim,false);
 assert.throws(()=>assembleTaiwanSecurityHistory({universe:u,days:[days[0],days[0]],expected_dates:[date],formed_at:'2026-11-11T10:00:00Z'}),/DUPLICATE_OR_FUTURE_DAY/);
});

test('real packet conversion preserves late receipt time and source bindings rather than backfilling publication dates',()=>{
 const u=universe(),r=assembleTaiwanSecurityHistory({universe:u,days:[normalizeTaiwanHistoryCapture(fixture())],expected_dates:[date],formed_at:'2026-11-11T10:00:00Z'}),
  history=r.stocks.find(s=>s.symbol==='2330');
 const packet=taiwanHistoryAnalysisPackets({history,cutoff:'2026-11-11T10:00:00Z'})[0],e=packet.evidence[0];
 assert.equal(packet.data_through,date);assert.equal(e.time_basis,'OBSERVED_AFTER_RECEIPT');assert.equal(e.first_seen_at,at);assert.equal(e.as_of,at);
 assert.equal(e.published_at,null);assert.equal(JSON.parse(e.content).source_capture.source_row_hash,history.bars[0].source_capture.source_row_hash);
 assert.throws(()=>taiwanHistoryAnalysisPackets({history,cutoff:'2026-11-10T18:00:00+08:00'}),/PACKET_HISTORY/);
 assert.equal(history.corporate_action_coverage_complete,false);
});

test('an official same-day table excluding block trades is retained with its true scope and cannot become complete all-trades history',()=>{
 const f=fixture();f.payload.tables[0].notes=['本統計資訊含一般、零股、盤後定價，不含鉅額、拍賣、標購。'];
 f.bytes=Buffer.from(JSON.stringify(f.payload));f.receipt.bytes=f.bytes.length;f.receipt.sha256=sha(f.bytes);
 const day=normalizeTaiwanHistoryCapture(f),bar=day.observations[0];assert.equal(bar.session_scope,'TWSE_REPORTED_EXCLUDES_BLOCK_TRADES');
 assert.equal(bar.all_trades_session_complete,false);assert.equal(bar.volume,1234);
 const r=assembleTaiwanSecurityHistory({universe:f.universe,days:[day],expected_dates:[date],formed_at:'2026-11-11T10:00:00Z'}),stock=r.stocks.find(s=>s.symbol==='2330');
 assert.equal(stock.price_history_complete,false);assert.deepEqual(stock.history_issues,['REPORTED_HISTORY_EXCLUDES_BLOCK_TRADES']);
});

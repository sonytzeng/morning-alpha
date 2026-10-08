import test from 'node:test';
import assert from 'node:assert/strict';
import {officialDate,officialNumber,historyUrl,parseOfficialHistory,companyDirectory,retrospectiveShapes,tpexDailyUrl,parseTpexDaily} from '../research/entry-official-history.ts';
import {retryDelay} from '../research/entry-history-acquire.mjs';
import {ACTION_SOURCES,parseActionInventory,parseTwseDividendDetail} from '../research/entry-corporate-actions.mjs';
// Synthetic parser contracts only. These are never historical investment performance.
const at='2026-10-08T12:00:00Z',month='2026-09';
const fields=['日期','成交股數','成交金額','開盤價','最高價','最低價','收盤價'];
const data=[['115/09/01','1,234','123,456','100','105','98','102']];
const tw=()=>({stat:'OK',date:'20260901',title:'115年09月 2330 台積電 各日成交資訊',fields,data:structuredClone(data)});
const tp=()=>({stat:'ok',code:'6488',tables:[{fields:['日 期','成交張數','成交仟元','開盤','最高','最低','收盤'],data:structuredClone(data)}]});
test('official date/number parsing never zero-fills unavailable prices',()=>{
 assert.equal(officialDate('115/09/01'),'2026-09-01');assert.equal(officialDate('20260901'),'2026-09-01');assert.equal(officialDate('115/02/30'),null);
 assert.equal(officialNumber('1,234.50'),1234.5);for(const s of ['--','','N/A','1e6','<a>5</a>'])assert.equal(officialNumber(s),null);
 assert.throws(()=>historyUrl('TPEX','../x',month));assert.throws(()=>historyUrl('OTHER','2330',month));
 const u=new URL(historyUrl('TPEX','6488',month));assert.equal(u.searchParams.get('code'),'6488');assert.equal(u.searchParams.has('id'),false);
});
test('exchange schema pins shares/TWD vs lots/thousands; acquisition availability is not backdated',()=>{
 const a=parseOfficialHistory('TWSE','2330',month,tw(),at),b=parseOfficialHistory('TPEX','6488',month,tp(),at);
 assert.equal(a.bars[0].volume,1234);assert.equal(a.bars[0].amount,123456);
 assert.equal(b.bars[0].volume,1234000);assert.equal(b.bars[0].amount,123456000);
 assert.equal(b.exact_volume_amount,false);assert.equal(b.volume_amount_scope,'ROUNDED_THOUSANDS_EXCLUDES_BLOCK_TRADES');
 assert.equal(a.bars[0].available_at,at);assert.equal(a.provenance,'RETROSPECTIVE_PUBLIC_ACQUISITION');
 assert.equal(a.price_basis,'RAW_EXCHANGE_AS_RETRIEVED');assert.equal(a.rejected.length,0);
});
test('TPEX daily all-trade totals preserve exact shares/TWD and never fall back to rounded monthly totals',()=>{
 const fields=['代號','名稱','收盤','漲跌','開盤','最高','最低','均價','成交股數','成交金額(元)'];
 const row=['6488','公開公司','102','+2','100','105','98','101','1,234,567','123,456,789'];
 const p={stat:'ok',date:'20260901',tables:[{fields,data:[row]},{fields,data:[]}]};
 const r=parseTpexDaily(p,'2026-09-01',['6488','3529'],at);
 assert.equal(r.daily[0].bar.volume,1234567);assert.equal(r.daily[0].bar.amount,123456789);assert.equal(r.daily[0].bar.available_at,at);
 assert.equal(r.exact_volume_amount,true);assert.equal(r.daily[1].bar,null);assert.equal(r.daily[1].reason,'SYMBOL_MISSING');
 assert.equal(new URL(tpexDailyUrl('2026-09-01')).searchParams.get('date'),'2026/09/01');
 assert.throws(()=>parseTpexDaily({...p,date:'20260902'},'2026-09-01',['6488'],at),/SESSION/);
 const duplicate=structuredClone(p);duplicate.tables[1].data.push(row);assert.equal(parseTpexDaily(duplicate,'2026-09-01',['6488'],at).daily[0].reason,'DUPLICATE_SYMBOL');
 const rounded=structuredClone(p);rounded.tables[0].fields[8]='成交張數';assert.throws(()=>parseTpexDaily(rounded,'2026-09-01',['6488'],at),/SCHEMA/);
});
test('wrong symbol/month/schema and duplicate days reject rather than contaminating cache',()=>{
 for(const mutate of [p=>p.title='115年09月 2317 stock',p=>p.date='20260801',p=>p.fields=['日期','成交張數',...fields.slice(2)],p=>p.data.push(p.data[0]),p=>p.data[0][0]='115/08/31']){
  const p=structuredClone(tw());mutate(p);assert.throws(()=>parseOfficialHistory('TWSE','2330',month,p,at));}
 const p=tp();p.code='';assert.throws(()=>parseOfficialHistory('TPEX','6488',month,p,at),/IDENTITY/);
});
test('suspension, zero turnover and incomplete/future sessions remain explicit gaps',()=>{
 for(const value of ['--','0']){const p=tw();p.data[0][1]=value;const r=parseOfficialHistory('TWSE','2330',month,p,at);assert.equal(r.bars.length,0);assert.equal(r.rejected[0].reason,'NO_VALID_TRADING_OHLCV_AMOUNT');}
 const r=parseOfficialHistory('TWSE','2330',month,tw(),'2026-09-01T01:00:00Z');assert.equal(r.bars.length,0);assert.equal(r.rejected[0].reason,'INCOMPLETE_OR_FUTURE_SESSION');
});
test('company source minimalization excludes all contact and personal fields; no theme invention',()=>{
 const url='https://openapi.twse.com.tw/v1/opendata/t187ap03_L';
 const rows=companyDirectory('TWSE',[{'公司代號':'1590','產業別':'05','上市日期':'1021216',Email:'SYNTHETIC_PRIVATE',董事長:'SYNTHETIC_PERSON'}],url,at);
 assert.deepEqual(Object.keys(rows[0]).sort(),['symbol','industry_code','exchange','listing_date','source_ref','available_at','classification_scope'].sort());
 assert.equal(rows[0].listing_date,'2013-12-16');assert(!JSON.stringify(rows).includes('SYNTHETIC_PRIVATE'));
 assert.throws(()=>companyDirectory('TWSE',[],url+'?token=no',at));
});
test('backoff respects Retry-After within a bounded wait; no unlimited retry policy',()=>{
 assert.equal(retryDelay(0,'30'),30000);assert.equal(retryDelay(2,null),6000);assert.equal(retryDelay(0,'99999'),60000);
 assert.equal(retryDelay(0,'Wed, 08 Oct 2026 12:00:30 GMT',Date.parse(at)),30000);
});
test('official action inventory preserves effective date but never infers a split factor from reference prices',()=>{
 const spec=ACTION_SOURCES[0],p={stat:'OK',fields:[...spec.fields],data:[['115年09月01日','2330','公開公司','100','90','10','權息','','','','','2330,20260901']]};
 const events=parseActionInventory(spec,p,['2330'],spec.base,at,'2026-04-01','2026-10-07');
 assert.equal(events[0].effective_date,'2026-09-01');assert.equal(events[0].cash_per_share,null);assert.equal(events[0].new_shares_per_old_share,null);assert.equal(events[0].adjustment_applied,false);
 assert.equal(events[0].available_at,at);assert.equal(events[0].detail_key,'2330,20260901');
 p.data[0][0]='115年11月01日';assert.throws(()=>parseActionInventory(spec,p,['2330'],spec.base,at,'2026-04-01','2026-10-07'),/OUTSIDE/);
});
test('cash dividends and bonus shares have their own explicit official units; combined rights value is not cash',()=>{
 const spec=ACTION_SOURCES[3],fields=[...spec.fields,'權值','息值','權值+息值','權/息','漲停價','跌停價','開始交易基準價','減除股利參考價','現金股利','每仟股無償配股'];
 const p={stat:'ok',tables:[{fields,data:[['115/09/01','6488','公開公司','100','90','8','2','10','權息','110','80','90','98','2','50']]}]};
 const [event]=parseActionInventory(spec,p,['6488'],spec.base,at,'2026-04-01','2026-10-07');assert.equal(event.cash_per_share,2);assert.equal(event.bonus_shares_per_1000,50);assert.equal(event.new_shares_per_old_share,null);
 const d={stat:'ok',fields:['股票代號','股票名稱','(每股配發現金股利)除息','除權','每千股無償配股'],data:[['2330  ','公開公司','6.000035 元／股','','0 股','','0 股','0 元／股']]};
 const detail=parseTwseDividendDetail(d,'2330','https://www.twse.com.tw/rwd/zh/exRight/TWT49UDetail',at);
 assert.equal(detail.cash_per_share,6.000035);assert.equal(detail.adjustment_applied,false);assert.throws(()=>parseTwseDividendDetail(d,'2317','source',at),/MISMATCH/);
});
test('ex-post true-price shape index cannot become an entry signal, Forward or Outcome',()=>{
 const bars=Array.from({length:28},(_,i)=>({date:`2026-08-${String(i+1).padStart(2,'0')}`,open:100,high:101,low:99,close:100,volume:10000,amount:1e6,source_ref:'SYNTHETIC_SHAPE_TEST',available_at:at}));
 Object.assign(bars[20],{open:105,high:108,low:90,close:95});
 const r=retrospectiveShapes(bars,[],false);assert(r.hits.some(h=>h.shape==='GAP_FAILURE'));assert(r.hits.some(h=>h.shape==='SHARP_DECLINE_THEN_BOUNCE'));
 assert.equal(r.forward_sample,0);assert.equal(r.outcome_sample,0);assert.match(r.scope,/NOT_STRATEGY/);assert(r.hits.every(h=>h.action_review==='ACTION_COVERAGE_INCOMPLETE'));
 const a=retrospectiveShapes(bars,[bars[20].date],false);assert(a.hits.some(h=>h.action_review==='KNOWN_ACTION_IN_WINDOW'));
 assert.throws(()=>retrospectiveShapes([...bars,bars[0]],[],false),/DUPLICATE/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTwseDaily,twseDailyUrl} from '../research/entry-official-history.ts';
import {acquisitionPlan,normalizeSource,assembleDaily} from '../src/features/vnext/dailyAdapter.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {RECOMMENDATION_UNIVERSE} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';
const date='2026-10-29',at='2026-10-30T00:00:00Z',companies=RECOMMENDATION_UNIVERSE.map(symbol=>({symbol,company:symbol,exchange:'TWSE',industry:'24'}));
const raw=()=>({stat:'OK',date:'20261029',tables:[{fields:['指數','收盤指數'],data:[['Index','100']]},{title:'115年10月29日 每日收盤行情(全部)',
 fields:['證券代號','證券名稱','成交股數','成交筆數','成交金額','開盤價','最高價','最低價','收盤價'],
 notes:['本統計資訊含一般、零股、盤後定價、鉅額交易，不含拍賣、標購。'],data:[['2330','A','12,345','100','123,450','10','11','9','10.5'],['1760','B','2,345','10','23,450','10','11','9','10.5']]}]});
const task=()=>({kind:'TWSE_PRICE_DAY',date,url:twseDailyUrl(date),format:'json',symbols:['2330','1760'],exchange:'TWSE',scope:'TEST',max_age_days:1,key:'a'.repeat(64)});
const receipt=async(t,payload)=>({task:t,payload,status:'OK',first_seen_at:at,available_at:at,published_at:null,as_of:at,raw_hash:'a'.repeat(64),payload_hash:await snapshotHash(payload),version:'TEST',reason:null});
test('bulk daily quote preserves native shares/TWD and proven STOCK_DAY scope',()=>{
 const p=parseTwseDaily(raw(),date,['2330','1760'],at);assert.equal(p.daily[0].bar.volume,12345);assert.equal(p.daily[0].bar.amount,123450);assert.equal(p.volume_amount_scope,'OFFICIAL_STOCK_DAY');
});
test('bulk rejects wrong session, in-session receipt, changed units, ambiguous tables and missing scope',()=>{
 for(const change of [p=>p.date='20261028',p=>p.tables[1].title='115年10月28日 每日收盤行情',p=>p.tables[1].fields[2]='成交張數',p=>p.tables[1].notes=[],p=>p.tables.push(p.tables[1])]){
  const p=raw();change(p);assert.throws(()=>parseTwseDaily(p,date,['2330'],at),/DAILY_/);
 }
 assert.throws(()=>parseTwseDaily(raw(),date,['2330'],'2026-10-29T05:00:00Z'),/DAILY_SESSION/);
});
test('duplicate, absent or invalid ticker rows are reported without zero-price substitutes',()=>{
 const p=raw();p.tables[1].data.push(p.tables[1].data[0]);p.tables[1].data[1][8]='--';const out=parseTwseDaily(p,date,['2330','1760','9999'],at);
 assert.deepEqual(out.daily.map(r=>r.reason),['DUPLICATE_SYMBOL','NO_VALID_TRADING_OHLCV_AMOUNT','SYMBOL_MISSING']);assert(out.daily.every(r=>r.bar===null));
});
test('one date-bound bulk source is scheduled first without removing historical tasks',async()=>{
 const a=await acquisitionPlan('2026-10-30',companies);assert.equal(a[0].kind,'TWSE_PRICE_DAY');assert.equal(a[0].url,twseDailyUrl(date));assert.equal(a[0].symbols.length,72);
 assert(a.some(t=>t.kind==='PRICE'&&t.month==='2026-10'));assert.equal(new Set(a.map(t=>t.key)).size,a.length);assert(a.length<=1600);
 const b=await acquisitionPlan('2026-11-02',companies);assert.notEqual(a[0].key,b[0].key);
});
test('normalization uses actual receipt and rejects alternate source identities',async()=>{
 const p=await normalizeSource(task(),raw(),at);assert.equal(p.rows[0].published_at,null);assert.equal(p.rows[0].first_seen_at,at);assert.equal(p.rows[0].source,twseDailyUrl(date));
 await assert.rejects(normalizeSource({...task(),url:'https://example.test/quote'},raw(),at),/SOURCE_IDENTITY/);
});
test('daily source fills a missing quote; equal monthly source stays immutable and unique',async()=>{
 const p=await normalizeSource(task(),raw(),at),daily=await receipt(task(),p),monthlyRow={...p.rows[0],source:'https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=20261001&stockNo=2330'};
 const monthly=await receipt({...task(),kind:'PRICE',symbols:['2330']},{rows:[monthlyRow]}),before=structuredClone([daily,monthly]);
 const r=await assembleDaily('2026-10-30',companies,[daily,monthly],at);
 assert.equal(r.inputs.find(i=>i.symbol==='1760').bars.length,1);assert.deepEqual(r.inputs.find(i=>i.symbol==='2330').bars,[monthlyRow]);assert.deepEqual([daily,monthly],before);
});
test('conflicting exact official prices remove that session instead of picking the favorable source',async()=>{
 const p=await normalizeSource(task(),raw(),at),daily=await receipt(task(),p),monthly=await receipt({...task(),kind:'PRICE'},{rows:[{...p.rows[0],amount:1}]});
 const r=await assembleDaily('2026-10-30',companies,[daily,monthly],at);assert.equal(r.inputs.find(i=>i.symbol==='2330').bars.length,0);assert.equal(r.inputs.find(i=>i.symbol==='1760').bars.length,1);
 assert(r.source_issues.some(i=>i.reason==='OFFICIAL_PRICE_SOURCE_CONFLICT'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {normalizeOfficialCompanyCapture,buildTaiwanMarketUniverse,planTaiwanMarketAnalysis,verifyTaiwanMarketCompletion,parseOfficialCompanyCsv,officialDate,TAIWAN_COMPANY_SOURCES} from '../research/taiwan-market-universe.mjs';
const at='2026-11-11T09:00:00Z';
function raw(symbol){return {'出表日期':'1151110','公司代號':symbol,'公司名稱':'測試公司 '+symbol,'公司簡稱':'測試','產業別':'24','上市日期':'20200101','上櫃日期':'20200101','已發行普通股數或TDR原股發行股數':'1000000'};}
function capture(id,rows){const spec=TAIWAN_COMPANY_SOURCES[id],heads=Object.keys(rows[0]);
 const csv=[heads,...rows.map(r=>heads.map(h=>r[h]))].map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n');
 const bytes=Buffer.from(spec.format==='json'?JSON.stringify(rows):csv);
 return {bytes,receipt:{schema:'TAIWAN_PUBLIC_SOURCE_RECEIPT_V1',source_id:id,url:spec.url,format:spec.format,state:'CAPTURED',status:200,
 started_at:'2026-11-11T08:30:00Z',received_at:'2026-11-11T08:31:00Z',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),row_count:rows.length}};
}
function universe(){return buildTaiwanMarketUniverse({formed_at:at,rosters:[['twse_companies',['1101','2330']],['tpex_companies',['6488']],['emerging_companies',['7777']]].map(([id,ids])=>normalizeOfficialCompanyCapture(capture(id,ids.map(raw))))});}
test('official CSV preserves quoted commas/newlines and rejects malformed rows',()=>{
 assert.deepEqual(parseOfficialCompanyCsv('\uFEFFa,b\r\n"x,y","line1\nline2"\r\n'),[{a:'x,y',b:'line1\nline2'}]);
 assert.throws(()=>parseOfficialCompanyCsv('a,a\nx,y'),/HEADERS/);
 assert.throws(()=>parseOfficialCompanyCsv('a,b\n"x"oops,y'),/TRAILING/);
 assert.throws(()=>parseOfficialCompanyCsv('a,b\nx'),/WIDTH/);
});
test('ROC/Gregorian dates are exact, with no calendar overflow',()=>{
 assert.equal(officialDate('1151110'),'2026-11-10');assert.equal(officialDate('20261110'),'2026-11-10');
 assert.throws(()=>officialDate('1150230'),/DATE/);assert.throws(()=>officialDate('2026-02-29'),/DATE/);
});
test('all three official markets determine scope, without a 72-stock selection',()=>{
 const u=universe(),p=planTaiwanMarketAnalysis({universe:u,business_date:'2026-11-11',cutoff:at,shard_size:3});
 assert.equal(u.total,4);assert.deepEqual(u.counts,{TWSE:2,TPEX:1,EMERGING:1});assert.equal(p.expected_cards,12);
 assert.deepEqual(p.shards.map(s=>s.expected_cards),[9,3]);assert.equal(new Set(p.shards.flatMap(s=>s.security_ids)).size,4);
 assert.equal(u.historical_membership_established,false);assert.equal(p.member_published,false);
});
test('raw bytes, approved source URL and real receipt time cannot be substituted',()=>{
 for(const mutate of [x=>{x.bytes=Buffer.from('[]');},x=>{x.receipt.url='https://example.com/data';},x=>{x.receipt.received_at='2026-11-09T00:00:00Z';}]){
  const c=capture('twse_companies',[raw('2330')]);mutate(c);assert.throws(()=>normalizeOfficialCompanyCapture(c));
 }
 const r=raw('2330');r['出表日期']='1151112';assert.throws(()=>normalizeOfficialCompanyCapture(capture('twse_companies',[r])),/FUTURE_DATE/);
 assert.throws(()=>normalizeOfficialCompanyCapture(capture('twse_companies',[raw('2330'),raw('2330')])),/IDENTITY/);
});
test('cross-market duplicate listing is retained as a conflict and blocks a complete plan',()=>{
 const rosters=[['twse_companies','2330'],['tpex_companies','2330'],['emerging_companies','7777']].map(([id,s])=>normalizeOfficialCompanyCapture(capture(id,[raw(s)])));
 const u=buildTaiwanMarketUniverse({rosters,formed_at:at});assert.equal(u.total,3);assert.equal(u.coverage_complete,false);
 assert.equal(u.cross_market_conflicts.length,1);assert.throws(()=>planTaiwanMarketAnalysis({universe:u,business_date:'2026-11-11',cutoff:at}),/PLAN_SCOPE/);
});
test('missing or repeated stock/horizon cannot claim all-market completion',()=>{
 const p=planTaiwanMarketAnalysis({universe:universe(),business_date:'2026-11-11',cutoff:at,shard_size:2});
 const results=p.shards.map(s=>({shard_id:s.shard_id,cards:s.security_ids.flatMap(security_id=>s.horizons.map(horizon=>({security_id,horizon,status:'INSUFFICIENT'})))}));
 assert.equal(verifyTaiwanMarketCompletion(p,results).state,'ALL_SECURITIES_ANALYZED');
 assert.equal(verifyTaiwanMarketCompletion(p,results.slice(0,1)).state,'PARTIAL_ANALYSIS');
 const bad=structuredClone(results);bad[0].cards[1]=bad[0].cards[0];assert.throws(()=>verifyTaiwanMarketCompletion(p,bad),/CARD_COMPLETION/);
 assert.throws(()=>verifyTaiwanMarketCompletion(p,[results[0],results[0]]),/SHARD_COMPLETION/);
});

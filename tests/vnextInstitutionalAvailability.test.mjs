import test from 'node:test';
import assert from 'node:assert/strict';
import {parseInstitutional as runtimeParse} from '../src/features/vnext/dailyParsers.mjs';
import {parseInstitutional as archiveParse} from '../scripts/vnext/stock-evidence.mjs';
import {fetchSource} from '../src/features/vnext/dailyAdapter.ts';

const at='2026-11-02T09:00:00.000Z';
const spec={exchange:'TPEX',date:'2026-11-02',symbols:['8299'],url:'https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&se=EW&t=D&d=115/11/02&o=json'};
const fields=['代號','名稱',...Array.from({length:7},()=>['買進股數','賣出股數','買賣超股數']).flat(),'三大法人買賣超股數合計'];
const response=data=>({stat:'ok',date:'20261102',tables:[{title:'三大法人買賣明細資訊',date:'115/11/02',fields,data}]});
// Synthetic balanced shares; publication time remains unknown.
const published=response([['8299','合成控制',100,20,80,0,0,0,100,20,80,10,5,5,15,5,10,4,4,0,19,9,10,95].map(String)]);

test('SYNTHETIC: HTTP-success empty institutional table is unavailable, never a successful zero revision',()=>{
 for(const parse of [runtimeParse,archiveParse]){
  assert.throws(()=>parse(response([]),spec,at),/^Error: INSTITUTIONAL_SOURCE_EMPTY$/);
  assert.throws(()=>parse({stat:'OK',date:'20261102',fields:[],data:[]},{...spec,exchange:'TWSE'},at),/^Error: INSTITUTIONAL_SOURCE_EMPTY$/);
 }
});

test('SYNTHETIC: later published response is accepted without changing zero net-share evidence or time lineage',()=>{
 for(const parse of [runtimeParse,archiveParse]){
  const out=parse(published,spec,at);
  assert.equal(out.rows.length,1);assert.equal(out.rows[0].values.net_shares,95);
  assert.equal(out.rows[0].basis,'SHARES');assert.equal(out.rows[0].published_at,null);
  assert.equal(out.rows[0].first_seen_at,at);
  const zero=structuredClone(published);zero.tables[0].data[0]=['8299','合成控制',...Array(22).fill('0')];
  assert.equal(parse(zero,spec,at).rows[0].values.net_shares,0,'a populated zero-net-share row is valid');
 }
});

test('SYNTHETIC: fetch adapter rejects an empty 200 before it can be saved, then accepts the later real table shape',async()=>{
 const task={...spec,key:'a'.repeat(64),kind:'INSTITUTIONAL',format:'json',scope:'2026-11-02',max_age_days:1};
 const bodies=[response([]),published];let calls=0;
 const fetcher=async()=>new Response(JSON.stringify(bodies[calls++]),{status:200});
 const invoke=()=>fetchSource(task,fetcher,()=>at,new AbortController().signal);
 await assert.rejects(invoke,/INSTITUTIONAL_SOURCE_EMPTY/);
 const receipt=await invoke();assert.equal(calls,2);assert.equal(receipt.status,'OK');
 assert.equal(receipt.payload.rows[0].values.net_shares,95);assert.equal(receipt.available_at,at);
});

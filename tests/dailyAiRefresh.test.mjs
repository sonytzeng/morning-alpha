import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshDailyAiPrices} from '../research/daily-ai-refresh.ts';
import {previousMarketTradingDate} from '../supabase/functions/_shared/market-session-contract.mjs';

const now='2026-10-31T03:30:00Z';
function retained(through='2026-10-28'){
 let d=through;const dates=[];for(let i=0;i<25;i++){dates.unshift(d);d=previousMarketTradingDate('TW',d);}
 return Array.from({length:72},(_,i)=>{const symbol=String(1000+i),otc=i>=60;return {symbol,company:'測試',through,cutoff:'2026-10-30T00:00:00Z',next_session:'2026-10-29',v1_missing:{SHORT:[],MEDIUM:[],LONG:[]},expected_sessions:dates,
  bars:dates.map(date=>({id:symbol+date,date,source:otc?'https://www.tpex.org.tw/previous':'https://www.twse.com.tw/previous',evidence_hash:'a'.repeat(64),published_at:null,first_seen_at:'2026-10-29T00:00:00Z',available_at:'2026-10-29T00:00:00Z',as_of:date+'T17:00:00+08:00',session_scope:otc?'INCLUDES_ODD_AFTERHOURS_BLOCK_TRADES':'OFFICIAL_STOCK_DAY',open:10,high:12,low:9,close:11,volume:1000,amount:11000})),
  facts:[{id:'fact'+symbol,kind:'REVENUE',period:'2026-09',basis:'MONTH',values:{revenue:12000},source:'https://mopsov.twse.com.tw/test',evidence_hash:'b'.repeat(64),published_at:null,first_seen_at:'2026-10-29T00:00:00Z',available_at:'2026-10-29T00:00:00Z',as_of:'2026-10-28T00:00:00Z'}]};});
}
function payload(url){const u=new URL(url),otc=u.hostname==='www.tpex.org.tw',date=otc?u.searchParams.get('date').replaceAll('/','-'):u.searchParams.get('date').replace(/(\d{4})(\d\d)(\d\d)/,'$1-$2-$3');
 const symbols=Array.from({length:otc?12:60},(_,i)=>String(1000+i+(otc?60:0)));
 return {stat:'OK',date:date.replaceAll('-',''),tables:[otc?{fields:['代號','名稱','收盤','漲跌','開盤','最高','最低','均價','成交股數','成交金額(元)'],data:symbols.map(s=>[s,'測試','21','1','20','22','19','20.5','12,345','259,245'])}
  :{title:`${Number(date.slice(0,4))-1911}年${date.slice(5,7)}月${date.slice(8)}日 每日收盤行情`,notes:['本統計資訊含一般、零股、盤後定價、鉅額交易，不含拍賣、標購。'],fields:['證券代號','證券名稱','成交股數','成交筆數','成交金額','開盤價','最高價','最低價','收盤價'],data:symbols.map(s=>[s,'測試','12,345','100','259,245','20','22','19','21'])}]};
}
test('independent source refresh catches up two sessions in four public calls, preserves exact shares and original financial traces',async()=>{
 const inputs=retained(),original=structuredClone(inputs),calls=[];let active=0,maxActive=0;
 const out=await refreshDailyAiPrices({inputs,businessDate:'2026-10-31',clock:()=>now,signal:new AbortController().signal,
  fetcher:async(url,init)=>{calls.push(url);assert.equal(init.redirect,'error');assert(init.signal instanceof AbortSignal);active++;maxActive=Math.max(maxActive,active);await new Promise(resolve=>setImmediate(resolve));active--;return Response.json(payload(url));}});
 assert.equal(calls.length,4);assert.equal(maxActive,2);assert(calls.every(u=>/^https:\/\/www\.(twse\.com|tpex\.org)\.tw\//.test(u)));
 assert.equal(out.through,'2026-10-30');assert.equal(out.cutoff,now);assert.equal(out.inputs.length,72);assert.equal(out.receipts.filter(r=>r.state==='CAPTURED').length,4);
 for(const s of out.inputs){assert.equal(s.expected_sessions.length,20);assert.equal(s.bars.length,20);assert.equal(s.bars.at(-1).date,'2026-10-30');assert.equal(s.bars.at(-1).volume,12345);assert.equal(s.bars.at(-1).amount,259245);
  assert.equal(s.bars.at(-1).published_at,null);assert.equal(s.bars.at(-1).first_seen_at,now);assert.equal(s.bars.at(-1).as_of,'2026-10-30T17:00:00+08:00');assert.match(s.bars.at(-1).evidence_hash,/^[a-f0-9]{64}$/);assert.deepEqual(s.facts,original.find(i=>i.symbol===s.symbol).facts);assert.deepEqual(out.gapsBySymbol[s.symbol],[]);}
 assert.deepEqual(inputs,original);assert(out.additionalGaps.includes('FINANCIAL_DATA_RETAINED_NOT_REFRESHED'));
});
test('one failed exchange remains a visible per-company gap without inventing bars or shrinking the universe',async()=>{
 const out=await refreshDailyAiPrices({inputs:retained(),businessDate:'2026-10-31',clock:()=>now,signal:new AbortController().signal,
  fetcher:async url=>url.includes('tpex.org.tw')?new Response('private provider detail',{status:403}):Response.json(payload(url))});
 assert.equal(out.inputs.length,72);assert.equal(out.inputs[60].bars.at(-1).date,'2026-10-28');assert.equal(out.inputs[60].through,'2026-10-30');
 assert(out.gapsBySymbol['1060'].includes('PRICE_PUBLIC_SOURCE_REFRESH_UNAVAILABLE'));assert(out.gapsBySymbol['1060'].includes('PRICE_20_SESSION_COVERAGE_MISSING'));
 assert.deepEqual(out.gapsBySymbol['1000'],[]);assert(!JSON.stringify(out).includes('private provider detail'));
});
test('next intake repairs failed recent sessions even when common through already reached the target',async()=>{
 const initial=await refreshDailyAiPrices({inputs:retained(),businessDate:'2026-10-31',clock:()=>now,signal:new AbortController().signal,
  fetcher:async url=>url.includes('tpex.org.tw')?new Response('',{status:403}):Response.json(payload(url))});
 const before=structuredClone(initial.inputs),calls=[];
 const recovered=await refreshDailyAiPrices({inputs:initial.inputs,businessDate:'2026-10-31',clock:()=>'2026-10-31T03:35:00Z',signal:new AbortController().signal,
  fetcher:async url=>{calls.push(url);return Response.json(payload(url));}});
 assert.equal(calls.length,2);assert(calls.every(url=>url.includes('tpex.org.tw')));
 for(const s of recovered.inputs){assert.equal(s.bars.length,20);assert.equal(s.bars.at(-1).date,'2026-10-30');assert.deepEqual(recovered.gapsBySymbol[s.symbol],[]);}
 for(const s of recovered.inputs.slice(0,60))assert.deepEqual(s.bars,before.find(old=>old.symbol===s.symbol).bars);
});
test('filling one missing company keeps all other retained bars and receipt hashes unchanged',async()=>{
 const initial=await refreshDailyAiPrices({inputs:retained(),businessDate:'2026-10-31',clock:()=>now,signal:new AbortController().signal,fetcher:async url=>Response.json(payload(url))});
 initial.inputs[60].bars=initial.inputs[60].bars.filter(b=>b.date!=='2026-10-30');const before=structuredClone(initial.inputs),calls=[];
 const repaired=await refreshDailyAiPrices({inputs:initial.inputs,businessDate:'2026-10-31',clock:()=>'2026-10-31T03:35:00Z',signal:new AbortController().signal,
  fetcher:async url=>{calls.push(url);return Response.json(payload(url));}});
 assert.equal(calls.length,1);assert(calls[0].includes('tpex.org.tw'));assert(calls[0].includes('2026%2F10%2F30'));
 for(const s of repaired.inputs.filter(s=>s.symbol!=='1060'))assert.deepEqual(s.bars,before.find(old=>old.symbol===s.symbol).bars);
 assert.equal(repaired.inputs[60].bars.at(-1).available_at,'2026-10-31T03:35:00Z');assert.deepEqual(repaired.gapsBySymbol['1060'],[]);
});
test('a differing refetched historical row is flagged without overwriting the pinned observation',async()=>{
 const inputs=retained('2026-10-30');inputs[60].bars=inputs[60].bars.filter(b=>b.date!=='2026-10-30');const original=structuredClone(inputs[61].bars.at(-1));
 const out=await refreshDailyAiPrices({inputs,businessDate:'2026-10-31',clock:()=>now,signal:new AbortController().signal,fetcher:async url=>Response.json(payload(url))});
 assert.deepEqual(out.inputs[61].bars.at(-1),original);assert(out.gapsBySymbol['1061'].includes('PRICE_RETAINED_REVISION_DIFFERS_FROM_PUBLIC_SOURCE'));
 inputs[60].bars.at(-1).session_scope='OTHER_RETAINED_SCOPE';
 const mixed=await refreshDailyAiPrices({inputs,businessDate:'2026-10-31',clock:()=>now,signal:new AbortController().signal,fetcher:async url=>Response.json(payload(url))});
 assert(mixed.gapsBySymbol['1060'].includes('PRICE_SESSION_SCOPE_MIXED'));
});
test('current-day all-trades data is excluded until after17:05; an already current base avoids all fetches',async()=>{
 let calls=0;
 const out=await refreshDailyAiPrices({inputs:retained('2026-10-29'),businessDate:'2026-10-30',clock:()=>'2026-10-30T07:00:00Z',signal:new AbortController().signal,fetcher:async()=>{calls++;throw Error('UNEXPECTED');}});
 assert.equal(out.through,'2026-10-29');assert.equal(calls,0);
});
test('oversized/malformed/date-shifted public responses fail closed as data gaps',async()=>{
 for(const body of [()=>new Response('x'.repeat(2000001)),url=>{const p=payload(url);p.date='20261027';return Response.json(p);},()=>new Response('{invalid')]){
  const out=await refreshDailyAiPrices({inputs:retained(),businessDate:'2026-10-31',clock:()=>now,signal:new AbortController().signal,fetcher:async url=>body(url)});
  assert(out.receipts.every(r=>r.state==='UNAVAILABLE'));assert(out.inputs.every(s=>s.bars.at(-1).date==='2026-10-28'));
 }
});
test('abort, wrong business date and uncovered calendar stop before network work; larger backlogs remain bounded',async()=>{
 const abort=new AbortController();abort.abort();let calls=0;const common={inputs:retained(),businessDate:'2026-10-31',clock:()=>now,fetcher:async()=>{calls++;throw Error('UNEXPECTED');},signal:abort.signal};
 await assert.rejects(()=>refreshDailyAiPrices(common),/AI_REFRESH_ABORTED/);
 await assert.rejects(()=>refreshDailyAiPrices({...common,signal:new AbortController().signal,businessDate:'2026-10-30'}),/AI_REFRESH_SCOPE/);assert.equal(calls,0);
 const out=await refreshDailyAiPrices({...common,inputs:retained('2026-10-01'),signal:new AbortController().signal,fetcher:async url=>{calls++;return Response.json(payload(url));}});
 assert.equal(calls,10);assert(out.additionalGaps.includes('PRICE_REFRESH_BACKLOG_OLDER_SESSIONS_NOT_FETCHED'));assert(out.inputs.every(s=>s.bars.length>=5&&s.bars.length<20));assert(out.inputs.every(s=>out.gapsBySymbol[s.symbol].includes('PRICE_20_SESSION_COVERAGE_MISSING')));
 await assert.rejects(()=>refreshDailyAiPrices({...common,inputs:retained(),businessDate:'2099-10-31',clock:()=>'2099-10-31T03:30:00Z',signal:new AbortController().signal}),/AI_REFRESH_CALENDAR_UNCOVERED/);
});

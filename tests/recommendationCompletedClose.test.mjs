import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeIntradayQuote} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';
import {recommendationQuoteCurrent} from '../supabase/functions/_shared/recommendation-phase.ts';
const at='2026-10-07T05:24:57.065Z',received='2026-10-07T08:18:37.841Z';
const identity={report_date:'2026-10-07',today_date:'2026-10-07',revision_id:'SYNTHETIC_CONTRACT_REGRESSION',generated_at:received,data_as_of:received,is_trading_day:true};
// Real failure timestamp and session shape, synthetic numeric values. This is
// not an archived Production response or an invented performance sample.
const payload={symbol:'1760',date:'2026-10-07',isClose:true,changePercent:1,lastTrade:{price:100,time:Date.parse(at)*1000},total:{tradeVolume:10,tradeValue:1000000}};
async function row(p=payload){return (await normalizeIntradayQuote('1760',p,received,identity.report_date))[0];}
test('closed Fugle session accepts actual last trade before13:25 without timestamp fabrication',async()=>{
 const q=await row();assert.equal(q.source_timestamp,at);assert.equal(q.captured_at,at);assert.equal(q.raw_payload.provider_is_close,true);
 assert.equal(recommendationQuoteCurrent(q,identity),true);
 const open=await row({...payload,isClose:false});assert.notEqual(open.raw_payload.source_hash,q.raw_payload.source_hash);
 assert.equal(recommendationQuoteCurrent(open,identity),false);
});
test('missing/false close proof, wrong date/session/provider and late receipt stay fail closed',async()=>{
 const q=await row();
 for(const patch of [{provider:'other'},{phase:'intraday'},{session:'REGULAR_INTRADAY'},{trading_date:'2026-10-06',raw_payload:{...q.raw_payload,evidence_session_date:'2026-10-06'}},{ingested_at:'2026-10-07T09:00:00Z'},{ingested_at:'2026-10-07T05:25:00Z'},{raw_payload:{...q.raw_payload,provider_is_close:false}},{raw_payload:{...q.raw_payload,provider_is_close:undefined}}])assert.equal(recommendationQuoteCurrent({...q,...patch},identity),false,JSON.stringify(patch));
 assert.equal(recommendationQuoteCurrent(q,{...identity,report_date:'2026-10-08',generated_at:'2026-10-08T02:00:00Z'}),false);
 for(const source of ['2026-10-07T00:59:00Z','2026-10-07T05:31:00Z','2026-10-07T09:00:00Z','2026-10-06T05:24:57Z'])assert.equal(recommendationQuoteCurrent({...q,captured_at:source,source_timestamp:source},identity),false);
});
test('live intraday20minute freshness and unrelated TAIEX/Core paths are unchanged',async()=>{
 const q=await row({...payload,isClose:false,lastTrade:{price:100,time:Date.parse('2026-10-07T02:00:00Z')*1000}});
 q.ingested_at='2026-10-07T02:00:01Z';
 assert.equal(recommendationQuoteCurrent(q,{...identity,generated_at:'2026-10-07T02:19:00Z'}),true);
 assert.equal(recommendationQuoteCurrent(q,{...identity,generated_at:'2026-10-07T02:21:00Z'}),false);
 const legacy={...q,symbol:'TAIEX',phase:'close',captured_at:at,raw_payload:{evidence_session_date:'2026-10-07'}};
 assert.equal(recommendationQuoteCurrent(legacy,identity),false);
});

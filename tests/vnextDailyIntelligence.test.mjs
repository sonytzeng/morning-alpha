import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {snapshotHash} from '../src/features/vnext/contracts.ts';
import {runDailyIntelligence,CandidateFailure,verifyDailyLock,dailySummary,dailyPublication,naturalCallerCandidate} from '../src/features/vnext/dailyIntelligence.ts';
import {researchOutcome,targetSessions,outcomeSweep} from '../src/features/vnext/dailyOutcome.ts';
import {dailyStore} from '../scripts/vnext/daily-store.mjs';
import {previousMarketTradingDate} from '../supabase/functions/_shared/market-session-contract.mjs';
import {entryFixture} from './helpers/entryFixtures.mjs';
import {readOwnerResearch} from '../scripts/vnext/owner-research-server.mjs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {HORIZONS} from '../src/features/vnext/contracts.ts';
// These controls are synthetic; they do not represent market observations,
// licenses, Production users, or a successful investment strategy.
const now='2026-10-12T00:00:00.000Z',source='https://example.test/synthetic-control';
async function fixture(){
 const dates=['2026-10-08'];while(dates.length<20)dates.unshift(previousMarketTradingDate('TW',dates[0]));
 const trace=id=>({id,source,evidence_hash:'a'.repeat(64),published_at:null,first_seen_at:now,available_at:now,as_of:'2026-10-08T13:30:00+08:00'});
 const inputs=Array.from({length:72},(_,n)=>({symbol:String(9000+n),company:'合成控制股票'+n,cutoff:now,through:'2026-10-08',next_session:'2026-10-12',expected_sessions:dates,
  bars:dates.map((date,i)=>({...trace('bar-'+n+'-'+date),date,as_of:date+'T13:30:00+08:00',open:100,close:i===19?104:100,low:99,high:105,volume:10000,amount:i===19?2000000:1000000,session_scope:'SYNTHETIC'})),facts:[],v1_missing:{SHORT:[],MEDIUM:[],LONG:[]}}));
 const body={inputs,entry:null,evidence_cutoff:now},acquired={...body,snapshot_hash:await snapshotHash(body)};
 const request={business_date:'2026-10-12',checkpoint:'MARKET_READY',mode:'FORWARD_SHADOW',provenance:'SYNTHETIC_CONTROL',core_ready:true,core_busy:false,source_revision:'synthetic-1',source_hash:acquired.snapshot_hash,actionable_at:'2026-10-12T09:00:00+08:00'};
 const directory=mkdtempSync('/tmp/ma-daily-intelligence-');const store=dailyStore(directory),calls={acquire:0,outcome:0,publication:0};
 const ports={clock:()=>now,acquire:async()=>{calls.acquire++;return acquired;},outcomes:async()=>{calls.outcome++;return {status:'NOT_MATURED'};},publication:async locks=>{calls.publication++;return dailyPublication(locks,(_,hash)=>({now,audience:'owner',server_entitlement_verified:true,input_hash:hash,approved_hash:null,approved_at:null,quality_reviewed:false,methodology_approved:false,use:'OWN_ANALYSIS',grants:[]}));}};
 return {acquired,request,store,ports,calls,directory};
}
test('daily pipeline executes all stages with 72 independent horizon evaluations and no member approval',async()=>{
 const f=await fixture(),r=await runDailyIntelligence(f.request,f.store,f.ports);assert.equal(r.state,'COMPLETE');assert.equal(r.checkpoint.locks.length,216);
 assert.deepEqual(r.checkpoint.completed,['ACQUISITION','RESEARCH','ENTRY','PREDICTION_LOCK','OUTCOME','PUBLICATION']);
 assert.deepEqual(dailySummary(r.checkpoint.locks).horizons,{SHORT:{scanned:72,qualified:72,rejected:0,insufficient:0},MEDIUM:{scanned:72,qualified:0,rejected:0,insufficient:72},LONG:{scanned:72,qualified:0,rejected:0,insufficient:72}});
 assert.equal(r.checkpoint.publication.eligible,0);assert.equal(r.core_awaits_research,false);for(const l of r.checkpoint.locks)assert(await verifyDailyLock(l));
 const bytes=readFileSync(join(f.directory,r.key,'prediction-batch.json'));assert.equal((await runDailyIntelligence(f.request,f.store,f.ports)).state,'ALREADY_COMPLETE');assert.equal(f.calls.acquire,1);assert.deepEqual(readFileSync(join(f.directory,r.key,'prediction-batch.json')),bytes);
});
for(const date of ['2026-10-09','2026-10-10','2026-10-11'])test('official holiday/weekend never acquires '+date,async()=>{const f=await fixture();assert.equal((await runDailyIntelligence({...f.request,business_date:date},f.store,f.ports)).state,'CLOSED_NO_EXECUTION');assert.equal(f.calls.acquire,0);});
test('unknown calendar and busy/not-ready core defer with zero provider calls',async()=>{const f=await fixture();assert.equal((await runDailyIntelligence({...f.request,business_date:'2040-01-01'},f.store,f.ports)).state,'CALENDAR_UNKNOWN');for(const x of [{core_busy:true},{core_ready:false}])assert.equal((await runDailyIntelligence({...f.request,...x},f.store,f.ports)).state,'DEFERRED_CORE_PRIORITY');assert.equal(f.calls.acquire,0);});
test('same checkpoint cannot replace evidence or source revision',async()=>{const f=await fixture();await runDailyIntelligence(f.request,f.store,f.ports);await assert.rejects(()=>runDailyIntelligence({...f.request,source_revision:'changed'},f.store,f.ports),/SCOPE_CONFLICT/);});
test('provider bounded retry persists exhausted budget across restarts',async()=>{const f=await fixture();let n=0;f.ports.acquire=async()=>{n++;throw new CandidateFailure('RATE_LIMIT',true);};const r=await runDailyIntelligence(f.request,f.store,f.ports);assert.equal(r.state,'BLOCKED');assert.equal(n,3);assert.equal(r.checkpoint.failure.reason,'RATE_LIMIT');await runDailyIntelligence(f.request,dailyStore(f.directory),f.ports);assert.equal(n,3);});
test('timeout aborts provider and cannot append late result',async()=>{const f=await fixture();let aborted=0;f.ports.acquire=(_,s)=>new Promise(resolve=>{s.addEventListener('abort',()=>{aborted++;resolve(f.acquired);});});const r=await runDailyIntelligence(f.request,f.store,f.ports,5);assert.equal(r.state,'BLOCKED');assert.equal(r.checkpoint.failure.reason,'TIMEOUT');assert.equal(aborted,3);assert(!r.checkpoint.acquired);});
test('nonretryable provider failure is classified without leaking error payload',async()=>{const f=await fixture();f.ports.acquire=async()=>{throw Error('sensitive provider response');};const r=await runDailyIntelligence(f.request,f.store,f.ports);assert.equal(r.checkpoint.failure.reason,'INTEGRATION_FAILED');assert(!JSON.stringify(r).includes('sensitive'));});
test('post-lock outcome failure resumes without reacquisition or rewriting prediction',async()=>{const f=await fixture();f.ports.outcomes=async()=>{throw new CandidateFailure('OUTCOME_SOURCE_UNAVAILABLE');};const first=await runDailyIntelligence(f.request,f.store,f.ports);assert.equal(first.state,'BLOCKED');const hash=await snapshotHash(first.checkpoint.locks);f.ports.outcomes=async()=>({status:'UNKNOWN'});const second=await runDailyIntelligence(f.request,dailyStore(f.directory),f.ports);assert.equal(second.state,'COMPLETE');assert.equal(await snapshotHash(second.checkpoint.locks),hash);assert.equal(f.calls.acquire,1);});
test('concurrent worker cannot duplicate lease or acquire twice',async()=>{const f=await fixture();let release;f.ports.acquire=async()=>{f.calls.acquire++;await new Promise(r=>release=r);return f.acquired;};const first=runDailyIntelligence(f.request,f.store,f.ports);while(!release)await new Promise(r=>setTimeout(r,1));await assert.rejects(()=>runDailyIntelligence(f.request,dailyStore(f.directory),f.ports),/RUN_BUSY/);release();await first;assert.equal(f.calls.acquire,1);});
test('future, wrong hash, truncated universe and wrong session reject before locks',async()=>{for(const mutate of [a=>a.inputs[0].facts.push({id:'future',source,evidence_hash:'b'.repeat(64),published_at:null,first_seen_at:'2027-01-01T00:00:00Z',available_at:'2027-01-01T00:00:00Z',as_of:now}),a=>a.inputs.pop(),a=>a.inputs[0].through='2026-10-07']){const f=await fixture();mutate(f.acquired);const {snapshot_hash,...body}=f.acquired;f.acquired.snapshot_hash=await snapshotHash(body);f.request.source_hash=f.acquired.snapshot_hash;const r=await runDailyIntelligence(f.request,f.store,f.ports);assert.equal(r.state,'BLOCKED');assert(!r.checkpoint.locks);}const f=await fixture();f.acquired.snapshot_hash='f'.repeat(64);assert.equal((await runDailyIntelligence(f.request,f.store,f.ports)).checkpoint.failure.reason,'ACQUISITION_HASH_MISMATCH');});
test('late data cannot be backdated into forward; replay stays replay',async()=>{const f=await fixture();f.ports.clock=()=> '2026-10-12T02:00:00Z';await assert.rejects(()=>runDailyIntelligence(f.request,f.store,f.ports),/FORWARD_WINDOW_EXPIRED/);const r=await runDailyIntelligence({...f.request,mode:'HISTORICAL_REPLAY'},f.store,f.ports);assert.equal(r.state,'COMPLETE');assert.equal(dailySummary(r.checkpoint.locks).forward_sample,0);assert(r.checkpoint.locks.every(l=>l.mode==='HISTORICAL_REPLAY'));});
test('entry integration reuses three unchanged models and keeps evidence gaps distinct',async()=>{const f=await fixture(),base=await entryFixture();const entry={...base,business_date:'2026-10-12',evaluation_time:now,mode:'FORWARD',stocks:f.acquired.inputs.map(i=>({...base.stocks[0],symbol:i.symbol,bars:[]}))};f.acquired.entry=entry;const {snapshot_hash,...body}=f.acquired;f.acquired.snapshot_hash=await snapshotHash(body);f.request.source_hash=f.acquired.snapshot_hash;const r=await runDailyIntelligence(f.request,f.store,f.ports);assert.equal(r.state,'COMPLETE');assert.equal(r.checkpoint.entry.candidates.length,216);assert.equal(r.checkpoint.entry.counts.INSUFFICIENT_EVIDENCE,216);assert(r.checkpoint.entry.candidates.every(c=>c.plan===null));});
test('natural caller candidate never waits for research and swallows queue failure only as recovery receipt',async()=>{const f=await fixture();let task,calls=0;assert.equal(naturalCallerCandidate({...f.request,core_ready:false},()=>{calls++;},p=>task=p),'DEFERRED_CORE_PRIORITY');assert.equal(calls,0);assert.equal(naturalCallerCandidate(f.request,async()=>{calls++;throw Error('offline');},p=>task=p),'CANDIDATE_ENQUEUED_NOT_PRODUCTION');assert.equal((await task).state,'ENQUEUE_FAILED');});
test('synchronous enqueue and background registration failures cannot throw into Core',async()=>{
 const f=await fixture();let task;
 assert.equal(naturalCallerCandidate(f.request,()=>{throw Error('sync');},p=>task=p),'CANDIDATE_ENQUEUED_NOT_PRODUCTION');
 assert.equal((await task).state,'ENQUEUE_FAILED');
 assert.equal(naturalCallerCandidate(f.request,async()=>null,()=>{throw Error('background');}),'CANDIDATE_BACKGROUND_REGISTRATION_FAILED');
});
test('durable prediction batch rejects mutation and synthetic never counts as performance',async()=>{const f=await fixture(),r=await runDailyIntelligence(f.request,f.store,f.ports);const copy=structuredClone(r.checkpoint.locks);copy[0].research.reason='tamper';await assert.rejects(()=>f.store.lock(copy),/LOCK_INVALID/);assert.equal(dailySummary(r.checkpoint.locks).outcome_sample,0);});
test('corrupt durable checkpoint refuses reuse instead of recomputing a new authoritative result',async()=>{
 const f=await fixture(),r=await runDailyIntelligence(f.request,f.store,f.ports),dir=join(f.directory,r.key);
 const path=join(dir,readdirSync(dir).filter(n=>n.startsWith('checkpoint-')).sort().at(-1));
 const raw=JSON.parse(readFileSync(path,'utf8'));raw.state.finished=false;writeFileSync(path,JSON.stringify(raw));
 await assert.rejects(()=>runDailyIntelligence(f.request,dailyStore(f.directory),f.ports),/CHECKPOINT_INTEGRITY/);assert.equal(f.calls.acquire,1);
});
test('completed checkpoint cannot hide a modified persisted prediction batch',async()=>{
 const f=await fixture(),r=await runDailyIntelligence(f.request,f.store,f.ports),path=join(f.directory,r.key,'prediction-batch.json');
 const rows=JSON.parse(readFileSync(path,'utf8'));rows[0].confirmation='tampered';writeFileSync(path,JSON.stringify(rows));
 await assert.rejects(()=>runDailyIntelligence(f.request,dailyStore(f.directory),f.ports),/PREDICTION_STORAGE_INTEGRITY/);
});
test('outcome evidence is append-only, same source idempotent and changed result cannot overwrite',async()=>{
 const f=await fixture(),r=await runDailyIntelligence(f.request,f.store,f.ports),lock=r.checkpoint.locks[0];
 const value=await researchOutcome(lock,1,{symbol:lock.symbol,observed_at:now,bars:[],benchmark:[],actions:null,invalidation:null});
 const key=await snapshotHash({prediction:lock.lock_hash,horizon:1,source:value.outcome_source_hash});
 await f.store.appendOutcome(key,value);await f.store.appendOutcome(key,value);
 await assert.rejects(()=>f.store.appendOutcome('f'.repeat(64),value),/OUTCOME_SCOPE_INVALID/);
 await assert.rejects(()=>f.store.appendOutcome(key,{...value,state:'FAKE_PASS'}),/IMMUTABLE_OUTCOME_CONFLICT/);
 assert.equal(readdirSync(join(f.directory,r.key)).filter(n=>n.startsWith('outcome-')).length,1);
});
test('candidate owner payload never reaches anonymous/free/premium; controls are not real Auth proof',async()=>{
 const request={method:'GET',authorization:'Bearer synthetic-control'};
 const daily={private_marker:'RESEARCH_ONLY'};
 for(const tier of ['free','premium']){
  const r=await readOwnerResearch(request,[],async()=>Response.json({schema:'VNEXT_PROJECTION_V1',tier,research_only:true}),null,null,null,null,null,daily);
  assert.equal(r.status,403);assert(!JSON.stringify(r).includes('RESEARCH_ONLY'));
 }
 assert.equal((await readOwnerResearch({method:'GET'},[])).status,401);
 const owner=await readOwnerResearch(request,[],async()=>Response.json({schema:'VNEXT_PROJECTION_V1',tier:'owner',research_only:true}),null,null,null,null,null,daily);
 assert.equal(owner.status,200);assert.equal(owner.body.daily.private_marker,'RESEARCH_ONLY');
});
test('Outcome uses independent horizon dates and fails closed beyond official calendar',()=>{assert.deepEqual(targetSessions('2026-10-08T09:00:00+08:00',2),['2026-10-08','2026-10-12']);assert.equal(targetSessions('2040-01-01T09:00:00+08:00',20),null);});
test('Outcome maturity, gaps, adjustment and execution never turn daily bars into fills',async()=>{const f=await fixture(),r=await runDailyIntelligence(f.request,f.store,f.ports),lock=r.checkpoint.locks[0];const s={symbol:lock.symbol,observed_at:now,bars:[],benchmark:[],actions:null,invalidation:null};assert.equal((await researchOutcome(lock,1,s)).state,'NOT_MATURED');s.observed_at='2026-10-12T06:00:00Z';assert.equal((await researchOutcome(lock,1,s)).state,'UNKNOWN');const bar={date:'2026-10-12',id:'b',source,evidence_hash:'b'.repeat(64),published_at:null,first_seen_at:s.observed_at,available_at:s.observed_at,as_of:'2026-10-12T05:30:00Z',open:100,high:104,low:98,close:103,volume:100,amount:10000,session_scope:'SYNTHETIC'};s.bars=[bar];s.benchmark=[bar];const o=await researchOutcome(lock,1,s);assert.equal(o.state,'OBSERVED_NOT_PERFORMANCE');assert(o.reasons.includes('CORPORATE_ACTION_COVERAGE_UNVERIFIED'));assert.equal(o.net_return,null);assert.equal(o.mfe,null);assert.equal(o.performance_eligible,false);assert.equal(o.observations.relative_price_change,null);await assert.rejects(()=>researchOutcome(lock,250,s),/SCOPE_INVALID/);let n=0;const sweep=await outcomeSweep(r.checkpoint.locks,async()=>s,async()=>n++,1);assert.equal(sweep.processed,1);assert.equal(sweep.remaining,215);assert.equal(n,3);});

// Render the actual component with labelled synthetic entry results. These are
// presentation controls, not proof of a Production publication or a real entry.
const entryUiSource=readFileSync(new URL('../src/pages/vnext/DailyIntelligence.tsx',import.meta.url),'utf8');
const entryUiExports={};
vm.runInNewContext(ts.transpileModule(entryUiSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText,{
 exports:entryUiExports,React,require:name=>{
  if(name==='react')return React;
  if(name==='@/features/vnext/contracts')return {HORIZONS};
  throw Error('UNEXPECTED_DAILY_UI_IMPORT:'+name);
 },
});
const syntheticEntries=()=>[
 {strategy:'OVERSOLD_REVERSAL',status:'WAIT_CONFIRMATION',reasons:['合成反轉仍待收盤確認'],trigger:'合成反轉觸發條件',invalidation:'合成反轉失效條件'},
 {strategy:'PULLBACK_ENTRY',status:'AVOID_ENTRY',reasons:['合成回檔風險過高'],trigger:'不得顯示的回檔買價',invalidation:'不得顯示的回檔停損'},
 {strategy:'BREAKOUT_CONTINUATION',status:'ENTRY_READY',reasons:['合成突破研究條件符合'],trigger:'合成突破觸發條件',invalidation:'合成突破失效條件'},
];
function entryUi(entry=syntheticEntries(),missing=false){
 const row={symbol:'9999',company:'合成展示控制',horizon:'SHORT',state:'QUALIFIED',reason:'合成觀察理由',confirmation:'合成觀察確認',invalidation:'合成觀察取消',risk:'合成風險',next_review_at:'2026-10-12T13:30:00+08:00',entry_source_missing:missing,entry};
 const data={through:'2026-10-08',evaluated_at:now,locked_at:now,source_hash:'a'.repeat(64),run_key:'b'.repeat(64),stages:[],pending_outcomes:0,unknown_outcomes:0,
  summary:{horizons:Object.fromEntries(Object.keys(HORIZONS).map(h=>[h,{scanned:1,qualified:1,rejected:0,insufficient:0}])),entry_source_missing_symbols:missing?1:0},rows:[row]};
 return renderToStaticMarkup(React.createElement(entryUiExports.default,{data}));
}
test('daily UI exposes each retained strategy reason, conditional trigger and invalidation without claiming a fill',()=>{
 const html=entryUi();
 for(const text of ['超跌反轉：等待條件確認','趨勢回檔：不適合進場','突破延續：研究條件符合，尚未確認成交','合成反轉仍待收盤確認','合成反轉觸發條件','合成反轉失效條件','合成突破觸發條件','合成突破失效條件','本期間各股已有三種進場判斷'])assert(html.includes(text),text);
 assert(!html.includes('不得顯示'));assert(!/<details[^>]*\bopen/.test(html));
 assert(html.includes('不是今日推薦或事前預測'));
});
test('daily UI counts an incomplete judgment even when the source adapter exists',()=>{
 const entries=syntheticEntries();entries[2]={...entries[2],status:'INSUFFICIENT_EVIDENCE',reasons:['合成缺少事件來源']};
 const html=entryUi(entries,false);
 assert(html.includes('本期間有 1 檔的進場研究仍有資料缺口'));assert(html.includes('合成缺少事件來源'));
 assert(!html.includes('合成突破觸發條件'));assert(!html.includes('合成突破失效條件'));
 assert(html.includes('合成反轉觸發條件'));
});
test('daily UI suppresses stale actionable strings when the matching source is missing',()=>{
 const html=entryUi(syntheticEntries(),true);
 assert.equal((html.match(/資料不足，無法判斷/g)||[]).length,3);
 assert(!html.includes('合成反轉觸發條件'));assert(!html.includes('合成突破觸發條件'));
 assert(!html.includes('合成反轉仍待收盤確認'));assert(!html.includes('合成突破研究條件符合'));
 assert(!html.includes('研究條件符合，尚未確認成交'));
});
test('daily UI treats absent, duplicate and unknown strategy statuses as unavailable',()=>{
 for(const entries of [[],[...syntheticEntries(),syntheticEntries()[0]],syntheticEntries().map(e=>({...e,status:'UNRECOGNIZED'}))]){
  const html=entryUi(entries);assert(html.includes('本期間有 1 檔的進場研究仍有資料缺口'));
  assert(!html.includes('合成反轉觸發條件'));assert(!html.includes('UNRECOGNIZED'));
 }
});

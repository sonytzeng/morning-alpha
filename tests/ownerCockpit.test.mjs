import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
import React from 'react';import * as jsxRuntime from 'react/jsx-runtime';import {renderToStaticMarkup} from 'react-dom/server';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
function module(p,extra={}){const exports={};vm.runInNewContext(ts.transpileModule(read(p),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Intl,Date,TextEncoder,crypto:globalThis.crypto,require:n=>{if(n in extra)return extra[n];throw Error(n);}});return exports;}
const contracts=module('src/features/vnext/contracts.ts');
const lab=module('src/features/research/tradingLab.ts'),publicMarket=module('src/lib/publicMarketReadModel.ts'),m=module('src/features/research/cockpit.ts',{'./tradingLab':lab,'../../lib/publicMarketReadModel':publicMarket,'../vnext/contracts':contracts});
// Render the actual component with explicit saved-state fixtures. Effects are
// deliberately not executed: this verifies display, not Production/Auth E2E.
function renderCockpit({market=null,entry=null,tab='today',today='2026-10-19'}={}){
 let slot=0;const values=[tab,market,entry,{},'',false,today,false],exports={};
 const react={useEffect(){},useState(initial){const value=slot<values.length?values[slot]:typeof initial==='function'?initial():initial;slot++;return [value,()=>{}];}};
 const source=ts.transpileModule(read('src/pages/admin/analysis/OwnerCockpit.tsx'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(source,{exports,Intl,Date,require:name=>{
  if(name==='react')return react;if(name==='react/jsx-runtime')return jsxRuntime;
  if(name==='@/features/research/cockpit')return m;if(name==='@/features/research/tradingLab')return lab;
  if(name==='@/lib/supabase')return {supabase:new Proxy({},{get(){throw Error('DISPLAY_MUST_NOT_REQUEST');}})};
  if(name==='./CockpitJournal')return {default:()=>null};if(name==='./cockpit.css')return {};
  throw Error(name);
 }});
 return renderToStaticMarkup(React.createElement(exports.default,null,
  React.createElement('div',{'data-source':'independent-stock-observation'},'2421 WATCH：個股觀察，不能代替進場策略結果')));
}
test('first-layer direction vocabulary is Chinese without changing evidence or numbers',()=>{
 const source='SOX DOWN -2.60%；2330 FLAT 0.00%；NVDA UP 1.23%';
 assert.equal(m.plainEvidence(source),'費城半導體指數 下跌 -2.60%；2330 持平 0.00%；輝達 上漲 1.23%');
 assert.equal(m.plainEvidence('UNKNOWN_GAP setup 尚未確認'),'UNKNOWN_GAP setup 尚未確認');
 assert.equal(source,'SOX DOWN -2.60%；2330 FLAT 0.00%；NVDA UP 1.23%');
});
for(const [regime,label] of Object.entries({stress:'壓力市場',volatile_range:'高波動盤整',risk_on_trend:'風險偏好多頭趨勢',risk_off_trend:'風險退避空頭趨勢'}))test(`actual Owner cockpit renders current producer regime ${regime} with the shared market label`,()=>{
 const market={business_date:'2026-10-19',canonical:{status:'READY',report_date:'2026-10-19',action:'WAIT',market_regime:regime,
  generated_text:{market_bias:'偏弱觀察',daily_sentence:'SYNTHETIC 已發布市場結論'}}};
 const before=JSON.stringify(market),html=renderCockpit({market});
 assert.equal(publicMarket.PUBLIC_REGIMES[regime],label);
 assert.match(html,new RegExp(`偏弱觀察 · ${label}`));
 assert.doesNotMatch(html,/市場型態尚未確認/);
 assert.match(html,/先等條件確認，不急著進場/);
 assert.match(html,/尚未取得今日進場研究結果/);
 assert.equal(JSON.stringify(market),before);
});
test('unknown regime stays unconfirmed without suppressing the saved market conclusion or creating recommendations',()=>{
 const market={business_date:'2026-10-19',canonical:{status:'READY',report_date:'2026-10-19',action:'WAIT',market_regime:'unreviewed_regime',
  generated_text:{market_bias:'偏弱觀察',daily_sentence:'SYNTHETIC 已發布市場結論'}}};
 const html=renderCockpit({market});
 assert.match(html,/偏弱觀察 · 市場型態尚未確認/);
 assert.match(html,/SYNTHETIC 已發布市場結論/);
 assert.match(html,/尚未取得今日進場研究結果/);
 assert.equal(m.cockpitToday(market,null,'2026-10-19').ready,null);
});
test('historical, stale and future research cannot become today opportunities',()=>{
 const row={mode:'HISTORICAL_REPLAY',business_date:'2026-10-08',evaluation_time:'2026-10-08T02:00:00Z',candidates:[{symbol:'2330',status:'ENTRY_READY'}]};
 assert.equal(m.isCurrentResearch(row,'2026-10-08'),false);assert.equal(m.cockpitToday(null,row,'2026-10-08').ready,null);
 assert.equal(m.isCurrentResearch({...row,mode:'FORWARD'},'2026-10-09'),false);
 assert.equal(m.isCurrentResearch({...row,mode:'FORWARD',evaluation_time:'2999-01-01'},'2026-10-08'),false);
 const x=m.cockpitToday(null,{...row,mode:'FORWARD',candidates:[...row.candidates,...row.candidates]},'2026-10-08');assert.equal(x.ready,1);
});
test('Entry headline never borrows V2 WATCH or legacy Lab activation status',()=>{
 const market={business_date:'2026-10-19',forward_enabled:false,canonical:{status:'READY',report_date:'2026-10-19',action:'WAIT',generated_text:{daily_sentence:'當日正式市場結論'}},
  discovery:{watchlist:[{symbol:'2421',status:'WATCH'}]}};
 const historical={mode:'HISTORICAL_REPLAY',business_date:'2026-10-19',evaluation_time:'2026-10-18T23:00:00Z',candidates:[{symbol:'2330',status:'ENTRY_READY'}]};
 for(const latest of [null,historical,{...historical,mode:'FORWARD',business_date:'2026-10-18'},
  {...historical,mode:'FORWARD',evaluation_time:'2999-01-01T00:00:00Z'}]){
  const result=m.cockpitToday(market,latest,'2026-10-19');assert.equal(result.watch,null);assert.equal(result.ready,null);assert.equal(result.currentResearch,false);
  const html=renderCockpit({market,entry:latest?{latest}:null});
  assert.match(html,/2421 WATCH/);assert.match(html,/進場策略待確認<\/span><strong>尚未取得今日進場研究結果/);
  assert.match(html,/個股觀察名單不代表進場條件已成立/);assert.doesNotMatch(html,/尚未啟用|已取得今日進場策略研究/);
 }
});
test('only current FORWARD Entry symbols drive displayed waiting and ready counts',()=>{
 const latest={mode:'FORWARD',business_date:'2026-10-19',evaluation_time:'2026-10-18T23:00:00Z',candidates:[
  {symbol:'2330',status:'WAIT_CONFIRMATION'},{symbol:'2330',status:'WAIT_CONFIRMATION'},
  {symbol:'2317',status:'ENTRY_READY'},{symbol:'2317',status:'ENTRY_READY'},
  {symbol:'2421',status:'AVOID_ENTRY'},{symbol:'2454',status:'INSUFFICIENT_EVIDENCE'}]};
 const result=m.cockpitToday(null,latest,'2026-10-19');assert.equal(result.watch,1);assert.equal(result.ready,1);assert.equal(result.currentResearch,true);
 const html=renderCockpit({entry:{latest}});assert.match(html,/進場策略待確認<\/span><strong>1 檔/);
 assert.match(html,/符合研究進場條件<\/span><strong>1 檔/);assert.match(html,/已取得今日進場策略研究/);
 assert.doesNotMatch(html,/尚未啟用|尚未取得今日進場研究結果/);
 const empty={...latest,candidates:[]},emptyHtml=renderCockpit({entry:{latest:empty}});
 assert.match(emptyHtml,/進場策略待確認<\/span><strong>0 檔/);assert.match(emptyHtml,/已取得今日進場策略研究/);
});
test('Entry research limitations describe samples without claiming automation is disabled',()=>{
 const html=renderCockpit({tab:'research'});
 assert.match(html,/目前樣本不足，還不能判斷這套進場策略是否有效/);
 assert.match(html,/個股觀察名單不等於進場條件已成立/);assert.doesNotMatch(html,/尚未啟用/);
});
test('only same-day READY canonical market is used; Taipei boundary is explicit',()=>{
 assert.equal(m.taipeiToday(new Date('2026-10-08T16:00:00Z')),'2026-10-09');
 assert.equal(m.cockpitToday({business_date:'2026-10-08',canonical:{status:'READY',report_date:'2026-10-08'}},null,'2026-10-09').market,null);
});
test('search name or symbol and exact state without promoting waiting',()=>{
 const rows=[{symbol:'2330',name:'台積電',status:'WAIT_CONFIRMATION'},{symbol:'2317',name:'鴻海',status:'AVOID_ENTRY'}];
 assert.equal(m.filterResearch(rows,'台積','ALL').length,1);assert.equal(m.filterResearch(rows,'2330','ENTRY_READY').length,0);
 assert.equal(m.entryNames.WAIT_CONFIRMATION,'值得觀察，等待確認');
});
test('holiday stock labels are bounded display metadata, never fabricated or conflicting',()=>{
 const rows=[{symbol:'2330',stock_name:' 台積電 '},{symbol:'2330',stock_name:'台積電'},{symbol:'2317',stock_name:'甲'},{symbol:'2317',stock_name:'乙'},{symbol:'9999',stock_name:'不在研究內'},{symbol:'1101',stock_name:''}];
 const names=m.researchStockNames(rows,['2330','2317','1101']);
 assert.deepEqual(JSON.parse(JSON.stringify(names)),{'2330':'台積電'});
 assert.equal(Object.keys(m.researchStockNames(null,['2330'])).length,0);
 const original={symbol:'2330',status:'WAIT_CONFIRMATION',name:undefined};
 const display={...original,name:names[original.symbol]};
 assert.equal(m.filterResearch([display],'台積','ALL').length,1);
 assert.equal(original.name,undefined);assert.equal(display.status,original.status);
 const ui=read('src/pages/admin/analysis/OwnerCockpit.tsx');
 assert(ui.includes(".select('symbol,stock_name').in('symbol',symbols).limit(1000)"));
 assert(ui.includes('symbols.length<=72'));assert(ui.includes('setCatalogNames({})'));
 assert(ui.includes('active&&g===generation&&!names.error'));
 assert(ui.indexOf('const names=await supabase.from')>ui.indexOf('setEntry(parsed)'));
});
test('insufficient evidence suppresses even an accidentally attached price plan',()=>{
 const plan={reference_range:[100,101],stop:90,target:120,risk_distance:10,reward_space:20,reward_risk:2};
 assert.equal(m.safePlan({status:'INSUFFICIENT_EVIDENCE',plan}),null);
 assert.equal(m.safePlan({status:'WAIT_CONFIRMATION',plan}).stop,90);
 assert.equal(m.safePlan({status:'ENTRY_READY',plan:{...plan,stop:NaN}}),null);
});
test('unknown net cost/profit is not coerced to zero; exact method required',()=>{
 assert.equal(m.totalKnown([{realized:10},{realized:null}],'realized'),null);
 assert.equal(m.totalKnown([{realized:10},{realized:-3}],'realized'),7);
 assert.throws(()=>m.readJournal({version:'OWNER_COCKPIT_LEDGER_V1',method:'FIFO',positions:[],audit:[]}),/CONTRACT/);
 assert.throws(()=>m.readJournal({version:'OWNER_COCKPIT_LEDGER_V1',method:'MOVING_AVERAGE_V1',positions:[{book:'LIVE',quantity:-1}],audit:[]}),/CONTRACT/);
});
test('only explicit submit writes, no outcome catch-up or simulation on page load',()=>{
 const ui=read('src/pages/admin/analysis/CockpitJournal.tsx');
 assert(ui.includes("operation:'COCKPIT_READ'"));assert.equal((ui.match(/operation:'COCKPIT_RECORD'/g)||[]).length,1);
 assert(!ui.includes('REFRESH_OUTCOMES'));assert(ui.includes('form.at'));assert(ui.includes('UNKNOWN')||ui.includes('未知'));
 assert(ui.includes("event==='SIGNED_OUT'||event==='SIGNED_IN'"));assert(ui.includes('g!==generation.current'));
 const sql=read('supabase/migrations/20261008213105_owner_trading_cockpit_ledger_v1.sql');
 assert(!/update public\.|delete from public\.|alter table public\./i.test(sql));assert(sql.includes('pg_advisory_xact_lock'));
 assert(sql.includes('unique(owner_id,request_id)'));assert(sql.includes('research_private.lab_require_owner'));
});

// Synthetic locked-RPC controls; never persisted or counted as Forward samples.
async function naturalFixture(){
 const date='2026-10-29',at='2026-10-28T23:01:00.000Z',locks=[];
 for(let i=0;i<72;i++)for(const horizon of ['SHORT','MEDIUM','LONG']){
  const symbol=String(1000+i),entries=Object.keys(m.strategyNames).map(strategy=>({symbol,name:'SYNTHETIC',strategy,strategy_version:strategy+'_1.0.0',status:'WAIT_CONFIRMATION',market_direction:'SYNTHETIC',market_regime:'range',entry_environment:'BALANCED',opportunity_quality:'CONDITIONAL',evidence_confidence:{completeness:1,probability:null,calibration:'INSUFFICIENT_SAMPLE'},reasons:['SYNTHETIC_WAIT'],entry_trigger:null,invalidation:null,plan:null,metrics:{},evidence_refs:['SYNTHETIC'],v2_status:'WATCH',horizons:[1,3,5,10,20]}));
  const body={id:'SYNTHETIC_'+symbol+'_'+horizon,business_date:date,symbol,horizon,mode:'FORWARD_SHADOW',provenance:'RETAINED_REAL_EVIDENCE',strategy_version:'VNEXT_OBSERVATION_HYPOTHESIS_2.0.0',entry_version:'ENTRY_OPPORTUNITY_1.0.0',generated_at:at,locked_at:'2026-10-28T23:02:00.000Z',evidence_cutoff:at,actionable_at:'2026-10-29T01:00:00.000Z',evidence_hash:'a'.repeat(64),confirmation:'SYNTHETIC_CONFIRM',invalidation:'SYNTHETIC_CANCEL',research:{symbol,horizon,confirmation:'SYNTHETIC_CONFIRM',invalidation:'SYNTHETIC_CANCEL'},entry:entries,entry_gap:null};
  locks.push({...body,lock_hash:await contracts.snapshotHash(body)});
 }
 return {business_date:date,member_published:0,performance_sample:0,analysis_value:'INSUFFICIENT_SAMPLE',predictions:locks};
}
const naturalNow=Date.parse('2026-10-29T00:00:00Z');
test('natural Owner RPC projects 216 verified locks to 72 stocks and 216 Entry results without samples or policy invention',async()=>{
 const data=await naturalFixture(),before=JSON.stringify(data),r=await m.dailyLockedEntry(data,'2026-10-29',naturalNow);
 assert.equal(r.source_kind,'DAILY_FORWARD_LOCKS');assert.equal(r.candidates.length,216);assert.equal(r.universe,72);assert.equal(r.scanned,72);
 assert.equal(m.cockpitToday(null,r,'2026-10-29').watch,72);assert.equal(m.cockpitToday(null,r,'2026-10-29').ready,0);
 assert.equal(r.policy,undefined);assert.equal(r.forward_sample,undefined);assert.equal(r.outcome_sample,undefined);assert.equal(JSON.stringify(data),before);
});
test('empty natural execution is unavailable research, not a zero-opportunity claim',async()=>{
 const d=await naturalFixture();d.predictions=[];assert.equal(await m.dailyLockedEntry(d,'2026-10-29',naturalNow),null);
 assert.equal(m.cockpitToday(null,null,'2026-10-29').watch,null);
});
test('natural reader rejects stale dates, partial batches, wrong provenance, late locks and altered bytes',async()=>{
 const base=await naturalFixture();
 for(const mutate of [d=>d.business_date='2026-10-28',d=>d.predictions.pop(),d=>d.predictions[0].entry[0].status='ENTRY_READY',d=>d.predictions[0].mode='HISTORICAL_REPLAY',d=>d.predictions[0].provenance='SYNTHETIC_CONTROL',d=>d.predictions[0].locked_at='2026-10-29T01:00:00.000Z']){
  const d=structuredClone(base);mutate(d);await assert.rejects(m.dailyLockedEntry(d,'2026-10-29',naturalNow),/DAILY_ENTRY_/);
 }
 await assert.rejects(m.dailyLockedEntry(base,'2026-10-29',Date.parse('2026-10-30T00:00:00Z')),/CONTRACT/);
});
test('even rehashed duplicate stocks, conflicting horizon Entry results and invalid price plans refuse projection',async()=>{
 const base=await naturalFixture();
 for(const mutate of [d=>d.predictions[1]=structuredClone(d.predictions[0]),d=>d.predictions[1].entry[0].reasons.push('CONFLICT'),d=>d.predictions[0].entry[0].plan={reference_range:[100,101],trigger:100,stop:102,target:110,risk_distance:1,reward_space:8,reward_risk:8,max_risk:.08,not_before:'2026-10-30',expires_on:'2026-10-30'}]){
  const d=structuredClone(base);mutate(d);for(const p of d.predictions){const {lock_hash,...body}=p;p.lock_hash=await contracts.snapshotHash(body);}
  await assert.rejects(m.dailyLockedEntry(d,'2026-10-29',naturalNow),/DAILY_ENTRY_/);
 }
});
test('a changed caller object cannot replace a future horizon after the first digest await',async()=>{
 const d=await naturalFixture(),p=m.dailyLockedEntry(d,'2026-10-29',naturalNow);d.predictions[215].entry[0].status='ENTRY_READY';
 const r=await p;assert(r.candidates.every(c=>c.status==='WAIT_CONFIRMATION'));
});
test('Owner UI reads natural locks through the existing Owner RPC and retains auth/date cancellation',()=>{
 const ui=read('src/pages/admin/analysis/OwnerCockpit.tsx');assert(ui.includes("rpc('get_owner_vnext_daily_v1',{p_date:requestDate})"));assert(ui.includes("d.error?.code==='42501'"));assert(ui.includes('taipeiToday()!==requestDate'));assert(ui.includes('dailyLockedEntry(d.data,requestDate)'));assert(!ui.includes("rpc('vnext_daily_runtime_v1'"));
});

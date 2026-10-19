import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
import React from 'react';import * as jsxRuntime from 'react/jsx-runtime';import {renderToStaticMarkup} from 'react-dom/server';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
function module(p,extra={}){const exports={};vm.runInNewContext(ts.transpileModule(read(p),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Intl,Date,require:n=>{if(n in extra)return extra[n];throw Error(n);}});return exports;}
const lab=module('src/features/research/tradingLab.ts'),m=module('src/features/research/cockpit.ts',{'./tradingLab':lab});
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

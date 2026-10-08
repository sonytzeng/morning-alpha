import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
function module(p,extra={}){const exports={};vm.runInNewContext(ts.transpileModule(read(p),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Intl,Date,require:n=>{if(n in extra)return extra[n];throw Error(n);}});return exports;}
const lab=module('src/features/research/tradingLab.ts'),m=module('src/features/research/cockpit.ts',{'./tradingLab':lab});
test('historical, stale and future research cannot become today opportunities',()=>{
 const row={mode:'HISTORICAL_REPLAY',business_date:'2026-10-08',evaluation_time:'2026-10-08T02:00:00Z',candidates:[{symbol:'2330',status:'ENTRY_READY'}]};
 assert.equal(m.isCurrentResearch(row,'2026-10-08'),false);assert.equal(m.cockpitToday(null,row,'2026-10-08').ready,null);
 assert.equal(m.isCurrentResearch({...row,mode:'FORWARD'},'2026-10-09'),false);
 assert.equal(m.isCurrentResearch({...row,mode:'FORWARD',evaluation_time:'2999-01-01'},'2026-10-08'),false);
 const x=m.cockpitToday(null,{...row,mode:'FORWARD',candidates:[...row.candidates,...row.candidates]},'2026-10-08');assert.equal(x.ready,1);
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

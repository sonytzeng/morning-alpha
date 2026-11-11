import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { marketSnapshotHash } from '../research/taiwan-market-universe.mjs';
import { TPEX_ACTION_SOURCES, TAIWAN_ACTION_KINDS, taiwanActionUrl, decodeTaiwanActionCapture,
  normalizeTaiwanActionCapture, buildTaiwanMarketActionCoverage, createTaiwanActionReplayEvidence } from '../research/taiwan-market-actions.mjs';
import { shortActionCoverageForWindow } from '../research/daily-ai-short-calibration.ts';
import { replayDailyAiShortMethod } from '../research/daily-ai-short-replay.ts';
import { validateAnalysisPacket } from '../research/daily-ai-analysis.ts';

// All issuers, prices, action rows, timestamps and costs in this file are
// synthetic counterexamples. No fixture is a source or recommendation approval.
const sha = value => createHash('sha256').update(value).digest('hex');
const from = '2026-08-11', through = '2026-11-11', cutoff = '2026-11-11T10:00:00Z';
const sources = Object.keys(TPEX_ACTION_SOURCES);
const received = ['2026-11-11T09:07:58.998044Z', '2026-11-11T09:08:10.771929Z', '2026-11-11T09:08:19.037989Z'];
function universe() {
  const companies = [['TPEX','5347'],['TPEX','5348'],['TPEX','3290'],['TPEX','8932'],['TWSE','2330'],['EMERGING','7777']]
    .map(([market,symbol]) => ({security_id:market+':'+symbol,market,symbol,company:'Synthetic '+symbol}));
  const body = {schema:'TAIWAN_MARKET_UNIVERSE_V1',coverage_complete:true,total:companies.length,companies};
  return {...body,universe_hash:marketSnapshotHash(body)};
}
function exRow({symbol='5347',date='115/08/20',cash='1.50',stock='0',rights='0'}={}) {
  const hasRights=Number(stock)>0||Number(rights)>0, label=Number(cash)>0?(hasRights?'除權息':'除息'):'除權';
  return [date,symbol,'Synthetic','100','98.5','0','1.5','1.5',label,'108','90','98.5','98.5',cash,stock,'0','0','0','0',rights,rights];
}
function html(pairs) { return '<table>'+pairs.map(([label,value])=>'<tr><th>'+label+'</th><td>'+value+'</td></tr>').join('')+'</table>'; }
function capitalRow() {return ['1150821','3290','Synthetic','100','90','99','81','90','90','現金減資',html([
  ['股票代號/股票名稱:','3290&nbsp/&nbspSynthetic'],['停止買賣日期:','115/08/11'],['恢復買賣日期:','115/08/21'],
  ['每壹仟股換發新股票:','700.00000000&nbsp股'],['每股退還股款:','3.00000000&nbsp元/股'],
  ['現金增資總股數:','NA'],['現金增資認購價:','NA'],['現金增資配股率:','NA']])];}
function parRow() {return ['1150901','8932','Synthetic','100','50','55','45','50',html([
  ['證券代號/證券名稱:','8932&nbsp/&nbspSynthetic'],['停止買賣日期:','115/08/20'],['恢復買賣日期:','115/09/01'],
  ['變更股票面額換股率:','2.00000000'],['變更前股票面額:','5.00000000'],['變更後股票面額:','2.50000000']])];}
function capture(source_id, {rows, gzip=false, mutate, received_at=received[sources.indexOf(source_id)]}={}) {
  rows ??= source_id==='tpex_ex_right'?[exRow()]:source_id==='tpex_capital_reduction'?[capitalRow()]:[parRow()];
  const payload={date:from.replaceAll('-','')+'~'+through.replaceAll('-',''),stat:'ok',tables:[{title:'',
    fields:[...TPEX_ACTION_SOURCES[source_id].fields],totalCount:rows.length,data:globalThis.structuredClone(rows),summary:[]}]};
  mutate?.(payload);
  const entity=Buffer.from(JSON.stringify(payload,null,1)+'\n'),bytes=gzip?gzipSync(entity):entity;
  const url=taiwanActionUrl(source_id,from,through);
  const receipt={schema:'TAIWAN_HISTORY_SOURCE_RECEIPT_V1',source_id,market:'TPEX',family:TPEX_ACTION_SOURCES[source_id].family,
    url,task_id:sha(url),date:null,from,through,state:'CAPTURED',status:200,started_at:'2026-11-11T09:00:00Z',received_at,
    bytes:bytes.length,sha256:sha(bytes),raw_bytes_complete:true,content_encoding:gzip?'gzip':'identity',historical_knowledge:false,
    fixture_provenance:'SYNTHETIC_TEST'};
  return {receipt,bytes,entity,payload};
}
function bundle(captures=sources.map(source=>capture(source)),u=universe()) {
  return buildTaiwanMarketActionCoverage({universe:u,captures,from,through,cutoff});
}
const actionCheck=(evidence,symbol,start=from,end=through)=>shortActionCoverageForWindow(evidence,symbol,start,end,'RAW_EXCLUDE_EVENT_WINDOWS');

test('gzip wire, exact decoded entity and original table/row arrays remain independently bound',()=>{
  const f=capture('tpex_ex_right',{gzip:true}),decoded=decodeTaiwanActionCapture(f),doc=normalizeTaiwanActionCapture(f);
  assert(decoded.entity_bytes.equals(f.entity));assert.notEqual(sha(f.bytes),sha(f.entity));
  assert.equal(decoded.public_receipt.sha256,sha(f.entity));assert.equal(decoded.public_receipt.wire_capture.source_sha256,sha(f.bytes));
  assert.equal(decoded.public_receipt.wire_capture.receipt_hash,marketSnapshotHash(f.receipt));
  assert.equal(doc.table_hash,marketSnapshotHash(f.payload.tables[0]));assert.equal(doc.row_count,1);
  assert.equal(doc.events[0].source_capture.source_row_hash,marketSnapshotHash(f.payload.tables[0].data[0]));
  assert.deepEqual(doc.events[0].raw_row,f.payload.tables[0].data[0]);assert.deepEqual(doc.events[0].source_capture.row_path,['tables',0,'data',0]);
  assert.equal(doc.events[0].available_at,f.receipt.received_at);assert.equal(doc.public_receipt.historical_knowledge,false);
});

test('HTTP success cannot replace exact range, fields, count, warnings and duplicate-row checks',()=>{
  const changes=[p=>p.stat='pending',p=>p.date='20260811~20261110',p=>p.tables.push(globalThis.structuredClone(p.tables[0])),
    p=>p.tables[0].totalCount=2,p=>p.tables[0].fields[13]='現金股利(未確認單位)',p=>p.tables[0].summary=['more pages'],
    p=>p.tables[0].notes=['partial'],p=>{p.tables[0].data.push(p.tables[0].data[0]);p.tables[0].totalCount++;},
    p=>p.tables[0].data[0][0]='115/08/01',p=>p.tables[0].data[0].pop()];
  for(const mutate of changes)assert.throws(()=>normalizeTaiwanActionCapture(capture('tpex_ex_right',{mutate})),/TAIWAN_ACTION_/);
});

test('changed bytes, URL, task identity, timestamps and incomplete wire receipts are rejected',()=>{
  for(const change of [f=>f.bytes=Buffer.concat([f.bytes,Buffer.from(' ')]),f=>f.receipt.task_id='0'.repeat(64),
    f=>f.receipt.url=f.receipt.url.replace('2026/11/11','2026/11/10'),f=>f.receipt.raw_bytes_complete=false,
    f=>f.receipt.historical_knowledge=true,f=>f.receipt.started_at='2026-11-12T09:00:00Z',
    f=>f.receipt.content_encoding='br',f=>f.receipt.market='TWSE']){
    const f=capture('tpex_ex_right');change(f);assert.throws(()=>normalizeTaiwanActionCapture(f),/TAIWAN_ACTION_/);
  }
});

test('cash, stock and shareholder subscription fields classify all combinations without cash or ratio defaults',()=>{
  const rows=[exRow(),exRow({date:'115/08/21',cash:'0',stock:'50'}),exRow({date:'115/08/24',cash:'0',rights:'20'}),
    exRow({date:'115/08/25',stock:'50'}),exRow({date:'115/08/26',rights:'20'})];
  const doc=normalizeTaiwanActionCapture(capture('tpex_ex_right',{rows}));
  assert.deepEqual(doc.rows.map(row=>row.issues),[[],[],[],[],[]]);
  assert.deepEqual(doc.events.map(event=>event.kind),['CASH_DIVIDEND','STOCK_DIVIDEND','RIGHTS','CASH_DIVIDEND','STOCK_DIVIDEND','CASH_DIVIDEND','RIGHTS']);
  assert(doc.events.every(event=>event.reported.quantities_are_as_reported_not_an_entitlement_ledger));
});

test('unresolved action rows block that issuer while retaining adverse events and other issuers completeness',async()=>{
  for(const row of [Object.assign(exRow(),{13:'--'}),Object.assign(exRow(),{8:'除權'})]){
    const r=bundle([capture('tpex_ex_right',{rows:[row]}),capture(sources[1]),capture(sources[2])]);
    const bad=r.corporate_actions['TPEX:5347'];assert.equal(bad.complete,false);assert.equal(bad.kind,'CORPORATE_ACTION_INVENTORY');
    assert(bad.events.length>0);assert(bad.events.every(event=>event.classification==='UNCLASSIFIED'));
    const check=await actionCheck(createTaiwanActionReplayEvidence(bad),'5347');assert.equal(check.complete,false);assert(check.overlapping_events.length>0);
    assert.equal(r.corporate_actions['TPEX:5348'].complete,true);
  }
});

test('resumption and par-value details retain actual halt and resume dates without fabricating daily actions or adjustment factors',()=>{
  const cap=normalizeTaiwanActionCapture(capture(sources[1])).events[0],par=normalizeTaiwanActionCapture(capture(sources[2])).events[0];
  assert.equal(cap.effective_date,'2026-08-21');assert.equal(cap.suspension_from,'2026-08-11');assert.equal(cap.reported.replacement_shares_per_1000,700);
  assert.equal(cap.reported.cash_return_as_reported,3);assert.equal(cap.reported.capital_raise_shares_text,'NA');
  assert.equal(par.kind,'SPLIT');assert.equal(par.subtype,'PAR_VALUE_CHANGE');assert.equal(par.reported.exchange_ratio_as_reported,2);
  assert.equal(par.reported.par_value_before_as_reported,5);assert.equal(par.reported.par_value_after_as_reported,2.5);
  for(const [source_id,change]of [[sources[1],s=>s.replace('3290&nbsp','3291&nbsp')],[sources[2],s=>s.replace('2.50000000','3.50000000')]]){
    const f=capture(source_id,{mutate:p=>{const row=p.tables[0].data[0];row[row.length-1]=change(row.at(-1));}});
    assert.equal(normalizeTaiwanActionCapture(f).events[0].classification,'UNCLASSIFIED');
  }
});

test('absence is bound to all three complete tables and their explicit empty symbol matches',async()=>{
  const r=bundle(),row=r.corporate_actions['TPEX:5348'];assert.equal(row.status,'NO_ACTIONS');assert.equal(row.complete,true);
  assert.deepEqual(row.coverage_kinds,TAIWAN_ACTION_KINDS);assert.equal(row.source_bindings.length,3);
  assert(row.source_bindings.every(source=>source.matched_row_indices.length===0&&source.row_count===1));
  const evidence=createTaiwanActionReplayEvidence(row);assert.equal(evidence.length,1);assert.equal((await actionCheck(evidence,'5348')).clear,true);
  assert.equal(evidence[0].available_at,received[2]);assert.equal(evidence[0].published_at,null);assert.equal(evidence[0].as_of,received[2]);
  assert.equal(row.historical_membership_established,false);assert.equal(row.source_use_approval,null);assert.equal(row.adjustment_applied,false);
  const missing=bundle(sources.slice(0,2).map(source=>capture(source))).corporate_actions['TPEX:5348'];
  assert.equal(missing.complete,false);assert.equal((await actionCheck(createTaiwanActionReplayEvidence(missing),'5348')).complete,false);
});

test('TPEx source coverage never creates TWSE or emerging completeness or ignores source range and observation time',()=>{
  const r=bundle();for(const id of ['TWSE:2330','EMERGING:7777']){assert.equal(r.corporate_actions[id].complete,false);assert.deepEqual(createTaiwanActionReplayEvidence(r.corporate_actions[id]),[]);}
  const future=sources.map(source=>capture(source,{received_at:'2026-11-11T10:00:01Z'}));assert.throws(()=>bundle(future),/FUTURE_CAPTURE/);
  const early=sources.map(source=>{const f=capture(source,{received_at:'2026-11-11T05:00:00Z'});f.receipt.started_at='2026-11-11T04:00:00Z';return f;});
  assert.equal(bundle(early).corporate_actions['TPEX:5348'].complete,false);
  const wider=buildTaiwanMarketActionCoverage({universe:universe(),captures:sources.map(source=>capture(source)),from:'2026-08-10',through,cutoff});
  assert.equal(wider.corporate_actions['TPEX:5348'].complete,false);
  assert.throws(()=>bundle([capture(sources[0]),capture(sources[0])]),/DUPLICATE_SOURCE/);
});

test('complete values are immutable and cannot be recreated from caller assertions or detached hashes',()=>{
  const r=bundle(),row=r.corporate_actions['TPEX:5348'];const {coverage_hash,...body}=row;assert.equal(coverage_hash,marketSnapshotHash(body));
  assert.throws(()=>row.complete=false,TypeError);assert.throws(()=>row.source_bindings[0].matched_row_indices.push(1),TypeError);
  assert.throws(()=>createTaiwanActionReplayEvidence(JSON.parse(JSON.stringify(row))),/VERIFIED_COVERAGE_REQUIRED/);
  assert.throws(()=>bundle([{receipt:{source_id:'tpex_ex_right'},bytes:Buffer.from('{}'),complete:true}]),/TAIWAN_ACTION_/);
});

test('large issuer inventories split into contiguous source-bound intervals without dropping events or changing identity',async()=>{
  const rows=Array.from({length:30},(_,i)=>exRow({date:'115/09/'+String(i+1).padStart(2,'0')}));
  const u=universe(),r=bundle([capture(sources[0],{rows}),capture(sources[1]),capture(sources[2])],u),coverage=r.corporate_actions['TPEX:5347'];
  u.companies[0].symbol='9999';u.companies[0].security_id='TPEX:9999';
  const evidence=createTaiwanActionReplayEvidence(coverage);assert(evidence.length>1);assert(evidence.every(e=>e.content.length<=12000&&e.symbol==='5347'));
  const bodies=evidence.map(e=>JSON.parse(e.content));assert.equal(bodies[0].from,from);assert.equal(bodies.at(-1).through,through);
  assert.deepEqual(bodies.flatMap(body=>body.events.map(event=>event.event_id)).sort(),coverage.events.map(event=>event.event_id).sort());
  const check=await actionCheck(evidence,'5347');assert.equal(check.complete,true);assert.equal(check.clear,false);assert.deepEqual(check.uncovered_intervals,[]);
  const clean=await actionCheck(evidence,'5347','2026-10-01',through);assert.equal(clean.clear,true);
  const allEvents=bodies.flatMap(body=>body.events);assert(allEvents.every(event=>event.available_at===received[0]));
});

test('source-bound ACTION evidence runs through the real SHORT replay with posthoc labels and event exclusions',async()=>{
  const r=bundle(),ca=createTaiwanActionReplayEvidence(r.corporate_actions['TPEX:5348']);
  const dates=['2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-11-02'];
  const values=[{open:100,high:102,low:98,close:100},{open:101,high:104,low:100,close:103},{open:103,high:105,low:100,close:104},
    {open:105,high:107,low:102,close:106},{open:90,high:92,low:88,close:90}];
  const evidence=dates.map((date,i)=>({id:'synthetic-p'+i,symbol:'5348',kind:'PRICE',source:'https://www.tpex.org.tw/synthetic-action-test',
    published_at:null,available_at:received[0],first_seen_at:received[0],as_of:received[0],time_basis:'OBSERVED_AFTER_RECEIPT',
    content:JSON.stringify({date,...values[i],volume:1000000,amount:100000000,session_scope:'SYNTHETIC_COMPLETE'})}));
  for(const item of evidence)item.evidence_hash=sha(item.content);
  const packet={symbol:'5348',company:'Synthetic',cutoff,data_through:dates.at(-1),evidence:[...evidence,...ca]};validateAnalysisPacket(packet);
  const args={symbol:'5348',packets:[packet],method:{method_id:'SHORT_ATR_CONDITIONAL_V1',parameters:{atr_period:2,breakout_lookback:2,
    trigger_rule:'PRIOR_WINDOW_HIGH_PLUS_TICK',entry_atr_width:.5,stop_atr_multiple:2,tick_size:.5}},holding_sessions:[2],as_of:cutoff,
    provenance:'SYNTHETIC_TEST',corporate_action_policy:'RAW_EXCLUDE_EVENT_WINDOWS',cost_model:{version:'EXPLICIT_SYNTHETIC_COSTS',quantity:1000,
      minimum_fee_twd:20,buy_fee:.001425,sell_fee:.001425,sell_tax:.003,slippage_each_side:.001,rounding:'CEIL_TWD'}};
  const replay=await replayDailyAiShortMethod(args);assert.equal(replay.rows[0].state,'MODELLED');assert.equal(replay.rows[0].source_known_before_entry,false);
  assert.equal(replay.mode,'POSTHOC_FIXED_METHOD_REPLAY');assert.equal(replay.forward_performance_samples,0);assert.equal(replay.strategy_calibrated,false);
  const changed=bundle([capture(sources[0],{rows:[exRow({symbol:'5348',date:'115/10/29'})]}),capture(sources[1]),capture(sources[2])]);
  args.packets[0].evidence=[...evidence,...createTaiwanActionReplayEvidence(changed.corporate_actions['TPEX:5348'])];
  const crossed=await replayDailyAiShortMethod(args);assert.equal(crossed.rows[0].state,'EXCLUDED');assert.equal(crossed.rows[0].net_return,null);
});

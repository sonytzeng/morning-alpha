import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverCandidates,outcomeFromCloses,performance,sampleLabel,taipeiDate,paperQuote,requestIdentity} from '../supabase/functions/_shared/owner-trading-lab.ts';
import {evidenceRows,IDENTITY} from './fixtures/decision-evidence-rows.mjs';
import {readTradingLab,currentMarket} from '../src/features/research/tradingLab.ts';
const canonical={id:'canonical',report_date:IDENTITY.report_date,status:'READY',action:'WAIT',market_regime:'range',generated_text:{market_report_gate:{recommendation_status:'BLOCKED',wait_reason:'原始正式原因'}}};
test('uses existing complete evidence evaluator, WATCHLIST != formal READY; stable decomposition',()=>{
 const d=evidenceRows(),before=JSON.stringify(d),x=discoverCandidates(d,IDENTITY,canonical);
 assert.equal(JSON.stringify(d),before);assert.equal(x.scanned,3);assert.equal(x.watchlist.length,3);
 assert.equal(x.formal_status,'BLOCKED');assert(x.watchlist.every(c=>c.status==='WATCHLIST'&&Object.keys(c.score.inputs).length===5));
 const reversed=structuredClone(d);for(const k of Object.keys(reversed))if(Array.isArray(reversed[k]))reversed[k].reverse();
 assert.deepEqual(discoverCandidates(reversed,IDENTITY,canonical),x);
 assert(x.funnel.every((s,i)=>s.before===s.passed+s.excluded&&(i===0||s.before===x.funnel[i-1].passed)));
});
test('prospective fill is not an overnight or future quote; request key order cannot break a retry',()=>{
 const q={id:'q',symbol:'2330',value:100,trading_date:'2026-10-06',phase:'intraday',quality_status:'verified',freshness_status:'fresh',captured_at:'2026-10-06T02:00:00Z',ingested_at:'2026-10-06T02:00:01Z'};
 assert.equal(paperQuote([q],'2330','2026-10-06T02:01:00Z'),q);
 for(const changed of [{...q,phase:'close'},{...q,trading_date:'2026-10-05'},{...q,captured_at:'2026-10-06T01:00:00Z'},{...q,ingested_at:'2999-01-01T00:00:00Z'}])assert.equal(paperQuote([changed],'2330','2026-10-06T02:01:00Z'),null);
 assert.equal(requestIdentity({b:2,a:{c:1,d:2}}),requestIdentity({a:{d:2,c:1},b:2}));
});
test('canonical market reasons and invalidation survive absent same-day Shadow; stale canonical is not today',()=>{
 const sections={executive_summary:{text:'正式一句話'},supporting_evidence:[{statement:'原始支持',evidence_refs:['one']}],counter_evidence:[{statement:'原始風險',evidence_refs:['two']}],failure_scenario:{triggers:[{condition:'原始失效條件',evidence_required:['one']}]},decision_guide:{risk_level:'high'}};
 const x={business_date:IDENTITY.report_date,canonical:{...canonical,generated_text:{canonical_market_state:{document:{sections}}}},shadow:null};
 const m=currentMarket(x);assert.equal(m.conclusion,'正式一句話');assert.deepEqual(m.supporting,['原始支持']);assert.deepEqual(m.contradicting,['原始風險']);assert.deepEqual(m.invalidation,['原始失效條件']);assert.equal(m.risk,'高');
 assert.equal(currentMarket({...x,canonical:{...x.canonical,status:'BLOCKED'}}).supporting.length,0);
});
test('missing volumes/fundamentals cannot manufacture a watchlist or relax recommendations',()=>{
 const d=evidenceRows();d.quotes.forEach(q=>{q.raw_payload={};});d.flows=[];d.earnings=[];d.mappings=[];
 const x=discoverCandidates(d,IDENTITY,canonical);assert.equal(x.watchlist.length,0);assert.equal(x.scanned,3);
 assert.equal(x.funnel[0].passed,0);assert.equal(x.first_blocked_gate,'流動性');assert.equal(x.availability.volume,'MISSING');
 assert.equal(x.availability.fundamentals,'MISSING');assert(x.details.every(r=>r.reasons.includes('20_DAILY_VOLUMES_MISSING')));
});
test('stale identity, future ingestion, conflicting quote and incomplete query fail closed',()=>{
 assert.equal(discoverCandidates(evidenceRows(),IDENTITY,{...canonical,report_date:'2000-01-01'}).watchlist.length,0);
 for(const mutation of [d=>d.quotes.forEach(q=>q.ingested_at='2999-01-01T00:00:00Z'),d=>d.failures.push('quotes:TRUNCATED')]){
  const d=evidenceRows();mutation(d);assert.equal(discoverCandidates(d,IDENTITY,canonical).watchlist.length,0);
 }
 assert.equal(discoverCandidates(evidenceRows(),IDENTITY,{...canonical,action:'STOP'}).watchlist.length,0);
});
test('performance uses distinct positions, never 4 horizons as 4 wins; under five hides misleading ratios',()=>{
 for(const n of [0,1,4,5,19,20,59,60])assert.equal(sampleLabel(n),n<5?'樣本不足':n<20?'早期觀察':n<60?'初步有效性':'較有意義樣本');
 assert.equal(performance([{id:'one',at:'2026-10-01',value:100}]).win_rate,null);
 const rows=[10,-10,0,20,-5].map((value,i)=>({id:String(i),at:`2026-10-0${i+1}`,value}));
 const p=performance([...rows,rows[0]]);assert.equal(p.sample,5);assert.equal(p.win_rate,40);assert.equal(p.expectancy,3);
 assert.equal(p.profit_factor,2);assert.equal(p.mfe,null);assert.equal(p.mae,null);assert(p.max_drawdown>0);
});
test('exact target close only; no next-available or future quote and no invented MFE/MAE',()=>{
 const t={symbol:'2330',entry_price:100,entered_at:'2026-10-01T02:00:00Z'},now='2026-10-02T07:00:00Z';
 const q={id:'quote',symbol:'2330',value:110,trading_date:'2026-10-02',phase:'close',quality_status:'verified',freshness_status:'fresh',captured_at:'2026-10-02T05:30:00Z',ingested_at:'2026-10-02T05:31:00Z'};
 const x=outcomeFromCloses(t,'1D','2026-10-02',[q],now);assert.equal(x.status,'OBSERVED');assert(Math.abs(x.return_percent-10)<1e-10);assert.equal(x.mfe,null);
 for(const changed of [{...q,trading_date:'2026-10-05'},{...q,ingested_at:'2026-10-03T00:00:00Z'},{...q,quality_status:'unverified'}])assert.equal(outcomeFromCloses(t,'1D','2026-10-02',[changed],now).status,'UNAVAILABLE');
 assert.equal(outcomeFromCloses(t,'1D','2026-10-02',[q,{...q,id:'other',value:120}],now).reason,'CONFLICTING_CLOSES');
});
test('Taipei date and current Shadow cannot be replaced by historical replay',()=>{
 assert.equal(taipeiDate('2026-10-05T23:00:00Z'),'2026-10-06');
 const x={version:'OWNER_TRADING_LAB_V1',public_product_approval:false,forward_enabled:false,business_date:IDENTITY.report_date,as_of:IDENTITY.generated_at,canonical,
  shadow:null,discovery:discoverCandidates(evidenceRows(),IDENTITY,canonical),trades:[],events:[],performance:{system:performance([]),sony:performance([]),market:{sample:0,direction_accuracy:null,forward_shadow_sample:0}}};
 assert.equal(readTradingLab(x),x);assert.equal(currentMarket(x).hasCurrentShadow,false);assert.equal(currentMarket(x).confidence,null);
 assert.throws(()=>readTradingLab({...x,shadow:{analysis:{business_date:'2026-10-02'}}}),/SHADOW_DATE/);
 assert.throws(()=>readTradingLab({...x,public_product_approval:true}),/CONTRACT/);
 assert.throws(()=>readTradingLab({...x,performance:{}}),/CONTRACT/);
});

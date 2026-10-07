import test from 'node:test';
import assert from 'node:assert/strict';
import { evidenceRows, IDENTITY } from './fixtures/decision-evidence-rows.mjs';
import { buildEvidenceDecision } from '../supabase/functions/_shared/decision-v1-evidence.ts';
import { recommendationQuoteCurrent, recommendationServiceSla } from '../supabase/functions/_shared/recommendation-phase.ts';
import { normalizeDailyCandles, normalizeIntradayQuote, assertRecommendationUniverse, RECOMMENDATION_UNIVERSE, acquireStockEvidence, buildRecommendationProof } from '../supabase/functions/_shared/recommendation-stock-evidence.ts';
export const PRE={...IDENTITY,generated_at:'2026-09-06T23:05:00Z',data_as_of:'2026-09-06T23:05:00Z'};
export function prem(){
 const d=evidenceRows();d.quotes=d.quotes.filter(q=>q.captured_at<=PRE.generated_at);
 for(const q of d.quotes.filter(q=>q.symbol==='TXF'))q.raw_payload.source_raw.session='regular';
 d.news[0].published_at='2026-09-06T10:00:00Z';d.news[0].created_at='2026-09-06T10:01:00Z';
 d.catalysts[0].event_at=d.news[0].published_at;d.catalysts[0].created_at=d.news[0].created_at;
 for(const m of d.mappings)m.created_at='2026-09-06T10:02:00Z';
 return d;
}
test('premarket phase: every knowable prerequisite complete, unobservable reaction is WATCH, never formal READY',()=>{
 const r=buildEvidenceDecision(prem(),PRE),p=r.phase_evaluation;
 assert.equal(p.status,'PREMARKET_WATCH',JSON.stringify(r));assert.equal(r.screening.status,'COMPLETE');
 assert.equal(p.watch_count,3);assert.equal(p.ready_count,0);assert.equal(p.blocked_count,0);assert.equal(p.not_yet_observable_count,3);
 assert.equal(r.action,'WAIT_FOR_CONFIRMATION');assert.deepEqual(r.stock_opportunities,[]);
 assert.ok(p.candidates.every(c=>c.post_event_price==='NOT_YET_OBSERVABLE'&&c.post_event_volume==='NOT_YET_OBSERVABLE'));
});
test('true missing prerequisites remain BLOCKED; phase does not optionalize institutional/consensus/catalyst',()=>{
 for(const key of ['flows','earnings','mappings']){const d=prem();d[key]=[];assert.equal(buildEvidenceDecision(d,PRE).phase_evaluation.status,'BLOCKED',key);}
 const d=prem();d.earnings[0].revenue_consensus=null;assert.equal(buildEvidenceDecision(d,PRE).phase_evaluation.status,'BLOCKED');
});
test('complete rejected premarket quality is NONE, never DATA MISSING',()=>{
 const d=prem();for(const f of d.earnings)f.guidance_direction='down';
 const p=buildEvidenceDecision(d,PRE).phase_evaluation;assert.equal(p.status,'PREMARKET_NONE');assert.equal(p.none_count,3);assert.equal(p.blocked_count,0);
});
test('intraday evidence confirmation promotes READY; failed confirmation drops, no hanging WATCH',()=>{
 const ready=buildEvidenceDecision(evidenceRows(),IDENTITY).phase_evaluation;
 assert.equal(ready.status,'READY');assert.equal(ready.ready_count,3);
 const d=evidenceRows();d.quotes.filter(q=>/^\d/.test(q.symbol)&&q.phase==='intraday').forEach(q=>{q.value=100;q.raw_payload.source_raw.total.tradeVolume=1;});
 const p=buildEvidenceDecision(d,IDENTITY).phase_evaluation;
 assert.equal(p.ready_count,0);assert.equal(p.watch_count,0);assert.ok(p.candidates.every(c=>c.status==='DROP'));assert.equal(p.status,'NONE');
});
test('same original cutoff cannot borrow a later quote, receipt, event or decision',()=>{
 const d=prem(),first=buildEvidenceDecision(d,PRE);const later=evidenceRows().quotes.filter(q=>q.captured_at>PRE.generated_at);
 d.quotes.push(...later);assert.deepEqual(buildEvidenceDecision(d,PRE),first);
 d.quotes.forEach(q=>q.ingested_at=IDENTITY.generated_at);assert.equal(buildEvidenceDecision(d,PRE).phase_evaluation.status,'BLOCKED');
});
test('weekend and holiday expected session, no fixed20h; current intraday cannot borrow prior close',()=>{
 const q=prem().quotes.find(q=>q.symbol==='2330'&&q.trading_date==='2026-09-04');
 assert.ok(Date.parse(PRE.generated_at)-Date.parse(q.captured_at)>20*3600000);
 assert.equal(recommendationQuoteCurrent(q,PRE),true);assert.equal(recommendationQuoteCurrent(q,IDENTITY),false);
 for(const date of ['2026-09-03','2026-09-07'])assert.equal(recommendationQuoteCurrent({...q,trading_date:date},PRE),false);
 assert.equal(recommendationQuoteCurrent({...q,captured_at:'2026-09-04T01:00:00Z'},PRE),false);
});
test('BLOCKED SLA counts trading days; WATCH and NONE healthy, missing unrecorded history is not invented',()=>{
 const dates=['2026-09-07','2026-09-08','2026-09-09','2026-09-10','2026-09-11'];
 const rows=dates.map(date=>({date,status:'BLOCKED'}));
 assert.equal(recommendationServiceSla(rows.slice(0,3),dates[2]).status,'WARNING');
 assert.equal(recommendationServiceSla(rows,dates[4]).status,'RECOMMENDATION_SERVICE_DEGRADED');
 for(const status of ['PREMARKET_WATCH','PREMARKET_NONE','NO_QUALIFIED_OPPORTUNITY','READY'])assert.equal(recommendationServiceSla([...rows.slice(0,4),{date:dates[4],status}],dates[4]).blocked_streak,0);
 assert.equal(recommendationServiceSla([],dates[4]).status,'UNAVAILABLE');
});
test('exact existing72 registry, not silent124 expansion or duplicate mapping',()=>{
 const u=RECOMMENDATION_UNIVERSE.map(symbol=>({symbol,is_active:true}));assert.equal(u.length,72);assertRecommendationUniverse(u);
 assert.throws(()=>assertRecommendationUniverse(u.slice(1)));assert.throws(()=>assertRecommendationUniverse([...u,u[0]]));
});
test('official daily vs intraday volume units and receipt availability; no invented amount',async()=>{
 const d=prem(),dates=[...new Set(d.quotes.filter(q=>q.symbol==='2330').map(q=>q.trading_date))];
 const payload={symbol:'2330',timeframe:'D',data:dates.map(date=>({date,open:100,high:103,low:99,close:102,volume:1000000,turnover:102000000,change:1}))};
 const rows=await normalizeDailyCandles('2330',payload,PRE.generated_at,PRE.report_date);assert.ok(rows.length>=20);
 assert.equal(rows[0].raw_payload.volume_shares,1000000);assert.equal(rows[0].ingested_at,PRE.generated_at);
 const bad=structuredClone(payload);delete bad.data[0].turnover;await assert.rejects(normalizeDailyCandles('2330',bad,PRE.generated_at,PRE.report_date));
 const gap=structuredClone(payload);gap.data.splice(gap.data.length-3,1);await assert.rejects(normalizeDailyCandles('2330',gap,PRE.generated_at,PRE.report_date),/STOCK_COMPLETED_SESSIONS_INCOMPLETE/);
 const q={symbol:'2330',date:IDENTITY.report_date,changePercent:1,total:{tradeVolume:1500,tradeValue:153000000},lastTrade:{price:102,time:Date.parse('2026-09-07T01:59:00Z')*1000}};
 const intraday=await normalizeIntradayQuote('2330',q,IDENTITY.generated_at,IDENTITY.report_date);assert.equal(intraday[0].raw_payload.volume_shares,1500000);
});
for(const phase of ['PREMARKET','INTRADAY'])test(`SYNTHETIC 72-stock ${phase} complete producer proof, not a Production replay`,async()=>{
 const source=phase==='PREMARKET'?prem():evidenceRows(),data=structuredClone(source);
 for(const key of ['quotes','flows','earnings','universe','mappings']){
  const template=source[key].filter(r=>(r.symbol||r.stock_symbol)==='2330');
  data[key]=source[key].filter(r=>!/^\d/.test(String(r.symbol||r.stock_symbol)));
  for(const symbol of RECOMMENDATION_UNIVERSE)for(const row of template){const copy=JSON.parse(JSON.stringify(row).replaceAll('2330',symbol));copy.id=String(copy.id)+'-'+symbol;data[key].push(copy);}
 }
 const r=await buildRecommendationProof(data,phase==='PREMARKET'?PRE:IDENTITY);
 assert.equal(r.decision.phase_evaluation.universe_count,72);assert.equal(r.decision.phase_evaluation.evaluated_count,72);
 assert.equal(r.decision.phase_evaluation.blocked_count,0);assert.equal(r.decision.phase_evaluation.status,phase==='PREMARKET'?'PREMARKET_WATCH':'READY');
 assert.equal(phase==='PREMARKET'?r.decision.phase_evaluation.watch_count:r.decision.phase_evaluation.ready_count,72);
 assert.deepEqual(r.business_writes,[]);assert.equal(r.acquisition.captures.length,0);
});
test('acquisition is bounded, exact72, never writes; 403 is explicit and no token/error body captured',async()=>{
 const calls=[];const u=RECOMMENDATION_UNIVERSE.map(symbol=>({symbol,is_active:true}));
 const result=await acquireStockEvidence({businessDate:PRE.report_date,universe:u,apiKey:'SYNTHETIC_TEST_ONLY',now:()=>PRE.generated_at,signal:AbortSignal.timeout(5000),fetcher:async(url,options)=>{
  calls.push(String(url));assert.equal(options.redirect,'error');assert.equal(new URL(url).hostname,'api.fugle.tw');return new Response('PRIVATE_ERROR_BODY',{status:403});
 }});
 assert.equal(calls.length,72);assert.equal(result.length,72);assert.ok(result.every(c=>c.status==='ENTITLEMENT_NON_RETRYABLE'));assert.doesNotMatch(JSON.stringify(result),/PRIVATE_ERROR_BODY|SYNTHETIC_TEST_ONLY/);
});

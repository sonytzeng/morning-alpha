import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {requestRecommendationProof} from '../supabase/functions/_shared/recommendation-producer.ts';
import {authorizeInternalRequest} from '../supabase/functions/_shared/internal-function-auth.mjs';
import {evidenceRows,IDENTITY} from './fixtures/decision-evidence-rows.mjs';
import {buildEvidenceDecision} from '../supabase/functions/_shared/decision-v1-evidence.ts';
import {phaseFunnel} from '../supabase/functions/_shared/recommendation-phase.ts';
import {evaluateStockRecommendationGate} from '../supabase/functions/_shared/market-report-gate.ts';
import {persistedRecommendationInput} from '../supabase/functions/_shared/recommendation-stock-evidence.ts';
const base={identity:IDENTITY,url:'https://isolated.invalid',cronSecret:'SYNTHETIC_INTERNAL_ONLY',serviceRoleKey:'SYNTHETIC.JWT.ONLY'};
test('complete intraday risk DROP/NONE stays healthy NONE through the actual publication gate',()=>{
 const decision=buildEvidenceDecision(evidenceRows({damaged:true}),IDENTITY);
 assert.equal(decision.phase_evaluation.status,'NONE');assert.equal(decision.action,'AVOID');
 const ai={decision_v1:decision,today_beneficiary_stocks_v10:[],research_master_v2:{report_date:IDENTITY.report_date,today_date:IDENTITY.today_date,provenance:{generated_at:IDENTITY.generated_at}}};
 const gate=evaluateStockRecommendationGate(ai);assert.equal(gate.status,'NO_QUALIFIED_OPPORTUNITY');assert.equal(gate.eligible,false);assert.equal(gate.universe_evaluation_complete,true);
 const incomplete=structuredClone(ai);incomplete.decision_v1.phase_evaluation.candidates[0].status='BLOCKED';
 assert.equal(evaluateStockRecommendationGate(incomplete).status,'BLOCKED');
});
test('producer uses separate existing gateway JWT and internal guard; response lineage binds exact date/revision',async()=>{
 const decision=buildEvidenceDecision(evidenceRows(),IDENTITY);let calls=0;
 const result=await requestRecommendationProof({...base,fetcher:async(url,init)=>{
  calls++;assert.equal(url,'https://isolated.invalid/functions/v1/recommendation-stock-evidence-v1');
  assert.equal(init.method,'POST');assert.equal(init.redirect,'error');
  const h=new Headers(init.headers);assert.equal(h.get('Authorization'),`Bearer ${base.serviceRoleKey}`);
  assert.equal((await authorizeInternalRequest(h,{currentToken:base.cronSecret,serviceRoleKey:base.serviceRoleKey})).ok,true);
  return Response.json({decision,acquisition:{captures:[]},business_writes:[]});
 }});
 assert.equal(calls,1);assert.deepEqual(result.decision,JSON.parse(JSON.stringify(decision)));
});
test('negative internal identities fail; no credentials copied to decision result',async()=>{
 for(const h of [new Headers(),new Headers({Authorization:'Bearer WRONG'}),new Headers({'x-cron-secret':'WRONG'}),new Headers({'x-cron-secret':base.cronSecret,'x-internal-auth-version':'v999'})])assert.equal((await authorizeInternalRequest(h,{currentToken:base.cronSecret,serviceRoleKey:base.serviceRoleKey})).ok,false);
 let calls=0;const result=await requestRecommendationProof({...base,serviceRoleKey:'OPAQUE_NOT_A_GATEWAY_JWT',fetcher:async()=>{calls++;throw Error('must not call');}});
 assert.equal(calls,0);assert.equal(result.acquisition,null);assert.equal(result.decision.evidence_quality,'insufficient');
 assert.doesNotMatch(JSON.stringify(result),/SYNTHETIC|OPAQUE|Bearer/);
});
test('401, timeout, wrong revision, future response and business-write response fail closed for recommendation only',async()=>{
 const good={decision:buildEvidenceDecision(evidenceRows(),IDENTITY),business_writes:[]};
 const replies=[()=>new Response(null,{status:401}),()=>{throw Error('SYNTHETIC_TRANSPORT_SECRET');},()=>Response.json({...good,decision:{...good.decision,revision_id:'other'}}),()=>Response.json({...good,decision:{...good.decision,generated_at:'2999-01-01T00:00:00Z'}}),()=>Response.json({...good,business_writes:['reports']})];
 for(const fetcher of replies){const r=await requestRecommendationProof({...base,fetcher});assert.equal(r.acquisition,null);assert.equal(r.decision.evidence_quality,'insufficient');assert.doesNotMatch(JSON.stringify(r),/SYNTHETIC_TRANSPORT_SECRET/);}
});
test('persisted capture keeps actual receipt time, wrong date/future cutoff cannot feed Owner evaluation',()=>{
 const data=evidenceRows(),q=structuredClone(data.quotes.find(q=>q.symbol==='2330'&&q.phase==='intraday'));
 q.raw_payload.contract='RECOMMENDATION_STOCK_EVIDENCE_V1';
 const capture={contract:'RECOMMENDATION_STOCK_EVIDENCE_V1',business_date:IDENTITY.report_date,cutoff:IDENTITY.generated_at,captures:[{symbol:'2330',status:'PASS',received_at:q.ingested_at,rows:[q]}]};
 const ai={recommendation_stock_evidence:capture,decision_v1:{report_date:IDENTITY.report_date,phase_evaluation:{evaluation_phase:'PREMARKET',candidates:[{symbol:'2330',status:'WATCH'}]}}};
 const r=persistedRecommendationInput(data,IDENTITY,ai);assert.equal(r.data.quotes.at(-1).ingested_at,q.ingested_at);assert.deepEqual(r.priorWatch,['2330']);
 for(const patch of [{business_date:'2020-01-01'},{cutoff:'2999-01-01T00:00:00Z'}])assert.equal(persistedRecommendationInput(data,IDENTITY,{...ai,recommendation_stock_evidence:{...capture,...patch}}).data,data);
 const future=structuredClone(ai);future.recommendation_stock_evidence.captures[0].rows[0].ingested_at='2999-01-01T00:00:00Z';
 assert.ok(persistedRecommendationInput(data,IDENTITY,future).data.failures.includes('PERSISTED_CAPTURE_ROW_INVALID'));
});
test('intraday funnel uses real input lineage, unknown prior WATCH is not invented',()=>{
 const p=buildEvidenceDecision(evidenceRows(),IDENTITY).phase_evaluation;
 const unknown=phaseFunnel(p);assert.equal(unknown.intraday.watch_input,null);assert.equal(unknown.intraday.ready,null);
 const known=phaseFunnel(p,['2330']);assert.equal(known.intraday.watch_input,1);assert.equal(known.intraday.ready,1);assert.equal(known.intraday.drop,0);
});
test('candidate wiring does not add scheduler, gateway bypass, provider/Atomic mutation or Owner network acquisition',()=>{
 const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
 const worker=read('supabase/functions/recommendation-stock-evidence-v1/index.ts');
 assert.match(worker,/authorizeInternalRequest/);assert.match(worker,/loadDecisionEvidence/);
 assert.doesNotMatch(worker,/\.insert\(|\.update\(|\.upsert\(|\.rpc\(/);
 assert.doesNotMatch(read('supabase/config.toml'),/functions\.recommendation-stock-evidence-v1/);
 const owner=read('supabase/functions/owner-trading-lab-v1/index.ts');
 assert.match(owner,/persistedRecommendationInput\(input,identity,saved\)/);assert.doesNotMatch(owner,/acquireStockEvidence\(/);
 const report=read('supabase/functions/generate-daily-report-v7/index.ts');assert.match(report,/aiStrategyJson\.decision_v1=recommendationProof\.decision/);
});

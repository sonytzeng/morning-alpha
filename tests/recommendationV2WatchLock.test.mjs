import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateV2Outcome,summarizeV2Outcomes} from '../supabase/functions/_shared/recommendation-shadow-v2-outcomes.ts';
import {evaluateV2Shadow,V2_METHODOLOGY,nextV2Session} from '../supabase/functions/_shared/recommendation-shadow-v2-engine.ts';
import {v2Fixture} from './helpers/recommendationV2Fixtures.mjs';
import {buildV2Capsule,persistV2Sidecar} from '../supabase/functions/_shared/recommendation-shadow-v2-runtime.ts';
import {previousMarketTradingDate} from '../supabase/functions/_shared/market-session-contract.mjs';

const prediction=status=>({id:'SYNTHETIC_'+status,symbol:'2330',methodology_version:V2_METHODOLOGY,observation_kind:'FORWARD',locked_at:'2026-10-07T01:00:00Z',cutoff:'2026-10-07T00:59:00Z',input_sha256:'a'.repeat(64),status,entry:{not_before:'2026-10-08',trigger_price:100,invalidation_price:95}});
const observed='2026-12-01T00:00:00Z';
function bars(){let date='2026-10-08';return Array.from({length:20},()=>{const bar={date,open:100,high:104,low:99,close:102,volume:1000,amount:100000,source_ref:'SYNTHETIC:'+date,available_at:date+'T14:00:00+08:00'};date=nextV2Session(date);return bar;});}
test('WATCH remains unqualified with pending evidence and V1 unchanged',async()=>{
 const input=v2Fixture(),v1=structuredClone(input.v1);input.sources=[];
 const r=await evaluateV2Shadow(input);assert.equal(r.counts.WATCH,72);assert.equal(r.counts.READY,0);
 assert(r.candidates.every(c=>c.pending.length>0&&c.entry.trigger_price>c.entry.invalidation_price));
 assert.deepEqual(input.v1,v1);assert.equal(r.production_eligible,false);assert.equal(r.promotion_allowed,false);
});
for(const status of ['WATCH','READY'])test(status+' preserves lock status across every horizon and state without changing mathematics',()=>{
 const p=prediction(status),before=structuredClone(p),b=bars();
 for(const h of [1,3,5,10,20]){
  const result=evaluateV2Outcome(p,b,h,observed),ready=evaluateV2Outcome(prediction('READY'),b,h,observed);
  assert.equal(result.prediction_status,status);assert.equal(result.state,'OBSERVED');assert.equal(result.return,ready.return);
 }
 const no=b.map(x=>({...x,high:100,close:100}));
 for(const [input,quotes,at,state] of [[p,b,'2026-10-08T01:00:00Z','PENDING'],[p,no,observed,'NOT_ENTERED'],[p,[],observed,'UNAVAILABLE']]){
  const r=evaluateV2Outcome(input,quotes,1,at);assert.equal(r.prediction_status,status);assert.equal(r.state,state);
 }
 const stop=structuredClone(b);stop[0].low=94;assert.equal(evaluateV2Outcome(p,stop,1,observed).win_loss,'LOSS');
 assert.deepEqual(p,before);
});
test('WATCH cannot bypass prospective time, calendar, hash, entry or source guards',()=>{
 const p=prediction('WATCH'),b=bars();
 for(const patch of [{observation_kind:'HISTORICAL_REPLAY'},{methodology_version:'OTHER'},{locked_at:p.entry.not_before+'T09:00:00+08:00'},{locked_at:'2026-10-06T00:00:00Z'},{cutoff:'invalid'},{input_sha256:'bad'},{status:'NONE'},{status:'BLOCKED'},{status:''},{entry:{...p.entry,not_before:'2026-10-10'}},{entry:{...p.entry,invalidation_price:100}}])assert.equal(evaluateV2Outcome({...p,...patch},b,1,observed).state,'UNAVAILABLE',JSON.stringify(patch));
 assert.equal(evaluateV2Outcome(p,b,1,'2026-10-06T00:00:00Z').state,'UNAVAILABLE');
 assert.equal(evaluateV2Outcome(p,b,2,observed).state,'UNAVAILABLE');
 assert.equal(evaluateV2Outcome(p,[...b,b[0]],1,observed).state,'UNAVAILABLE');
 assert.equal(evaluateV2Outcome(p,b.slice(1),1,observed).state,'UNAVAILABLE');
});
test('natural sidecar processes locked WATCH alongside READY without changing either status',async()=>{
 const input=v2Fixture(),capsule=await buildV2Capsule(input),start=input.captures[0].rows[0].trading_date;
 const lock=previousMarketTradingDate('TW',start)+'T08:00:00+08:00';
 const pending=['WATCH','READY'].map((status,i)=>({...prediction(status),symbol:input.captures[i].symbol,locked_at:lock,cutoff:lock,entry:{not_before:start,trigger_price:100,invalidation_price:95}}));
 const saved=[];
 const result=await persistV2Sidecar(capsule,{storeRun:async()=>({error:null}),pending:async()=>({data:pending,error:null}),storeOutcome:async(r,text)=>{saved.push(r);assert.equal(JSON.parse(text).prediction.status,r.prediction_status);return {error:null};}},()=>input.identity.generated_at);
 assert.equal(result.status,'SHADOW_STORED');assert.equal(saved.length,10);
 assert.equal(saved.filter(r=>r.prediction_status==='WATCH').length,5);assert.equal(saved.filter(r=>r.prediction_status==='READY').length,5);
});
test('metrics separate WATCH and READY; neither unentered nor unknown status pools into performance',()=>{
 const ready=evaluateV2Outcome(prediction('READY'),bars(),1,observed),watch={...evaluateV2Outcome(prediction('WATCH'),bars(),1,observed),return:-.5};
 const rows=[ready,watch,{...watch,prediction_id:'NO',state:'NOT_ENTERED',return:null},{...watch,prediction_id:'MISSING',prediction_status:undefined},{...watch,prediction_id:'OTHER',methodology_version:'OTHER'}];
 const s=summarizeV2Outcomes(rows,['2026-10-07','2026-10-07'],{READY:['2026-10-07'],WATCH:['2026-10-07']});
 assert.equal(s.performance_basis,'READY_ONLY');assert.equal(s.outcome_sample,1);assert.equal(s.forward_sample,1);
 assert.equal(s.horizons[0].expectancy,ready.return);assert.equal(s.horizons[0].not_entered,0);
 assert.equal(s.by_status.WATCH.horizons[0].expectancy,-.5);assert.equal(s.by_status.WATCH.horizons[0].not_entered,1);
 assert.equal(s.by_status.WATCH.qualified_ready,false);assert.equal(s.by_status.READY.qualified_ready,true);
 assert.equal(s.unclassified_outcomes,1);assert.equal(s.by_status.WATCH.outcome_sample,1);
 assert.throws(()=>summarizeV2Outcomes([ready,ready],[]),/DUPLICATE/);
 assert.throws(()=>summarizeV2Outcomes([ready,{...ready,horizon:3,prediction_status:'WATCH'}],[]),/CONFLICTING_PREDICTION_STATUS/);
});
test('WATCH-only dates never qualify READY review, missing stratification fails closed, no promotion',()=>{
 const dates=Array.from({length:20},(_,i)=>String(i)),watch=evaluateV2Outcome(prediction('WATCH'),bars(),1,observed);
 const s=summarizeV2Outcomes([watch],dates,{READY:[],WATCH:dates});
 assert.equal(s.promotion_review_eligible,false);assert.equal(s.promotion_allowed,false);
 assert.equal(s.horizons[0].expectancy,null);assert.equal(s.by_status.WATCH.forward_sample,20);
 assert.equal(summarizeV2Outcomes([],dates).promotion_review_eligible,false);
 assert.equal(summarizeV2Outcomes([],dates,{READY:dates,WATCH:[]}).promotion_allowed,false);
});
test('forward migration is limited to status constraint and three existing RPCs, without changing store guards',()=>{
 const read=name=>readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
 const old=read('20261007092045_recommendation_v2_owner_shadow.sql'),next=read('20261007113746_recommendation_v2_watch_prospective_lock.sql');
 assert.doesNotMatch(next,/\b(?:grant|revoke|create policy|alter policy|drop policy|create role|alter role|disable row level security|update public\.|delete from|truncate|insert into public\.reports)\b/i);
 assert.deepEqual([...next.matchAll(/create or replace function public\.(\w+)/g)].map(m=>m[1]),['store_recommendation_shadow_v2','store_recommendation_shadow_v2_outcome','get_owner_recommendation_shadow_v2']);
 const body=s=>s.slice(s.indexOf('language plpgsql'),s.indexOf('end $$;')+7).replace(/--[^\n]*/g,'').replace(/\s+/g,' ').trim();
 const normalized=next.replace("if v_candidate->>'status' in ('WATCH','READY') then","if v_candidate->>'status'='READY' then").replace("v_now,v_cutoff,v_hash,v_candidate->>'status',v_entry)","v_now,v_cutoff,v_hash,'READY',v_entry)");
 assert.equal(body(normalized),body(old.slice(old.indexOf('create function public.store_recommendation_shadow_v2('))));
 assert.match(next,/check\(status in \('WATCH','READY'\)\)/);
 assert.match(next,/'prediction_status',p.status/);
});

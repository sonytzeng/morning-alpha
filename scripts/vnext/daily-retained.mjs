/** Retained real evidence -> isolated lifecycle; zero network or Production writes. */
import {auditResearchFunnel} from './research-funnel.mjs';
import {dailyStore} from './daily-store.mjs';
import {snapshotHash} from '../../src/features/vnext/contracts.ts';
import {runDailyIntelligence,dailySummary,dailyPublication} from '../../src/features/vnext/dailyIntelligence.ts';
import {researchOutcome} from '../../src/features/vnext/dailyOutcome.ts';
export async function retainedDailyCandidate({foundation,names,stock,context,directory,now}){
 const inputs=[];
 const funnel=await auditResearchFunnel(foundation,names,stock,context,i=>inputs.push(i));
 const body={inputs,entry:null,evidence_cutoff:funnel.cutoff},acquired={...body,snapshot_hash:await snapshotHash(body)};
 // There is no matching current Canonical/V2 entry capsule in this retained
 // dataset. Never transplant an October 7/8 entry judgment into October 12.
 const business_date=inputs[0].next_session;
 const request={business_date,checkpoint:'RETAINED_SOURCE_AUDIT',mode:'HISTORICAL_REPLAY',provenance:'RETAINED_REAL_EVIDENCE',
  core_ready:true,core_busy:false,source_revision:funnel.snapshot_hash,source_hash:acquired.snapshot_hash,actionable_at:business_date+'T09:00:00+08:00'};
 const store=dailyStore(directory),ports={clock:()=>now,acquire:async()=>acquired,
  outcomes:async locks=>{
   // No new quote retrieval is authorized by this offline replay. Record every
   // horizon as pending/unknown, not 648 fabricated measured outcomes.
   const rows=[];for(const lock of locks)for(const horizon of lock.target_sessions)rows.push(await researchOutcome(lock,horizon,{symbol:lock.symbol,observed_at:now,bars:[],benchmark:[],actions:null,invalidation:null}));
   return {rows,measured:0,pending:rows.filter(r=>r.state==='NOT_MATURED').length,unknown:rows.filter(r=>r.state==='UNKNOWN').length};
  },
  publication:locks=>dailyPublication(locks,(_,hash)=>({now,audience:'owner',server_entitlement_verified:true,input_hash:hash,
   approved_hash:null,approved_at:null,methodology_approved:false,quality_reviewed:false,use:'OWN_ANALYSIS',grants:[]}))};
 const first=await runDailyIntelligence(request,store,ports),again=await runDailyIntelligence(request,store,ports);
 if(first.state!=='COMPLETE'&&first.state!=='ALREADY_COMPLETE'||again.state!=='ALREADY_COMPLETE')throw Error('DAILY_REPLAY_INCOMPLETE');
 const state=first.checkpoint,summary=dailySummary(state.locks);
 const payload={schema:'VNEXT_DAILY_OWNER_PREVIEW_1',classification:'HISTORICAL_REPLAY_NOT_CURRENT',through:funnel.through,
  evaluated_at:funnel.cutoff,locked_at:state.locks[0].locked_at,summary,stages:state.completed,
  pending_outcomes:state.outcome.pending,unknown_outcomes:state.outcome.unknown,
  rows:state.locks.map(l=>({symbol:l.symbol,company:l.company,horizon:l.horizon,state:l.research.state,reason:l.research.reason,
   confirmation:l.confirmation,invalidation:l.invalidation,risk:l.research.risk,next_review_at:l.next_review_at,
   entry:l.entry.map(e=>({strategy:e.strategy,status:e.status,reasons:e.reasons,trigger:e.entry_trigger,invalidation:e.invalidation})),entry_source_missing:Boolean(l.entry_gap)})),
  source_hash:funnel.snapshot_hash,run_key:first.key,production_changed:false};
 return {preview:{...payload,snapshot_hash:await snapshotHash(payload)},funnel_hash:funnel.snapshot_hash,idempotency:again.state,summary,checkpoint:state};
}
if(process.argv[1]===new URL(import.meta.url).pathname){
 if(process.env.CI)throw Error('PRIVATE_REAL_DATA_NOT_CI');globalThis.fetch=()=>{throw Error('OFFLINE_ONLY');};
 const r=await retainedDailyCandidate({foundation:process.env.MA_VNEXT_FOUNDATION_DIR,names:process.env.MA_VNEXT_DISPLAY_NAMES,
  stock:process.env.MA_VNEXT_STOCK_DIR,context:process.env.MA_VNEXT_CONTEXT_DIR,directory:process.env.MA_VNEXT_DAILY_DIR,now:new Date().toISOString()});
 console.log(JSON.stringify({summary:r.summary,idempotency:r.idempotency,funnel_hash:r.funnel_hash,preview_hash:r.preview.snapshot_hash,
  pending_outcomes:r.preview.pending_outcomes,unknown_outcomes:r.preview.unknown_outcomes,network_requests:0,production_operations:0}));
}

import {resolve} from 'node:path';
import {readdirSync} from 'node:fs';
import {sha,readPrivate,privateDirectory,auditBars,foundationSessions} from './foundation-history.mjs';
import {completedActualPeriod} from './foundation-sources.mjs';

/** Availability is local recorded knowledge, never the historical period label. */
export function availableAt(fact,cutoff){
 const t=Date.parse(cutoff),seen=Date.parse(fact.first_seen_at),available=Date.parse(fact.available_at);
 return Number.isFinite(t)&&Number.isFinite(seen)&&Number.isFinite(available)&&seen<=available&&available<=t&&
  (fact.published_at===null||Number.isFinite(Date.parse(fact.published_at))&&Date.parse(fact.published_at)<=available)&&
  (fact.as_of==null||Number.isFinite(Date.parse(fact.as_of))&&Date.parse(fact.as_of)<=available)&&
  /^https:\/\//.test(fact.source??fact.source_ref??'')&&/^[a-f0-9]{64}$/.test(fact.evidence_hash??'');
}

/** Price-index rebasing only. NEVER a realized/total return, fill or entitlement claim. */
export function adjustedReferencePrice({price,date,through,cutoff,actions,clearance}){
 if(!Number.isFinite(price)||price<=0||date>through)throw Error('PRICE_INVALID');
 if(!clearance||clearance.complete!==true||clearance.from>date||clearance.through<through||!availableAt(clearance,cutoff))return {status:'UNVERIFIED',price:null,reason:'COMPLETE_ACTION_CLEARANCE_REQUIRED'};
 let value=price;for(const a of actions.filter(a=>a.effective_date>date&&a.effective_date<=through)){
  if(!availableAt(a,cutoff)||a.verified_entitlement!==true||!['CASH_DIVIDEND','STOCK_DIVIDEND','SPLIT','CAPITAL_REDUCTION'].includes(a.kind)||!Number.isFinite(a.before_reference)||!Number.isFinite(a.after_reference)||a.before_reference<=0||a.after_reference<=0)return {status:'UNVERIFIED',price:null,reason:'ACTION_ENTITLEMENT_UNVERIFIED'};
  value*=a.after_reference/a.before_reference;
 }
 return {status:'VERIFIED_PRICE_INDEX_ONLY',price:value,total_return_permitted:false};
}

/** No timers, dispatch, credentials or network. Future async caller proposal only. */
export function incrementalPlan({completedSession,coreComplete,coreBusy,stocks,watermarks={},cursor=0,budget=12}){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(completedSession)||!Array.isArray(stocks)||stocks.length!==72||new Set(stocks.map(s=>s.symbol)).size!==72||stocks.some(s=>!/^\d{4}$/.test(s.symbol)||!['TWSE','TPEX'].includes(s.exchange))||!Number.isInteger(cursor)||cursor<0||!Number.isInteger(budget)||budget<1||budget>12)throw Error('PLAN_INVALID');
 if(!coreComplete||coreBusy)return {state:'DEFERRED_CORE_PRIORITY',jobs:[],next_cursor:cursor,enabled:false};
 const jobs=[...stocks.filter(s=>s.exchange==='TWSE').map(s=>({id:'TWSE:'+s.symbol,kind:'MONTH_TO_DATE',symbol:s.symbol})),{id:'TPEX:ALL',kind:'EXACT_DAILY',symbol:null},...['ACTIONS','EVENTS','ACTUALS'].map(s=>({id:s,kind:'SOURCE_SNAPSHOT',symbol:null}))]
  .sort((a,b)=>a.id.localeCompare(b.id));
 // Cursor indexes the stable job list, not a shrinking pending list.
 const batch=jobs.slice(cursor,cursor+budget).filter(j=>watermarks[j.id]!==completedSession).map(j=>({...j,session:completedSession,idempotency_key:sha({source:j.id,session:completedSession,version:'FOUNDATION_V1'}),timeout_ms:20000,attempts:3,minimum_interval_ms:2200}));
 return {state:'CANDIDATE_ONLY',jobs:batch,next_cursor:cursor+budget<jobs.length?cursor+budget:null,enabled:false,concurrency:1,core_awaits_research:false,advance_watermark:'ONLY_AFTER_VALIDATED_IMMUTABLE_COMMIT'};
}

function latest(directory,prefix,schema){
 const files=readdirSync(directory).filter(n=>new RegExp('^'+prefix+'-[a-f0-9]{64}\\.json$').test(n));
 const rows=files.map(name=>{const r=readPrivate(resolve(directory,name));if(r.schema!==schema||name!==prefix+'-'+sha(r)+'.json')throw Error('FOUNDATION_SNAPSHOT_HASH');return r;});
 if(!rows.length)throw Error('FOUNDATION_ACQUISITION_NOT_COMPLETE');return rows.sort((a,b)=>a.observed_at.localeCompare(b.observed_at)).at(-1);
}
export function auditFoundation(directory){
 const dir=privateDirectory(directory),history=latest(dir,'history','VNEXT_FOUNDATION_HISTORY_V1'),sources=latest(dir,'sources','VNEXT_FOUNDATION_SOURCES_V1');
 if(history.rows.length!==72||new Set(history.rows.map(r=>r.symbol)).size!==72||history.forward_sample!==0||sources.forward_sample!==0||history.production_writes!==0||sources.production_writes!==0)throw Error('FOUNDATION_SCOPE');
 const dates=foundationSessions(history.before),coverage=Object.fromEntries([20,60,120,250].map(n=>[n,history.rows.filter(r=>auditBars(r.bars,dates.slice(-n),history.observed_at).complete).length]));
 if(JSON.stringify(coverage)!==JSON.stringify(history.coverage))throw Error('COVERAGE_MISMATCH');
 for(const row of history.rows)for(const b of [...row.bars,...(row.warmup??[])]){
  const original=Object.fromEntries(Object.entries(b).filter(([key])=>['date','open','high','low','close','volume','amount','available_at','source_ref'].includes(key)));
  // Preserve the original adapter field order for its immutable JSON hash.
  if(b.evidence_hash!==sha(original)||!availableAt(b,history.observed_at)||b.first_seen_at!==b.available_at||b.price_basis!=='RAW_UNADJUSTED')throw Error('BAR_PROVENANCE');
 }
 for(const row of history.rows){const expected=[...(row.warmup??[]),...row.bars].sort((a,b)=>a.date.localeCompare(b.date)).slice(-250);if(sha(expected.map(b=>b.date))!==sha(row.traded250_dates))throw Error('TRADED_OBSERVATION_MISMATCH');if(row.warmup?.some(b=>b.date>=dates[0]))throw Error('WARMUP_SESSION_INVALID');}
 for(const f of sources.facts)if(!availableAt(f,sources.observed_at)||f.impact!=='UNKNOWN'||(['REVENUE','EPS'].includes(f.kind)&&!completedActualPeriod(f.kind,f.period,f.source_date)))throw Error('FACT_PROVENANCE');
 for(const r of sources.relations)if(!availableAt(r,sources.observed_at)||r.inferred!==false||r.impact!=='UNKNOWN')throw Error('RELATION_PROVENANCE');
 const replay_cutoffs=['2026-10-07T12:28:24.170Z','2026-10-08T06:33:01.624Z'];
 const leakage=replay_cutoffs.map(c=>history.rows.flatMap(r=>[...r.bars,...(r.warmup??[])]).filter(b=>availableAt(b,c)).length+sources.facts.filter(f=>availableAt(f,c)).length+sources.relations.filter(r=>availableAt(r,c)).length);
 if(leakage.some(n=>n!==0))throw Error('NEW_FOUNDATION_MUST_NOT_ENTER_OLD_REPLAY');
 return {history,sources,coverage,traded_coverage:history.rows.filter(r=>r.traded250_dates.length===250&&auditBars([...(r.warmup??[]),...r.bars],r.traded250_dates,history.observed_at).complete).length,old_cutoff_admissible:leakage};
}
export function foundationSummary(directory){
 const {history:h,sources:s,coverage,traded_coverage,old_cutoff_admissible}=auditFoundation(directory);
 return {schema:'VNEXT_FOUNDATION_SUMMARY_V1',observed_at:s.observed_at>h.observed_at?s.observed_at:h.observed_at,through:h.through,from:h.from,universe:72,coverage,traded_coverage,
  rows:h.rows.map(r=>({symbol:r.symbol,coverage:Object.fromEntries([20,60,120,250].map(n=>[n,r.coverage[n].valid])),gaps:r.coverage[250].gaps})),
  action_events:s.actions.length,action_sources:s.sources.filter(r=>['EX_RIGHT','CAPITAL_REDUCTION','PAR_VALUE_CHANGE'].includes(r.kind)).length,adjusted_returns_permitted:false,
  official_facts:Object.fromEntries(['EVENT','REVENUE','EPS'].map(k=>[k,s.facts.filter(f=>f.kind===k).length])),
  relations:s.relations.map(r=>({supplier:r.supplier,customer:r.customer,type:r.type,source:r.source,source_date:r.source_date,scope:r.scope})),
  history_hash:sha(h),sources_hash:sha(s),old_cutoff_admissible,forward_sample:0,outcome_sample:0,daily_acquisition_enabled:false,
  rights:'PRIVATE_RESEARCH_ONLY_PUBLIC_REDISTRIBUTION_NOT_CLEARED',member_publication:false};
}

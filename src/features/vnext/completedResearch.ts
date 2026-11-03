import {HORIZONS,hashValid,snapshotHash,sourceSafe,validObservationTime,type Horizon} from './contracts.ts';

export type CompletedRow={symbol:string;company:string;horizon:Horizon;state:'QUALIFIED'|'REJECTED'|'INSUFFICIENT';
 close:number;reason:string;confirmation:string;invalidation:string;risk:string;gaps:string[];sources:string[]};
export type CompletedFocus={symbol:string;horizons:Horizon[];decision:string;reason:string;risk:string;confirmation:string;invalidation:string;
 sources:string[];plan:null|{status:'WAIT_CONFIRMATION';range:[number,number];no_chase:number;stop:number;scenario:number;reward_risk:number;
  valid_from:string;valid_until:string;pending:string[]}};
export type CompletedResearch={schema:'VNEXT_COMPLETED_RESEARCH_V1';mode:'AS_OF_RESEARCH';owner_only:true;member_published:false;
 forward_sample:0;outcome_sample:0;data_through:string;evaluated_at:string;source_hash:string;rows:CompletedRow[];focus:CompletedFocus[]};
const obj=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('COMPLETED_OBJECT');return v as Record<string,unknown>;};
const str=(v:unknown,max=3000)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw Error('COMPLETED_TEXT');return v;};
const arr=(v:unknown,max=216)=>{if(!Array.isArray(v)||v.length>max)throw Error('COMPLETED_ARRAY');return v as unknown[];};
const num=(v:unknown)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<=0)throw Error('COMPLETED_NUMBER');return v;};
const time=(v:unknown)=>{const s=str(v,40);if(!validObservationTime(s))throw Error('COMPLETED_TIME');return s;};
const horizon=(v:unknown):Horizon=>{if(typeof v!=='string'||!Object.hasOwn(HORIZONS,v))throw Error('COMPLETED_HORIZON');return v as Horizon;};
const symbol=(v:unknown)=>{const s=str(v,6);if(!/^\d{4,6}$/.test(s))throw Error('COMPLETED_SYMBOL');return s;};
const sources=(v:unknown)=>{const rows=arr(v,100).map(x=>str(x));if(!rows.length||rows.some(s=>!sourceSafe(s)))throw Error('COMPLETED_SOURCE');return rows;};

/** This projection is only for the independently authenticated research Owner.
 * It does not grant publication, invent a forward sample or revive old plans. */
export async function parseCompletedResearch(value:unknown,now=Date.now()):Promise<CompletedResearch|null>{
 const response=obj(value);
 if(response.schema!=='VNEXT_COMPLETED_OWNER_V1'||response.owner_only!==true)throw Error('COMPLETED_OWNER');
 if(response.snapshot_text===null&&response.snapshot_hash===null)return null;
 const serialized=str(response.snapshot_text,1_000_000),hash=str(response.snapshot_hash,64);
 const raw:unknown=JSON.parse(serialized),p=obj(raw);
 if(!hashValid(hash)||await snapshotHash(raw)!==hash)throw Error('COMPLETED_HASH');
 if(p.schema!=='VNEXT_COMPLETED_RESEARCH_V1'||p.mode!=='AS_OF_RESEARCH'||p.owner_only!==true||p.member_published!==false
  ||p.forward_sample!==0||p.outcome_sample!==0)throw Error('COMPLETED_SCOPE');
 const data_through=str(p.data_through,10),evaluated_at=time(p.evaluated_at),source_hash=str(p.source_hash,64);
 if(!/^\d{4}-\d\d-\d\d$/.test(data_through)||!validObservationTime(data_through+'T13:30:00+08:00')||!hashValid(source_hash)
  ||!Number.isFinite(now)||Date.parse(evaluated_at)>now||Date.parse(evaluated_at)<Date.parse(data_through+'T13:30:00+08:00'))throw Error('COMPLETED_CHRONOLOGY');
 const rows=arr(p.rows).map(value=>{const r=obj(value);
  if(!['QUALIFIED','REJECTED','INSUFFICIENT'].includes(String(r.state)))throw Error('COMPLETED_STATE');
  return {symbol:symbol(r.symbol),company:str(r.company,100),horizon:horizon(r.horizon),state:r.state as CompletedRow['state'],close:num(r.close),
   reason:str(r.reason),confirmation:str(r.confirmation),invalidation:str(r.invalidation),risk:str(r.risk),gaps:arr(r.gaps,100).map(x=>str(x)),sources:sources(r.sources)};
 });
 const symbols=new Set(rows.map(r=>r.symbol));
 if(rows.length!==216||symbols.size!==72||new Set(rows.map(r=>r.symbol+':'+r.horizon)).size!==216
  ||[...symbols].some(s=>new Set(rows.filter(r=>r.symbol===s).map(r=>r.company+':'+r.close)).size!==1))throw Error('COMPLETED_UNIVERSE');
 const focus=arr(p.focus,72).map(value=>{const f=obj(value),s=symbol(f.symbol),hs=arr(f.horizons,3).map(horizon);
  if(!symbols.has(s)||!hs.length||new Set(hs).size!==hs.length)throw Error('COMPLETED_FOCUS');
  let plan:CompletedFocus['plan']=null;
  if(f.plan!==null){const q=obj(f.plan),range=arr(q.range,2).map(num),valid_from=time(q.valid_from),valid_until=time(q.valid_until),pending=arr(q.pending,20).map(x=>str(x));
   const no_chase=num(q.no_chase),stop=num(q.stop),scenario=num(q.scenario),reward_risk=num(q.reward_risk);
   if(q.status!=='WAIT_CONFIRMATION'||range.length!==2||range[0]>range[1]||stop>=range[0]||no_chase<=range[1]||scenario<=range[1]
    ||reward_risk<2||!pending.length||Date.parse(valid_from)<=Date.parse(evaluated_at)||Date.parse(valid_until)<=Date.parse(valid_from))throw Error('COMPLETED_PLAN');
   plan={status:'WAIT_CONFIRMATION',range:[range[0],range[1]],no_chase,stop,scenario,reward_risk,valid_from,valid_until,pending};
  }
  return {symbol:s,horizons:hs,decision:str(f.decision),reason:str(f.reason),risk:str(f.risk),confirmation:str(f.confirmation),invalidation:str(f.invalidation),sources:sources(f.sources),plan};
 });
 if(new Set(focus.map(f=>f.symbol)).size!==focus.length)throw Error('COMPLETED_DUPLICATE_FOCUS');
 return {schema:'VNEXT_COMPLETED_RESEARCH_V1',mode:'AS_OF_RESEARCH',owner_only:true,member_published:false,forward_sample:0,outcome_sample:0,
  data_through,evaluated_at,source_hash,rows,focus};
}
export function completedPlanState(plan:CompletedFocus['plan'],now=Date.now()){
 if(!plan||!Number.isFinite(now))return 'NONE';
 return now>=Date.parse(plan.valid_until)?'EXPIRED':now<Date.parse(plan.valid_from)?'UPCOMING':'CONDITIONAL';
}

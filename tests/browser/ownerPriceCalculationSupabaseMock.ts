// Same-origin synthetic fixture reader. Every write and unknown RPC is denied.
let counts={prices:0,calculations:0,blockedWrites:0};
const listeners=new Set<()=>void>();
export const getReadCounts=()=>counts;
export const subscribeReadCounts=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
const record=(key:keyof typeof counts)=>{counts={...counts,[key]:counts[key]+1};listeners.forEach(listener=>listener());};
export const supabase={rpc(name:string,args:Record<string,unknown>){return {async abortSignal(signal:AbortSignal){
 if(signal.aborted)throw Error('ABORTED');
 if(name!=='get_daily_ai_owner_price_plans_v1'&&name!=='get_daily_ai_owner_price_calculation_v1'){
  record('blockedWrites');return {data:null,error:{code:'42501',message:'SYNTHETIC_PREVIEW_READ_ONLY'}};
 }
 const calculation=name==='get_daily_ai_owner_price_calculation_v1';record(calculation?'calculations':'prices');
 const url=new URL('/__owner-price-fixture',location.origin);url.searchParams.set('kind',calculation?'calculation':'prices');
 if(calculation)url.searchParams.set('plan',String(args.p_plan_hash));
 const response=await fetch(url,{signal,credentials:'omit'});
 if(!response.ok)return {data:null,error:{code:'READ_FAILED',message:'SYNTHETIC_FIXTURE_READ_FAILED'}};
 return {data:await response.json(),error:null};
}};}};

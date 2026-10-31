import {analyseStock,validateAnalysisPacket,validateAnalysisResult,type AnalysisPacket} from './daily-ai-analysis.ts';
import {snapshotHash} from '../src/features/vnext/contracts.ts';

type Analysis=Awaited<ReturnType<typeof analyseStock>>;
/** Durable implementation owns atomic leases. Returning a cached result must
 * never authorize publication; per-stock failures remain visible to operators. */
export interface AnalysisJobs{
 claim(key:string,context:{input_hash:string;model_revision:string;symbol:string;cutoff:string}):Promise<{state:'BUSY'}|{state:'EXHAUSTED'}|{state:'CACHED';result:Analysis}|{state:'ACQUIRED';lease:string}>;
 complete(key:string,lease:string,result:Analysis):Promise<void>;
 fail(key:string,lease:string,code:string):Promise<void>;
}
export async function analyseDailyBatch(input:{packets:AnalysisPacket[];modelRevision:string;maxStocks:number;signal?:AbortSignal},
 jobs:AnalysisJobs,run:(packet:AnalysisPacket)=>Promise<Analysis>){
 if(!input.modelRevision.trim()||input.modelRevision.length>200||!Number.isInteger(input.maxStocks)
  ||input.maxStocks<1||input.maxStocks>8||input.packets.length!==72
  ||new Set(input.packets.map(p=>p.symbol)).size!==72||new Set(input.packets.map(p=>p.cutoff)).size!==1)throw Error('AI_BATCH_SCOPE');
 // Validate the entire batch before any claim or provider expense.
 const packets=structuredClone(input.packets);for(const p of packets)validateAnalysisPacket(p);
 const rows:{symbol:string;state:'CACHED'|'COMPLETE'|'BUSY'|'FAILED'|'DEFERRED';code?:string}[]=[];
 let executed=0;
 for(const packet of packets){
  if(input.signal?.aborted)throw Error('AI_ANALYSIS_ABORTED');
  if(executed>=input.maxStocks){rows.push({symbol:packet.symbol,state:'DEFERRED'});continue;}
  const inputHash=await snapshotHash(packet);
  const key=await snapshotHash({version:'DAILY_AI_BATCH_1',input_hash:inputHash,model_revision:input.modelRevision});
  const claim=await jobs.claim(key,{input_hash:inputHash,model_revision:input.modelRevision,symbol:packet.symbol,cutoff:packet.cutoff});
  if(claim.state==='EXHAUSTED'){rows.push({symbol:packet.symbol,state:'FAILED',code:'AI_BATCH_ATTEMPTS_EXHAUSTED'});continue;}
  if(claim.state==='BUSY'){rows.push({symbol:packet.symbol,state:'BUSY'});continue;}
  if(claim.state==='CACHED'){await validateAnalysisResult(packet,claim.result);rows.push({symbol:packet.symbol,state:'CACHED'});continue;}
  if(input.signal?.aborted)throw Error('AI_ANALYSIS_ABORTED');
  executed++;
  let result:Analysis;
  try{
   result=await run(structuredClone(packet));await validateAnalysisResult(packet,result);
  }catch(error){
   // An interrupted invocation cannot know whether provider work finished.
   // Keep the lease until its normal expiry rather than permitting an immediate
   // duplicate paid request or marking unknown work as a confirmed failure.
   if(input.signal?.aborted)throw Error('AI_ANALYSIS_ABORTED');
   const message=error instanceof Error?error.message:'';
   const code=/^(AI_ANALYSIS|AI_BATCH|STOCK_AI)_[A-Z0-9_]{1,80}$/.test(message)?message:'AI_BATCH_FAILED';
   await jobs.fail(key,claim.lease,code);rows.push({symbol:packet.symbol,state:'FAILED',code});
   continue;
  }
  // Persist a valid paid result even if the worker deadline has just elapsed.
  // A failed/unknown commit must never be followed by a competing FAIL write.
  await jobs.complete(key,claim.lease,result);rows.push({symbol:packet.symbol,state:'COMPLETE'});
 }
 return {rows,model_calls:executed,member_published:false,complete:rows.every(r=>r.state==='CACHED'||r.state==='COMPLETE')};
}

import {timingSafeEqual} from 'node:crypto';
import {validateAnalysisPacket,type AnalysisPacket} from '../../../research/daily-ai-analysis.ts';
import type {analyseDailyBatch} from '../../../research/daily-ai-batch.ts';
import {hashValid,validObservationTime} from '../../../src/features/vnext/contracts.ts';

export type StockAnalysisSelector={cutoff:string}|{batch_id:string};
export type StoredStockAnalysisBatch={id:string;cutoff:string;packets:AnalysisPacket[]};
type BatchResult=Awaited<ReturnType<typeof analyseDailyBatch>>;
export type StockAnalysisWorkerPorts={
 internalSecret:string;clock:()=>string;
 loadBatch:(selector:StockAnalysisSelector,signal:AbortSignal)=>Promise<StoredStockAnalysisBatch|null>;
 runBatch:(packets:AnalysisPacket[],maxStocks:1,signal:AbortSignal)=>Promise<BatchResult>;
};
const reply=(status:number,body:unknown)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
async function bounded<T>(work:(signal:AbortSignal)=>Promise<T>,ms:number):Promise<T>{
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([Promise.resolve().then(()=>work(controller.signal)),new Promise<never>((_,reject)=>{
  timer=setTimeout(()=>{controller.abort();reject(Error('STOCK_ANALYSIS_TIMEOUT'));},ms);
 })]);}finally{if(timer)clearTimeout(timer);controller.abort();}
}
export async function readStockAnalysisRequestText(req:Request){
 const length=req.headers.get('content-length');
 if(length!==null&&(!/^\d+$/.test(length)||Number(length)>512))throw Error('INPUT_LIMIT');
 const reader=req.body?.getReader();if(!reader)return '';
 const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;
  if(size>512)throw Error('INPUT_LIMIT');chunks.push(part.value);
 }}finally{await reader.cancel();reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
export function stockAnalysisRequestRejection(req:Request,internalSecret:string):Response|null{
 if(req.method!=='POST')return reply(405,{error:'METHOD_NOT_ALLOWED'});
 if(req.headers.has('origin'))return reply(403,{error:'SERVER_ONLY'});
 const presented=new TextEncoder().encode(req.headers.get('x-vnext-internal')??''),expected=new TextEncoder().encode(internalSecret);
 if(expected.byteLength<24||presented.byteLength!==expected.byteLength||!timingSafeEqual(presented,expected))return reply(401,{error:'INTERNAL_AUTH_REQUIRED'});
 return null;
}
/** The internal credential is required; gateway JWT validation is not assumed.
 * The request
 * selects a server-owned retained batch; it cannot supply evidence, a model,
 * price plans, publisher permissions or continuation counts. One invocation
 * executes at most one model call. Existing callers own subsequent checkpoints. */
export async function handleDailyStockAnalysis(req:Request,ports:StockAnalysisWorkerPorts,
 limits={loadMs:8000,runMs:45000}){
 const rejected=stockAnalysisRequestRejection(req,ports.internalSecret);if(rejected)return rejected;
 if(!Number.isInteger(limits.loadMs)||limits.loadMs<1||limits.loadMs>8000
  ||!Number.isInteger(limits.runMs)||limits.runMs<1||limits.runMs>45000)return reply(500,{error:'WORKER_CONFIGURATION_INVALID'});
 let selector:StockAnalysisSelector;
 try{
  const text=await readStockAnalysisRequestText(req),input:unknown=JSON.parse(text);
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==1)return reply(422,{error:'SCOPE_INVALID'});
  const record=input as Record<string,unknown>;
  if(Object.hasOwn(record,'cutoff')&&typeof record.cutoff==='string'&&validObservationTime(record.cutoff))selector={cutoff:record.cutoff};
  else if(Object.hasOwn(record,'batch_id')&&typeof record.batch_id==='string'&&hashValid(record.batch_id))selector={batch_id:record.batch_id};
  else return reply(422,{error:'SCOPE_INVALID'});
 }catch(error){return reply(error instanceof Error&&error.message==='INPUT_LIMIT'?413:422,{error:error instanceof Error&&error.message==='INPUT_LIMIT'?'INPUT_LIMIT':'SCOPE_INVALID'});}
 try{
  const now=ports.clock();if(!validObservationTime(now))return reply(500,{error:'WORKER_CLOCK_INVALID'});
  if('cutoff' in selector&&Date.parse(selector.cutoff)>Date.parse(now))return reply(422,{error:'FUTURE_CUTOFF'});
  const batch=await bounded(signal=>ports.loadBatch(selector,signal),limits.loadMs);
  if(batch===null)return reply(409,{error:'SOURCE_BATCH_UNAVAILABLE',member_published:false});
  if(!hashValid(batch.id)||!validObservationTime(batch.cutoff)||Date.parse(batch.cutoff)>Date.parse(now)
   ||'batch_id' in selector&&batch.id!==selector.batch_id||'cutoff' in selector&&batch.cutoff!==selector.cutoff
   ||!Array.isArray(batch.packets)||batch.packets.length!==72||new Set(batch.packets.map(p=>p.symbol)).size!==72
   ||batch.packets.some(p=>p.cutoff!==batch.cutoff))throw Error('STOCK_ANALYSIS_BATCH_INVALID');
  const packets=structuredClone(batch.packets);for(const packet of packets)validateAnalysisPacket(packet);
  const result=await bounded(signal=>ports.runBatch(packets,1,signal),limits.runMs);
  const states=['CACHED','COMPLETE','BUSY','FAILED','DEFERRED'] as const;
  if(!result||result.member_published!==false||!Array.isArray(result.rows)||result.rows.length!==72
   ||new Set(result.rows.map(r=>r.symbol)).size!==72||result.rows.some(r=>!packets.some(p=>p.symbol===r.symbol)||!states.includes(r.state))
   ||!Number.isInteger(result.model_calls)||result.model_calls<0||result.model_calls>1
   ||result.rows.filter(r=>r.state==='COMPLETE').length>result.model_calls
   ||result.complete!==result.rows.every(r=>r.state==='CACHED'||r.state==='COMPLETE'))throw Error('STOCK_ANALYSIS_PROGRESS_INVALID');
  const counts=Object.fromEntries(states.map(state=>[state,result.rows.filter(r=>r.state===state).length]));
  const failed=counts.FAILED>0,complete=result.complete;
  return reply(complete?200:failed?207:202,{status:complete?'ANALYSIS_COMPLETE':failed?'PARTIAL_FAILURE':'ANALYSIS_PENDING',
   batch_id:batch.id,cutoff:batch.cutoff,counts,model_calls:result.model_calls,
   requires_next_checkpoint:!complete,member_published:false});
 }catch(error){
  return reply(error instanceof Error&&error.message==='STOCK_ANALYSIS_TIMEOUT'?503:409,
   {error:error instanceof Error&&error.message==='STOCK_ANALYSIS_TIMEOUT'?'STOCK_ANALYSIS_TIMEOUT':'STOCK_ANALYSIS_REJECTED',member_published:false});
 }
}

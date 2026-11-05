import {hashValid} from '../../../src/features/vnext/contracts.ts';
import {intakeUuid} from './intake.ts';
import {stockAnalysisRequestRejection,readStockAnalysisRequestText} from './handler.ts';

export type DailyStockSourceResult={
 state:'SOURCE_PREPARED'|'BUSY'|'EXHAUSTED'|'EXPIRED'|'SOURCE_UNAVAILABLE';
 intake_id:string;batch_id?:string;analysis_dispatched?:boolean;
};
export type DailyStockSourcePorts={
 internalSecret:string;
 runSource:(intakeId:string,signal:AbortSignal)=>Promise<DailyStockSourceResult>;
};
const reply=(status:number,body:Record<string,unknown>)=>Response.json({...body,model_calls:0,member_published:false},
 {status,headers:{'Cache-Control':'no-store'}});

/** A server-only request can prepare one retained intake and dispatch analysis.
 * This handler never calls a model, approves research or publishes to members. */
export async function handleDailyStockSource(req:Request,ports:DailyStockSourcePorts,limits={runMs:45000}){
 const rejected=stockAnalysisRequestRejection(req,ports.internalSecret);
 if(rejected){const body=await rejected.json();return reply(rejected.status,{error:body.error});}
 if(!Number.isInteger(limits.runMs)||limits.runMs<1||limits.runMs>45000)return reply(500,{error:'WORKER_CONFIGURATION_INVALID'});
 let intakeId:string;
 try{
  const input:unknown=JSON.parse(await readStockAnalysisRequestText(req));
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==1
   ||!Object.hasOwn(input,'intake_id')||!intakeUuid((input as Record<string,unknown>).intake_id))return reply(422,{error:'SCOPE_INVALID'});
  intakeId=(input as {intake_id:string}).intake_id;
 }catch(error){
  const limited=error instanceof Error&&error.message==='INPUT_LIMIT';
  return reply(limited?413:422,{error:limited?'INPUT_LIMIT':'SCOPE_INVALID'});
 }
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  const value:unknown=await Promise.race([Promise.resolve().then(()=>ports.runSource(intakeId,controller.signal)),new Promise<never>((_,reject)=>{
   timer=setTimeout(()=>{reject(Error('STOCK_SOURCE_TIMEOUT'));controller.abort();},limits.runMs);
  })]);
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('STOCK_SOURCE_RESULT_INVALID');
  const result=value as Record<string,unknown>;
  if(result.intake_id!==intakeId||typeof result.state!=='string'||!['SOURCE_PREPARED','BUSY','EXHAUSTED','EXPIRED','SOURCE_UNAVAILABLE'].includes(result.state)
   ||result.analysis_dispatched!==undefined&&typeof result.analysis_dispatched!=='boolean'
   ||result.batch_id!==undefined&&(typeof result.batch_id!=='string'||!hashValid(result.batch_id))
   ||result.model_calls!==undefined&&result.model_calls!==0
   ||result.member_published!==undefined&&result.member_published!==false)throw Error('STOCK_SOURCE_RESULT_INVALID');
  if(result.state==='SOURCE_PREPARED'){
   if(typeof result.batch_id!=='string'||!hashValid(result.batch_id)||typeof result.analysis_dispatched!=='boolean')throw Error('STOCK_SOURCE_RESULT_INVALID');
   return reply(202,{state:'SOURCE_PREPARED',intake_id:intakeId,batch_id:result.batch_id,analysis_dispatched:result.analysis_dispatched});
  }
  return reply(result.state==='BUSY'?202:409,{state:result.state,intake_id:intakeId});
 }catch(error){
  const timeout=error instanceof Error&&error.message==='STOCK_SOURCE_TIMEOUT';
  return reply(timeout?503:409,{error:timeout?'STOCK_SOURCE_TIMEOUT':'STOCK_SOURCE_REJECTED'});
 }finally{if(timer)clearTimeout(timer);controller.abort();}
}

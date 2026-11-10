import {stockAnalysisRequestRejection} from './handler.ts';
import {validObservationTime} from '../../../src/features/vnext/contracts.ts';
import type {refreshDailyAiFinancials,DailyAiFinancialRefreshResult} from '../../../research/daily-ai-financial-refresh.ts';

import type {refreshDailyAiInstitutional,InstitutionalRefreshResult} from '../../../research/daily-ai-institutional-refresh.ts';
type Refresh=typeof refreshDailyAiFinancials;
type InstitutionalRefresh=typeof refreshDailyAiInstitutional;
type StageResult=DailyAiFinancialRefreshResult|InstitutionalRefreshResult;
type StageRefresh=(request:Parameters<Refresh>[0])=>Promise<StageResult>;
const inputLimit=8_100_000,outputLimit=16_000_000;
const fail:()=>never=()=>{throw Error('AI_FINANCIAL_STAGE_UNAVAILABLE');};
const day=(at:string)=>new Date(Date.parse(at)+8*3600000).toISOString().slice(0,10);
async function boundedText(body:ReadableStream<Uint8Array>|null,headers:Headers,limit:number,signal:AbortSignal){
 if(signal.aborted)fail();
 const length=headers.get('content-length');
 if(length!==null&&(!/^\d+$/.test(length)||Number(length)>limit))fail();
 const reader=body?.getReader();if(!reader)fail();
 const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
 const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const item=await reader.read();if(signal.aborted)fail();if(item.done)break;size+=item.value.byteLength;if(size>limit)fail();chunks.push(item.value);}}
 finally{signal.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.byteLength;}
 return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
/** Internal compute only: no database writer, publication or model port.
 * The original CRON credential is required before reading a large body.
 * Delivery-token bridging must NOT precede this handler. */
export async function handleFinancialStage(req:Request,ports:{internalSecret:string;refresh:StageRefresh;fetcher:typeof fetch;clock:()=>string}){
 const rejected=stockAnalysisRequestRejection(req,ports.internalSecret);if(rejected)return rejected;
 const deadlineAt=Number(req.headers.get('x-source-deadline-ms'));
 const remaining=deadlineAt-Date.now();
 if(!Number.isSafeInteger(deadlineAt)||remaining<=0||remaining>45000)return Response.json({error:'AI_FINANCIAL_STAGE_UNAVAILABLE'},{status:503});
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(30_000,remaining));
 const signal=AbortSignal.any([req.signal,controller.signal]);
 try{
  const input=JSON.parse(await boundedText(req.body,req.headers,inputLimit,signal));
  const now=ports.clock();
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).sort().join('|')!=='businessDate|inputs'
   ||!validObservationTime(now)||input.businessDate!==day(now)||!Array.isArray(input.inputs)||input.inputs.length!==72
   ||new Set(input.inputs.map((s:{symbol?:unknown})=>s?.symbol)).size!==72
   ||input.inputs.some((s:Record<string,unknown>)=>!s||typeof s!=='object'||typeof s.symbol!=='string'||!/^\d{4,6}$/.test(s.symbol)
    ||!Array.isArray(s.bars)||s.bars.length>400||!Array.isArray(s.facts)||s.facts.length>1000))fail();
  if(signal.aborted)fail();
  let abort:()=>void=()=>{};
  const cancelled=new Promise<never>((_,reject)=>{abort=()=>reject(Error('AI_FINANCIAL_STAGE_UNAVAILABLE'));signal.addEventListener('abort',abort,{once:true});});
  let result:StageResult;
  try{result=await Promise.race([ports.refresh({...input,fetcher:ports.fetcher,clock:ports.clock,signal}),cancelled]);}
  finally{signal.removeEventListener('abort',abort);}
  if(signal.aborted||Date.now()>=deadlineAt)fail();
  const text=JSON.stringify(result);if(new TextEncoder().encode(text).byteLength>outputLimit||Date.now()>=deadlineAt)fail();
  return new Response(text,{status:200,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 }catch{return Response.json({error:'AI_FINANCIAL_STAGE_UNAVAILABLE',model_calls:0,member_published:false},{status:503,headers:{'Cache-Control':'no-store'}});}
 finally{clearTimeout(timer);controller.abort();}
}
/** One bounded invocation; no retries or continuation loop. SOURCE still
 * verifies and stores the returned observations through its existing RPC. */
function remoteStage(projectUrl:string,internalSecret:string,fetcher:typeof fetch,kind:'financial'|'institutional',deadlineAt:number):StageRefresh{
 return async request=>{
  const url=new URL(projectUrl);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'||internalSecret.length<24)fail();
  const remaining=deadlineAt-Date.now();if(!Number.isSafeInteger(deadlineAt)||remaining<=0||remaining>45000)fail();
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(32_000,remaining)),signal=AbortSignal.any([request.signal,controller.signal]);
  try{
   if(signal.aborted)fail();
   const body=JSON.stringify({inputs:request.inputs,businessDate:request.businessDate});if(new TextEncoder().encode(body).byteLength>inputLimit)fail();
   const response=await fetcher(new URL('/functions/v1/daily-stock-source-'+kind+'-v1',url),{method:'POST',redirect:'error',credentials:'omit',
    headers:{'Content-Type':'application/json','x-vnext-internal':internalSecret,'x-source-deadline-ms':String(deadlineAt)},body,signal});
   if(!response.ok)fail();
   const value=JSON.parse(await boundedText(response.body,response.headers,outputLimit,signal));
   if(signal.aborted||Date.now()>=deadlineAt||!value||typeof value!=='object'||Array.isArray(value)||value.proof?.schema!==(kind==='financial'?'DAILY_AI_FINANCIAL_REFRESH_V1':'DAILY_AI_INSTITUTIONAL_REFRESH_V1')
    ||!Array.isArray(value.inputs)||value.inputs.length!==72||!validObservationTime(value.cutoff)||day(value.cutoff)!==request.businessDate)fail();
   return value as StageResult;
  }catch{fail();}finally{clearTimeout(timer);controller.abort();}
 };
}

export const remoteFinancialStage=(url:string,secret:string,fetcher:typeof fetch,deadlineAt:number):Refresh=>remoteStage(url,secret,fetcher,'financial',deadlineAt) as Refresh;
export const remoteInstitutionalStage=(url:string,secret:string,fetcher:typeof fetch,deadlineAt:number):InstitutionalRefresh=>remoteStage(url,secret,fetcher,'institutional',deadlineAt) as InstitutionalRefresh;

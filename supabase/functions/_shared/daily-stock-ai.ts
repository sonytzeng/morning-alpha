import {analyseStock,type AnalysisPacket} from '../../../research/daily-ai-analysis.ts';

/** Server-only port. Reuses a server supplied credential; never accepts member
 * request options, changes secrets, publishes content or logs provider bodies. */
export async function analyseStockWithProvider(packet:AnalysisPacket,config:{apiKey:string;model:string;fetcher:typeof fetch;signal?:AbortSignal}){
 if(!config.apiKey||!config.model||config.model.length>100)throw Error('STOCK_AI_CONFIGURATION_REQUIRED');
 let receipt:{response_id:string;model:string;input_tokens:number;output_tokens:number}|null=null;
 const analysis=await analyseStock(packet,async request=>{
  const response=await config.fetcher('https://api.openai.com/v1/chat/completions',{
   method:'POST',signal:request.signal,headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.apiKey},
   body:JSON.stringify({model:config.model,messages:[{role:'system',content:request.system},{role:'user',content:request.input}],
    response_format:{type:'json_object'},max_tokens:6000}),
  });
  if(!response.ok)throw Error('STOCK_AI_PROVIDER_HTTP_'+response.status);
  const bytes=Number(response.headers.get('content-length'));
  if(bytes>512000)throw Error('STOCK_AI_RESPONSE_LIMIT');
  // Streaming read bounds actual bytes even when Content-Length is absent.
  const reader=response.body?.getReader();if(!reader)throw Error('STOCK_AI_RESPONSE_MISSING');
  const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;
    if(size>512000)throw Error('STOCK_AI_RESPONSE_LIMIT');chunks.push(part.value);}}
  finally{await reader.cancel();reader.releaseLock();}
  const data=new Uint8Array(size);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.byteLength;}
  const body=JSON.parse(new TextDecoder().decode(data));
  const choice=body.choices?.[0],content=choice?.message?.content,usage=body.usage;
  if(choice?.finish_reason!=='stop'||typeof content!=='string'||typeof body.id!=='string'||!body.id
   ||typeof body.model!=='string'||!body.model||!Number.isSafeInteger(usage?.prompt_tokens)||usage.prompt_tokens<0
   ||!Number.isSafeInteger(usage?.completion_tokens)||usage.completion_tokens<0)throw Error('STOCK_AI_RECEIPT_INVALID');
  receipt={response_id:body.id,model:body.model,input_tokens:usage.prompt_tokens,output_tokens:usage.completion_tokens};
  return JSON.parse(content);
 },30000,config.signal);
 if(!receipt)throw Error('STOCK_AI_RECEIPT_MISSING');
 return {...analysis,receipt,publication_ready:false as const};
}

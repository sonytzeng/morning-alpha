import {analyseStock,validateAnalysisPacket,type AnalysisPacket} from '../../../research/daily-ai-analysis.ts';
import {buildStockAnalysisContext} from '../../../research/daily-ai-semantics.ts';
import {HORIZONS,snapshotHash} from '../../../src/features/vnext/contracts.ts';

export type StockAiProviderReceipt={response_id:string;model:string;input_tokens:number;output_tokens:number};
export type StockAiCandidateObserver=(candidate:unknown,receipt:StockAiProviderReceipt,inputHash:string)=>Promise<void>;

/** Shared references keep each packet's long evidence identifiers in one enum.
 * The original citation/text validators still run after provider decoding. */
export function dailyStockAnalysisResponseFormat(packet:AnalysisPacket){
 validateAnalysisPacket(packet);
 const evidenceIds=packet.evidence.map(e=>e.id);
 if(evidenceIds.some(id=>typeof id!=='string'||!id.trim()||id.length>200))throw Error('STOCK_AI_SCHEMA_EVIDENCE_IDS');
 const text={type:'string',minLength:1,maxLength:1500,pattern:'\\S'};
 const condition={...text,pattern:'^[^0-9０-９]*[^0-9０-９\\s][^0-9０-９]*$',
  description:'只寫不含數字的事件式確認或取消條件；不得提供任何數字價格、價位、買價或停損價。日期和財務數字放在有來源期間的理由。'};
 const horizon=(statuses:string[],minimumGaps:number)=>({type:'object',additionalProperties:false,
  properties:{horizon:{type:'string',enum:['SHORT','MEDIUM','LONG']},status:{type:'string',enum:statuses},reason:{$ref:'#/$defs/claim'},
   counter_evidence:{type:'array',maxItems:20,items:{$ref:'#/$defs/claim'}},confirmation:condition,invalidation:condition,
   gaps:{type:'array',minItems:minimumGaps,maxItems:30,items:text}},
  required:['horizon','status','reason','counter_evidence','confirmation','invalidation','gaps']});
 return {type:'json_schema',json_schema:{name:'daily_stock_analysis_v1',strict:true,schema:{
  type:'object',additionalProperties:false,
  properties:{symbol:{type:'string',enum:[packet.symbol]},horizons:{type:'array',minItems:3,maxItems:3,items:{$ref:'#/$defs/horizon'}}},
  required:['symbol','horizons'],
  $defs:{evidence_id:{type:'string',enum:evidenceIds},claim:{type:'object',additionalProperties:false,
   properties:{text:{...text,description:'每句包含營收、EPS、每股盈餘、毛利或其他公司財務數字時，必須同句逐字標示該引用的實際完整期間 YYYY-MM 或 YYYY-Qn。不得用研究日補年份；歷史已報實績不得稱為預測。'},evidence_ids:{type:'array',minItems:1,maxItems:100,items:{$ref:'#/$defs/evidence_id'}}},required:['text','evidence_ids']},
   horizon:{anyOf:[horizon(['WATCH','WAIT','AVOID'],0),horizon(['INSUFFICIENT'],1)]}},
 }}};
}

/** Server-only port. Reuses a server supplied credential; never accepts member
 * request options, changes secrets, publishes content or logs provider bodies. */
export async function analyseStockWithProvider(packet:AnalysisPacket,config:{apiKey:string;model:string;fetcher:typeof fetch;signal?:AbortSignal;onCandidate?:StockAiCandidateObserver}){
 if(!config.apiKey||!config.model||config.model.length>100)throw Error('STOCK_AI_CONFIGURATION_REQUIRED');
 let receipt:StockAiProviderReceipt|null=null;
 const analysis=await analyseStock(packet,async request=>{
  // Build the enum from analyseStock's owned snapshot, never a mutable caller.
  const owned=JSON.parse(request.input) as AnalysisPacket,responseFormat=dailyStockAnalysisResponseFormat(owned);
  const context=buildStockAnalysisContext(owned);
  const providerInput={...owned,analysis_context:{...context,
   horizon_definitions:Object.fromEntries(Object.entries(HORIZONS).map(([h,rule])=>[h,rule.duration])),
   revenue_periods_present_in_packet:[...new Set(context.financial_evidence_periods.filter(r=>r.kind==='REVENUE'&&r.period).map(r=>r.period))].sort(),
   financial_basis_rule:'AS_REPORTED_IS_NOT_SINGLE_QUARTER_YTD_CUMULATIVE_OR_TTM',
   gap_statement_rule:'MISSING_IN_THIS_PACKET_IS_NOT_PROOF_OF_NOT_PUBLISHED',
  }};
  const completion=config.model==='gpt-6-astra'?{max_completion_tokens:6000,reasoning_effort:'low'}:{max_tokens:6000};
  const response=await config.fetcher('https://api.openai.com/v1/chat/completions',{
   method:'POST',signal:request.signal,headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.apiKey},
   body:JSON.stringify({model:config.model,messages:[{role:'system',content:request.system+' 引用必須逐字使用 JSON Schema 列舉中的完整 evidence_ids，不得改寫或縮短，且同一主張不得重複引用同一 ID。期間定義必須與 analysis_context.horizon_definitions 一致：SHORT為1～10個交易日，MEDIUM為2～12週，LONG為3～18個月，不得自行改持有期間。analysis_context.latest_revenue_period 與 recent_revenue 是來源實際已報期間，不是研究月份；即使研究日已過數年，也不得把年份換成今年。每句包含任何公司財務數字（營收、EPS、毛利率等）都必須同句標示對應來源的完整 YYYY-MM 或 YYYY-Qn；不可以只寫十月或第二季。AS_REPORTED只代表來源原報值與期間標籤，未證明單季或累計；不得把AS_REPORTED稱為單季、累計、年初至今、YTD或TTM，也不得自行差分或換算。已報歷史營收與財報都是實績，不得寫成未來預測、預估或將公布數值。缺口只能描述本次輸入未包含或無法確認，不能因此宣稱公司尚未公布、營收未揭露或市場沒有資料；先檢查 revenue_periods_present_in_packet 全部實際月份，不能因缺少季度標籤就忽略已有的該季各月營收。不得宣稱無來源的連續季數、連續年數或成長期數，除非逐期證據足夠。確認與失效條件只寫無數字的事件／資料條件，不得包含阿拉伯或全形數字，也不得用中文數字提供任何價格、價位、買價或停損；日期移到理由或缺口。請精簡：每段理由以240字內、反面證據0到3段且每段160字內、確認與失效條件各120字內、每項缺口80字內為原則。所有文字不得為空白；INSUFFICIENT 至少列一項真實缺口。每個期間各輸出一次。'},{role:'user',content:JSON.stringify(providerInput)}],
    response_format:responseFormat,...completion}),
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
  if(choice?.message?.refusal)throw Error('STOCK_AI_PROVIDER_REFUSAL');
  if(choice?.finish_reason!=='stop'||typeof content!=='string'||typeof body.id!=='string'||!body.id
   ||typeof body.model!=='string'||!body.model||!Number.isSafeInteger(usage?.prompt_tokens)||usage.prompt_tokens<0
   ||!Number.isSafeInteger(usage?.completion_tokens)||usage.completion_tokens<0)throw Error('STOCK_AI_RECEIPT_INVALID');
  receipt={response_id:body.id,model:body.model,input_tokens:usage.prompt_tokens,output_tokens:usage.completion_tokens};
  const candidate:unknown=JSON.parse(content);
  // Preserve the exact paid response before semantic validation can reject it.
  // Audit storage receives detached copies and cannot repair the model output.
  if(config.onCandidate)await config.onCandidate(structuredClone(candidate),{...receipt},await snapshotHash(owned));
  return candidate;
 },30000,config.signal);
 if(!receipt)throw Error('STOCK_AI_RECEIPT_MISSING');
 return {...analysis,receipt,publication_ready:false as const};
}

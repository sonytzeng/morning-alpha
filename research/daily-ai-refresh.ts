import {parseTwseDaily,parseTpexDaily,twseDailyUrl,tpexDailyUrl} from './entry-official-history.ts';
import {coveredCalendarDate,isMarketTradingDate,previousMarketTradingDate} from '../supabase/functions/_shared/market-session-contract.mjs';
import {validObservationTime} from '../src/features/vnext/contracts.ts';
import type {DailyBar,FunnelInput} from '../src/features/vnext/researchFunnel.ts';

type Receipt={source:string;date:string;state:'CAPTURED'|'UNAVAILABLE';received_at:string|null;hash:string|null};
const stopped=(signal:AbortSignal)=>{if(signal.aborted)throw Error('AI_REFRESH_ABORTED');};
const taipeiDay=(at:string)=>new Date(Date.parse(at)+8*3600000).toISOString().slice(0,10);
const digest=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as BufferSource)),v=>v.toString(16).padStart(2,'0')).join('');
const day=(s:string)=>/^\d{4}-\d\d-\d\d$/.test(s)&&validObservationTime(s+'T00:00:00Z');
async function read(response:Response){
 if(!response.ok||Number(response.headers.get('content-length'))>2000000)throw Error('AI_REFRESH_HTTP');
 const reader=response.body?.getReader();if(!reader)throw Error('AI_REFRESH_BODY');
 const parts:Uint8Array[]=[];let size=0;
 try{for(;;){const p=await reader.read();if(p.done)break;size+=p.value.byteLength;
  if(size>2000000)throw Error('AI_REFRESH_SIZE');parts.push(p.value);
 }}finally{try{await reader.cancel();}catch{/* Transport may already be aborted. */}reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.byteLength;}
 return bytes;
}
function sessionsThrough(through:string,count:number){
 const dates:string[]=[];let date:string|null=through;
 for(let i=0;i<count;i++){if(!date||!coveredCalendarDate('TW',date)||!isMarketTradingDate('TW',date))throw Error('AI_REFRESH_CALENDAR_UNCOVERED');dates.unshift(date);date=previousMarketTradingDate('TW',date);}
 return dates;
}
function exchange(stock:FunnelInput):'TWSE'|'TPEX'|null{
 const latest=stock.bars.slice().sort((a,b)=>b.date.localeCompare(a.date))[0];if(!latest)return null;
 try{const h=new URL(latest.source).hostname;
  return h==='www.twse.com.tw'||h==='openapi.twse.com.tw'?'TWSE':h==='www.tpex.org.tw'?'TPEX':null;
 }catch{return null;}
}
/** Independent AS_OF source checkpoint. Fixed public exchange URLs only; never
 * invokes a paid provider, a model, a member publisher or the Forward engine.
 * Existing financial observations retain their original dates and trace bytes. */
export async function refreshDailyAiPrices(input:{inputs:FunnelInput[];businessDate:string;fetcher:typeof fetch;clock:()=>string;signal:AbortSignal}){
 stopped(input.signal);const began=input.clock();
 if(!validObservationTime(began)||!day(input.businessDate)||taipeiDay(began)!==input.businessDate
  ||input.inputs.length!==72||new Set(input.inputs.map(i=>i.symbol)).size!==72||new Set(input.inputs.map(i=>i.through)).size!==1
  ||input.inputs.some(i=>!/^\d{4,6}$/.test(i.symbol)||!Array.isArray(i.bars)||!Array.isArray(i.facts)))throw Error('AI_REFRESH_SCOPE');
 if(!coveredCalendarDate('TW',input.businessDate))throw Error('AI_REFRESH_CALENDAR_UNCOVERED');
 // Both exact daily endpoints include volume from block trades. Wait until
 // after the 17:00 session and a publication buffer before selecting today.
 const through=isMarketTradingDate('TW',input.businessDate)&&Date.parse(began)>=Date.parse(input.businessDate+'T17:05:00+08:00')
  ?input.businessDate:previousMarketTradingDate('TW',input.businessDate);
 const previous=input.inputs[0].through;
 if(!through||!day(previous)||previous>through)throw Error('AI_REFRESH_DATA_DATE');
 const expected=sessionsThrough(through,20),recent=sessionsThrough(through,5);
 const additionalGaps=['FINANCIAL_DATA_RETAINED_NOT_REFRESHED','INSTITUTIONAL_DATA_RETAINED_NOT_REFRESHED'];
 if(previous<recent[0]&&previous!==previousMarketTradingDate('TW',recent[0]))additionalGaps.push('PRICE_REFRESH_BACKLOG_OLDER_SESSIONS_NOT_FETCHED');
 const stocks=structuredClone(input.inputs),gapsBySymbol:Record<string,string[]>={},markets=new Map(stocks.map(s=>[s.symbol,exchange(s)]));
 for(const s of stocks){gapsBySymbol[s.symbol]=[];if(markets.get(s.symbol)===null)gapsBySymbol[s.symbol].push('PRICE_EXCHANGE_CLASSIFICATION_UNCONFIRMED');}
 // A partial refresh advances the edition's common target date, while some
 // stocks can still lack that day's observation. Retry those holes on the next
 // intake instead of treating the target date as proof that all bars exist.
 const tasks=recent.flatMap(date=>(['TWSE','TPEX'] as const).filter(market=>stocks.some(s=>markets.get(s.symbol)===market
  &&(date>previous||!s.bars.some(b=>b.date===date)))).map(market=>({date,market})));
 const receipts:Receipt[]=new Array(tasks.length);let cursor=0;
 const worker=async()=>{for(;;){const index=cursor++;if(index>=tasks.length)return;stopped(input.signal);
  const {date,market}=tasks[index],source=market==='TWSE'?twseDailyUrl(date):tpexDailyUrl(date),selected=stocks.filter(s=>markets.get(s.symbol)===market);
  try{
   const response=await input.fetcher(source,{method:'GET',redirect:'error',signal:AbortSignal.any([input.signal,AbortSignal.timeout(6000)])});
   const bytes=await read(response);stopped(input.signal);const received_at=input.clock();
   if(!validObservationTime(received_at)||Date.parse(received_at)<Date.parse(began))throw Error('AI_REFRESH_CLOCK');
   const hash=await digest(bytes),payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
   const parsed=(market==='TWSE'?parseTwseDaily:parseTpexDaily)(payload,date,selected.map(s=>s.symbol),received_at);
   for(const stock of selected){const row=parsed.daily.find(r=>r.symbol===stock.symbol);
    if(!row?.bar){gapsBySymbol[stock.symbol].push('PRICE_SESSION_OBSERVATION_UNAVAILABLE');continue;}
    const retained=stock.bars.find(b=>b.date===date);
    if(retained){
     // The source checkpoint pins existing retained observations byte for byte.
     // Refetching an exchange to fill one company's gap cannot rewrite the
     // other companies' prior receipts or silently apply a revised history.
     if((['open','high','low','close','volume','amount'] as const).some(k=>retained[k]!==row.bar![k]))
      gapsBySymbol[stock.symbol].push('PRICE_RETAINED_REVISION_DIFFERS_FROM_PUBLIC_SOURCE');
     continue;
    }
    const bar:DailyBar={id:`asof:${market}:${date}:${stock.symbol}:${hash.slice(0,16)}`,source,evidence_hash:hash,
     published_at:null,first_seen_at:received_at,available_at:received_at,as_of:date+'T17:00:00+08:00',
     date,...Object.fromEntries(['open','high','low','close','volume','amount'].map(k=>[k,row.bar![k as keyof typeof row.bar]])) as Pick<DailyBar,'open'|'high'|'low'|'close'|'volume'|'amount'>,
     session_scope:parsed.volume_amount_scope};
    stock.bars.push(bar);
   }
   receipts[index]={source,date,state:'CAPTURED',received_at,hash};
  }catch(error){
   if(input.signal.aborted)throw Error('AI_REFRESH_ABORTED');
   if(error instanceof Error&&error.message==='AI_REFRESH_CLOCK')throw error;
   receipts[index]={source,date,state:'UNAVAILABLE',received_at:null,hash:null};
   for(const stock of selected)gapsBySymbol[stock.symbol].push('PRICE_PUBLIC_SOURCE_REFRESH_UNAVAILABLE');
  }
 }};
 await Promise.all([worker(),worker()]);stopped(input.signal);const cutoff=input.clock();
 if(!validObservationTime(cutoff)||Date.parse(cutoff)<Date.parse(began)||receipts.some(r=>r.received_at&&Date.parse(r.received_at)>Date.parse(cutoff)))throw Error('AI_REFRESH_CLOCK');
 for(const stock of stocks){
  stock.bars=stock.bars.filter(b=>expected.includes(b.date)).sort((a,b)=>a.date.localeCompare(b.date));
  stock.expected_sessions=expected.slice();stock.through=through;stock.cutoff=cutoff;
  let next:string|null=through;for(let i=0;i<30;i++){
   next=new Date(Date.parse(next+'T00:00:00Z')+86400000).toISOString().slice(0,10);
   if(!coveredCalendarDate('TW',next))throw Error('AI_REFRESH_CALENDAR_UNCOVERED');if(isMarketTradingDate('TW',next))break;
  }stock.next_session=next;
  if(expected.some(date=>stock.bars.filter(b=>b.date===date).length!==1))gapsBySymbol[stock.symbol].push('PRICE_20_SESSION_COVERAGE_MISSING');
  if(new Set(stock.bars.map(b=>b.session_scope)).size>1)gapsBySymbol[stock.symbol].push('PRICE_SESSION_SCOPE_MIXED');
  gapsBySymbol[stock.symbol]=[...new Set(gapsBySymbol[stock.symbol])];
 }
 return {inputs:stocks,cutoff,through,additionalGaps,gapsBySymbol,receipts};
}

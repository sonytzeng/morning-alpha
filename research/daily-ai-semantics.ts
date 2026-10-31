import type {AnalysisPacket,CitedClaim} from './daily-ai-analysis.ts';

type FinancialRecord={evidence_id:string;kind:string;period:string|null;basis:string|null;
 values:Record<string,unknown>|null;available_at:string};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const month=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value);
const period=(value:unknown):value is string=>typeof value==='string'&&(
 month(value)||/^\d{4}-Q[1-4]$/.test(value)||/^\d{4}-\d\d-\d\d$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))
 &&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value);
function financialRecords(packet:AnalysisPacket):FinancialRecord[]{
 const result:FinancialRecord[]=[];
 for(const evidence of packet.evidence){
  if(evidence.kind!=='FINANCIAL')continue;
  let raw:unknown;try{raw=JSON.parse(evidence.content);}catch{continue;}
  if(!object(raw)||typeof raw.kind!=='string'||!raw.kind.trim())continue;
  result.push({evidence_id:evidence.id,kind:raw.kind,period:period(raw.period)?raw.period:null,
   basis:typeof raw.basis==='string'?raw.basis:null,values:object(raw.values)?structuredClone(raw.values):null,available_at:evidence.available_at});
 }
 return result;
}
/** Project actual retained periods. The research date never supplies a missing
 * revenue year or changes an old reported month into a current observation. */
export function buildStockAnalysisContext(packet:AnalysisPacket){
 const records=financialRecords(packet),revenues=records.filter(r=>r.kind==='REVENUE'&&month(r.period))
  .sort((a,b)=>b.period!.localeCompare(a.period!)||a.evidence_id.localeCompare(b.evidence_id));
 const periods=[...new Set(revenues.map(r=>r.period!))].slice(0,3);
 const row=(r:FinancialRecord)=>({period:r.period!,basis:r.basis,values:r.values,evidence_id:r.evidence_id,available_at:r.available_at});
 return {latest_revenue_period:periods[0]??null,
  recent_revenue:periods.map(p=>row(revenues.find(r=>r.period===p)!)),
  revenue_period_conflicts:periods.flatMap(p=>{
   const candidates=revenues.filter(r=>r.period===p);
   return candidates.length>1?[{period:p,observations:candidates.map(row)}]:[];
  }),
  financial_evidence_periods:records.map(({evidence_id,kind,period,basis})=>({evidence_id,kind,period,basis})),
  revenue_period_basis:'ACTUAL_RETAINED_REPORTED_MONTHS_NOT_RESEARCH_MONTH',
 };
}

const financialWords=/營收|收入|EPS|每股(?:盈餘|獲利|淨利)|毛利|淨利|營業(?:利益|利潤|損失)|獲利|資本支出|資本投資|股利|盈餘|年增|月增|季增|財務|財報|財測|(?:\brevenue\b|\bmargin\b|\bcapex\b|\bprofit\b|\bincome\b)/i;
const forecastWords=/預測|預估|預計|預期|將達|將為|可望達|\bforecast(?:ed|s)?\b|\bproject(?:ed|s)?\b|\bexpected\b/i;
function statedPeriods(sentence:string){
 const found:{value:string;raw:string}[]=[];
 for(const m of sentence.matchAll(/\b(\d{4}-(?:Q[1-4]|\d{2}(?:-\d{2})?))\b/gi)){
  const value=m[1].replace(/q/,'Q');if(period(value))found.push({value,raw:m[0]});
 }
 for(const m of sentence.matchAll(/(\d{4})年\s*(\d{1,2})月(?:\s*(\d{1,2})日)?/g)){
  const value=m[1]+'-'+m[2].padStart(2,'0')+(m[3]?'-'+m[3].padStart(2,'0'):'');if(period(value))found.push({value,raw:m[0]});
 }
 for(const m of sentence.matchAll(/(\d{4})年\s*(?:第\s*([1-4])季|Q([1-4]))/gi))found.push({value:m[1]+'-Q'+(m[2]??m[3]),raw:m[0]});
 return found;
}
/** This is an evidence-period guard, not an accuracy score or a substitute for
 * the separate semantic review. Unknown citations remain the caller's error. */
export function validateStockAnalysisClaim(packet:AnalysisPacket,claim:CitedClaim):void{
 const ids=new Set(claim.evidence_ids),records=financialRecords(packet).filter(r=>ids.has(r.evidence_id));
 const known=new Set(records.flatMap(r=>r.period?[r.period]:[]));
 for(const sentence of claim.text.split(/[。！？!?；;\n]+/u)){
  if(!financialWords.test(sentence))continue;
  const stated=statedPeriods(sentence);
  if(known.size&&stated.some(p=>!known.has(p.value)))throw Error('AI_ANALYSIS_FINANCIAL_PERIOD');
  let withoutPeriods=sentence;for(const p of stated)withoutPeriods=withoutPeriods.replaceAll(p.raw,'');
  const metricNumber=/[-+＋－]?\d[\d,.，．]*(?:\s*)(?:%|％|元|圓|塊|億|萬|千|百萬|倍)/u.test(withoutPeriods)
   ||/百分之[負正零〇一二三四五六七八九十百千萬億兩點点]+|[負正零〇一二三四五六七八九十百千萬億兩點点]+\s*(?:元|圓|塊|億|萬|倍)/u.test(withoutPeriods)
   ||/(?:營收|收入|EPS|每股(?:盈餘|獲利|淨利)|毛利率?|淨利率?|獲利|年增|月增|季增|\brevenue\b|\bmargin\b|\bcapex\b|\bprofit\b|\bincome\b)[^。！？!?；;\n\d]{0,16}[-+＋－]?\d/i.test(withoutPeriods);
  if(metricNumber&&(!stated.length||records.length>0&&!known.size))throw Error('AI_ANALYSIS_FINANCIAL_PERIOD');
  const forecastText=sentence.replace(/(?:並非|不是|不代表|不得視為|不可視為|不能視為|不應視為|不屬於|非)(?:未來|任何|新的|對未來的)?(?:預測|預估|預計|預期)/g,'');
  if(records.length&&stated.length&&forecastWords.test(forecastText))throw Error('AI_ANALYSIS_REPORTED_FACT_AS_FORECAST');
 }
}

/** Conditions describe observable events, not numeric trading levels. Dates and
 * numeric facts belong in the evidence-grounded reason or limitations instead. */
export function validateStockAnalysisCondition(text:string):void{
 const chineseNumber='[零〇○一二三四五六七八九十百千萬億兩壹貳參肆伍陸柒捌玖拾佰仟點点半]+';
 if(/[0-9０-９]/u.test(text)||new RegExp(chineseNumber+'\\s*(?:元|塊|圓|角|分)','u').test(text)
  ||new RegExp('(?:上看|站上|守住|跌破|突破|回測|支撐|壓力|停損|目標價|價位)\\s*'+chineseNumber,'u').test(text))throw Error('AI_ANALYSIS_CONDITION_PRICE');
}

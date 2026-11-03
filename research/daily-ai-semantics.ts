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

const financialWords=/營收|收入|EPS|每股(?:盈餘|獲利|淨利)|毛利|淨利|營業(?:利益|利潤|損失|費用)|獲利|資本支出|資本投資|股利|盈餘|年增|月增|季增|財務|財報|財測|(?:\brevenue\b|\bmargin\b|\bcapex\b|\bprofit\b|\bincome\b)/i;
const valuationWords=/本益比|股價淨值比|股價盈餘比|殖利率|估值|\b(?:P\/?E(?:R)?|P\/?B(?:R)?)(?![A-Za-z])|\bdividend yield\b|\bvaluation\b/i;
const forecastWords=/預測|預估|預計|預期|將達|將為|可望達|\bforecast(?:ed|s)?\b|\bproject(?:ed|s)?\b|\bexpected\b/i;
function statedPeriods(sentence:string){
 const found:{value:string;raw:string;index:number}[]=[];
 for(const m of sentence.matchAll(/\b(\d{4}-(?:Q[1-4]|\d{2}(?:-\d{2})?))\b/gi)){
  const value=m[1].replace(/q/,'Q');if(period(value))found.push({value,raw:m[0],index:m.index??0});
 }
 for(const m of sentence.matchAll(/(\d{4})年\s*(\d{1,2})月(?:\s*(\d{1,2})日)?/g)){
  const value=m[1]+'-'+m[2].padStart(2,'0')+(m[3]?'-'+m[3].padStart(2,'0'):'');if(period(value))found.push({value,raw:m[0],index:m.index??0});
 }
 for(const m of sentence.matchAll(/(\d{4})年\s*(?:第\s*([1-4])季|Q([1-4]))/gi))found.push({value:m[1]+'-Q'+(m[2]??m[3]),raw:m[0],index:m.index??0});
 return found;
}
/** Only an issuer's cited, verified MOPS financial-report headline can add an
 * actual quarter. An excerpt can also contain guidance; its dates are not an
 * actual-period registry and must never be scanned into this set. */
function officialNewsActualPeriods(packet:AnalysisPacket,ids:Set<string>){
 const result=new Set<string>();
 for(const e of packet.evidence){
  if(e.kind!=='NEWS'||e.symbol!==packet.symbol||!ids.has(e.id))continue;
  let c:unknown;try{c=JSON.parse(e.content);}catch{continue;}
  if(!object(c)||c.schema!=='DAILY_AI_OFFICIAL_NEWS_FACT_V1'||c.coverage!=='OFFICIAL_ANNOUNCEMENT_EXCERPT'
   ||!object(c.source_metadata)||c.source_metadata.company_code!==packet.symbol
   ||c.source_metadata.publication_timezone!=='NOT_DECLARED_BY_SOURCE'
   ||c.source_metadata.window_basis!=='SOURCE_DECLARED_DAY_COORDINATE_NOT_EXACT_PUBLICATION_TIME'
   ||c.source_received_at!==e.available_at||e.first_seen_at!==e.available_at||e.as_of!==e.available_at
   ||e.published_at!==null||e.time_basis!=='OBSERVED_AFTER_RECEIPT'||typeof c.title!=='string'
   ||!c.title.includes('財務報告')||forecastWords.test(c.title)||/展望|子公司/.test(c.title))continue;
  const source=c.provider==='TWSE_MOPS_OPEN_DATA'?'https://openapi.twse.com.tw/v1/opendata/t187ap04_L':
   c.provider==='TPEX_MOPS_OPEN_DATA'?'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap04_O':null;
  if(!source||e.source!==source||!new RegExp('^official-news:'+c.provider+':[a-f0-9]{64}$').test(e.id))continue;
  const quarters=statedPeriods(c.title).filter(p=>/^\d{4}-Q[1-4]$/.test(p.value)).map(p=>p.value);
  for(const match of c.title.matchAll(/(?<!\d)(?:民國)?(\d{2,3})年\s*第\s*([1-4])季/g)){
   if(Number(match[1])>=80&&Number(match[1])<=300)quarters.push(String(Number(match[1])+1911)+'-Q'+match[2]);
  }
  for(const value of quarters){
   const [year,quarter]=value.split('-Q').map(Number),closedAt=Date.UTC(year,quarter*3,1)-8*3600000;
   if(Number.isFinite(Date.parse(e.available_at))&&closedAt<=Date.parse(e.available_at)&&closedAt<=Date.parse(packet.cutoff))result.add(value);
  }
 }
 return result;
}
type OfficialGuidanceSection={period:string;company:string;section:string};
type OfficialReportScope={evidence_id:string;title:string;company:string;excerpt:string};
/** A separate source guidance scope, never an actual reported-quarter entry.
 * The caller already verified the frozen source content/hash at intake. */
function officialNewsReportScopes(packet:AnalysisPacket,ids:Set<string>):OfficialReportScope[]{
 const result:OfficialReportScope[]=[];
 for(const e of packet.evidence){
  if(e.kind!=='NEWS'||e.symbol!==packet.symbol||!ids.has(e.id))continue;
  let c:unknown;try{c=JSON.parse(e.content);}catch{continue;}
  if(!object(c)||c.schema!=='DAILY_AI_OFFICIAL_NEWS_FACT_V1'||c.coverage!=='OFFICIAL_ANNOUNCEMENT_EXCERPT'
   ||!object(c.source_metadata)||c.source_metadata.company_code!==packet.symbol
   ||c.source_metadata.publication_timezone!=='NOT_DECLARED_BY_SOURCE'
   ||c.source_metadata.window_basis!=='SOURCE_DECLARED_DAY_COORDINATE_NOT_EXACT_PUBLICATION_TIME'
   ||c.source_received_at!==e.available_at||e.first_seen_at!==e.available_at||e.as_of!==e.available_at
   ||e.published_at!==null||e.time_basis!=='OBSERVED_AFTER_RECEIPT'||typeof c.title!=='string'
   ||!c.title.includes('財務報告')||forecastWords.test(c.title)||/展望|子公司/.test(c.title)
   ||typeof c.excerpt!=='string'||c.excerpt_truncated!==false||!Number.isFinite(Date.parse(e.available_at))
   ||Date.parse(e.available_at)>Date.parse(packet.cutoff))continue;
  const source=c.provider==='TWSE_MOPS_OPEN_DATA'?'https://openapi.twse.com.tw/v1/opendata/t187ap04_L':
   c.provider==='TPEX_MOPS_OPEN_DATA'?'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap04_O':null;
  if(!source||e.source!==source||!new RegExp('^official-news:'+c.provider+':[a-f0-9]{64}$').test(e.id))continue;
  result.push({evidence_id:e.id,title:c.title,company:typeof c.source_metadata.company_name==='string'?c.source_metadata.company_name:packet.company,excerpt:c.excerpt.replace(/\r\n?/g,'\n')});
 }
 return result;
}
function officialNewsGuidanceSections(packet:AnalysisPacket,ids:Set<string>):OfficialGuidanceSection[]{
 const result:OfficialGuidanceSection[]=[];
 for(const report of officialNewsReportScopes(packet,ids)){
  const excerpt=report.excerpt;
  for(const h of excerpt.matchAll(/^[ \t]*(?:民國)?(\d{2,4})年[ \t]*第?[ \t]*([1-4一二三四])季[ \t]*(?:營運)?(?:展望|指引|財測)[ \t]*[:：]?[ \t]*$/gm)){
   const n=Number(h[1]),year=n>=80&&n<=300?n+1911:n,quarter=({一:1,二:2,三:3,四:4} as Record<string,number>)[h[2]]??Number(h[2]);
   if(year<1900||year>3000)continue;
   const tail=excerpt.slice((h.index??0)+h[0].length),end=tail.search(/^[ \t]*(?:\d+[.、]|(?:民國)?\d{2,4}年[ \t]*第?[ \t]*[1-4一二三四]季)/m);
   const section=(end<0?tail:tail.slice(0,end)).trim();
   if(!section||!financialWords.test(section)||!/[0-9]/.test(section))continue;
   result.push({period:`${year}-Q${quarter}`,company:report.company,section});
  }
 }
 return result;
}
type OfficialCumulativeRange={quarter:string;start:string;end:string;excerpt:string};
function officialNewsCumulativeRanges(packet:AnalysisPacket,ids:Set<string>,actual:Set<string>):OfficialCumulativeRange[]{
 const ranges:OfficialCumulativeRange[]=[];
 const sourceDay=(raw:string)=>{const a=raw.split('/').map(Number),year=a[0]+1911;
  if(a[0]<80||a[0]>300)return null;const value=String(year)+'-'+String(a[1]).padStart(2,'0')+'-'+String(a[2]).padStart(2,'0');return period(value)?value:null;};
 for(const report of officialNewsReportScopes(packet,ids)){
  // Both the formal reporting interval and an explicitly cumulative field
  // must be present. Meetings, metadata dates and AS_REPORTED API rows do not
  // supply this scope. This initial support is for calendar-year YTD filings.
  const m=report.excerpt.match(/(?:財務報告|年度自結財務資訊)報導期間\s*\n[^\n]*起訖日期[^\n]*[:：]\s*(\d{2,3}\/\d{1,2}\/\d{1,2})\s*[~～]\s*(\d{2,3}\/\d{1,2}\/\d{1,2})/);
  if(!m||!/\d+\.1月1日累計至本期止(?:基本每股盈餘|歸屬於母公司業主淨利|本期淨利|營業收入)/.test(report.excerpt))continue;
  const start=sourceDay(m[1]),end=sourceDay(m[2]);if(!start||!end||!start.endsWith('-01-01')||start.slice(0,4)!==end.slice(0,4))continue;
  const year=Number(end.slice(0,4)),q=Number(end.slice(5,7))/3,quarter=year+'-Q'+q;
  if(!Number.isInteger(q)||!actual.has(quarter)||new Date(Date.UTC(year,q*3,0)).toISOString().slice(0,10)!==end)continue;
  ranges.push({quarter,start,end,excerpt:report.excerpt});
 }
 return ranges;
}
function qualifiedCumulativeEndpoints(sentence:string,stated:ReturnType<typeof statedPeriods>,ranges:OfficialCumulativeRange[]){
 const allowed=new Set<number>(),mentioned=new Set<number>(),sorted=stated.slice().sort((a,b)=>a.index-b.index);
 for(let i=0;i<sorted.length-1;i++){
  const a=sorted[i],b=sorted[i+1];
  if(!/^\d{4}-\d\d(?:-\d\d)?$/.test(a.value)||!/^\d{4}-\d\d(?:-\d\d)?$/.test(b.value)
   ||!/^\s*(?:至|到|~|～|—|－)\s*$/.test(sentence.slice(a.index+a.raw.length,b.index)))continue;
  mentioned.add(a.index);mentioned.add(b.index);
  // Keep a repeated month elsewhere in the same sentence outside this range.
  let left=0;for(const m of sentence.slice(0,a.index).matchAll(/[，,](?!\d{3}(?:\D|$))/g))left=(m.index??0)+1;
  const tail=sentence.slice(b.index+b.raw.length),right=tail.search(/[，,](?!\d{3}(?:\D|$))/);
  const scope=sentence.slice(left,b.index+b.raw.length+(right<0?tail.length:right));
  if(!positiveCumulativeMetric(scope))continue;
  const quarters=statedPeriods(scope).filter(p=>/^\d{4}-Q[1-4]$/.test(p.value));
  if(ranges.some(r=>quarters.every(q=>q.value===r.quarter)&&(a.value===r.start&&b.value===r.end||a.value===r.start.slice(0,7)&&b.value===r.end.slice(0,7)))){allowed.add(a.index);allowed.add(b.index);}
 }
 return {allowed,mentioned};
}
function positiveCumulativeMetric(scope:string){
 const basis=scope.replace(/(?:並非|不是|不代表|非)(?:單季|當季|單月|當月|每月|各月|逐月|每季|各季|逐季)/g,'');
 if(/(?:非|不是|不屬於|不代表|未提供|尚無)\s*累計|單季|當季|單月|當月|每月|各月|逐月|每季|各季|逐季/.test(basis))return false;
 return /累計(?:至本期止)?(?:基本)?(?:EPS|每股(?:盈餘|獲利|淨利)|(?:歸屬(?:於)?母公司業主|歸母)?淨利|營業(?:收入|利益|毛利))[^，,。；;\n（）()]{0,16}\d/i.test(basis)
  &&!/累計[^，,。；;\n]{0,24}(?:不明|未知|另列|另行|待核)/.test(basis);
}
function rejectCumulativeAsDiscrete(sentence:string,stated:ReturnType<typeof statedPeriods>,ranges:OfficialCumulativeRange[]){
 for(const {period:p,scope} of periodScopes(sentence,stated)){
  if(!ranges.some(r=>r.quarter===p.value)||!/(?:EPS|每股(?:盈餘|獲利|淨利)|淨利|營業利益)[^。！？!?；;\n]{0,24}\d/i.test(scope))continue;
  if(!positiveCumulativeMetric(scope))throw Error('AI_ANALYSIS_FINANCIAL_PERIOD');
 }
}
const guidanceWords=/展望|指引|預測|預估|預計|預期|將達|將為|可望達|\bforecast(?:ed|s)?\b|\bproject(?:ed|s)?\b|\bexpected\b/i;
const withoutNegatedActual=(text:string)=>text.replace(/(?:並非|而非|不是|不代表|不得視為|不可視為|不能視為|不應視為|不屬於|尚非|非)(?:已報|已實現|已達成)?(?:實績|實現|結果|營收)/g,'');
const withoutNegatedForecast=(text:string)=>text.replace(/(?:並非|不是|不代表|不得視為|不可視為|不能視為|不應視為|不屬於|非)(?:未來|任何|新的|對未來的)?(?:預測|預估|預計|預期)/g,'');
function periodScopes(sentence:string,stated:ReturnType<typeof statedPeriods>){
 const sorted=stated.slice().sort((a,b)=>a.index-b.index),starts=sorted.map((p,i)=>{
  if(i===0)return 0;
  const between=sentence.slice(sorted[i-1].index+sorted[i-1].raw.length,p.index);
  let boundary=-1;for(const m of between.matchAll(/[，,](?!\d{3}(?:\D|$))/g))boundary=m.index??-1;
  return boundary<0?p.index:sorted[i-1].index+sorted[i-1].raw.length+boundary+1;
 });
 return sorted.map((p,i)=>({period:p,scope:sentence.slice(starts[i],starts[i+1]??sentence.length)}));
}
/** Protect only commas inside a complete valid grouped numeric literal. */
function guidanceCommaClauses(scope:string){
 const normalized=scope.replace(/[０-９]/gu,c=>String(c.charCodeAt(0)-0xff10)),inside=new Set<number>();
 for(const token of normalized.matchAll(/(?<![0-9A-Za-z_.．\/+\-])[-+]?[0-9]{1,3}(?:[，,][0-9]{3})+(?:[.．][0-9]+)?(?![0-9])/gu)){
  for(const comma of token[0].matchAll(/[，,]/gu))inside.add((token.index??0)+(comma.index??0));
 }
 const clauses:string[]=[];let start=0;
 for(const comma of scope.matchAll(/[，,]/gu)){const at=comma.index??0;if(inside.has(at))continue;clauses.push(scope.slice(start,at));start=at+1;}
 clauses.push(scope.slice(start));return clauses;
}
function admitsGuidance(sentence:string,scope:string,value:string,sections:OfficialGuidanceSection[],packet:AnalysisPacket){
 const candidates=sections.filter(s=>s.period===value);if(!candidates.length||!guidanceWords.test(withoutNegatedForecast(scope)))return false;
 // A numerical financial comma-clause must identify its own guidance.
 // A later company-outlook clause cannot relabel an unqualified future figure.
 for(const clause of guidanceCommaClauses(scope)){
  let values=clause;for(const p of statedPeriods(clause))values=values.replaceAll(p.raw,'');
  const numeric=/[0-9０-９]/u.test(values)||/百分之[負正零〇一二三四五六七八九十百千萬億兩點点]+|[負正零〇一二三四五六七八九十百千萬億兩點点]+\s*(?:元|圓|塊|億|萬|倍)/u.test(values);
  if(numeric&&financialWords.test(values)&&!guidanceWords.test(withoutNegatedForecast(clause)))return false;
 }
 // Company attribution can span a coordinated sentence. The guidance marker
 // and actual/forecast distinction remain local to this particular period.
 let attribution=sentence;for(const p of statedPeriods(sentence))attribution=attribution.replaceAll(p.raw,'');
 const issuerNames=[packet.company,...candidates.map(s=>s.company)].filter(Boolean);
 if(!/(?:^|[，,。；;：:\s（(])(?:本公司|公司)/.test(attribution)&&!issuerNames.some(name=>attribution.includes(name)))return false;
 for(const m of attribution.matchAll(/(?:^|[，,；;：:\s（(])([\p{L}\p{N}]{2,20})公司/gu))if(!issuerNames.includes(m[1]))return false;
 if(/子公司|分析師|市場預(?:估|測)|法人預(?:估|測)|本研究|AI預(?:估|測)|我們預(?:估|測)/i.test(scope))return false;
 if(/實績|已報|已實現|已達成|已達|已錄得|已認列|已入帳|確定(?:為|是|達)|已兌現|實際(?:營收|毛利|獲利|達|已|結果)|結算結果|已完成/.test(withoutNegatedActual(scope)))return false;
 const rules=[
  {words:/營收|營業收入|\brevenue\b/i,label:'(?:合併)?(?:營收|營業收入)'},
  {words:/毛利率|\bgross margin\b/i,label:'(?:合併)?(?:營業)?毛利率'},
  {words:/毛利(?!率)|\bgross profit\b/i,label:'(?:合併)?(?:營業)?毛利(?:額|金額)?'},
  {words:/營業費用率|\boperating expense rate\b/i,label:'(?:合併)?營業費用率'},
  {words:/營業費用(?!率)|\boperating expense(?! rate)\b/i,label:'(?:合併)?營業費用(?:金額)?'},
  {words:/EPS|每股(?:盈餘|獲利|淨利)/i,label:'(?:合併)?(?:基本)?(?:EPS|每股(?:盈餘|獲利|淨利))'},
  {words:/淨利|本期獲利|\bnet income\b/i,label:'(?:合併)?(?:本期)?淨利'},
  {words:/資本支出|資本投資|\bcapex\b|\bcapital expenditure/i,label:'(?:合併)?(?:資本支出|資本投資|CAPEX)'},
  {words:/營業(?:利益|利潤|損失)|\boperating (?:profit|income|loss)\b/i,label:'(?:合併)?營業(?:利益|利潤|損失)'},
  {words:/股利|\bdividend\b/i,label:'(?:每股)?(?:現金)?股利'},
 ];
 let numbers=scope;for(const p of statedPeriods(scope))numbers=numbers.replaceAll(p.raw,'');
 const numeric=[...numbers.matchAll(/\d[\d,.，．]*/g)],mentions=[...numbers.matchAll(new RegExp(rules.map(rule=>rule.words.source).join('|')+'|'+financialWords.source,'gi'))];
 const claimed=rules.filter(rule=>rule.words.test(scope));
 if(numeric.length&&!claimed.length)return false;
 const quantified=numeric.flatMap(n=>{
  const distance=(m:RegExpMatchArray)=>Math.max(0,(n.index??0)-((m.index??0)+m[0].length),(m.index??0)-((n.index??0)+n[0].length));
  const nearest=mentions.slice().sort((a,b)=>distance(a)-distance(b)||(a.index??0)-(b.index??0))[0];return nearest?[nearest[0]]:[];
 });
 // Unknown numerical financial labels cannot pass via every([]). Dates alone
 // and qualitative overall guidance make no numerical metric assertion.
 if(quantified.some(word=>!rules.some(rule=>rule.words.test(word))))return false;
 return candidates.some(s=>claimed.every(rule=>new RegExp('^[ \\t]*'+rule.label+'[ \\t]*[:：][^\\n]*\\d','im').test(s.section)));
}

/** This is an evidence-period guard, not an accuracy score or a substitute for
 * the separate semantic review. Unknown citations remain the caller's error. */
export function validateStockAnalysisClaim(packet:AnalysisPacket,claim:CitedClaim):void{
 const ids=new Set(claim.evidence_ids),records=financialRecords(packet).filter(r=>ids.has(r.evidence_id));
 const newsActual=officialNewsActualPeriods(packet,ids),known=new Set([...records.flatMap(r=>r.period?[r.period]:[]),...newsActual]);
 const citedDailyValuation=records.some(r=>r.kind==='VALUATION_AS_REPORTED'),guidance=officialNewsGuidanceSections(packet,ids),ranges=officialNewsCumulativeRanges(packet,ids,newsActual);
 for(const sentence of claim.text.split(/[。！？!?；;\n]+/u)){
  if(!financialWords.test(sentence)&&!(citedDailyValuation&&valuationWords.test(sentence)))continue;
  const stated=statedPeriods(sentence),scopes=periodScopes(sentence,stated),admittedGuidance=new Set<number>();
  const cumulativeEndpoints=qualifiedCumulativeEndpoints(sentence,stated,ranges);rejectCumulativeAsDiscrete(sentence,stated,ranges);
  const datedValuationMonths=new Set(records.filter(r=>r.kind==='VALUATION_AS_REPORTED'&&r.period&&/^\d{4}-\d\d-\d\d$/.test(r.period)
   &&stated.some(p=>p.value===r.period)).map(r=>r.period!.slice(0,7)));
  for(const p of stated){
   // A calendar label is not a new reported month. Admit it only when the same
   // sentence names the cited valuation's exact day and labels it as valuation
   // observation data; monthly revenue and quarterly claims keep exact binding.
   const calendarLabel=citedDailyValuation&&month(p.value)&&/^\s*(?:的\s*)?估值(?:觀測日|觀察日|資料|快照)/u.test(sentence.slice(p.index+p.raw.length));
   if(calendarLabel){if(!datedValuationMonths.has(p.value))throw Error('AI_ANALYSIS_FINANCIAL_PERIOD');continue;}
   if(cumulativeEndpoints.allowed.has(p.index))continue;
   if(cumulativeEndpoints.mentioned.has(p.index)&&/累計|EPS|每股(?:盈餘|獲利|淨利)|淨利|營業利益/i.test(sentence))throw Error('AI_ANALYSIS_FINANCIAL_PERIOD');
   const scope=scopes.find(s=>s.period.index===p.index)?.scope??sentence;
   const unboundGuidance=/^\d{4}-Q[1-4]$/.test(p.value)&&guidanceWords.test(withoutNegatedForecast(scope))&&!known.has(p.value);
   const futureQuarter=/^\d{4}-Q[1-4]$/.test(p.value)&&Date.UTC(Number(p.value.slice(0,4)),Number(p.value.slice(-1))*3,1)-8*3600000>Date.parse(packet.cutoff);
   if(!known.has(p.value)&&(known.size||unboundGuidance||futureQuarter)){
    if(!admitsGuidance(sentence,scope,p.value,guidance,packet))throw Error('AI_ANALYSIS_FINANCIAL_PERIOD');
    admittedGuidance.add(p.index);
   }
  }
  let withoutPeriods=sentence;for(const p of stated)withoutPeriods=withoutPeriods.replaceAll(p.raw,'');
  const metricNumber=/[-+＋－]?\d[\d,.，．]*(?:\s*)(?:%|％|元|圓|塊|億|萬|千|百萬|倍)/u.test(withoutPeriods)
   ||/百分之[負正零〇一二三四五六七八九十百千萬億兩點点]+|[負正零〇一二三四五六七八九十百千萬億兩點点]+\s*(?:元|圓|塊|億|萬|倍)/u.test(withoutPeriods)
   ||citedDailyValuation&&/(?:本益比|股價淨值比|股價盈餘比|殖利率|估值|\bP\/?E(?:R)?|\bP\/?B(?:R)?|\bdividend yield\b|\bvaluation\b)[^。！？!?；;\n\d]{0,16}[-+＋－]?\d/i.test(withoutPeriods)
   ||/(?:營收|收入|EPS|每股(?:盈餘|獲利|淨利)|毛利率?|淨利率?|獲利|年增|月增|季增|\brevenue\b|\bmargin\b|\bcapex\b|\bprofit\b|\bincome\b)[^。！？!?；;\n\d]{0,16}[-+＋－]?\d/i.test(withoutPeriods);
  if(metricNumber&&(!stated.length||records.length>0&&!known.size))throw Error('AI_ANALYSIS_FINANCIAL_PERIOD');
  const forecastText=withoutNegatedForecast(sentence);
  if((records.length||newsActual.size)&&stated.length&&forecastWords.test(forecastText)){
   if(!admittedGuidance.size||scopes.some(s=>!admittedGuidance.has(s.period.index)&&forecastWords.test(withoutNegatedForecast(s.scope))))throw Error('AI_ANALYSIS_REPORTED_FACT_AS_FORECAST');
  }
 }
}

/** Conditions describe observable events, not numeric trading levels. Dates and
 * numeric facts belong in the evidence-grounded reason or limitations instead. */
export function validateStockAnalysisCondition(text:string):void{
 const chineseNumber='[零〇○一二三四五六七八九十百千萬億兩壹貳參肆伍陸柒捌玖拾佰仟點点半]+';
 if(/[0-9０-９]/u.test(text)||new RegExp(chineseNumber+'\\s*(?:元|塊|圓|角|分)','u').test(text)
  ||new RegExp('(?:上看|站上|守住|跌破|突破|回測|支撐|壓力|停損|目標價|價位)\\s*'+chineseNumber,'u').test(text))throw Error('AI_ANALYSIS_CONDITION_PRICE');
}

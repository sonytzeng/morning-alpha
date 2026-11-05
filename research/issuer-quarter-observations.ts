/** Offline observations from issuer PDF tables. This does not grant source rights,
 * approve a research method, or write a prediction/publication. The file loader
 * binds these extracted pages to the retained PDF bytes before calling here. */
import {snapshotHash,validObservationTime,compareTime,hashValid} from '../src/features/vnext/contracts.ts';
import {traceIssues,type FunnelInput} from '../src/features/vnext/researchFunnel.ts';
import type {StockFact} from '../src/features/vnext/stockResearch.ts';

export type IssuerDocument={symbol:'2454'|'2379';period:string;format:'MEDIATEK_STATEMENTS'|'MEDIATEK_RELEASE'|'REALTEK_STATEMENTS';
 source:string;sha256:string;bytes:number;received_at:string;text:string};
export type IssuerObservation=StockFact&{source_sha256:string;source_bytes:number;source_locator:{page:number;column:string;row:string};
 source_admitted:false;member_publication_approved:false};
const compact=(s:string)=>s.replace(/\s+/g,' ').trim();
const realtekSources:Record<string,string>={
 '2025-Q2':'Final_.2025.FS.AllReport.ENG.IFRS.pdf',
 '2025-Q3':'_.2025.FS.AllReport.CHT.IFRS.pdf',
 '2026-Q1':'_.2026.FS.AllReport.ENG.IFRS.pdf',
 '2026-Q2':'_.2026.FS.AllReport.ENG.IFRS.20260630.pdf',
};
const fail=():never=>{throw Error('ISSUER_QUARTER_DOCUMENT_INVALID');};
const one=(text:string,pattern:RegExp)=>{const matches=[...text.matchAll(pattern)];if(matches.length!==1)fail();return matches[0];};
const amount=(s:string)=>{const n=Number(s.replaceAll(',',''));if(!Number.isFinite(n))fail();return n;};

export async function parseIssuerQuarterText(d:IssuerDocument,cutoff:string):Promise<IssuerObservation[]>{
 const match=/^(20\d\d)-Q([1-4])$/.exec(d.period);if(!match)fail();
 const year=Number(match![1]),q=Number(match![2]),priorQ=q===1?4:q-1,priorY=q===1?year-1:year;
 const end=new Date(Date.UTC(year,q*3,0)).toISOString().slice(0,10)+'T23:59:59+08:00';
 if(!validObservationTime(cutoff)||!validObservationTime(d.received_at)||compareTime(d.received_at,end)<0
  ||compareTime(d.received_at,cutoff)>0||!hashValid(d.sha256)||!Number.isSafeInteger(d.bytes)||d.bytes<1||d.bytes>8_000_000
  ||typeof d.text!=='string'||d.text.length>8_000_000)fail();
 const expected=d.symbol==='2454'&&['MEDIATEK_STATEMENTS','MEDIATEK_RELEASE'].includes(d.format)
  ?`https://www.mediatek.com/hubfs/MediaTek%20Assets/Pdfs/Quarterly%20Earnings%20Release/${year}/Quarterly%20Earnings%20Release-${year}Q${q}/${d.format==='MEDIATEK_STATEMENTS'?'Financial%20Statements':'Press%20Release'}.pdf`
  :d.symbol==='2379'&&d.format==='REALTEK_STATEMENTS'&&realtekSources[d.period]
   ?'https://www.realtek.com/images/cqfs/'+realtekSources[d.period]:null;
 if(!expected||d.source!==expected)fail();
 const pages=d.text.split('\f'),facts:IssuerObservation[]=[];
 const add=async(kind:string,value:number,unit:string,measurement_basis:string,page:number,row:string,reported_decimal:string)=>{
  const body={symbol:d.symbol,kind,period:d.period,basis:'SINGLE_QUARTER',source:d.source,published_at:null,
   first_seen_at:d.received_at,available_at:d.received_at,as_of:end,source_sha256:d.sha256,source_bytes:d.bytes,
   source_locator:{page,column:'CURRENT_YEAR_THREE_MONTH_PERIOD',row},source_admitted:false as const,member_publication_approved:false as const,
   data_quality_status:'ISSUER_ORIGINAL_OBSERVATION_PUBLICATION_TIME_AND_RIGHTS_UNVERIFIED',
   values:{value,unit,measurement_basis,reported_decimal,consolidation:'CONSOLIDATED'}};
  facts.push({...body,id:`issuer-quarter:${d.symbol}:${d.period}:${kind}:${d.sha256}`,evidence_hash:await snapshotHash(body)});
 };
 if(d.format==='MEDIATEK_STATEMENTS'){
  const page=compact(pages[0]),word=['','First','Second','Third','Fourth'][q];
  if(!page.includes('MEDIATEK INC. AND SUBSIDIARIES CONSOLIDATED STATEMENTS OF COMPREHENSIVE INCOME')
   ||!page.includes(`For the ${word} quarter of year ${year}`)||!page.includes('Unit: Millions of New Taiwan dollars')
   ||!page.includes(`${q}Q ${year} ${q}Q ${year-1} YoY% ${q}Q ${year} ${priorQ}Q ${priorY} QoQ%`))fail();
  const eps=one(page,/Basic Earnings Per Share \(NTD\)\s+(-?\d+\.\d{2})\s+(-?\d+\.\d{2})\s+(-?\d+\.\d{2})\s+(-?\d+\.\d{2})(?=\s|$)/g);
  if(eps[1]!==eps[3])fail();
  await add('EPS',amount(eps[1]),'TWD_PER_COMMON_SHARE','BASIC',1,'Basic Earnings Per Share (NTD)',eps[1]);
 }else if(d.format==='MEDIATEK_RELEASE'){
  const column=`${q}Q${String(year).slice(-2)} ${priorQ}Q${String(priorY).slice(-2)} ${q}Q${String(year-1).slice(-2)}`;
  const tables=pages.map((p,i)=>({page:i+1,text:compact(p)})).filter(p=>p.text.includes('Taiwan-International Financial Reporting Standards (TIFRS)')
   &&p.text.includes(`Consolidated Income Statement (Percentage of Revenue) ${column} Gross profit`));
  if(tables.length!==1)fail();const table=tables[0];
  const section=table.text.split('Consolidated Income Statement (Percentage of Revenue) ')[1];
  const margin=one(section,/Gross profit\s+(\d+\.\d)%\s+(\d+\.\d)%\s+(\d+\.\d)%/g);
  if(amount(margin[1])>100)fail();
  await add('MARGIN',amount(margin[1]),'PERCENT','DIRECTLY_REPORTED_GROSS_MARGIN',table.page,'Gross profit, Percentage of Revenue',margin[1]);
 }else{
  const month=['','MARCH 31','JUNE 30','SEPTEMBER 30','DECEMBER 31'][q],span=q===1?'THREE-MONTH':q===2?'THREE-MONTH AND SIX-MONTH':'THREE-MONTH AND NINE-MONTH';
  const tables=pages.map((p,i)=>({page:i+1,text:compact(p)})).filter(p=>p.text.includes('9750 Basic earnings per share')&&p.text.includes('9850 Diluted earnings per share'));
  if(tables.length!==1)fail();const table=tables[0],p=table.text.replace(/\b(Three|Six|Nine) months ended /g,'$1-month periods ended ');
  if(!p.includes('REALTEK SEMICONDUCTOR CORPORATION AND SUBSIDIARIES CONSOLIDATED STATEMENTS OF COMPREHENSIVE INCOME')
   ||!p.includes(`FOR THE ${span} PERIODS ENDED ${month}, ${year} AND ${year-1}`)
   ||!p.includes('Expressed in thousands of New Taiwan dollars, except for earnings per share')
   ||!p.includes(`Three-month periods ended ${month[0]+month.slice(1).toLowerCase()} ${q===1?'':`${q===2?'Six':'Nine'}-month periods ended ${month[0]+month.slice(1).toLowerCase()} `}${year} ${year-1}${q===1?'':` ${year} ${year-1}`} Items`))fail();
  const basis=one(p,/9750 Basic earnings per share\s+6\(29\)\s+\$\s+(-?\d+\.\d{2})(?=\s|$)/g);
  const diluted=one(p,/9850 Diluted earnings per share\s+6\(29\)\s+\$\s+(-?\d+\.\d{2})(?=\s|$)/g);
  await add('EPS',amount(diluted[1]),'TWD_PER_COMMON_SHARE','DILUTED',table.page,'9850 Diluted earnings per share',diluted[1]);
  await add('EPS_BASIC_CONTEXT',amount(basis[1]),'TWD_PER_COMMON_SHARE','BASIC',table.page,'9750 Basic earnings per share',basis[1]);
 }
 return facts;
}

/** An append-only new study, not a replacement for an existing source revision.
 * Missing quarters and CapEx remain missing. No cumulative subtraction occurs. */
export function withIssuerQuarterObservations(input:FunnelInput,observations:IssuerObservation[]):FunnelInput{
 const selected=observations.filter(f=>f.symbol===input.symbol),keys=selected.map(f=>f.kind+':'+f.period);
 if(new Set(keys).size!==keys.length||selected.some(f=>traceIssues(f,input.cutoff).length||f.source_admitted!==false||f.member_publication_approved!==false)
  ||input.facts.some(f=>keys.includes(f.kind+':'+f.period)))throw Error('ISSUER_QUARTER_MERGE_CONFLICT');
 const result={...structuredClone(input),facts:[...structuredClone(input.facts),...structuredClone(selected)]};
 const eps=result.facts.filter(f=>f.kind==='EPS'&&f.basis==='SINGLE_QUARTER');
 if(selected.some(f=>f.kind==='EPS')&&(eps.some(f=>f.values.unit!=='TWD_PER_COMMON_SHARE'||!['BASIC','DILUTED'].includes(String(f.values.measurement_basis)))
  ||new Set(eps.map(f=>f.values.measurement_basis)).size!==1))throw Error('ISSUER_EPS_MEASUREMENT_MISMATCH');
 return result;
}

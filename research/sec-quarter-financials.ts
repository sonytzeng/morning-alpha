/** Actual SEC exhibit observations, parsed offline from freshly retained bytes.
 * Never substitutes an issuer-site URL, differences cumulative EPS, converts
 * ADR earnings, admits a source or publishes a recommendation. */
import {snapshotHash,validObservationTime} from '../src/features/vnext/contracts.ts';
import {traceIssues,type FunnelInput} from '../src/features/vnext/researchFunnel.ts';
import type {StockFact} from '../src/features/vnext/stockResearch.ts';

export type SecQuarterDocument={period:string;kind:'release'|'presentation';url:string;bytes:number;sha256:string;received_at:string;body:string};
export type SecQuarterFact=StockFact&{source_sha256:string;source_bytes:number;
 source_locator:{accession:string;section:string;column:string;row:string};source_admitted:false;member_publication_approved:false};
const fail=():never=>{throw Error('SEC_QUARTER_SOURCE_INVALID');};
const digest=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
const number=(s:string)=>{const n=Number(s.replaceAll(',',''));if(!Number.isFinite(n)||n<0)fail();return n;};
const one=(s:string,r:RegExp)=>{const matches=[...s.matchAll(r)];if(matches.length!==1)fail();return matches[0];};
const quarter=(p:string)=>{const m=/^(20\d{2})-Q([1-4])$/.exec(p);if(!m)fail();
 const year=Number(m![1]),q=Number(m![2]);return {year,q,label:q+'Q'+String(year).slice(-2),
  end:new Date(Date.UTC(year,q*3,0)).toISOString().slice(0,10),
  word:['','first','second','third','fourth'][q],month:['','March','June','September','December'][q]};};
function text(html:string){
 return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
  .replace(/<!--[^]*?-->/g,' ').replace(/<[^>]+>/g,' ')
  .replace(/&(?:nbsp|amp|lt|gt|quot|apos|#39|#x27);/gi,s=>({'&nbsp;':' ','&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&#39;':"'",'&#x27;':"'"}[s.toLowerCase()]??s))
  .replace(/&#(?:x([0-9a-f]+)|(\d+));/gi,(_,h,d)=>{const n=parseInt(h??d,h?16:10);return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):' ';})
  .replace(/\s+/g,' ').trim();
}
async function verify(d:SecQuarterDocument,kind:SecQuarterDocument['kind'],cutoff:string){
 const q=quarter(d.period),url=new URL(d.url);
 const path=/^\/Archives\/edgar\/data\/1046179\/(0001046179\d{8})\/([^/]+\.htm)$/.exec(url.pathname);
 const file=kind==='release'?`a${q.q}q${String(q.year).slice(-2)}e_withguidancexfinal.htm`:`a${q.q}q${String(q.year).slice(-2)}presentatione.htm`;
 if(d.kind!==kind||url.protocol!=='https:'||url.hostname!=='www.sec.gov'||url.port||url.username||url.password||url.search||url.hash
  ||!path||path[2]!==file||!validObservationTime(cutoff)||!validObservationTime(d.received_at)
  ||Date.parse(d.received_at)>Date.parse(cutoff)||Date.parse(d.received_at)<Date.parse(q.end+'T23:59:59+08:00')
  ||typeof d.body!=='string'||!Number.isSafeInteger(d.bytes)||d.bytes<1||d.bytes>2000000
  ||new TextEncoder().encode(d.body).length!==d.bytes||await digest(d.body)!==d.sha256)fail();
 const content=text(d.body);
 if(!content.includes(kind==='release'?'EX-99.1':'EX-99.2'))fail();
 return {...q,content,accession:path![1]};
}

export async function parseSecQuarterFinancials(release:SecQuarterDocument,presentation:SecQuarterDocument,cutoff:string):Promise<SecQuarterFact[]>{
 if(release.period!==presentation.period)fail();
 const [r,p]=await Promise.all([verify(release,'release',cutoff),verify(presentation,'presentation',cutoff)]);
 if(r.accession!==p.accession||!r.content.includes('TSMC (TWSE: 2330, NYSE: TSM)')
  ||!r.content.includes(`for the ${r.word} quarter ended ${r.month} ${Number(r.end.slice(-2))}, ${r.year}.`)
  ||!r.content.includes('All figures were prepared in accordance with TIFRS on a consolidated basis.'))fail();
 const eps=one(r.content,/diluted earnings per share of NT\$(\d+\.\d{2}) \(US\$\d+\.\d{2} per ADR unit\)/g);
 const margins=one(r.content,/Gross margin for the quarter was (\d+\.\d)%, operating margin was (\d+\.\d)%, and net profit margin was (\d+\.\d)%/g);
 if([margins[1],margins[2],margins[3]].some(n=>number(n)>100))fail();
 const previous=r.q===1?'4Q'+String(r.year-1).slice(-2):(r.q-1)+'Q'+String(r.year).slice(-2);
 const columns=`${r.label} ${previous} ${r.q}Q${String(r.year-1).slice(-2)}`;
 const marker='Cash Flows * Free cash flow = Cash from operating activities';
 const sections=p.content.split(marker);if(sections.length!==2)fail();
 const flow=sections[1].split('Guidance')[0];
 if(!flow.includes('(In NT$ billions) '+columns+' Beginning Balance'))fail();
 const operating=one(flow,/Cash from operating activities ([\d,]+\.\d{2}) [\d,]+\.\d{2} [\d,]+\.\d{2}/g);
 const capex=one(flow,/Capital expenditures \(([\d,]+\.\d{2})\) \([\d,]+\.\d{2}\) \([\d,]+\.\d{2}\)/g);
 const free=one(flow,/Free Cash Flow \* ([\d,]+\.\d{2}) [\d,]+\.\d{2} [\d,]+\.\d{2}/g);
 if(Math.abs(number(operating[1])-number(capex[1])-number(free[1]))>.011)fail();
 const result:SecQuarterFact[]=[];
 const add=async(kind:string,values:SecQuarterFact['values'],d:SecQuarterDocument,row:string,section:string)=>{
  const body={symbol:'2330',kind,period:d.period,basis:'SINGLE_QUARTER',values:{...values,
    assurance:'ISSUER_DISCLOSURE_NOT_ASSERTED_AUDITED',
    board_approval_at_release:r.content.includes(`${r.q}Q${r.year} figures have not been approved by Board of Directors`)?'NOT_APPROVED':'NOT_ESTABLISHED',
    subsequent_revision_review:'NOT_PERFORMED'},source:d.url,published_at:null,
   first_seen_at:d.received_at,available_at:d.received_at,as_of:r.end+'T23:59:59+08:00',source_sha256:d.sha256,source_bytes:d.bytes,
   source_locator:{accession:r.accession,section,column:r.label,row},source_admitted:false as const,member_publication_approved:false as const,
   data_quality_status:'SEC_FILING_DIRECT_SINGLE_QUARTER_OBSERVED_AFTER_RECEIPT_PUBLICATION_TIME_NOT_INFERRED'};
  result.push({...body,id:`sec-quarter:2330:${d.period}:${kind}:${d.sha256}`,evidence_hash:await snapshotHash(body)});
 };
 await add('EPS',{value:number(eps[1]),unit:'TWD_PER_COMMON_SHARE',measurement_basis:'DILUTED',reported_decimal:eps[1],consolidation:'CONSOLIDATED'},release,'diluted earnings per share of NT$','Quarterly reported results');
 await add('MARGIN',{value:number(margins[1]),unit:'PERCENT',measurement_basis:'DIRECTLY_REPORTED_GROSS_MARGIN',reported_decimal:margins[1],operating_margin_percent:number(margins[2]),net_margin_percent:number(margins[3])},release,'Gross margin for the quarter','Quarterly reported results');
 await add('CAPEX',{value:number(capex[1])*1e9,unit:'TWD',reported_decimal_billion:capex[1],measurement_basis:'DIRECTLY_REPORTED_QUARTER_CAPITAL_EXPENDITURES',
  cashflow_sign:'OUTFLOW_POSITIVE_MAGNITUDE',operating_cashflow_twd:number(operating[1])*1e9,free_cashflow_twd:number(free[1])*1e9,
  amount_resolution_twd:10000000,amount_precision:'ROUNDED_DISCLOSED_BILLIONS_NOT_EXACT_UNDERLYING_YUAN'},presentation,'Capital expenditures; Cash from operating activities; Free Cash Flow','Cash Flows');
 return result;
}

/** Add source-bound actuals to a fresh input; never overwrite prior observations
 * or grant their use. The existing packet builder and research gates still run. */
export async function withSecQuarterFinancials(input:FunnelInput,facts:SecQuarterFact[]):Promise<FunnelInput>{
 const selected=facts.filter(f=>f.symbol===input.symbol);
 const keys=selected.map(f=>f.kind+':'+f.period);
 if(new Set(keys).size!==keys.length||input.facts.some(f=>keys.includes(f.kind+':'+f.period))
  ||selected.some(f=>f.source_admitted!==false||f.member_publication_approved!==false||traceIssues(f,input.cutoff).length))throw Error('SEC_QUARTER_MERGE_CONFLICT');
 for(const fact of selected){const {id,evidence_hash,...body}=fact;
  if(evidence_hash!==await snapshotHash(body)||id!==`sec-quarter:2330:${fact.period}:${fact.kind}:${fact.source_sha256}`)throw Error('SEC_QUARTER_FACT_DRIFT');}
 return {...structuredClone(input),facts:[...structuredClone(input.facts),...structuredClone(selected)]};
}

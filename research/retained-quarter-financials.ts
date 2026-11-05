/** Offline Owner research adapter for four already-retained issuer originals.
 * No acquisition, old-snapshot mutation, source admission or publication. */
import {snapshotHash,validObservationTime,compareTime,hashValid,sourceSafe} from '../src/features/vnext/contracts.ts';
import type {FunnelInput} from '../src/features/vnext/researchFunnel.ts';
import type {StockDossier,StockFact} from '../src/features/vnext/stockResearch.ts';

/** Reviewed public source identities only; no issuer financial values. */
export const RETAINED_QUARTER_SOURCE_IDENTITIES=[
 {
  "period": "2025-Q4",
  "url": "https://investor.tsmc.com/english/encrypt/files/encrypt_file/reports/2026-01/00fe50f72b38d74e6b9b066398f020f337cd4e9d/4Q25%20Management%20Report.pdf",
  "sha256": "cbd5645aed3df57a59beb942110ec251a45c6407c401f8813cff4942e4503e35",
  "bytes": 4986716
 },
 {
  "period": "2026-Q1",
  "url": "https://investor.tsmc.com/english/encrypt/files/encrypt_file/reports/2026-04/5508a9df8981f587c73dbfaf9f577f142e22bbb1/1Q26ManagementReport.pdf",
  "sha256": "4878487acab931ea06635a8bb97cbb9dcf14e2140d4c480667298ca1c43e8bdc",
  "bytes": 4653875
 },
 {
  "period": "2026-Q2",
  "url": "https://investor.tsmc.com/english/encrypt/files/encrypt_file/reports/2026-07/6f49632674bd2d0fd48cb65aaf89ec6ab510b559/2Q26%20ManagementReport.pdf",
  "sha256": "fad79c6a6ec870357df9eae00e680256956e34083ec84a226959c693eccb1a5f",
  "bytes": 4645787
 },
 {
  "period": "2026-Q3",
  "url": "https://investor.tsmc.com/english/encrypt/files/encrypt_file/reports/2026-10/f83780000ddc0c3b48e57a87eab6814c4ab35058/3Q26%20ManagementReport.pdf",
  "sha256": "27b5b92d05207bf662756edfbe72494c5f34a007a79306ae040d957886b411d2",
  "bytes": 468113
 }
] as const;
export type QuarterFinancialPack={schema:string;symbol:string;created_at:string;supported_as_of_dates:{from:string;through:string};
 source_review_sha256:string;source_quality_review_sha256:string;source_admitted:false;member_publication_approved:false;methodology_promoted:false;forward_sample:0;outcome_sample:0;
 rows:{symbol:string;period:string;period_start:string;period_end:string;basis:string;consolidation:string;
  eps:{reported_decimal:string;unit:string;basis:string;page:number;locator:string};
  margin:{reported_decimal:string;unit:string;basis:string;page:number;locator:string;gross_profit_twd_billion:string;revenue_twd_billion:string;ratio_recomputed:boolean};
  capex:{reported_signed_decimal_twd_billion:string;reported_unit:string;cashflow_sign:string;measurement:string;positive_value_semantics:string;page:number;locator:string};
  source:{url:string;sha256:string;bytes:number;received_at:string;first_seen_at:string;date_label:string;published_at:null;original_version:null;revision_chain:null}}[];
 counterevidence:unknown[];missing_documented_reviews:string[]};
/** Supplied by the trusted offline operator from a separately sealed private
 * source review. This is an integrity binding, never publication permission. */
export type QuarterFinancialSeal={schema:'RETAINED_QUARTER_FINANCIAL_SOURCE_SEAL_V1';source_pack_sha256:string};
const day=(at:string)=>new Date(Date.parse(at)+8*3600000).toISOString().slice(0,10);

/** The separately sealed digest binds the source bytes/receipts, quarter columns, common-share
 * diluted EPS, reported margin, and the signed TWD CapEx line independently of
 * any later caller. The hash proves integrity against that offline review, not source admission. */
export async function retainedQuarterFinancialFacts(cutoff:string,pack:QuarterFinancialPack,seal:QuarterFinancialSeal):Promise<StockFact[]>{
 if(!validObservationTime(cutoff)||seal?.schema!=='RETAINED_QUARTER_FINANCIAL_SOURCE_SEAL_V1'||!hashValid(seal.source_pack_sha256)
  ||await snapshotHash(pack)!==seal.source_pack_sha256||pack.schema!=='RETAINED_2330_DIRECT_QUARTER_FINANCIAL_FAMILIES_V1'
  ||pack.symbol!=='2330'||pack.rows.length!==4||pack.source_admitted!==false||pack.member_publication_approved!==false
  ||pack.methodology_promoted!==false||pack.forward_sample!==0||pack.outcome_sample!==0||!validObservationTime(pack.created_at)
  ||!hashValid(pack.source_review_sha256)||!hashValid(pack.source_quality_review_sha256))throw Error('RETAINED_FINANCIAL_SOURCE_INVALID');
 const periods=['2025-Q4','2026-Q1','2026-Q2','2026-Q3'];
 for(const [i,row] of pack.rows.entries()){
  const quarter=Number(periods[i].slice(-1)),year=Number(periods[i].slice(0,4)),identity=RETAINED_QUARTER_SOURCE_IDENTITIES[i];
  const start=new Date(Date.UTC(year,(quarter-1)*3,1)).toISOString().slice(0,10),end=new Date(Date.UTC(year,quarter*3,0)).toISOString().slice(0,10);
  if(row.source.url!==identity.url||row.source.sha256!==identity.sha256||row.source.bytes!==identity.bytes
   ||row.symbol!=='2330'||row.period!==periods[i]||row.period_start!==start||row.period_end!==end||row.basis!=='DIRECT_STANDALONE_QUARTER'
   ||row.consolidation!=='CONSOLIDATED'||row.eps.unit!=='TWD_PER_COMMON_SHARE'||row.eps.basis!=='DILUTED'||!/^[-]?\d+\.\d{2}$/.test(row.eps.reported_decimal)||!Number.isFinite(Number(row.eps.reported_decimal))
   ||row.margin.unit!=='PERCENT'||row.margin.basis!=='DIRECTLY_REPORTED_GROSS_MARGIN'||row.margin.ratio_recomputed!==false||!/^\d+\.\d$/.test(row.margin.reported_decimal)
   ||Number(row.margin.reported_decimal)>100||!/^[-]\d+\.\d{2}$/.test(row.capex.reported_signed_decimal_twd_billion)
   ||row.capex.reported_unit!=='TWD_BILLION'||row.capex.cashflow_sign!=='OUTFLOW_IN_PARENTHESES'||row.capex.measurement!=='CONSOLIDATED_QUARTERLY_CAPITAL_EXPENDITURES'
   ||row.capex.positive_value_semantics!=='EXPENDITURE_MAGNITUDE_NOT_CASH_INFLOW'||row.eps.page!==1||row.margin.page!==1||row.capex.page!==5
   ||!row.eps.locator||!row.margin.locator||!row.capex.locator||!sourceSafe(row.source.url)||!hashValid(row.source.sha256)
   ||!Number.isSafeInteger(row.source.bytes)||row.source.bytes<1||row.source.bytes>8_000_000||row.source.published_at!==null
   ||row.source.original_version!==null||row.source.revision_chain!==null||!validObservationTime(row.source.received_at)||!validObservationTime(row.source.first_seen_at)
   ||compareTime(row.source.first_seen_at,row.source.received_at)!==0||compareTime(row.source.received_at,pack.created_at)>0
   ||compareTime(row.source.received_at,end+'T23:59:59+08:00')<0)throw Error('RETAINED_FINANCIAL_SOURCE_INVALID');
 }
 if(compareTime(cutoff,pack.created_at)<0||day(cutoff)<pack.supported_as_of_dates.from||day(cutoff)>pack.supported_as_of_dates.through)throw Error('RETAINED_FINANCIAL_CUTOFF_INVALID');
 const result:StockFact[]=[];
 for(const row of pack.rows){
  const [whole,fraction]=row.capex.reported_signed_decimal_twd_billion.slice(1).split('.');
  const capex=Number(whole)*1_000_000_000+Number(fraction)*10_000_000;
  if(!Number.isSafeInteger(capex))throw Error('RETAINED_FINANCIAL_SOURCE_INVALID');
  const common={symbol:row.symbol,period:row.period,basis:'SINGLE_QUARTER',source:row.source.url,
   published_at:null,first_seen_at:row.source.first_seen_at,available_at:pack.created_at,
   as_of:row.period_end+'T23:59:59+08:00',data_quality_status:'DIRECT_ISSUER_QUARTER_OBSERVED_AFTER_RECEIPT_PUBLICATION_TIME_UNKNOWN',
   source_pack_sha256:seal.source_pack_sha256,source_sha256:row.source.sha256,source_bytes:row.source.bytes,
   source_received_at:row.source.received_at,consolidation:row.consolidation,source_admitted:false,member_publication_approved:false};
  const metrics=[
   {kind:'EPS',value:Number(row.eps.reported_decimal),unit:row.eps.unit,measurement_basis:row.eps.basis,page:row.eps.page,locator:row.eps.locator,reported_decimal:row.eps.reported_decimal},
   {kind:'MARGIN',value:Number(row.margin.reported_decimal),unit:row.margin.unit,measurement_basis:row.margin.basis,page:row.margin.page,locator:row.margin.locator,reported_decimal:row.margin.reported_decimal},
   // Only this exact reviewed negative cash-use field is converted to a named
   // expenditure magnitude. Never abs(net investing cash flow) or generic cash.
   {kind:'CAPEX',value:capex,unit:'TWD',measurement_basis:row.capex.positive_value_semantics,page:row.capex.page,locator:row.capex.locator,
    reported_decimal:row.capex.reported_signed_decimal_twd_billion,signed_cashflow_twd:-capex,reported_unit:row.capex.reported_unit},
  ];
  for(const metric of metrics){
   const body={...common,kind:metric.kind,values:{value:metric.value,unit:metric.unit,measurement_basis:metric.measurement_basis,
    reported_decimal:metric.reported_decimal,...('signed_cashflow_twd' in metric?{signed_cashflow_twd:metric.signed_cashflow_twd!,reported_unit:metric.reported_unit!}:{})},
    source_locator:{page:metric.page,table_column:'CURRENT_QUARTER',locator:metric.locator}};
   result.push({...body,id:`retained-financial:${row.symbol}:${row.period}:${metric.kind}:${seal.source_pack_sha256}`,evidence_hash:await snapshotHash(body)});
  }
 }
 return result;
}

/** A new retained-snapshot study chooses the directly reported financial
 * series. Earlier unproven cumulative EPS remains returned as source context;
 * it is neither overwritten nor joined to the diluted single-quarter series. */
export async function withRetainedQuarterFinancials(input:FunnelInput,pack:QuarterFinancialPack,seal:QuarterFinancialSeal){
 const facts=(await retainedQuarterFinancialFacts(input.cutoff,pack,seal)).filter(f=>f.symbol===input.symbol);
 if(!facts.length)return {input:structuredClone(input),retained_context:[] as FunnelInput['facts']};
 const keys=new Set(facts.map(f=>f.kind+':'+f.period)),context=input.facts.filter(f=>keys.has(f.kind+':'+f.period));
 if(context.some(f=>f.basis==='SINGLE_QUARTER'))throw Error('RETAINED_FINANCIAL_EXISTING_SERIES_CONFLICT');
 return {input:{...structuredClone(input),facts:[...structuredClone(input.facts.filter(f=>!keys.has(f.kind+':'+f.period))),...facts]},retained_context:structuredClone(context)};
}

/** The original generic dossier keeps its prior behavior. Only this separately
 * sealed 12-fact study closes the exact financial gap in its private projection. */
export async function retainedQuarterFinancialDossier(dossier:StockDossier,input:FunnelInput,pack:QuarterFinancialPack,seal:QuarterFinancialSeal):Promise<StockDossier>{
 const facts=(await retainedQuarterFinancialFacts(input.cutoff,pack,seal)).filter(f=>f.symbol===input.symbol);
 if(!facts.length)return structuredClone(dossier);
 for(const fact of facts){const matches=input.facts.filter(f=>f.id===fact.id);if(matches.length!==1||await snapshotHash(matches[0])!==await snapshotHash(fact))throw Error('RETAINED_FINANCIAL_DOSSIER_INPUT_MISMATCH');}
 const legacy='累計EPS不能直接相減當成單季EPS；投資現金流不能冒充資本支出。需求、競爭優勢與估值仍未得到完整驗證。';
 return {...structuredClone(dossier),coverage:{...dossier.coverage,comparable_eps_quarters:4,capex_quarters:4},
  supporting:[...dossier.supporting,'另有四季直接單季稀釋普通股EPS、公告毛利率與明列資本支出；均來自同季合併管理報告。'],
  opposing:[...dossier.opposing.filter(s=>s!==legacy),'直接單季財務不代表需求、競爭優勢或估值已驗證；仍須查核獲利中的非經常性項目與資本支出風險。'],
  data_gaps:dossier.data_gaps.filter(s=>s!=='可比較單季EPS與資本支出不足'),
  sources:[...dossier.sources,...facts.map(f=>({kind:f.kind,source:f.source,published_at:f.published_at,first_seen_at:f.first_seen_at,available_at:f.available_at,as_of:f.as_of,evidence_hash:f.evidence_hash}))]};
}

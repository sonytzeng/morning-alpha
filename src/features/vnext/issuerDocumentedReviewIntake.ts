/** Server-only private computation from a freshly inspected policy packet.
 * reviewed_at is the actual source/policy review; evaluated_at is each new
 * arithmetic run. Neither timestamp grants investment quality or publication. */
import {snapshotHash,validObservationTime,hashValid,compareTime} from './contracts.ts';
import {traceIssues,type ResearchFact} from './researchFunnel.ts';
import type {AcquiredResearch} from './dailyIntelligence.ts';
export type IssuerDocumentedReviewPacket={schema:'PRIVATE_2330_REVIEW_POLICY_V1';symbol:'2330';reviewed_at:string;expires_at:string;max_age_days:7;
 policy_id:string;source_study_sha256:string;financial_reference:ResearchFact[];
 reviews:{kind:'DEMAND'|'MOAT';source:string;source_sha256:string;source_bytes:number;analysis_zh:string;counter_evidence_zh:string}[];
 source_documents:{period:string;kind:string;url:string;sha256:string;bytes:number;received_at:string;http:number}[];
 scenarios:{name:string;g_H:number;R_H:number;r:number;g_T:number;R_T:number;model_value_twd:number;discount_25_threshold_twd:number;terminal_fraction:number}[];
 source_admitted:false;member_publication_approved:false;methodology_promoted:false};
export type IssuerDocumentedReviewBinding={packet:IssuerDocumentedReviewPacket;expectedHash:string};
const fail=(code:string):never=>{throw Error('ISSUER_REVIEW_'+code);};
const valid=(ok:unknown,code:string)=>{if(!ok)fail(code);};
const day=(at:string)=>new Date(Date.parse(at)+8*3600000).toISOString().slice(0,10);
const financialKinds=['EPS','MARGIN','CAPEX'];
const order=(a:ResearchFact,b:ResearchFact)=>(a.kind+':'+a.period).localeCompare(b.kind+':'+b.period);
const params=[[.06,.12,.12,.02,.12],[.12,.25,.10,.03,.15],[.18,.30,.09,.04,.20]];

export async function mergeIssuerDocumentedReviews(acquired:AcquiredResearch,binding:IssuerDocumentedReviewBinding,clock:()=>string):Promise<AcquiredResearch>{
 const input=structuredClone(acquired),release=structuredClone(binding),p=release.packet;
 const {snapshot_hash,...body}=input;
 valid(hashValid(snapshot_hash)&&await snapshotHash(body)===snapshot_hash,'ACQUIRED_HASH');
 valid(hashValid(release.expectedHash)&&await snapshotHash(p)===release.expectedHash,'PACKET_HASH');
 valid(p.schema==='PRIVATE_2330_REVIEW_POLICY_V1'&&p.symbol==='2330'&&p.max_age_days===7
  &&p.source_admitted===false&&p.member_publication_approved===false&&p.methodology_promoted===false
  &&p.policy_id==='2330_EPS_REINVESTMENT_THREE_SCENARIO_25_BUFFER_CONDITIONAL_WAIT_V1'
  &&validObservationTime(p.reviewed_at)&&validObservationTime(p.expires_at)&&hashValid(p.source_study_sha256)
  &&compareTime(p.expires_at,new Date(Date.parse(p.reviewed_at)+7*86400000).toISOString())===0,'PACKET_SCOPE');
 valid(input.inputs.length===72&&new Set(input.inputs.map(i=>i.symbol)).size===72
  &&input.inputs.every(i=>i.cutoff===input.evidence_cutoff),'INPUT_SCOPE');
 valid(p.financial_reference.length===12&&new Set(p.financial_reference.map(f=>f.kind+':'+f.period)).size===12
  &&p.financial_reference.every(f=>financialKinds.includes(f.kind)&&f.basis==='SINGLE_QUARTER'&&traceIssues(f,p.reviewed_at).length===0),'REFERENCE_SCOPE');
 valid(p.reviews.length===2&&p.reviews.map(r=>r.kind).sort().join('|')==='DEMAND|MOAT'
  &&p.reviews.every(r=>hashValid(r.source_sha256)&&r.source_bytes>0&&r.analysis_zh&&r.counter_evidence_zh),'SEMANTIC_SCOPE');
 valid(p.source_documents.length===9&&new Set(p.source_documents.map(d=>d.period+':'+d.kind)).size===9
  &&p.source_documents.every(d=>d.http===200&&hashValid(d.sha256)&&d.bytes>0&&d.bytes<=16*1024*1024
   &&validObservationTime(d.received_at)&&compareTime(d.received_at,p.reviewed_at)<=0),'SOURCE_SCOPE');
 valid(p.scenarios.length===3&&p.scenarios.map(s=>s.name).join('|')==='conservative|base|optimistic'
  &&p.scenarios.every((s,i)=>[s.g_H,s.R_H,s.r,s.g_T,s.R_T].every((v,j)=>v===params[i][j])),'POLICY_PARAMETERS');
 const evaluatedAt=clock();valid(validObservationTime(evaluatedAt)&&compareTime(evaluatedAt,input.evidence_cutoff)>=0,'EVALUATION_TIME');
 const issue=async(reason:string)=>{input.source_issues=[...(input.source_issues??[]),{kind:'ISSUER_DOCUMENTED_REVIEW',key:'2330',reason}];
  const {snapshot_hash:old,...rest}=input;void old;input.snapshot_hash=await snapshotHash(rest);return input;};
 if(compareTime(evaluatedAt,p.reviewed_at)<0)return issue('POLICY_NOT_YET_AVAILABLE');
 if(compareTime(evaluatedAt,p.expires_at)>=0)return issue('POLICY_REVIEW_EXPIRED');
 const stock=input.inputs.find(i=>i.symbol==='2330')!;
 if(stock.next_session!==day(evaluatedAt)||compareTime(evaluatedAt,stock.next_session+'T13:30:00+08:00')>=0)return issue('QUOTE_REVIEW_SESSION_CLOSED');
 if(compareTime(stock.next_session+'T13:30:00+08:00',p.expires_at)>0)return issue('POLICY_EXPIRES_BEFORE_SESSION_REVIEW');
 const financial=stock.facts.filter(f=>financialKinds.includes(f.kind)).sort(order);
 if(await snapshotHash(financial)!==await snapshotHash(p.financial_reference.slice().sort(order)))return issue('FINANCIAL_QUARTER_OR_FINGERPRINT_CHANGED_REQUIRES_REVIEW');
 // A newer as-reported quarter also vetoes a still-present old twelve-row set.
 if(stock.facts.some(f=>['EPS','FINANCIAL_YTD','EPS_AS_REPORTED'].includes(f.kind)&&String(f.period)>'2026-Q3'))return issue('NEW_FINANCIAL_PERIOD_REQUIRES_REVIEW');
 if(stock.facts.some(f=>['DEMAND','MOAT','VALUATION'].includes(f.kind)))fail('EXISTING_REVIEW_CONFLICT');
 const bars=stock.bars.filter(b=>b.date===stock.through);
 if(bars.length!==1||stock.through>=stock.next_session||bars[0].close<=0||!Number.isFinite(bars[0].close)
  ||traceIssues(bars[0],input.evidence_cutoff).length)return issue('SOLE_COMPLETED_QUOTE_REQUIRED');
 const price=bars[0].close,eps=financial.filter(f=>f.kind==='EPS').reduce((s,f)=>s+Number(f.values.value),0);
 valid(Math.abs(eps-98.26)<1e-8,'EARNINGS_BASE');
 const scenarios=p.scenarios.map(s=>{let pv=0;for(let t=1;t<=5;t++)pv+=eps*(1+s.g_H)**t*(1-(t<5?s.g_H/s.R_H:s.g_T/s.R_T))/(1+s.r)**t;
  const terminal=eps*(1+s.g_H)**5*(1+s.g_T)*(1-s.g_T/s.R_T)/(s.r-s.g_T)/(1+s.r)**5,value=pv+terminal;
  valid(Math.abs(value-s.model_value_twd)<1e-8&&Math.abs(value*.75-s.discount_25_threshold_twd)<1e-8,'MODEL_RECOMPUTATION');
  return {...s,quote_meets_discount:price<=value*.75};});
 if(scenarios.some(s=>s.quote_meets_discount))return issue('SCENARIO_SELECTION_REQUIRES_NEW_REVIEW');
 const bindingQuote={symbol:'2330',session_date:stock.through,close_twd:price,unit:'TWD_PER_COMMON_SHARE',scope:'RETAINED_COMPLETED_QUOTE_NOT_INTRADAY_EXECUTION'};
 const evaluationHash=await snapshotHash({policy_hash:release.expectedHash,evaluated_at:evaluatedAt,quote:bars[0],scenarios});
 const until=stock.next_session+'T13:30:00+08:00';
 for(const kind of ['DEMAND','MOAT','VALUATION']){
  const semantic=p.reviews.find(r=>r.kind===kind),primary=semantic??p.source_documents.find(d=>d.period==='2026-Q3'&&d.kind==='presentation')!;
  const values:ResearchFact['values']={verdict:kind==='VALUATION'?'NOT_SUPPORTED':'SUPPORTED',policy_id:p.policy_id,policy_hash:release.expectedHash,
   reviewed_at:p.reviewed_at,evaluated_at:evaluatedAt,computation:'AUTOMATIC_FIXED_POLICY_REPRICE_NOT_NEW_INDEPENDENT_REVIEW',
   classification:'CONDITIONAL_OWN_ANALYSIS_NOT_OFFICIAL_VERDICT',source_admitted:'FALSE',member_publication_approved:'FALSE',
   quote_session:stock.through,quote_close_twd:price,required_discount_fraction:.25,reported_eps_ttm_twd:eps,actual_fcfe_verified:'FALSE',
   analysis_zh:semantic?.analysis_zh??`保留${stock.through}收盤${price}元高於三個固定情境各自25%折讓門檻，條件式研究採等待；不是官方合理價或可執行買價。`,
   counter_evidence_zh:semantic?.counter_evidence_zh??'要求報酬可翻轉結果；未正常化EPS、假設分配及高終值占比限制估值可靠性。',
   confirmation_zh:'下一季財務、需求與投入資本後現金流仍支持，並依新價格重新計算。',
   invalidation_zh:'資料、季度、價格或政策效期改變時停止沿用，重新檢查。'};
  if(kind==='VALUATION')for(const s of scenarios){values[s.name+'_model_value_twd']=s.model_value_twd;values[s.name+'_discount_25_threshold_twd']=s.discount_25_threshold_twd;values[s.name+'_terminal_fraction']=s.terminal_fraction;}
  const factBody={id:`private-fixed-policy-review:2330:${kind}:${evaluationHash}`,symbol:'2330',kind,period:kind==='VALUATION'?stock.through:'2026-Q3',basis:'DOCUMENTED_REVIEW',values,
   source:'source' in primary?primary.source:primary.url,source_sha256:'source_sha256' in primary?primary.source_sha256:primary.sha256,
   source_bytes:'source_bytes' in primary?primary.source_bytes:primary.bytes,published_at:null,first_seen_at:evaluatedAt,available_at:evaluatedAt,
   as_of:kind==='VALUATION'?bars[0].as_of:'2026-09-30T23:59:59+08:00',reviewed_at:p.reviewed_at,evaluated_at:evaluatedAt,review_valid_until:until,
   policy_expires_at:p.expires_at,review_price_basis:bindingQuote,source_admitted:false,member_publication_approved:false};
  stock.facts.push({...factBody,evidence_hash:await snapshotHash(factBody)});
 }
 // Derived evidence gets its actual computation time. Move only this NEW
 // acquisition's cutoff forward; never rewrite a retained checkpoint/lock.
 const cutoff=clock();valid(validObservationTime(cutoff)&&compareTime(cutoff,evaluatedAt)>=0&&day(cutoff)===stock.next_session
  &&compareTime(cutoff,until)<0&&compareTime(cutoff,p.expires_at)<0,'FINAL_CUTOFF');
 input.evidence_cutoff=cutoff;for(const i of input.inputs)i.cutoff=cutoff;
 if(input.entry)input.entry.evaluation_time=cutoff;
 input.source_issues=[...(input.source_issues??[]),{kind:'ISSUER_DOCUMENTED_REVIEW',key:'2330',reason:'PRIVATE_FIXED_POLICY_NOT_METHOD_PROMOTION_OR_PUBLICATION'}];
 const {snapshot_hash:old,...next}=input;void old;input.snapshot_hash=await snapshotHash(next);return input;
}

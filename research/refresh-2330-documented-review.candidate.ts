/** Private re-review of the existing2330 conditional policy against freshly read
 * originals and one exact retained quote. No registry, source-right or release
 * grant is made here, and the old review/history is never mutated. */
import {snapshotHash,validObservationTime} from '../src/features/vnext/contracts.ts';
import {evaluateResearch,traceIssues,type FunnelInput,type ResearchFact} from '../src/features/vnext/researchFunnel.ts';
import {parseSecQuarterFinancials,type SecQuarterDocument} from './sec-quarter-financials.ts';

export type ReviewPrimaryDocument=SecQuarterDocument|{period:'2025-FY';kind:'annual';url:string;bytes:number;sha256:string;received_at:string;body:string};
type PriorReview={facts:ResearchFact[];facts_sha256:string;source_seal_sha256:string;review_valid_until:string};
const priorSeal='6b3cfccff75a1960196a2edd9685290f7eb66b0bd7f0dd396c84de597ca12526';
const priorFacts='53765d515cc65a5deec0514fcf8c4cae8873010f54d016cfecfec7b039c1ad94';
const policy='2330_EPS_REINVESTMENT_THREE_SCENARIO_25_BUFFER_CONDITIONAL_WAIT_V1';
const periods=['2025-Q4','2026-Q1','2026-Q2','2026-Q3'];
function fail(code:string):never{throw Error('FRESH_2330_REVIEW_'+code);}
const digest=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
const text=(html:string)=>html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
 .replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();
const one=(body:string,re:RegExp)=>{const a=[...body.matchAll(re)];if(a.length!==1)fail('AMBIGUOUS_SOURCE');return a[0];};
const num=(v:string)=>Number(v.replaceAll(',',''));

export async function refresh2330DocumentedReview(args:{input:FunnelInput;documents:ReviewPrimaryDocument[];prior:PriorReview;created_at:string;review_valid_until:string}){
 // Own every mutable preimage before async validation. This output is a new
 // private input with a new cutoff, never a replacement of today's frozen run.
 const a=structuredClone(args),{input,documents,prior,created_at,review_valid_until}=a;
 if(input.symbol!=='2330'||!validObservationTime(created_at)||!validObservationTime(review_valid_until)
  ||Date.parse(created_at)>=Date.parse(review_valid_until))fail('TIME_SCOPE');
 const today=new Date(Date.parse(created_at)+8*3600000).toISOString().slice(0,10);
 if(input.next_session!==today||input.through>=today||review_valid_until!==today+'T13:30:00+08:00')fail('SESSION_SCOPE');
 if(prior.source_seal_sha256!==priorSeal||prior.facts_sha256!==priorFacts||prior.facts.length!==3
  ||await snapshotHash(prior.facts.slice().sort((x,y)=>x.id.localeCompare(y.id)))!==priorFacts
  ||prior.facts.some(f=>f.values.policy_id!==policy))fail('PRIOR_POLICY_SEAL');
 const bars=input.bars.filter(b=>b.date===input.through);
 if(bars.length!==1||bars[0].close<=0||!Number.isFinite(bars[0].close)||traceIssues(bars[0],created_at).length)fail('QUOTE_SCOPE');
 if(documents.length!==9||new Set(documents.map(d=>d.period+':'+d.kind)).size!==9)fail('DOCUMENT_SCOPE');
 for(const d of documents)if(!validObservationTime(d.received_at)||Date.parse(d.received_at)>Date.parse(created_at)
  ||Date.parse(d.received_at)<=Date.parse(prior.review_valid_until))fail('FRESH_RECEIPT_REQUIRED');
 const financials=[];
 const operating=[];
 for(const period of periods){
  const releases=documents.filter(d=>d.period===period&&d.kind==='release'),presentations=documents.filter(d=>d.period===period&&d.kind==='presentation');
  if(releases.length!==1||presentations.length!==1)fail('QUARTER_SCOPE');
  const release=releases[0] as SecQuarterDocument,presentation=presentations[0] as SecQuarterDocument;
  financials.push(...await parseSecQuarterFinancials(release,presentation,created_at));
  const body=text(release.body),revenue=num(one(body,/announced consolidated revenue of NT\$([\d,]+\.\d{2}) billion/g)[1]);
  const yoy=num(one(body,/Year-over-year, (?:first|second|third|fourth) quarter revenue increased (\d+\.\d)%/g)[1]);
  const leading=num(one(body,/Advanced technologies, defined as 7-nanometer and more advanced technologies, accounted for (\d+)% of total wafer revenue/g)[1]);
  operating.push({period,revenue_twd_billion:revenue,revenue_yoy_percent:yoy,leading_edge_wafer_revenue_percent:leading});
 }
 const annual=documents.find(d=>d.kind==='annual');
 if(!annual||annual.url!=='https://www.sec.gov/Archives/edgar/data/1046179/000162828026025362/tsm-20251231.htm'
  ||annual.bytes!==new TextEncoder().encode(annual.body).length||annual.bytes>16*1024*1024||await digest(annual.body)!==annual.sha256)fail('ANNUAL_SOURCE');
 const annualText=text(annual.body);
 if(!/NT\$\s*246,427 million/.test(annualText)||!/annual capacity \(in 12-inch equivalent wafers\) exceeded 17 million wafers/.test(annualText)
  ||!annualText.includes('Competition')||!annualText.includes('Risks'))fail('ANNUAL_LOCATORS');
 const eps=financials.filter(f=>f.kind==='EPS').reduce((s,f)=>s+Number(f.values.value),0),price=bars[0].close;
 const oldValuation=prior.facts.find(f=>f.kind==='VALUATION');if(!oldValuation)fail('PRIOR_VALUATION');
 if(Math.abs(eps-Number(oldValuation.values.eps0_twd))>1e-8)fail('EARNINGS_BASE_CHANGED_REQUIRES_POLICY_REVIEW');
 const scenarios=['conservative','base','optimistic'].map(name=>{
  const v=oldValuation.values,gh=Number(v[name+'_g_H']),rh=Number(v[name+'_R_H']),r=Number(v[name+'_r']),gt=Number(v[name+'_g_T']),rt=Number(v[name+'_R_T']);
  let pv=0;for(let t=1;t<=5;t++)pv+=eps*(1+gh)**t*(1-(t<5?gh/rh:gt/rt))/(1+r)**t;
  const terminal=eps*(1+gh)**5*(1+gt)*(1-gt/rt)/(r-gt)/(1+r)**5,value=pv+terminal;
  if(!Number.isFinite(value)||value<=0||Math.abs(value-Number(v[name+'_model_value_twd']))>1e-8)fail('ORIGINAL_MODEL_RECOMPUTATION');
  return {name,g_H:gh,R_H:rh,r,g_T:gt,R_T:rt,model_value_twd:value,discount_25_threshold_twd:value*.75,terminal_fraction:terminal/value,quote_meets_discount:price<=value*.75};
 });
 // The inherited policy has a definite negative only when all three fixed
 // comparisons fail. A mixed result needs a separately reviewed choice rule.
 if(scenarios.some(s=>s.quote_meets_discount))fail('SCENARIO_SELECTION_REQUIRES_REVIEW');
 if(operating.some(r=>r.revenue_yoy_percent<=0))fail('DEMAND_REQUIRES_NEW_SEMANTIC_REVIEW');
 const binding={symbol:'2330',session_date:input.through,close_twd:price,unit:'TWD_PER_COMMON_SHARE',scope:'RETAINED_FORMAL_QUOTE_NOT_INTRADAY_EXECUTION'};
 const dependencies=documents.map(({body,...receipt})=>receipt);
 const review={schema:'PRIVATE_2330_FRESH_DOCUMENTED_REVIEW_V1',created_at,review_valid_until,review_price_basis:binding,policy_id:policy,
  prior_source_seal:priorSeal,original_review_unchanged:true,primary_documents:dependencies,operating,eps_reported_ttm_twd:eps,scenarios,
  financial_basis:'TIFRS_CONSOLIDATED_SINGLE_QUARTER_NOT_NORMALIZED',annual_basis:'IFRS_AS_ISSUED_BY_IASB_CONTEXT_ONLY_NOT_MIXED_WITH_QUARTERLY_EPS',
  source_admitted:false,member_publication_approved:false,methodology_promoted:false};
 const reviewHash=await snapshotHash(review),facts=[];
 for(const kind of ['DEMAND','MOAT','VALUATION']){
  const primary=kind==='MOAT'?annual:documents.find(d=>d.period==='2026-Q3'&&d.kind===(kind==='DEMAND'?'release':'presentation'))!;
  const values:ResearchFact['values']={verdict:kind==='VALUATION'?'NOT_SUPPORTED':'SUPPORTED',policy_id:policy,review_hash:reviewHash,
   classification:'CONDITIONAL_OWN_ANALYSIS_NOT_ISSUER_OR_REGULATOR_VERDICT',publication_status:'NOT_APPROVED',review_price_session:input.through,review_price_close_twd:price,
   historical_reference_only:'TRUE',actual_fcfe_verified:'FALSE',earnings_normalization:'REPORTED_NOT_NORMALIZED',
   analysis_zh:kind==='DEMAND'?'四季已實現營收年增皆正，最新季先進製程占晶圓營收79%，支持有限範圍的需求研究假設。公司下季展望不能視為實現訂單。':kind==='MOAT'?
    '原件所列研發投入、製造規模與先進節點實際收入支持可觀察的技術及規模優勢；不表示永久壟斷或可保證超額報酬。':
    `保留${input.through}收盤${price}元高於三個固定情境各自的25%折讓門檻，這個條件式方法採等待。情境與要求報酬均為分析假設。`,
   counter_evidence_zh:kind==='DEMAND'?'僅四季已實現表現，沒有多年綁約訂單；匯率與產品組合影響營收。':kind==='MOAT'?
    '最新季毛利率66.4%低於前季67.7%；競爭、海外廠成本與技術轉換仍可能侵蝕經濟利益。':
    '樂觀模型值高於保留價格，但25%折讓門檻未成立；要求報酬改變可翻轉判斷，未正常化EPS與高終值占比仍是限制。',
   confirmation_zh:'下一季財務、需求與投入資本後現金流仍支持，並以當時新價格重評。',
   invalidation_zh:'報價日期、價格、季度財務或有效期改變即停止沿用本三筆，必須重新審查。'};
  if(kind==='VALUATION')for(const s of scenarios){values[s.name+'_model_value_twd']=s.model_value_twd;values[s.name+'_discount_25_threshold_twd']=s.discount_25_threshold_twd;values[s.name+'_terminal_fraction']=s.terminal_fraction;}
  const body={id:`fresh-own-documented-review:2330:${kind}:${reviewHash}`,symbol:'2330',kind,period:kind==='VALUATION'?input.through:'2026-Q3',basis:'DOCUMENTED_REVIEW',values,
   source:primary.url,published_at:null,first_seen_at:created_at,available_at:created_at,as_of:kind==='VALUATION'?bars[0].as_of:'2026-09-30T23:59:59+08:00',
   source_sha256:primary.sha256,source_bytes:primary.bytes,source_locator:{review_hash:reviewHash,section:kind==='MOAT'?'2025 Form20-F R&D/Capacity/Competition/Risks':'Quarterly release and cash flow source checked in full'},
   source_dependencies:dependencies,review_valid_until,review_price_basis:binding,source_admitted:false,member_publication_approved:false};
  facts.push({...body,evidence_hash:await snapshotHash(body)});
 }
 const working={...input,cutoff:created_at,facts:[...input.facts.filter(f=>!['EPS','MARGIN','CAPEX','DEMAND','MOAT','VALUATION'].includes(f.kind)),...financials,...facts]};
 const evaluation=evaluateResearch(working,'LONG');
 if(!evaluation.evaluated||evaluation.state!=='REJECTED'||evaluation.reasons.join('|')!=='VALUATION:NOT_SUPPORTED')fail('COMPLETE_EVALUATION_REQUIRED');
 return {review,review_hash:reviewHash,facts,financials,input:working,evaluation,production_written:false,old_acquisition_unchanged:true};
}

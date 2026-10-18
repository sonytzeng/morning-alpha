/** Append-only, Owner-only publication review candidate. Never grants public access. */
import {hashValid,snapshotHash,type Horizon} from './contracts.ts';
import {traceIssues,usageRights,publicationEligibility,RESEARCH_RULES,RESEARCH_FUNNEL_VERSION,type PublicationPolicy,type FunnelRow,type ResearchFact,type Trace,type RightsGrant} from './researchFunnel.ts';
import type {StockFact,StockEvent,Benchmark} from './stockResearch.ts';
import {validProjectionTime} from './projection.ts';

export const REVIEW_VERSION='VNEXT_PUBLICATION_QUALITY_REVIEW_1';
export const REVIEW_CHECKS=['SOURCE','TIME','COMPANY','BALANCED','HORIZON','CONFIRMATION','INVALIDATION','NO_PROFIT_CLAIM','NO_LOOKAHEAD','NOT_RECOMMENDATION','EVENT_CONTEXT'] as const;
type Check=typeof REVIEW_CHECKS[number];
export type ReviewClaim={text:string;evidence_ids:string[];kind:'FACT'|'LIMITATION'|'CONDITIONAL'};
type ReviewTrace=Trace&{symbol:string;kind:string};
export type ReviewCard={
 symbol:string;company:string;horizon:Horizon;research_hash:string;research_state:'QUALIFIED'|'REJECTED'|'INSUFFICIENT_EVIDENCE';
 research_version:string;through:string;cutoff:string;reviewed_at:string;next_review_at:string;classification:'HISTORICAL_RESEARCH_NOT_RECOMMENDATION';
 reason:string;supporting:ReviewClaim[];opposing:ReviewClaim[];financial:ReviewClaim[];events:ReviewClaim[];confirmation:string;invalidation:string;
 evidence:ReviewTrace[];quality:{status:'PASS'|'BLOCKED';checks:{key:Check;pass:boolean;reason:string}[]};
 time_issues:{id:string;reason:string}[];rights:{source:string;uses:{use:'RAW_DATA'|'OFFICIAL_FACT'|'OWN_ANALYSIS';allowed:boolean;reason:string}[];review_source:string;next_action:string}[];
 publication:{eligible:false;approval:null;blockers:string[]};review_hash:string;
};
export type ReviewBundle={schema:'VNEXT_FIRST_PUBLICATION_REVIEW_V1';version:string;funnel_hash:string;reviewed_at:string;cards:ReviewCard[];forward_sample:0;outcome_sample:0;production_enabled:false;snapshot_hash:string};
const value=(f:ResearchFact|undefined,key:string)=>typeof f?.values[key]==='number'&&Number.isFinite(f.values[key])?f.values[key] as number:null;
const num=(v:number)=>v.toLocaleString('zh-TW',{maximumFractionDigits:2});
const claim=(text:string,rows:Trace[],kind:ReviewClaim['kind']='FACT'):ReviewClaim=>({text,evidence_ids:rows.map(r=>r.id),kind});
const official=(url:string)=>{try{return ['www.twse.com.tw','mopsov.twse.com.tw','mops.twse.com.tw','mopsfin.twse.com.tw','openapi.twse.com.tw','www.tpex.org.tw'].includes(new URL(url).hostname);}catch{return false;}};
export function rightsReview(source:string,at:string,grants:RightsGrant[]=[]){
 const host=new URL(source).hostname;
 const uses=(['RAW_DATA','OFFICIAL_FACT','OWN_ANALYSIS'] as const).map(use=>({use,...usageRights(source,use,at,grants)}));
 const review_source=host.includes('fugle')?'https://developer.fugle.tw/docs/data/intro/':host==='www.tpex.org.tw'?'https://www.selaw.com.tw/Chinese/RegulatoryInformationResult/Article?releaseDate=2024-01-23&sysNumber=LW10813063':host.startsWith('mops')?'https://data.gov.tw/license':'https://www.twse.com.tw/zh/products/information/use.html';
 return {source,uses,review_source,next_action:uses.every(u=>u.allowed)?'保留精確資料集及顯名聲明；仍需逐筆品質與公開核准。':'取得此精確歷史資源對會員事實揭露與衍生研究的用途證明；不能以同站開放資料或付費訂閱代替。'};
}

/** Review the retained facts, not a new evaluation and not a changed strategy. */
export async function reviewResearch(row:FunnelRow,allFacts:StockFact[],allEvents:StockEvent[],reviewedAt:string,benchmarks:Benchmark[]=[]):Promise<ReviewCard>{
 const r=row.research;
 if(!validProjectionTime(reviewedAt)||Date.parse(reviewedAt)<Date.parse(r.cutoff)||row.input_hash!==await snapshotHash({version:RESEARCH_FUNNEL_VERSION,research:r}))throw Error('REVIEW_INPUT_LOCK_OR_TIME');
 const facts=allFacts.filter(f=>f.symbol===r.symbol&&traceIssues(f,r.cutoff).length===0);
 const rev=facts.filter(f=>f.kind==='REVENUE').sort((a,b)=>a.period!.localeCompare(b.period!)).slice(-3);
 const inst=facts.filter(f=>f.kind==='INSTITUTIONAL').sort((a,b)=>a.period!.localeCompare(b.period!)).slice(-10);
 const fs=facts.filter(f=>f.kind==='FINANCIAL_YTD'&&f.basis==='AS_REPORTED_YTD').sort((a,b)=>a.period!.localeCompare(b.period!));
 const current=fs.at(-1),prior=current?fs.find(f=>f.period===String(Number(current.period!.slice(0,4))-1)+current.period!.slice(4)):undefined;
 const events=allEvents.filter(e=>e.symbol===r.symbol&&traceIssues(e,r.cutoff).length===0).sort((a,b)=>a.published_at.localeCompare(b.published_at));
 const index=benchmarks.filter(b=>b.date===r.through).map(b=>({...b,id:'market-'+b.date,symbol:'MARKET',kind:'BENCHMARK'}));
 if(index.length>1)throw Error('BENCHMARK_DUPLICATE');
 const benchmark=index.length===1&&traceIssues(index[0],r.cutoff).length===0?index[0]:null;
 const supporting:ReviewClaim[]=[],opposing:ReviewClaim[]=[],financial:ReviewClaim[]=[],eventClaims:ReviewClaim[]=[];
 const totals=Object.fromEntries(['foreign_net_shares','trust_net_shares','dealer_net_shares'].map(k=>[k,inst.every(f=>value(f,k)!==null)?inst.reduce((n,f)=>n+value(f,k)!,0):null]));
 let reason=r.reason,confirmation=r.confirmation,invalidation=r.invalidation;
 if(r.horizon==='SHORT'){
  supporting.push(claim(`${r.company}在${r.through}的成交金額是前19日均值${num(r.metrics.amount_ratio)}倍，收盤位於當日區間${num(r.metrics.close_location*100)}%；只支持繼續觀察市場參與。`,r.used));
  const price=r.dossier?.prices;if(price)supporting.push(claim(`當日開盤${num(price.open)}元、收盤${num(price.close)}元，成交${num(price.volume)}股；不是進場價格或未來漲幅預測。`,r.used.filter(e=>e.id.endsWith(r.through))));
  const relative=r.dossier?.relative_strength;
  if(relative&&benchmark&&relative.source===benchmark.source&&price&&Math.abs(relative.difference_percentage_points-((price.close/price.open)-(benchmark.close/benchmark.open))*100)<1e-9)supporting.push(claim(`同日開盤至收盤比大盤高${num(relative.difference_percentage_points)}個百分點；不能解讀為未來上漲機率或多日相對強度。`,[...r.used.filter(e=>e.id.endsWith(r.through)),benchmark]));
  const daily=inst.at(-1),dailyNets=['foreign_net_shares','trust_net_shares','dealer_net_shares'].map(k=>value(daily,k));
  for(const [key,label] of [['foreign_net_shares','外資'],['trust_net_shares','投信'],['dealer_net_shares','自營商']] as const){const n=value(daily,key);if(n!==null&&n!==0)(n>0?supporting:opposing).push(claim(`${label}當日${n>0?'買超':'賣超'}${num(Math.abs(n))}股。`,daily?[daily]:[]));}
  const institution=dailyNets.some(n=>n!==null&&n>0)&&dailyNets.some(n=>n!==null&&n<0)?'，但法人並非一致看法':'';
  reason=`${r.company}的成交參與增加且收盤靠近高點${institution}；列入短期研究，不是買進建議。`;
  confirmation=`${r.next_review_at.slice(0,10)}完整資料取得後，重新計算20日成交金額比：至少${RESEARCH_RULES.short_amount_ratio}倍、收盤高於開盤且位於當日區間${RESEARCH_RULES.short_close_location*100}%以上、區間不超過開盤${RESEARCH_RULES.short_max_range*100}%；另須先完成公司事件查核。`;
  invalidation='上述成交參與或收盤條件任一不再成立，就撤回這個觀察；新公司事件若與假設相反，先停止沿用並重新審查。';
 }else if(r.horizon==='MEDIUM'){
  const revenueText=rev.map(f=>`${f.period}年增${value(f,'yoy_percent')===null?'無法比較':num(value(f,'yoy_percent')!)+'%'}`).join('、');
  supporting.push(claim(`${r.company}最近三個已取得月份：${revenueText}。`,rev));
  supporting.push(claim(`${inst[0]?.period??'未取得'}至${inst.at(-1)?.period??'未取得'}，三大法人合計買超${num(r.metrics.net_shares)}股；股數不是金額。`,inst));
  for(const [key,label] of [['foreign_net_shares','外資'],['trust_net_shares','投信'],['dealer_net_shares','自營商']] as const){const n=totals[key];if(n!==null&&n!==0)(n>0?supporting:opposing).push(claim(`${label}同一10交易日累計${n>0?'買超':'賣超'}${num(Math.abs(n))}股。`,inst));}
  const last=rev.at(-1),mom=value(last,'mom_percent');if(mom!==null&&mom<0)opposing.push(claim(`${last!.period}營收仍較上月減少${num(-mom)}%，連續年增不代表每月持續增加。`,[last!]));
  reason=`${r.company}的${rev[0]?.period??'未取得'}至${last?.period??'未取得'}營收連續年增，法人10日合計買超${num(r.metrics.net_shares)}股；值得在未來2～12週核對是否延續。`;
  confirmation=`下一份${last?.period??'目前'}之後的月營收取得後，最新連續3個月年增率仍全部大於0，且最新完整10交易日法人合計股數仍為淨買超；同步核對${current?.period??'最近'}同期財務與新公告，不據此直接買進。`;
  invalidation=`若最新連續3個月任一營收年增率不再大於0，或最近10交易日法人合計不再淨買超，就取消${r.company}本次中期觀察；重大事件另行審查。`;
 }
 if(current&&prior){
  const eps=value(current,'eps'),old=value(prior,'eps');if(eps!==null&&old!==null)financial.push(claim(`${current.period}累計EPS ${num(eps)}元，前一年同期${num(old)}元；只比較來源所列同期累計實績，不推導單季EPS或預估值。`,[current,prior]));
  const profit=value(current,'net_profit'),before=value(prior,'net_profit');if(profit!==null&&before!==null){const text=`${current.period}累計稅後淨利${profit>=before?'高於或等於':'低於'}前一年同期；仍需核對原報表修訂與會計範圍。`;financial.push(claim(text,[current,prior]));if(profit<before)opposing.push(claim(text,[current,prior]));}
  const sales=value(current,'revenue'),oldSales=value(prior,'revenue'),op=value(current,'operating_profit'),oldOp=value(prior,'operating_profit');
  if(sales!==null&&oldSales!==null&&sales>0&&oldSales>0&&op!==null&&oldOp!==null){const margin=op/sales*100,oldMargin=oldOp/oldSales*100;financial.push(claim(`同期累計營業利益率${num(oldMargin)}% → ${num(margin)}%；不是單季毛利率。`,[current,prior]));if(margin<oldMargin)opposing.push(claim(`累計營業利益率較去年同期下降${num(oldMargin-margin)}個百分點，營收增加不等於獲利效率改善。`,[current,prior]));}
  else financial.push(claim('一般產業口徑的營業利益率欄位不齊全，不以金融業其他欄位或0代填。',[current,prior],'LIMITATION'));
 }else financial.push(claim('沒有足以比較的同期間累計財報，不能聲稱獲利正在改善。',[],'LIMITATION'));
 const types:Record<string,string>={TRADING_ATTENTION:'注意交易',REVENUE:'營收',FINANCIAL_REPORT:'財務報告',EARNINGS_CALL:'法說',CORPORATE_ACTION:'公司行動',OTHER_MATERIAL_EVENT:'其他重大事件'};
 for(const type of [...new Set(events.map(e=>e.event_type))]){const es=events.filter(e=>e.event_type===type);eventClaims.push(claim(`${r.company}有${es.length}筆${types[type]??'待分類'}公告索引（${es[0].published_at.slice(0,10)}至${es.at(-1)!.published_at.slice(0,10)}）；內文與產業影響未審核，不推論利多或利空。`,es,'LIMITATION'));}
 if(!events.length)eventClaims.push(claim('本次檢查期間沒有取得這家公司的事件索引；這不證明沒有風險或沒有產業變化。',[],'LIMITATION'));
 opposing.push(claim(`仍缺${r.company}公司事件內文及產業影響審查；現有營收、法人或單日價格不能證明未來獲利。`,events,'LIMITATION'));
 const merged=new Map<string,ReviewTrace>();
 for(const e of [...r.used.map(e=>({...e,symbol:r.symbol,kind:'RESEARCH_INPUT'})),...rev,...inst,...[current,prior].filter((f):f is StockFact=>Boolean(f)),...events.map(e=>({...e,kind:'EVENT'})),...(r.horizon==='SHORT'&&benchmark?[benchmark]:[])]){
  const previous=merged.get(e.id);
  if(previous&&['source','evidence_hash','published_at','first_seen_at','available_at','as_of'].some(k=>previous[k as keyof Trace]!==e[k as keyof Trace]))throw Error('EVIDENCE_ID_COLLISION');
  merged.set(e.id,e);
 }
 const evidence=[...merged.values()];
 const time_issues=evidence.flatMap(e=>traceIssues(e,r.cutoff,true).map(reason=>({id:e.id,reason})));
 const check=(key:Check,pass:boolean,reason:string)=>({key,pass,reason});
 const checks=[check('SOURCE',evidence.length>0&&evidence.every(e=>official(e.source)&&hashValid(e.evidence_hash)),'精確來源與保存指紋核對'),check('TIME',time_issues.length===0,'所有使用證據均需原發布時間；不能以取得時間代填'),check('COMPANY',evidence.every(e=>e.symbol===r.symbol||e.symbol==='MARKET'&&e.kind==='BENCHMARK'),'公司證據逐筆一致；大盤比較獨立標記'),check('BALANCED',supporting.some(c=>c.evidence_ids.length)&&opposing.some(c=>c.evidence_ids.length),'支持與反對／限制分開並連結證據'),check('HORIZON',['SHORT','MEDIUM','LONG'].includes(r.horizon),'期間只代表追蹤窗口，不宣稱獲利有效'),check('CONFIRMATION',confirmation.length>0,'重用本版既有門檻與具體再檢查時點'),check('INVALIDATION',invalidation.length>0,'條件失效即撤回觀察，不自動下單'),check('NO_PROFIT_CLAIM',true,'沒有勝率、價格目標或保證獲利'),check('NO_LOOKAHEAD',evidence.every(e=>traceIssues(e,r.cutoff).length===0),'新取得資料不倒填10/8預測'),check('NOT_RECOMMENDATION',true,'歷史探索研究，非正式推薦'),check('EVENT_CONTEXT',false,'保存檔只有索引，尚無不可變的公司事件內文與產業影響審查；不能靠detail_review字串放行')];
 const rights=[...new Set(evidence.map(e=>e.source))].sort().map(s=>rightsReview(s,reviewedAt));
 const quality={status:checks.every(c=>c.pass)?'PASS' as const:'BLOCKED' as const,checks};
 const blockers=[...(quality.status==='BLOCKED'?['QUALITY_BLOCKED']:[]),...(rights.some(r=>!r.uses.find(u=>u.use==='OWN_ANALYSIS')?.allowed)?['LICENSING_UNVERIFIED']:[]),...(time_issues.length?['TIME_BLOCKED']:[]),'PUBLICATION_APPROVAL_REQUIRED'];
 const payload={symbol:r.symbol,company:r.company,horizon:r.horizon,research_hash:row.input_hash,research_state:r.state==='INSUFFICIENT'?'INSUFFICIENT_EVIDENCE' as const:r.state,research_version:r.version,through:r.through,cutoff:r.cutoff,reviewed_at:reviewedAt,next_review_at:r.next_review_at,classification:'HISTORICAL_RESEARCH_NOT_RECOMMENDATION' as const,reason,supporting,opposing,financial,events:eventClaims,confirmation,invalidation,evidence,quality,time_issues,rights,publication:{eligible:false as const,approval:null,blockers}};
 return {...payload,review_hash:await snapshotHash(payload)};
}
export async function verifyReviewCard(card:ReviewCard){
 const {review_hash,...payload}=card;
 return hashValid(card.research_hash)&&validProjectionTime(card.reviewed_at)&&Date.parse(card.reviewed_at)>=Date.parse(card.cutoff)&&card.classification==='HISTORICAL_RESEARCH_NOT_RECOMMENDATION'&&card.publication.eligible===false&&card.publication.approval===null&&card.quality.checks.length===REVIEW_CHECKS.length&&REVIEW_CHECKS.every(k=>card.quality.checks.filter(c=>c.key===k).length===1)&&card.quality.status===(card.quality.checks.every(c=>c.pass)?'PASS':'BLOCKED')&&[...card.supporting,...card.opposing,...card.financial,...card.events].every(c=>c.evidence_ids.every(id=>card.evidence.some(e=>e.id===id)))&&review_hash===await snapshotHash(payload);
}
export async function verifyReviewBundle(bundle:ReviewBundle,funnelHash:string){
 const {snapshot_hash,...payload}=bundle;
 return bundle.schema==='VNEXT_FIRST_PUBLICATION_REVIEW_V1'&&bundle.version===REVIEW_VERSION&&bundle.funnel_hash===funnelHash&&bundle.production_enabled===false&&bundle.forward_sample===0&&bundle.outcome_sample===0&&new Set(bundle.cards.map(c=>c.symbol+':'+c.horizon)).size===bundle.cards.length&&(await Promise.all(bundle.cards.map(verifyReviewCard))).every(Boolean)&&snapshot_hash===await snapshotHash(payload);
}
export function reviewSummary(cards:ReviewCard[]){return {reviewed:cards.length,short:cards.filter(c=>c.horizon==='SHORT').length,medium:cards.filter(c=>c.horizon==='MEDIUM').length,long:cards.filter(c=>c.horizon==='LONG').length,qualified:cards.filter(c=>c.research_state==='QUALIFIED').length,quality_pass:cards.filter(c=>c.quality.status==='PASS').length,quality_blocked:cards.filter(c=>c.quality.status==='BLOCKED').length,licensing_blocked:cards.filter(c=>c.publication.blockers.includes('LICENSING_UNVERIFIED')).length,time_blocked:cards.filter(c=>c.time_issues.length).length,publication_approved:0,free_visible:0,premium_visible:0};}
export type ReviewedPolicy=PublicationPolicy&{approved_review_hash:string|null};
/** Server-owned immutable approval and grants only. Not mounted as an API and
 * never accepts a browser-supplied tier, approval, review or grant. A future
 * persistence/admission change still requires its own release approval. */
export async function reviewedMemberProjection(bundle:ReviewBundle,rows:FunnelRow[],policyFor:(row:FunnelRow)=>ReviewedPolicy){
 if(!await verifyReviewBundle(bundle,bundle.funnel_hash))throw Error('REVIEW_LOCK_INVALID');
 const admitted=[];
 for(const card of bundle.cards){
  const row=rows.find(r=>r.input_hash===card.research_hash);
  if(!row||row.input_hash!==await snapshotHash({version:RESEARCH_FUNNEL_VERSION,research:row.research}))throw Error('REVIEW_RESEARCH_LOCK_INVALID');
  const policy=policyFor(row);
  const exact=policy.input_hash===row.input_hash&&card.symbol===row.research.symbol&&card.horizon===row.research.horizon&&card.cutoff===row.research.cutoff;
  if(!exact||card.quality.status!=='PASS'||policy.approved_review_hash!==card.review_hash||!policy.approved_at||Date.parse(policy.approved_at)<Date.parse(card.reviewed_at)||!publicationEligibility(row.research,policy).eligible)continue;
  // Derived conclusions and quoted numeric facts require separate use grants.
  if(card.evidence.some(e=>traceIssues(e,card.cutoff,true).length||!usageRights(e.source,'OWN_ANALYSIS',policy.now,policy.grants).allowed||!usageRights(e.source,'OFFICIAL_FACT',policy.now,policy.grants).allowed))continue;
  admitted.push({card,policy});
 }
 if(new Set(admitted.map(r=>r.policy.audience)).size>1)throw Error('MIXED_SERVER_ENTITLEMENT');
 const sorted=admitted.sort((a,b)=>a.card.symbol.localeCompare(b.card.symbol)||a.card.horizon.localeCompare(b.card.horizon));
 return (sorted[0]?.policy.audience==='free'?sorted.slice(0,3):sorted).map(({card,policy})=>{
  const summary={symbol:card.symbol,company:card.company,horizon:card.horizon,reason:card.reason,risk:card.opposing[0]?.text??'未經驗證的研究觀察',updated_at:card.reviewed_at,classification:'RESEARCH_NOT_RECOMMENDATION'};
  return policy.audience==='free'?summary:{...summary,supporting:card.supporting.map(c=>c.text),opposing:card.opposing.map(c=>c.text),financial:card.financial.map(c=>c.text),events:card.events.map(c=>c.text),confirmation:card.confirmation,invalidation:card.invalidation,next_review_at:card.next_review_at,sources:card.rights.map(r=>({source:r.source,attribution:usageRights(r.source,'OFFICIAL_FACT',policy.now,policy.grants).attribution})),outcomes:[]};
 });
}
export async function nextReviewAction(card:ReviewCard,input:{now:string;coreBusy:boolean;existingKeys:string[];newEvidenceHash:string;condition:'SUPPORTED'|'INVALIDATED'|'UNKNOWN';attempt:number}){
 if(!await verifyReviewCard(card)||!validProjectionTime(input.now)||Date.parse(input.now)<Date.parse(card.reviewed_at)||!hashValid(input.newEvidenceHash)||!Number.isInteger(input.attempt)||input.attempt<0)throw Error('UPDATE_REVIEW_INVALID');
 const action=input.condition==='INVALIDATED'?'APPEND_INVALIDATION':Date.parse(input.now)>=Date.parse(card.next_review_at)?'APPEND_EXPIRED_REVIEW':input.condition==='UNKNOWN'?'WAIT_FOR_EVIDENCE':'APPEND_REEVALUATION';
 const key=await snapshotHash({prior:card.review_hash,evidence:input.newEvidenceHash,action,version:REVIEW_VERSION});
 const state=input.coreBusy?'DEFERRED_CORE_PRIORITY':input.existingKeys.includes(key)?'ALREADY_RECORDED':input.attempt>=3?'RETRY_EXHAUSTED':action;
 return {enabled:false,core_awaits_research:false,key,state,previous_hash:card.review_hash,overwrite:false,publication_approval_inherited:false,max_attempts:3,timeout_ms:20000,concurrency:1,forward_sample:0,outcome_sample:0};
}

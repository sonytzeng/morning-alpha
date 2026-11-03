/** Read-only due-diligence view. This catalog is NOT a publication grant. */
import type {ReviewCard} from './publicationReview';
import type {Admission,AdmissionBundle} from './publicationAdmission';
import {traceIssues} from './researchFunnel.ts';

export const CLEARANCE_VERSION='VNEXT_SOURCE_TIME_DOSSIER_1';
export const LICENSE_REVIEWED_AT='2026-10-11T12:30:00.000Z';
export const OGL='https://data.gov.tw/license';
const openResource=(id:string,dataset:string,resource:string,reviewedAt=LICENSE_REVIEWED_AT)=>({
 source_id:'DATA_GOV_TW_'+id,dataset,resource,license_type:'OPEN_GOVERNMENT_DATA_LICENSE_1',
 permitted_usage:'僅限該資料集實際釋出資源；遵守顯名與第三人權利條件。',
 commercial_usage:'PERMITTED_WITH_ATTRIBUTION',derivative_usage:'PERMITTED_WITH_ATTRIBUTION',
 redistribution:'PERMITTED_WITH_ATTRIBUTION',attribution_required:true,
 attribution:'原提供機關／年份／資料集名稱與版本／政府資料開放授權條款連結',
 evidence_url:'https://data.gov.tw/dataset/'+id,license_url:OGL,
 review_status:'DATASET_LICENSE_VERIFIED_NOT_HISTORICAL_ENDPOINT_GRANT',reviewed_at:reviewedAt,
});
export const OPEN_RESOURCES=Object.freeze([
 openResource('11549','上市個股日成交資訊','https://www.twse.com.tw/exchangeReport/STOCK_DAY_ALL?response=open_data'),
 openResource('18420','上市公司每月營業收入彙總表','https://mopsfin.twse.com.tw/opendata/t187ap05_L.csv'),
 openResource('20762','上市公司營益分析彙總表','https://mopsfin.twse.com.tw/opendata/t187ap17_L.csv'),
 openResource('11856','上櫃股票三大法人買賣明細資訊','https://www.tpex.org.tw/web/stock/3insti/DAILY_TradE/3itrade_hedge_result.php?l=zh-tw&se=EW&t=D&o=data'),
 openResource('56510','上櫃公司每月營業收入','https://mopsfin.twse.com.tw/opendata/t187ap05_O.csv'),
 openResource('91998','上市公司綜合損益表（一般業）','https://mopsfin.twse.com.tw/opendata/t187ap06_L_ci.csv'),
 openResource('18418','上櫃公司每日重大訊息','https://mopsfin.twse.com.tw/opendata/t187ap04_O.csv'),
]);
/** New exact current-day resources are a dated addendum, not a rewrite of the
 * seven historical review records above. A catalog match is NOT a rights grant
 * installed in the server registry, a session-scope review, or publication. */
export const CURRENT_DAILY_LICENSE_REVIEWED_AT='2026-10-20T21:12:33Z';
export const CURRENT_DAILY_OPEN_RESOURCES=Object.freeze([
 openResource('11370','上櫃股票行情（含等價、零股、盤後、鉅額交易）','https://www.tpex.org.tw/web/stock/aftertrading/DAILY_CLOSE_quotes/stk_quote_result.php?l=zh-tw&o=data',CURRENT_DAILY_LICENSE_REVIEWED_AT),
 openResource('11371','上櫃股票收盤行情（不含定價）','https://www.tpex.org.tw/web/stock/aftertrading/otc_quotes_no1430/stk_wn1430_result.php?l=zh-tw&se=EW&o=data',CURRENT_DAILY_LICENSE_REVIEWED_AT),
 openResource('11555','盤後資訊每日收盤行情－大盤統計資訊','https://www.twse.com.tw/exchangeReport/MI_INDEX?response=open_data',CURRENT_DAILY_LICENSE_REVIEWED_AT),
]);
const TWSE_TERMS='https://www.twse.com.tw/zh/terms/use.html';
const TWSE_INFO='https://www.twse.com.tw/zh/products/information/use.html';
const TPEX_TERMS='https://www.selaw.com.tw/Chinese/RegulatoryInformationResult/Article?releaseDate=2024-01-23&sysNumber=LW10813063';
/** Exact host + path only; a related open dataset does not license its neighbors. */
export function sourceScope(source:string){
 const url=new URL(source),h=url.hostname,p=url.pathname;
 let source_id='UNREVIEWED_RESOURCE',dataset='未確認的資料資源',related:string[]=[],terms:string[]=[],reason='尚未取得精確來源與用途條款。';
 if(h==='www.twse.com.tw'&&p==='/exchangeReport/STOCK_DAY'){
  source_id='TWSE_STOCK_DAY_HISTORY';dataset='歷史個股量價';related=['11549'];terms=[TWSE_TERMS,TWSE_INFO];reason='實際使用 STOCK_DAY 歷史查詢；開放資料登錄的是 STOCK_DAY_ALL，未取得歷史資源等價授權。';
 }else if(h==='www.twse.com.tw'&&p==='/rwd/zh/fund/T86'){
  source_id='TWSE_T86_HISTORY';dataset='上市三大法人歷史股數';terms=[TWSE_TERMS,TWSE_INFO];reason='需確認精確歷史股數資源、事實引用及會員衍生研究用途；不是法人金額。';
 }else if(h==='www.tpex.org.tw'&&p==='/web/stock/3insti/daily_trade/3itrade_hedge_result.php'){
  source_id='TPEX_INSTITUTIONAL_HISTORY';dataset='上櫃三大法人歷史股數';related=['11856'];terms=[TPEX_TERMS];reason='開放資源列當日 CSV；本次為指定歷史日期的 JSON。需確認涵蓋範圍，不能只因同一處理程式便放行。';
 }else if(h==='mopsov.twse.com.tw'&&/^\/nas\/t21\/(sii|otc)\/t21sc03_\d+_\d+\.csv$/.test(p)){
  source_id=p.includes('/otc/')?'MOPS_REVENUE_OTC_HISTORY':'MOPS_REVENUE_LISTED_HISTORY';dataset='歷史月營收';related=[p.includes('/otc/')?'56510':'18420'];terms=[TWSE_TERMS,OGL];reason='開放清單的現行彙總 CSV 不等於已保存的歷史月份檔；需釐清歷史版本是否同受授權。';
 }else if(h==='mopsov.twse.com.tw'&&p==='/mops/web/ajax_t163sb04'){
  source_id='MOPS_FINANCIAL_YTD_HISTORY';dataset='同期累計財報';related=url.searchParams.get('TYPEK')==='sii'?['91998','20762']:[];terms=[TWSE_TERMS,OGL];reason='實際為歷史季度查詢，不是開放清單資源；目前取回版本也不證明原始申報版本。';
 }else if(h==='mops.twse.com.tw'&&p==='/mops/api/t05st01'){
  source_id='MOPS_MATERIAL_EVENT_HISTORY';dataset='公司重大訊息歷史索引';related=['18418'];terms=[TWSE_TERMS,OGL];reason='上櫃當日重大訊息開放清單不能直接涵蓋所有上市／上櫃歷史查詢與公告全文。';
 }else if(h==='www.twse.com.tw'&&p==='/indicesReport/MI_5MINS_HIST'){
  source_id='TWSE_INDEX_HISTORY';dataset='大盤歷史開收盤';terms=[TWSE_TERMS,TWSE_INFO];reason='大盤比較實際來源為 MI_5MINS_HIST；不可用其他指數或成交值資料集授權代替。';
 }else if(h==='api.fugle.tw'||h==='developer.fugle.tw'){
  source_id='FUGLE_CONTRACT_REQUIRED';dataset='Fugle行情';terms=['https://developer.fugle.tw/docs/data/intro/'];reason='須核对現有契約是否涵蓋指定會員事實及衍生分析用途；API訂閱不自動等於再散布權。';
 }
 const exact=[...OPEN_RESOURCES,...CURRENT_DAILY_OPEN_RESOURCES].find(r=>r.resource===source);
 return {source_id:exact?.source_id??source_id,dataset:exact?.dataset??dataset,source,
  license_type:exact?.license_type??'SOURCE_SPECIFIC_SCOPE_PENDING',
  review_status:exact?'EXACT_OPEN_RESOURCE_VERIFIED':'LICENSING_PENDING',
  permitted_usage:exact?.permitted_usage??reason,commercial_usage:exact?.commercial_usage??'PENDING',
  derivative_usage:exact?.derivative_usage??'PENDING',redistribution:exact?.redistribution??'PENDING',
  attribution_required:exact?.attribution_required??null,attribution:exact?.attribution??'依最終確認的條款顯名；尚未核准用途。',
  free_usage:exact?'CONDITIONAL_ON_LICENSE_COMPLIANCE':'PENDING',premium_usage:exact?'CONDITIONAL_ON_LICENSE_COMPLIANCE':'PENDING',
  raw_display:exact?'CONDITIONAL_ON_LICENSE_COMPLIANCE':'DO_NOT_DISPLAY_UNTIL_CONFIRMED',
  own_analysis:exact?'CONDITIONAL_ON_LICENSE_COMPLIANCE':'PENDING_NOT_A_BLANKET_PROHIBITION',
  evidence_urls:exact?[exact.evidence_url,OGL]:terms,
  related_open_resources:OPEN_RESOURCES.filter(r=>related.some(id=>r.source_id==='DATA_GOV_TW_'+id)),
  reviewed_at:exact?.reviewed_at??LICENSE_REVIEWED_AT,confers_publication_approval:false as const};
}
const valid=(v:string|null)=>v!==null&&Number.isFinite(Date.parse(v));
function bounds(values:(string|null)[]){const v=values.filter((s):s is string=>valid(s)).sort((a,b)=>Date.parse(a)-Date.parse(b));return {first:v[0]??null,last:v.at(-1)??null};}
const kindName:Record<string,string>={RESEARCH_INPUT:'量價',REVENUE:'月營收',INSTITUTIONAL:'法人股數',FINANCIAL_YTD:'同期累計財報',EVENT:'公司公告',BENCHMARK:'大盤比較'};
export function clearanceDossier(card:ReviewCard,audit:Admission){
 if(card.review_hash!==audit.review_hash||card.symbol!==audit.symbol)throw Error('CLEARANCE_REVIEW_MISMATCH');
 const rows=card.evidence.map(e=>({...e,role:card.horizon==='SHORT'&&e.kind==='RESEARCH_INPUT'||card.horizon==='MEDIUM'&&['REVENUE','INSTITUTIONAL'].includes(e.kind)?'ENGINE_INPUT':'SUPPORT_OR_COUNTEREVIDENCE'}));
 const sources=[...new Set(rows.map(e=>e.source))].sort().map(source=>{
  const es=rows.filter(e=>e.source===source);
  return {...sourceScope(source),evidence_count:es.length,evidence_ids:es.map(e=>e.id),
   roles:[...new Set(es.map(e=>e.role))],missing_published:es.filter(e=>!valid(e.published_at)).length,
   published_at:bounds(es.map(e=>e.published_at)),first_seen_at:bounds(es.map(e=>e.first_seen_at)),available_at:bounds(es.map(e=>e.available_at)),as_of:bounds(es.map(e=>e.as_of))};
 });
 return {version:CLEARANCE_VERSION,symbol:card.symbol,review_hash:card.review_hash,
  quality:audit.quality,time_pass:audit.time_valid,licensing_approved:audit.license_valid,owner_approval_ready:audit.owner_approval_ready,
  classification:card.classification,research_at:card.cutoff,reviewed_at:card.reviewed_at,last_checked_at:audit.reviewed_at,expires_at:audit.expires_at,
  receipt_pit_pass:audit.receipt_pit_valid,missing_published:rows.filter(e=>!valid(e.published_at)).length,
  time_issues:rows.flatMap(e=>traceIssues(e,card.cutoff,true).map(reason=>({id:e.id,reason}))),
  groups:[...new Set(rows.map(e=>e.kind))].map(kind=>{const es=rows.filter(e=>e.kind===kind);return {kind,label:kindName[kind]??'其他證據',count:es.length,missing_published:es.filter(e=>!valid(e.published_at)).length,roles:[...new Set(es.map(e=>e.role))]};}),
  sources,changes_research:false as const,grants_created:0 as const};
}
export const CLEARANCE_LABELS={quality:'品質通過',time:'時間證明通過',license:'授權確認',ready:'可以提交Sony核准'};
export type ClearanceMetric=keyof typeof CLEARANCE_LABELS;
export function metricPass(a:Admission,k:ClearanceMetric){return k==='quality'?a.quality==='PASS':k==='time'?a.time_valid:k==='license'?a.license_valid:a.owner_approval_ready;}
export function clearanceCounts(bundle:AdmissionBundle){return Object.fromEntries((Object.keys(CLEARANCE_LABELS) as ClearanceMetric[]).map(k=>[k,bundle.cards.filter(a=>metricPass(a,k)).length])) as Record<ClearanceMetric,number>;}

/** Private Owner workbench contracts. No service credential, analysis call,
 * review default or publication side effect lives in this module. */
import {compareTime,hashValid,snapshotHash,sourceSafe,validObservationTime,type Horizon} from './contracts.ts';
import {DAILY_AI_MARKETS,parseDailyAiMarketOwnerPreviewCardV2,parseDailyAiMarketResearchReferenceV1,
 type DailyAiMarket,type DailyAiMarketCardV2,type DailyAiMarketEditionV2,type DailyAiMarketResearchReferenceV1} from './dailyAiMarketPageV2.ts';

export const MARKET_REVIEW_KINDS=['QUALITY','TIME','SOURCE_USE','METHODOLOGY']as const;
export type MarketReviewKind=typeof MARKET_REVIEW_KINDS[number];
export type MarketReviewStatus='PASS'|'FAIL'|'PENDING';
export const MARKET_REVIEW_LABELS:Record<MarketReviewKind,string>={QUALITY:'資料與分析品質',TIME:'資料時點與效期',SOURCE_USE:'來源使用依據',METHODOLOGY:'方法與限制'};
export type OwnerMarketScope={identity:string;generation:number;signal:AbortSignal;tier:'owner'};
export type OwnerMarketEdition=DailyAiMarketEditionV2&Readonly<{plan_hash:string;method_version:'TAIWAN_MARKET_RESEARCH_V1'}>;
export type OwnerMarketCatalogCursor=Readonly<{prepared_at:string;id:string}>;
export type OwnerMarketCatalog=Readonly<{editions:readonly OwnerMarketEdition[];next_cursor:OwnerMarketCatalogCursor|null;checked_at:string}>;
export type OwnerMarketCompany=Readonly<{security_id:string;market:DailyAiMarket;symbol:string;company:string;short_name:string}>;
export type OwnerMarketSearch=Readonly<{edition_id:string;universe_hash:string;query:string;limit:number;checked_at:string;
 companies:readonly OwnerMarketCompany[];has_more:boolean}>;
type Json=Record<string,unknown>;
export type OwnerMarketReview=Readonly<{id:string;review_hash:string;reviewer_ref:string;statuses:Readonly<Record<MarketReviewKind,MarketReviewStatus>>;
 reason:string;expires_at:string;documents:readonly Readonly<{kind:MarketReviewKind;hash:string;text:string;url:string|null;notes:string|null}>[]}>;
export type OwnerMarketPage=Readonly<{edition:OwnerMarketEdition;cards:readonly DailyAiMarketCardV2[];total:number;start:number;checked_at:string;
 review:OwnerMarketReview|null;publication:null|Readonly<{id:number;action:'APPROVE'|'REVOKE';review_id:string;audience:'free'|'premium'}>;
 rights_ready:boolean;source_use:Readonly<{total:number;approved:number;blocked_sources:readonly string[]}>;
 coverage:readonly Readonly<{market:DailyAiMarket;universe_count:number;analysed_count:number;card_count:number;roster_as_of:string|null;
 price_date:string|null;financial_available_at:string|null;news_available_at:string|null}>[]}>;
export type OwnerMarketInput=Readonly<{edition_id:string;security_id:string;packet_hash:string;analysis_hash:string;company:string;data_through:string;
 evidence:readonly Readonly<{id:string;kind:string;source:string;available_at:string;first_seen_at:string;as_of:string;evidence_hash:string;content:string}>[];
 packet:Json;analysis:Json}>;
export type OwnerMarketReference=Readonly<{horizon:Horizon;summary:DailyAiMarketResearchReferenceV1;reference:Json;
 sources:readonly Readonly<{security_id:string;source_url:string;capture_id:string;source_row_hash:string;received_at:string}>[]}>;
export type OwnerMarketSubmission=Readonly<{schema:'DAILY_AI_MARKET_OWNER_REVIEW_REQUEST_V1';edition_id:string;reason:string;
 documents:readonly Readonly<{kind:MarketReviewKind;status:MarketReviewStatus;document_url:string;notes:string}>[]}>;
export type OwnerMarketCommandKind='REVIEW'|'APPROVE'|'REVOKE';
export type OwnerMarketCommand=Readonly<{schema:'DAILY_AI_OWNER_MARKET_COMMAND_JOURNAL_V1';subject_user_id:string;request_key:string;
 kind:OwnerMarketCommandKind;edition_id:string;request_hash:string;created_at:string}>;
export type OwnerMarketCommandReceipt=Readonly<{state:'RECORDED'|'NOT_RECORDED';kind:OwnerMarketCommandKind|null;edition_id:string|null;
 recorded_at:string|null;result:Json|null}>;
export class OwnerMarketError extends Error{readonly code:string;constructor(code:string){super('AI_MARKET_OWNER_'+code);this.code=code;}}
const fail=(code:string):never=>{throw new OwnerMarketError(code);};
const object=(v:unknown):Json=>v&&typeof v==='object'&&!Array.isArray(v)?v as Json:fail('OBJECT');
const exact=(r:Json,keys:readonly string[])=>{if(Object.keys(r).length!==keys.length||Object.keys(r).some(k=>!keys.includes(k)))fail('FIELDS');};
const text=(v:unknown,max=1500)=>typeof v==='string'&&!!v.trim()&&v.length<=max?v:fail('TEXT');
const hash=(v:unknown)=>{const h=text(v,64);return hashValid(h)?h:fail('HASH');};
const uuid=(v:unknown)=>{const s=text(v,36);return /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(s)?s:fail('IDENTITY');};
const time=(v:unknown)=>{const t=text(v,40);return validObservationTime(t)?t:fail('TIME');};
const date=(v:unknown)=>{const d=text(v,10);return /^\d{4}-\d\d-\d\d$/.test(d)&&validObservationTime(d+'T00:00:00Z')?d:fail('DATE');};
const int=(v:unknown,max=30000)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=max?v:fail('COUNT');
const one=<T extends string>(v:unknown,values:readonly T[]):T=>typeof v==='string'&&values.includes(v as T)?v as T:fail('ENUM');
const list=(v:unknown,max:number)=>Array.isArray(v)&&v.length<=max?v as unknown[]:fail('LIST');
const freeze=<T>(v:T):T=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const url=(v:unknown)=>{const s=text(v,2000);return sourceSafe(s)?s:fail('URL');};
const security=(v:unknown)=>{const s=text(v,20);return /^(TWSE|TPEX|EMERGING):\d{4,6}$/.test(s)?s:fail('SECURITY');};
function active(scope:OwnerMarketScope){uuid(scope.identity);if(scope.tier!=='owner'||scope.signal.aborted||!Number.isSafeInteger(scope.generation)||scope.generation<0)fail('SCOPE');}
function envelope(r:Json,schema:string,scope:OwnerMarketScope){active(scope);if(r.schema!==schema||r.subject_user_id!==scope.identity||r.preview_only!==true||r.research_only!==true)fail('SCOPE');}
async function rawHash(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
function parsed(raw:unknown,max:number):{value:Json;text:string}{const t=text(raw,max);if(new TextEncoder().encode(t).length>max)fail('SIZE');try{return {value:object(JSON.parse(t)),text:t};}catch{return fail('JSON');}}
function edition(value:unknown,now:number):OwnerMarketEdition{
 const e=object(value);exact(e,['id','plan_hash','edition_date','evidence_cutoff','prepared_at','expires_at','analysis_origin','method_version','mode','forecast','performance_available']);
 const result={id:hash(e.id),plan_hash:hash(e.plan_hash),edition_date:date(e.edition_date),evidence_cutoff:time(e.evidence_cutoff),prepared_at:time(e.prepared_at),expires_at:time(e.expires_at),
  analysis_origin:'DETERMINISTIC_SCREENING' as const,method_version:'TAIWAN_MARKET_RESEARCH_V1' as const,mode:'AS_OF_RESEARCH' as const,forecast:false as const,performance_available:false as const};
 if(e.analysis_origin!==result.analysis_origin||e.method_version!==result.method_version||e.mode!==result.mode||e.forecast!==false||e.performance_available!==false
  ||compareTime(result.evidence_cutoff,result.prepared_at)>0||compareTime(result.prepared_at,result.expires_at)>=0||Date.parse(result.prepared_at)>now
  ||new Date(Date.parse(result.evidence_cutoff)+8*3600000).toISOString().slice(0,10)!==result.edition_date)fail('CHRONOLOGY');
 return result; // expired drafts remain inspectable; writes are separately gated.
}
export function parseOwnerMarketCatalog(value:unknown,scope:OwnerMarketScope,now=Date.now()):OwnerMarketCatalog{
 const r=object(structuredClone(value));exact(r,['schema','subject_user_id','preview_only','research_only','checked_at','editions','next_cursor']);envelope(r,'VNEXT_AI_OWNER_MARKET_CATALOG_V2',scope);
 const checked_at=time(r.checked_at);if(Date.parse(checked_at)>now)fail('CHRONOLOGY');
 const editions=list(r.editions,20).map(v=>edition(v,now));if(new Set(editions.map(e=>e.id)).size!==editions.length)fail('DUPLICATE');
 if(editions.some((e,i)=>i>0&&(compareTime(editions[i-1].prepared_at,e.prepared_at)<0||compareTime(editions[i-1].prepared_at,e.prepared_at)===0&&editions[i-1].id<=e.id)))fail('ORDER');
 let next_cursor:OwnerMarketCatalogCursor|null=null;
 if(r.next_cursor!==null){const c=object(r.next_cursor);exact(c,['id','prepared_at']);next_cursor={id:hash(c.id),prepared_at:time(c.prepared_at)};
  const last=editions.at(-1);if(!last||next_cursor.id!==last.id||compareTime(next_cursor.prepared_at,last.prepared_at)!==0)fail('CURSOR');}
 return freeze({checked_at,editions,next_cursor});
}
export function normalizeOwnerMarketSearch(value:unknown):string{
 if(typeof value!=='string')return fail('SEARCH_QUERY');const query=value.trim();
 if([...query].length<1||[...query].length>80||new TextEncoder().encode(query).length>320
  ||[...value].some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)>=127&&c.charCodeAt(0)<=159)
  ||['%','_','\\',"'",';','"','<','>','`','{','}','|','$','*'].some(c=>query.includes(c)))fail('SEARCH_QUERY');
 return query;
}
export function parseOwnerMarketSearch(value:unknown,scope:OwnerMarketScope,expected:{edition_id:string;query:string;limit:number},now=Date.now()):OwnerMarketSearch{
 const r=object(structuredClone(value));exact(r,['schema','subject_user_id','preview_only','research_only','edition_id','universe_hash','query','limit','checked_at','companies','has_more']);
 envelope(r,'VNEXT_AI_OWNER_MARKET_SEARCH_V2',scope);const query=normalizeOwnerMarketSearch(expected.query),checked_at=time(r.checked_at);
 if(r.edition_id!==hash(expected.edition_id)||r.query!==query||r.limit!==expected.limit||!Number.isSafeInteger(expected.limit)
  ||expected.limit<1||expected.limit>20||typeof r.has_more!=='boolean'||Date.parse(checked_at)>now)fail('SEARCH_SCOPE');
 const companies=list(r.companies,expected.limit).map(value=>{const c=object(value);exact(c,['security_id','market','symbol','company','short_name']);
  const row={security_id:security(c.security_id),market:one(c.market,DAILY_AI_MARKETS),symbol:text(c.symbol,6),company:text(c.company,200),short_name:text(c.short_name,200)};
  if(row.security_id!==row.market+':'+row.symbol||!/^\d{4,6}$/.test(row.symbol))fail('SEARCH_IDENTITY');
  const needle=query.toLowerCase().replaceAll('臺','台');
  if(![row.symbol,row.company,row.short_name].some(s=>s.toLowerCase().replaceAll('臺','台').includes(needle)))fail('SEARCH_MATCH');return row;});
 if(new Set(companies.map(c=>c.security_id)).size!==companies.length||r.has_more&&companies.length!==expected.limit
  ||companies.some((c,i)=>i>0&&(DAILY_AI_MARKETS.indexOf(companies[i-1].market)>DAILY_AI_MARKETS.indexOf(c.market)
   ||companies[i-1].market===c.market&&companies[i-1].symbol>=c.symbol)))fail('SEARCH_ORDER');
 return freeze({edition_id:hash(r.edition_id),universe_hash:hash(r.universe_hash),query,limit:expected.limit,checked_at,companies,has_more:r.has_more===true});
}
async function review(value:unknown,documents:unknown,e:OwnerMarketEdition):Promise<OwnerMarketReview|null>{
 if(value===null){if(list(documents,4).length)fail('REVIEW');return null;}
 const r=object(value);exact(r,['id','review_hash','review','review_text']);const raw=parsed(r.review_text,20000),v=raw.value;
 if(await rawHash(raw.text)!==hash(r.review_hash)||await snapshotHash(v)!==await snapshotHash(r.review))fail('REVIEW_HASH');
 exact(v,['schema','edition_id','snapshot_hash','reviewer_ref','quality','time_status','licensing','methodology','document_hashes','reason','expires_at']);
 if(v.schema!=='DAILY_AI_MARKET_REVIEW_V2'||v.edition_id!==e.id||v.snapshot_hash!==e.id)fail('REVIEW_SCOPE');
 const statuses={QUALITY:one(v.quality,['PASS','FAIL','PENDING']),TIME:one(v.time_status,['PASS','FAIL','PENDING']),SOURCE_USE:one(v.licensing,['PASS','FAIL','PENDING']),METHODOLOGY:one(v.methodology,['PASS','FAIL','PENDING'])};
 const hashes=object(v.document_hashes);exact(hashes,MARKET_REVIEW_KINDS);const expires_at=time(v.expires_at);if(compareTime(expires_at,e.expires_at)>0)fail('REVIEW_TIME');
 const result:OwnerMarketReview['documents'][number][]=[];
 for(const item of list(documents,4)){
  const d=object(item);exact(d,['kind','hash','text']);const kind=one(d.kind,MARKET_REVIEW_KINDS),raw=text(d.text,200000),digest=hash(d.hash);
  if(digest!==hash(hashes[kind])||await rawHash(raw)!==digest||result.some(x=>x.kind===kind))fail('REVIEW_DOCUMENT');
  let documentUrl:string|null=null,notes:string|null=null;
  let document:unknown;try{document=JSON.parse(raw);}catch{document=null;}
  if(document&&typeof document==='object'&&!Array.isArray(document)){const p=object(document);if(p.schema==='DAILY_AI_MARKET_OWNER_REVIEW_DOCUMENT_V1'){
   if(p.edition_id!==e.id||p.kind!==kind||p.status!==statuses[kind]||v.reviewer_ref!=='OWNER:'+uuid(p.reviewer_user_id))fail('REVIEW_DOCUMENT');
   documentUrl=url(p.document_url);notes=text(p.notes,8000);
  }}
  result.push({kind,hash:digest,text:raw,url:documentUrl,notes});
 }
 if(result.length!==4)fail('REVIEW_DOCUMENT');
 return {id:uuid(r.id),review_hash:hash(r.review_hash),reviewer_ref:text(v.reviewer_ref,200),statuses,reason:text(v.reason,3000),expires_at,documents:result};
}
export async function parseOwnerMarketPage(value:unknown,scope:OwnerMarketScope,expected:{edition_id:string;start:number;limit:number},now=Date.now()):Promise<OwnerMarketPage>{
 const r=object(structuredClone(value));exact(r,['schema','subject_user_id','preview_only','research_only','edition','cards','total','start','review','publication','rights_ready','checked_at','coverage','source_use','review_documents']);
 envelope(r,'VNEXT_AI_OWNER_MARKET_PAGE_V2',scope);const e=edition(r.edition,now),checked_at=time(r.checked_at),total=int(r.total),start=int(r.start);
 if(e.id!==hash(expected.edition_id)||start!==expected.start||expected.limit<1||expected.limit>60||Date.parse(checked_at)>now)fail('PAGE_SCOPE');
 const cards=await Promise.all(list(r.cards,expected.limit).map(v=>parseDailyAiMarketOwnerPreviewCardV2(v,e)));
 if(cards.length!==Math.min(expected.limit,Math.max(0,total-start))||total%3!==0||new Set(cards.map(c=>c.market+':'+c.symbol+':'+c.horizon)).size!==cards.length)fail('COUNT');
 // SQL orders two fields: security_id, then horizon. Joining horizon with ':'
 // reverses a four-digit symbol and a longer TDR symbol sharing its prefix.
 if(cards.some((c,i)=>{if(!i)return false;const p=cards[i-1],previous=`${p.market}:${p.symbol}`,current=`${c.market}:${c.symbol}`;
  return previous>current||previous===current&&p.horizon>=c.horizon;}))fail('ORDER');
 const coverage=list(r.coverage,3).map(v=>{const c=object(v);exact(c,['market','universe_count','analysed_count','card_count','roster_as_of','price_date','financial_available_at','news_available_at']);
  const row={market:one(c.market,DAILY_AI_MARKETS),universe_count:int(c.universe_count,10000),analysed_count:int(c.analysed_count,10000),card_count:int(c.card_count),
   roster_as_of:c.roster_as_of===null?null:date(c.roster_as_of),price_date:c.price_date===null?null:date(c.price_date),
   financial_available_at:c.financial_available_at===null?null:time(c.financial_available_at),news_available_at:c.news_available_at===null?null:time(c.news_available_at)};
  if(row.analysed_count>row.universe_count||row.card_count!==row.analysed_count*3||row.price_date!==null&&row.price_date>e.edition_date
   ||[row.financial_available_at,row.news_available_at].some(t=>t!==null&&compareTime(t,e.evidence_cutoff)>0))fail('COVERAGE');return row;});
 if(coverage.length!==3||new Set(coverage.map(c=>c.market)).size!==3||coverage.reduce((n,c)=>n+c.card_count,0)!==total)fail('COVERAGE');
 const s=object(r.source_use);exact(s,['total','approved','blocked_sources']);const source_use={total:int(s.total,100000),approved:int(s.approved,100000),blocked_sources:list(s.blocked_sources,20).map(url)};
 if(source_use.approved>source_use.total||source_use.blocked_sources.length!==Math.min(20,source_use.total-source_use.approved)
  ||typeof r.rights_ready!=='boolean'||r.rights_ready!==(source_use.total>0&&source_use.approved===source_use.total))fail('RIGHTS');
 const reviewed=await review(r.review,r.review_documents,e);let publication:OwnerMarketPage['publication']=null;
 if(r.publication!==null){const p=object(r.publication);exact(p,['id','action','review_id','audience']);publication={id:int(p.id,Number.MAX_SAFE_INTEGER),action:one(p.action,['APPROVE','REVOKE']),review_id:uuid(p.review_id),audience:one(p.audience,['free','premium'])};if(!publication.id)fail('PUBLICATION');}
 active(scope);return freeze({edition:e,cards,total,start,checked_at,review:reviewed,publication,coverage,source_use,rights_ready:r.rights_ready as boolean});
}
export async function parseOwnerMarketInput(value:unknown,scope:OwnerMarketScope,page:OwnerMarketPage,securityId:string):Promise<OwnerMarketInput>{
 const r=object(structuredClone(value));exact(r,['schema','subject_user_id','edition_id','security_id','preview_only','research_only','packet_text','packet_hash','analysis_text','analysis_hash']);
 envelope(r,'VNEXT_AI_OWNER_MARKET_INPUT_V2',scope);const id=security(securityId),symbol=id.split(':')[1];
 if(r.edition_id!==page.edition.id||r.security_id!==id)fail('INPUT_SCOPE');
 const p=parsed(r.packet_text,8000000),a=parsed(r.analysis_text,1000000),packetHash=hash(r.packet_hash),analysisHash=hash(r.analysis_hash);
 if(await rawHash(p.text)!==packetHash||await rawHash(a.text)!==analysisHash||a.value.input_hash!==packetHash)fail('INPUT_HASH');
 if(p.value.symbol!==symbol||a.value.symbol!==symbol||compareTime(time(p.value.cutoff),page.edition.evidence_cutoff)!==0
  ||p.value.cutoff!==a.value.cutoff||a.value.schema!=='DAILY_AI_STOCK_ANALYSIS_V2'||a.value.analysis_origin!=='DETERMINISTIC_SCREENING'
  ||a.value.model_generated!==false||a.value.member_published!==false||a.value.method_version!=='TAIWAN_MARKET_RESEARCH_V1')fail('INPUT_SCOPE');
 const evidence:OwnerMarketInput['evidence'][number][]=[];
 for(const raw of list(p.value.evidence,100)){
  const v=object(raw);exact(v,['id','symbol','kind','source','published_at','available_at','time_basis','first_seen_at','as_of','evidence_hash','content']);
  const source=url(v.source),available_at=time(v.available_at),first_seen_at=time(v.first_seen_at),as_of=time(v.as_of),content=text(v.content,200000),digest=hash(v.evidence_hash);
  if(v.symbol!==symbol||v.id!=='market-'+digest.slice(0,40)||await rawHash(content)!==digest||compareTime(available_at,page.edition.evidence_cutoff)>0
   ||compareTime(first_seen_at,available_at)>0||compareTime(as_of,available_at)>0)fail('EVIDENCE');
  if(v.published_at===null?v.time_basis!=='OBSERVED_AFTER_RECEIPT':v.time_basis!=='PUBLISHED'||compareTime(time(v.published_at),available_at)>0)fail('EVIDENCE_TIME');
  evidence.push({id:text(v.id,200),kind:one(v.kind,['PRICE','FINANCIAL','NEWS','MARKET']),source,available_at,first_seen_at,as_of,evidence_hash:digest,content});
 }
 if(!evidence.length||new Set(evidence.map(v=>v.id)).size!==evidence.length)fail('EVIDENCE');
 const horizons=list(a.value.horizons,3).map(object);if(horizons.length!==3||new Set(horizons.map(h=>one(h.horizon,['SHORT','MEDIUM','LONG']))).size!==3)fail('INPUT_HORIZONS');
 for(const card of page.cards.filter(c=>c.market+':'+c.symbol===id)){
  const h=horizons.find(v=>v.horizon===card.horizon)!;
  if(h.status!==card.status||h.confirmation!==card.confirmation||h.invalidation!==card.invalidation||await snapshotHash(h.reason)!==await snapshotHash(card.reason))fail('INPUT_CARD_BINDING');
 }
 const data_through=date(p.value.data_through);if(data_through>page.edition.edition_date)fail('INPUT_TIME');active(scope);
 return freeze({edition_id:page.edition.id,security_id:id,packet_hash:packetHash,analysis_hash:analysisHash,company:text(p.value.company,100),data_through,evidence,packet:p.value,analysis:a.value});
}
export async function parseOwnerMarketReferences(value:unknown,scope:OwnerMarketScope,page:OwnerMarketPage,input:OwnerMarketInput):Promise<readonly OwnerMarketReference[]>{
 active(scope);const expected=page.cards.filter(c=>c.market+':'+c.symbol===input.security_id&&c.research_reference).map(c=>c.research_reference!);
 if(value===null){if(expected.length)fail('REFERENCE_MISSING');return [];}
 const r=object(structuredClone(value));exact(r,['plan_hash','security_id','input_pool_hash','references']);
 if(r.plan_hash!==page.edition.plan_hash||r.security_id!==input.security_id||input.edition_id!==page.edition.id)fail('REFERENCE_SCOPE');
 const pool=hash(r.input_pool_hash),references:OwnerMarketReference[]=[];
 for(const raw of list(r.references,3)){
  const item=object(raw);exact(item,['horizon','summary','reference']);const horizon=one(item.horizon,['SHORT','MEDIUM','LONG']),full=object(item.reference);
  const summary=parseDailyAiMarketResearchReferenceV1(item.summary,input.security_id.split(':')[1],horizon,page.edition.evidence_cutoff);if(!summary)fail('REFERENCE');
  const {reference_hash,...body}=full;if(hash(reference_hash)!==summary.reference_hash||await snapshotHash(body)!==summary.reference_hash||summary.input_pool_hash!==pool
   ||full.security_id!==input.security_id||full.forecast!==false||full.buy_ready!==false||full.production_eligible!==false)fail('REFERENCE_HASH');
  const prices=horizon==='SHORT'?list(full.range,2):list(full.price_scenarios,3);
  if((full.quote_date??full.through)!==summary.quote_date||full.current_price!==summary.current_price||prices[0]!==summary.lower||prices.at(-1)!==summary.upper
   ||horizon==='SHORT'&&(prices.length!==2||full.schema!=='TAIWAN_OBSERVED_PRICE_RANGE_V1'||full.input_packet_hash!==input.packet_hash)
   ||horizon!=='SHORT'&&(prices.length!==3||prices[1]!==summary.median||full.peer_count!==summary.peer_count||full.method!==summary.method_id||full.state!=='CALCULATED_RESEARCH_ONLY'))fail('REFERENCE_VALUES');
  const onCard=expected.find(x=>x.horizon===horizon);if(onCard&&await snapshotHash(onCard)!==await snapshotHash(summary))fail('REFERENCE_CARD_BINDING');
  const sources:OwnerMarketReference['sources'][number][]=[],seen=new Set<string>();let nodes=0;
  const visit=(v:unknown,identity=input.security_id,depth=0)=>{
   if(++nodes>100000||depth>40)fail('REFERENCE_SIZE');if(Array.isArray(v)){v.forEach(x=>visit(x,identity,depth+1));return;}
   if(v===null||typeof v!=='object')return;const o=object(v);if(o.security_id!==undefined)identity=security(o.security_id);
   if(o.capture_id!==undefined||o.source_row_hash!==undefined){const source={security_id:identity,source_url:url(o.source_url),capture_id:hash(o.capture_id),source_row_hash:hash(o.source_row_hash),received_at:time(o.received_at)};
    if(compareTime(source.received_at,page.edition.evidence_cutoff)>0)fail('REFERENCE_TIME');const key=identity+source.capture_id+source.source_row_hash;if(!seen.has(key)){seen.add(key);sources.push(source);}}
   Object.values(o).forEach(x=>visit(x,identity,depth+1));
  };visit(full);
  if(horizon!=='SHORT'&&!sources.length)fail('REFERENCE_SOURCES');references.push({horizon,summary,reference:full,sources});
 }
 if(new Set(references.map(r=>r.horizon)).size!==references.length||expected.some(r=>!references.some(v=>v.horizon===r.horizon)))fail('REFERENCE_MISSING');
 active(scope);return freeze(references);
}
export function prepareOwnerMarketSubmission(value:unknown,editionId:string):OwnerMarketSubmission{
 const r=object(structuredClone(value));exact(r,['schema','edition_id','reason','documents']);
 if(r.schema!=='DAILY_AI_MARKET_OWNER_REVIEW_REQUEST_V1'||r.edition_id!==hash(editionId))fail('SUBMISSION_SCOPE');
 const reason=text(r.reason,3000);if(reason.trim().length<10)fail('SUBMISSION_REASON');
 const documents=list(r.documents,4).map(raw=>{const d=object(raw);exact(d,['kind','status','document_url','notes']);const notes=text(d.notes,8000);if(notes.trim().length<10)fail('SUBMISSION_NOTES');
  return {kind:one(d.kind,MARKET_REVIEW_KINDS),status:one(d.status,['PASS','FAIL','PENDING']),document_url:url(d.document_url),notes};});
 if(documents.length!==4||new Set(documents.map(d=>d.kind)).size!==4)fail('SUBMISSION_DOCUMENTS');
 return freeze({schema:'DAILY_AI_MARKET_OWNER_REVIEW_REQUEST_V1',edition_id:editionId,reason,documents});
}
export function ownerMarketReady(page:OwnerMarketPage,now=Date.now()):boolean{return Date.parse(page.edition.expires_at)>now&&!!page.review&&Date.parse(page.review.expires_at)>now
 &&MARKET_REVIEW_KINDS.every(k=>page.review!.statuses[k]==='PASS')&&page.rights_ready;}
export function ownerMarketPublished(page:OwnerMarketPage,now=Date.now()):boolean{return ownerMarketReady(page,now)&&page.publication?.action==='APPROVE'&&page.publication.review_id===page.review?.id;}

/** The journal contains only an operation identity and hashes, no private
 * packet/review text. Persistence must succeed before sending any mutation. */
export const ownerMarketJournalKey=(identity:string)=>'morning-alpha:owner-market-command:v1:'+uuid(identity);
export async function createOwnerMarketCommand(scope:OwnerMarketScope,kind:OwnerMarketCommandKind,editionId:string,request:unknown,now=Date.now()):Promise<OwnerMarketCommand>{
 active(scope);const request_hash=await snapshotHash(request);active(scope);return freeze({schema:'DAILY_AI_OWNER_MARKET_COMMAND_JOURNAL_V1',subject_user_id:scope.identity,
  request_key:crypto.randomUUID(),kind:one(kind,['REVIEW','APPROVE','REVOKE']),edition_id:hash(editionId),request_hash,created_at:new Date(now).toISOString()});
}
export function parseOwnerMarketCommand(value:unknown,identity:string):OwnerMarketCommand{
 const r=object(value);exact(r,['schema','subject_user_id','request_key','kind','edition_id','request_hash','created_at']);
 if(r.schema!=='DAILY_AI_OWNER_MARKET_COMMAND_JOURNAL_V1'||r.subject_user_id!==uuid(identity))fail('JOURNAL_SCOPE');
 return freeze({schema:'DAILY_AI_OWNER_MARKET_COMMAND_JOURNAL_V1',subject_user_id:identity,request_key:uuid(r.request_key),kind:one(r.kind,['REVIEW','APPROVE','REVOKE']),edition_id:hash(r.edition_id),request_hash:hash(r.request_hash),created_at:time(r.created_at)});
}
export function persistOwnerMarketCommand(storage:Pick<Storage,'setItem'|'getItem'>,command:OwnerMarketCommand){
 const key=ownerMarketJournalKey(command.subject_user_id),raw=JSON.stringify(command);if(storage.getItem(key)!==null)fail('JOURNAL_PENDING');storage.setItem(key,raw);if(storage.getItem(key)!==raw)fail('JOURNAL_WRITE');
}
export function loadOwnerMarketCommand(storage:Pick<Storage,'getItem'>,identity:string):OwnerMarketCommand|null{
 const raw=storage.getItem(ownerMarketJournalKey(identity));if(raw===null)return null;let value:unknown;try{value=JSON.parse(raw);}catch{return fail('JOURNAL_CORRUPT');}return parseOwnerMarketCommand(value,identity);
}
export function clearOwnerMarketCommand(storage:Pick<Storage,'getItem'|'removeItem'>,command:OwnerMarketCommand){
 const current=loadOwnerMarketCommand(storage,command.subject_user_id);if(current?.request_key!==command.request_key)fail('JOURNAL_CHANGED');storage.removeItem(ownerMarketJournalKey(command.subject_user_id));
}
export async function parseOwnerMarketMutationReceipt(value:unknown,scope:OwnerMarketScope,command:OwnerMarketCommand):Promise<Json>{
 active(scope);const r=object(structuredClone(value));if(command.subject_user_id!==scope.identity||r.edition_id!==command.edition_id||typeof r.replayed!=='boolean')fail('RECEIPT_SCOPE');
 if(command.kind==='REVIEW'){
  exact(r,['schema','edition_id','review_id','replayed','member_published','subject_user_id','request_key','submission_hash','review_hash']);
  if(r.schema!=='DAILY_AI_OWNER_MARKET_REVIEW_RECEIPT_V2'||r.subject_user_id!==scope.identity||r.request_key!==command.request_key||r.submission_hash!==command.request_hash||r.member_published!==false)fail('RECEIPT_SCOPE');uuid(r.review_id);hash(r.review_hash);
 }else{
  exact(r,['schema','edition_id','event_id','action','replayed']);if(r.schema!=='DAILY_AI_MARKET_PUBLICATION_V2'||r.action!==command.kind||!int(r.event_id,Number.MAX_SAFE_INTEGER))fail('RECEIPT_SCOPE');
 }
 return freeze(r);
}
export async function parseOwnerMarketCommandReceipt(value:unknown,scope:OwnerMarketScope,command:OwnerMarketCommand):Promise<OwnerMarketCommandReceipt>{
 active(scope);const r=object(structuredClone(value));exact(r,['schema','subject_user_id','request_key','state','kind','edition_id','request_hash','recorded_at','result']);
 if(r.schema!=='DAILY_AI_OWNER_MARKET_COMMAND_V2'||r.subject_user_id!==scope.identity||r.request_key!==command.request_key)fail('RECEIPT_SCOPE');
 if(r.state==='NOT_RECORDED'){if(r.kind!==null||r.edition_id!==null||r.request_hash!==null||r.recorded_at!==null||r.result!==null)fail('RECEIPT_SCOPE');return freeze({state:'NOT_RECORDED',kind:null,edition_id:null,recorded_at:null,result:null});}
 if(r.state!=='RECORDED'||r.kind!==command.kind||r.edition_id!==command.edition_id||r.request_hash!==command.request_hash)fail('RECEIPT_SCOPE');
 const result=await parseOwnerMarketMutationReceipt(r.result,scope,command);active(scope);
 return freeze({state:'RECORDED',kind:command.kind,edition_id:command.edition_id,recorded_at:time(r.recorded_at),result});
}

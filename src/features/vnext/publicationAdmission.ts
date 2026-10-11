/** Independent publication admission, NOT a research selector or Production API.
 * Registries are server-owned, reviewed artifacts; never request-body policies. */
import {snapshotHash,hashValid} from './contracts.ts';
import {traceIssues,usageRights,type Trace,type RightsGrant} from './researchFunnel.ts';
import {verifyReviewBundle,type ReviewBundle,type ReviewCard} from './publicationReview.ts';
import {validProjectionTime} from './projection.ts';

export const ADMISSION_VERSION='VNEXT_INDEPENDENT_PUBLICATION_REVIEW_1';
export type FindingState='PASS'|'FAIL'|'UNVERIFIED';
export type Finding={key:string;state:FindingState;reason:string;evidence_ids:string[];remedy:string};
export type IndependentRecord={review_hash:string;kind:'EVENT_CONTEXT'|'METHODOLOGY';result:'PASS'|'FAIL'|'PENDING';
 reviewer_ref:string;reviewed_at:string;document_hash:string;document_ref:string;reason:string};
export type SourceRecord=Trace&{symbol:string;kind:string};
export type Admission={symbol:string;horizon:ReviewCard['horizon'];review_hash:string;research_hash:string;
 version:string;reviewed_at:string;expires_at:string;quality:'PASS'|'FAIL'|'INCOMPLETE';
 checks:Finding[];matrix:Finding[];time_valid:boolean;receipt_pit_valid:boolean;license_valid:boolean;
 owner_approval_ready:boolean;admission_hash:string};
export type AdmissionBundle={version:string;review_bundle_hash:string;reviewed_at:string;cards:Admission[];snapshot_hash:string};
export type ReviewRegistry={sources:SourceRecord[];independent:IndependentRecord[];grants:RightsGrant[]};
const result=(key:string,state:FindingState,reason:string,evidence_ids:string[]=[],remedy='無需處理'):Finding=>({key,state,reason,evidence_ids,remedy});
const check=(key:string,pass:boolean,reason:string,ids:string[]=[])=>result(key,pass?'PASS':'FAIL',reason,ids,pass?'無需處理':'保留原研究；修復聲明或來源後建立新審查，不覆寫舊紀錄。');
const traceKeys=['source','evidence_hash','published_at','first_seen_at','available_at','as_of'] as const;

/** Does not read card.quality, card.publication or the engine's QUALIFIED as proof.
 * No missing license/timestamp is relabelled a demonstrated analytical error. */
export async function inspectPublication(card:ReviewCard,registry:ReviewRegistry,now:string):Promise<Admission>{
 if(!validProjectionTime(now)||Date.parse(now)<Date.parse(card.reviewed_at))throw Error('ADMISSION_TIME_INVALID');
 const sources=new Map(registry.sources.map(s=>[s.id,s]));
 if(sources.size!==registry.sources.length)throw Error('SOURCE_ID_COLLISION');
 const linked=card.evidence.every(e=>{const s=sources.get(e.id);return s&&s.symbol===e.symbol&&traceKeys.every(k=>s[k]===e[k]);});
 const claims=[...card.supporting,...card.opposing,...card.financial,...card.events];
 const allText=[card.reason,card.confirmation,card.invalidation,...claims.map(c=>c.text)].join('\n');
 const receipt=card.evidence.length>0&&card.evidence.every(e=>traceIssues(e,card.cutoff).length===0);
 const missingTime=card.evidence.filter(e=>traceIssues(e,card.cutoff,true).length);
 const current=Date.parse(now)<Date.parse(card.next_review_at);
 const independent=(kind:IndependentRecord['kind'])=>{
  const entries=registry.independent.filter(r=>r.review_hash===card.review_hash&&r.kind===kind);
  const r=entries.length===1?entries[0]:null;
  if(r&&!['PASS','FAIL','PENDING'].includes(r.result))return result(kind,'UNVERIFIED','審核結果格式不明，不能視為通過',[],'修復審核檔案格式並重新驗證；不得轉成核准。');
  if(!r||!r.reviewer_ref||r.reviewer_ref===card.research_version||!r.reason||!r.document_ref||!hashValid(r.document_hash)||!validProjectionTime(r.reviewed_at)||Date.parse(r.reviewed_at)<Date.parse(card.reviewed_at)||Date.parse(r.reviewed_at)>Date.parse(now))return result(kind,'UNVERIFIED',kind==='EVENT_CONTEXT'?'公司公告內文及影響尚未完成獨立查核':'探索方法尚未取得獨立品質審核',[],kind==='EVENT_CONTEXT'?'取得可合法使用的原公告內文，逐項查核公司關聯與反證，另存審查文件。':'獨立覆核研究方法及適用期間；保留版本、審核人與文件指紋。');
  return result(kind,r.result==='PENDING'?'UNVERIFIED':r.result,r.reason,[r.document_hash],r.result==='PASS'?'無需處理':r.result==='PENDING'?'補齊本項查核證據；待確認不代表品質不合格。':'保留拒絕結果；建立修正版及新審查，不由選股引擎自行核准。');
 };
 const checks=[
  check('SOURCE_LOCK',linked&&card.evidence.length>0,'所有使用證據均對回獨立載入的保存來源與指紋',card.evidence.map(e=>e.id)),
  check('COMPANY',card.evidence.every(e=>e.symbol===card.symbol||e.symbol==='MARKET'&&e.kind==='BENCHMARK'),'公司證據與大盤比較各自具名'),
  check('CLAIM_LINKS',claims.every(c=>c.evidence_ids.every(id=>sources.has(id)&&card.evidence.some(e=>e.id===id)))&&claims.filter(c=>c.kind==='FACT').every(c=>c.evidence_ids.length>0),'事實聲明有本卡來源；未知與條件不冒充事實'),
  check('BALANCE',card.supporting.some(c=>c.kind==='FACT'&&c.evidence_ids.length>0)&&card.opposing.length>0,'支持、反對及未確認限制分開，不把缺資料說成無風險'),
  check('CONFIRMATION',card.confirmation.length>20&&/資料|月營收|交易日/.test(card.confirmation)&&/至少|大於|以上/.test(card.confirmation),'確認條件含具體可觀測資料與原有數值條件'),
  check('INVALIDATION',card.invalidation.length>20&&/撤回|取消|停止/.test(card.invalidation),'失效條件明確取消觀察，不自動下單'),
  check('NO_PROFIT_PROMISE',!/(保證獲利|穩賺|必漲|勝率\s*\d|目標價\s*\d)/.test(allText),'未宣稱保證獲利、無證據目標價或勝率'),
  check('FINANCIAL_BASIS',!card.financial.some(c=>c.kind==='FACT'&&/單季EPS|預估值/.test(c.text)&&!c.text.includes('不')),'累計實績不冒充單季或預估'),
  check('CLASSIFICATION',card.classification==='HISTORICAL_RESEARCH_NOT_RECOMMENDATION','保留研究評估時間；不是當時盤前預測或正式推薦'),
  independent('EVENT_CONTEXT'),independent('METHODOLOGY'),
 ];
 const quality:Admission['quality']=checks.some(c=>c.state==='FAIL')?'FAIL':checks.every(c=>c.state==='PASS')?'PASS':'INCOMPLETE';
 const sourceUrls=[...new Set(card.evidence.map(e=>e.source))];
 const rawUnknown=sourceUrls.filter(s=>!usageRights(s,'RAW_DATA',now,registry.grants).allowed);
 const factUnknown=sourceUrls.filter(s=>!usageRights(s,'OFFICIAL_FACT',now,registry.grants).allowed);
 const derivedUnknown=sourceUrls.filter(s=>!usageRights(s,'OWN_ANALYSIS',now,registry.grants).allowed);
 const license=factUnknown.length===0&&derivedUnknown.length===0;
 const events=card.evidence.filter(e=>e.kind==='EVENT');
 const eventReviewed=checks.find(c=>c.key==='EVENT_CONTEXT')!.state==='PASS';
 const timeValid=receipt&&missingTime.length===0&&current;
 const ready=quality==='PASS'&&timeValid&&license&&card.research_state==='QUALIFIED';
 const matrix=[
  result('DATA_MISSING',eventReviewed?'PASS':'UNVERIFIED',eventReviewed?'公司事件內容查核文件已具備':checks.find(c=>c.key==='EVENT_CONTEXT')!.reason,events.map(e=>e.id),eventReviewed?'本項已完成，不需重新查閱。':'依上列個別原因補齊風險分析或未披露資料；已讀原文不必重抓，新證據不得倒填原研究時間。'),
  result('DATA_INTEGRATION',linked?'PASS':'FAIL',linked?'本卡引用的量價、法人、營收與同期財務均已接入保存來源':'卡片存在找不到的來源或版本差異',card.evidence.map(e=>e.id),linked?'既有資料不用重新抓取；事件影響是否完成，另看個別查核結果。':'修復來源映射，不補造不存在的欄位。'),
  result('TIME_METADATA',timeValid?'PASS':receipt&&current?'UNVERIFIED':'FAIL',!receipt?'取得時間或研究截止不一致':!current?'已到重新檢查時間，不能沿用舊版本':missingTime.length?`${missingTime.length}筆原發布時間未確認；首次取得時間已保存`:'原發布時間、取得時間、研究截止與效期均通過',missingTime.map(e=>e.id),'追索原始發布證明；不得以first_seen代填；到期則建立新研究。'),
  result('METHODOLOGY_QUALITY',quality==='INCOMPLETE'?'UNVERIFIED':quality,quality==='PASS'?'獨立品質審核通過':checks.filter(c=>c.state!=='PASS').map(c=>c.reason).join('；'),checks.filter(c=>c.state!=='PASS').flatMap(c=>c.evidence_ids),'依個別查核項目補齊文件，不改正式推薦或降低研究門檻。'),
  result('RAW_REDISTRIBUTION',rawUnknown.length?'UNVERIFIED':'PASS',rawUnknown.length?`${rawUnknown.length}個精確來源的原始再散布權利未確認；會員投影不輸出原始資料`:'原始資料用途有對應證明',rawUnknown,'保持原始Provider payload與圖表不公開；此項不自動否決自行分析用途。'),
  result('ANALYSIS_COMMERCIAL_RIGHTS',license?'PASS':'UNVERIFIED',license?'事實揭露與自行研究用途各自有明確依據':`事實揭露${factUnknown.length}個、自行分析${derivedUnknown.length}個來源用途待確認`,[...new Set([...factUnknown,...derivedUnknown])],'取得精確資源、商用、衍生與顯名條款；未知不等於已禁止，也不等於已允許。'),
  result('OWNER_APPROVAL','UNVERIFIED',ready?'前置條件已通過，等待Sony逐筆核准':'等待前置條件，不是Owner審核拒絕',[],'前置檢查全部通過後才可提交；此審查不會自動核准。'),
 ];
 const expires=[card.next_review_at,...registry.grants.filter(g=>sourceUrls.includes(g.source)&&g.expires_at&&validProjectionTime(g.expires_at)).map(g=>g.expires_at!)].sort((a,b)=>Date.parse(a)-Date.parse(b))[0];
 const payload={symbol:card.symbol,horizon:card.horizon,review_hash:card.review_hash,research_hash:card.research_hash,version:ADMISSION_VERSION,reviewed_at:now,expires_at:expires,quality,checks,matrix,time_valid:timeValid,receipt_pit_valid:receipt,license_valid:license,owner_approval_ready:ready};
 return {...payload,admission_hash:await snapshotHash(payload)};
}
export async function admissionBundle(review:ReviewBundle,registry:ReviewRegistry,now:string):Promise<AdmissionBundle>{
 if(!await verifyReviewBundle(review,review.funnel_hash))throw Error('REVIEW_LOCK_INVALID');
 const cards=await Promise.all(review.cards.map(c=>inspectPublication(c,registry,now)));
 const payload={version:ADMISSION_VERSION,review_bundle_hash:review.snapshot_hash,reviewed_at:now,cards};
 return {...payload,snapshot_hash:await snapshotHash(payload)};
}
export async function verifyAdmission(bundle:AdmissionBundle,review:ReviewBundle){
 const {snapshot_hash,...p}=bundle;
 return bundle.version===ADMISSION_VERSION&&bundle.review_bundle_hash===review.snapshot_hash&&bundle.cards.length===review.cards.length&&new Set(bundle.cards.map(c=>c.review_hash)).size===bundle.cards.length&&snapshot_hash===await snapshotHash(p)&&(await Promise.all(bundle.cards.map(async c=>{const{admission_hash,...payload}=c;return review.cards.some(r=>r.review_hash===c.review_hash&&r.research_hash===c.research_hash)&&admission_hash===await snapshotHash(payload);}))).every(Boolean);
}
export function admissionSummary(bundle:AdmissionBundle){
 const c=bundle.cards;
 return {reviewed:c.length,quality_pass:c.filter(c=>c.quality==='PASS').length,quality_fail:c.filter(c=>c.quality==='FAIL').length,quality_pending:c.filter(c=>c.quality==='INCOMPLETE').length,licensing_approved:c.filter(c=>c.license_valid).length,licensing_blocked:c.filter(c=>!c.license_valid).length,time_valid:c.filter(c=>c.time_valid).length,time_blocked:c.filter(c=>!c.time_valid).length,receipt_pit_valid:c.filter(c=>c.receipt_pit_valid).length,owner_approval_ready:c.filter(c=>c.owner_approval_ready).length};
}

export type ApprovalEvent={version:string;sequence:number;previous_hash:string|null;research_hash:string;review_hash:string;admission_hash:string;
 action:'APPROVE'|'REVOKE';owner_ref:string;at:string;reason:string;idempotency_key:string;event_hash:string};
/** The server re-inspects trusted stored sources/registries immediately before use. */
export async function appendOwnerDecision(card:ReviewCard,admission:Admission,journal:ApprovalEvent[],request:{action:'APPROVE'|'REVOKE';reason:string;key:string},owner:{verified:boolean;ref:string},now:string){
 if(!owner.verified||!owner.ref)throw Error('OWNER_REQUIRED');
 if(!await verifyJournal(journal))throw Error('AUDIT_CHAIN_INVALID');
 if(!['APPROVE','REVOKE'].includes(request.action)||!request.reason.trim()||request.reason.length>500||!/^[-a-zA-Z0-9_]{16,80}$/.test(request.key))throw Error('DECISION_INVALID');
 if(!validProjectionTime(now)||Date.parse(now)<Date.parse(admission.reviewed_at)||admission.review_hash!==card.review_hash||admission.research_hash!==card.research_hash)throw Error('STALE_REVIEW');
 const prior=journal.find(e=>e.idempotency_key===request.key);
 if(prior){if(prior.review_hash!==card.review_hash||prior.action!==request.action||prior.reason!==request.reason||prior.owner_ref!==owner.ref)throw Error('IDEMPOTENCY_CONFLICT');return prior;}
 if(request.action==='APPROVE'&&(!admission.owner_approval_ready||Date.parse(now)>=Date.parse(admission.expires_at)))throw Error('PREREQUISITES_NOT_PASSED');
 const last=journal.at(-1);
 if(last&&Date.parse(now)<Date.parse(last.at))throw Error('AUDIT_TIME_REGRESSION');
 const p={version:ADMISSION_VERSION,sequence:journal.length+1,previous_hash:last?.event_hash??null,research_hash:card.research_hash,review_hash:card.review_hash,admission_hash:admission.admission_hash,action:request.action,owner_ref:owner.ref,at:now,reason:request.reason,idempotency_key:request.key};
 return {...p,event_hash:await snapshotHash(p)};
}
export async function verifyJournal(rows:ApprovalEvent[]){
 for(let i=0;i<rows.length;i++){const {event_hash,...p}=rows[i];if(p.version!==ADMISSION_VERSION||p.sequence!==i+1||p.previous_hash!==(rows[i-1]?.event_hash??null)||!validProjectionTime(p.at)||!p.owner_ref||!['APPROVE','REVOKE'].includes(p.action)||![p.research_hash,p.review_hash,p.admission_hash].every(hashValid)||event_hash!==await snapshotHash(p))return false;}
 return new Set(rows.map(r=>r.idempotency_key)).size===rows.length;
}
export async function approvedProjection(review:ReviewBundle,admissions:AdmissionBundle,journal:ApprovalEvent[],identity:{verified:boolean;tier:string},now:string,registry?:ReviewRegistry){
 if(!identity.verified||!['free','premium','owner'].includes(identity.tier))return [];
 if(!validProjectionTime(now)||!await verifyReviewBundle(review,review.funnel_hash)||!await verifyAdmission(admissions,review)||!await verifyJournal(journal))throw Error('PROJECTION_LOCK_INVALID');
 // A content hash is not authorization. Recheck the current server-owned
 // registry so a revoked grant/review cannot remain visible via an old hash.
 if(!registry)return [];
 const fresh=new Map((await Promise.all(review.cards.map(c=>inspectPublication(c,registry,now)))).map(a=>[a.review_hash,a]));
 const visible=review.cards.filter(c=>{
  const a=admissions.cards.find(a=>a.review_hash===c.review_hash)!,e=journal.filter(e=>e.research_hash===c.research_hash).at(-1);
  return fresh.get(c.review_hash)?.owner_approval_ready&&a.owner_approval_ready&&Date.parse(now)>=Date.parse(a.reviewed_at)&&Date.parse(now)<Date.parse(a.expires_at)&&e?.action==='APPROVE'&&e.review_hash===c.review_hash&&e.admission_hash===a.admission_hash&&Date.parse(e.at)<=Date.parse(now);
 }).sort((a,b)=>a.symbol.localeCompare(b.symbol)||a.horizon.localeCompare(b.horizon));
 return (identity.tier==='free'?visible.slice(0,3):visible).map(c=>{
  const summary={symbol:c.symbol,company:c.company,horizon:c.horizon,reason:c.reason,risk:c.opposing[0]?.text??'研究尚未驗證獲利',updated_at:c.reviewed_at,through:c.through,classification:'歷史研究觀察，不是今日推薦'};
  return identity.tier==='free'?summary:{...summary,supporting:c.supporting.map(x=>x.text),opposing:c.opposing.map(x=>x.text),confirmation:c.confirmation,invalidation:c.invalidation,next_review_at:c.next_review_at};
 });
}

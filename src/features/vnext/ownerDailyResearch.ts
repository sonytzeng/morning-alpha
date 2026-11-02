import {HORIZONS,sourceSafe,type Horizon} from './contracts.ts';
import {verifyDailyLock,type DailyLock} from './dailyIntelligence.ts';
import {memberTaipeiDate} from './member.ts';
import {previousMarketTradingDate} from '../../../supabase/functions/_shared/market-session-contract.mjs';

export const OWNER_DAILY_STATES=['NOT_OBSERVED','QUEUED','RUNNING','COMPLETE','BLOCKED','EXPIRED'] as const;
export type OwnerDailyResearch={business_date:string;state:typeof OWNER_DAILY_STATES[number];reason:string|null;source_count:number;
 rows:DailyLock[];through:string|null;evidence_cutoff:string|null;locked_at:string|null;member_published:0};
const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('OWNER_DAILY_OBJECT');return v as Record<string,unknown>;};
const text=(v:unknown,max=3000)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;

/** Read only the existing authenticated Owner projection. A saved evaluation
 * is never an approval, an executable price plan or a measured trade. */
export async function parseOwnerDailyResearch(value:unknown,requestDate:string,now=Date.now()):Promise<OwnerDailyResearch>{
 const encoded=JSON.stringify(value);if(!encoded||encoded.length>12_000_000)throw Error('OWNER_DAILY_LIMIT');
 // Own all lock preimages before the first hash await.
 const p=object(JSON.parse(encoded));
 if(!Number.isFinite(now)||memberTaipeiDate(now)!==requestDate||p.business_date!==requestDate
  ||!OWNER_DAILY_STATES.includes(p.state as OwnerDailyResearch['state'])||p.member_published!==0
  ||p.performance_sample!==0||p.analysis_value!=='INSUFFICIENT_SAMPLE'
  ||!Number.isInteger(p.source_count)||Number(p.source_count)<0
  ||p.reason!==null&&(!text(p.reason,200)||!/^[A-Z0-9_:.-]+$/.test(String(p.reason)))
  ||!Array.isArray(p.predictions)||p.predictions.length!==0&&p.predictions.length!==216)throw Error('OWNER_DAILY_SCOPE');
 const rows=p.predictions as DailyLock[],seen=new Set<string>(),ids=new Set<string>();
 let through:string|null=null,cutoff:string|null=null,lockedAt:string|null=null,runKey:string|null=null;
 const stocks=new Map<string,{company:string;evidence_hash:string}>();
 for(const candidate of rows){
  const l=object(candidate),r=object(l.research);
  if(!text(l.id,200)||!text(l.symbol,6)||!/^\d{4,6}$/.test(String(l.symbol))||!text(l.company,100)
   ||l.business_date!==requestDate||l.mode!=='FORWARD_SHADOW'||l.provenance!=='RETAINED_REAL_EVIDENCE'
   ||!Object.hasOwn(HORIZONS,String(l.horizon))||!['QUALIFIED','REJECTED','INSUFFICIENT'].includes(String(r.state))
   ||r.evaluated!==(r.state!=='INSUFFICIENT')||r.mode!=='RETAINED_SNAPSHOT_REVIEW_NOT_FORWARD'
   ||['reason','confirmation','invalidation','risk'].some(k=>!text(r[k]))||r.company!==l.company
   ||!Array.isArray(r.reasons)||r.reasons.length>100||r.reasons.some(v=>!text(v,300))
   ||!Array.isArray(r.used)||r.used.length>500||r.used.some(v=>!sourceSafe(String(object(v).source)))
   ||r.state==='QUALIFIED'&&(r.reasons.length!==0||r.used.length===0)||r.state!=='QUALIFIED'&&r.reasons.length===0
   ||r.cutoff!==l.evidence_cutoff||r.next_review_at!==l.next_review_at||r.version!==l.strategy_version
   ||r.through!==previousMarketTradingDate('TW',requestDate)
   ||Date.parse(String(l.locked_at))>now||Date.parse(String(l.actionable_at))!==Date.parse(requestDate+'T09:00:00+08:00')
   ||!await verifyDailyLock(candidate))throw Error('OWNER_DAILY_LOCK');
  const key=String(l.symbol)+':'+String(l.horizon),id=String(l.id),suffix=':'+key;
  if(!id.endsWith(suffix)||ids.has(id)||seen.has(key))throw Error('OWNER_DAILY_UNIVERSE');
  const prefix=id.slice(0,-suffix.length),prior=stocks.get(String(l.symbol));
  if(runKey!==null&&runKey!==prefix||cutoff!==null&&cutoff!==l.evidence_cutoff||lockedAt!==null&&lockedAt!==l.locked_at
   ||prior&&(prior.company!==l.company||prior.evidence_hash!==l.evidence_hash))throw Error('OWNER_DAILY_MIXED_BATCH');
  runKey=prefix;cutoff=String(l.evidence_cutoff);lockedAt=String(l.locked_at);through=String(r.through);
  stocks.set(String(l.symbol),{company:String(l.company),evidence_hash:String(l.evidence_hash)});ids.add(id);seen.add(key);
 }
 if(rows.length&&(stocks.size!==72||Object.keys(HORIZONS).some(h=>rows.filter(l=>l.horizon===h).length!==72))
  ||p.state==='NOT_OBSERVED'&&rows.length)throw Error('OWNER_DAILY_UNIVERSE');
 return {business_date:requestDate,state:p.state as OwnerDailyResearch['state'],reason:p.reason as string|null,
  source_count:Number(p.source_count),rows,through,evidence_cutoff:cutoff,locked_at:lockedAt,member_published:0};
}

export function ownerDailyReason(reason:string|null){
 const labels:Record<string,string>={ACQUISITION_CONTINUATION:'正在分批取得研究資料。',CANONICAL_PUBLICATION_PENDING:'等待今日市場資料完成確認。',
  ACQUIRED_SNAPSHOT_CONTINUATION:'來源快照已保存，正在接續評估。',EVALUATION_CONTINUATION:'正在接續整理與評估。',
  OUTCOME_SOURCE_CONTINUATION:'已保存今日評估，正在取得先前研究追蹤資料。',SOURCE_RETRY_PENDING:'來源暫時未回應，依既有排程重試。',
  FORWARD_PREPARATION_CONTINUATION:'正在整理資料並完成評估。',COLD_BOOTSTRAP_WITH_IMMUTABLE_LOCK:'今日評估已保存，其餘來源與結果追蹤仍在補齊。',
  COLD_BOOTSTRAP_NO_LATE_FORWARD:'資料仍在補齊，本次尚未完成盤前評估。',OUTCOME_CONTINUATION:'今日評估已保存，正在更新先前研究的追蹤狀態。',
  LATE_ACQUISITION_NOT_FORWARD:'本次資料未能在盤前期限內備妥，沒有補寫成事前評估。',FORWARD_TIME_INVALID:'本次未通過盤前時間核對，不能當成有效事前評估。',
  DATABASE_RPC_REJECTED:'研究資料存取未完成，需修復後重試。'};
 return reason?labels[reason]??'本次流程仍在處理或等待下一步，尚未確認完成。':null;
}
export function ownerDailyCounts(data:OwnerDailyResearch,horizon:Horizon){
 const rows=data.rows.filter(r=>r.horizon===horizon);
 return {saved:rows.length,evaluated:rows.filter(r=>r.research.evaluated).length,qualified:rows.filter(r=>r.research.state==='QUALIFIED').length,
  rejected:rows.filter(r=>r.research.state==='REJECTED').length,insufficient:rows.filter(r=>r.research.state==='INSUFFICIENT').length};
}

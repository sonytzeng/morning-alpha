import type { EntryEvaluation, EntryResult, Strategy } from '../../types/research-source-contracts';
import { currentMarket, type TradingLabData } from './tradingLab';
import { PUBLIC_REGIMES } from '../../lib/publicMarketReadModel';
import {snapshotHash} from '../vnext/contracts';
export type CockpitEntry=Pick<EntryEvaluation,'business_date'|'evaluation_time'|'mode'|'universe'|'scanned'|'candidates'>&{source_kind?:'DAILY_FORWARD_LOCKS'};
export const strategyNames:Record<Strategy,string>={OVERSOLD_REVERSAL:'大跌後是否出現反彈機會',PULLBACK_ENTRY:'上漲趨勢中的回檔買點',BREAKOUT_CONTINUATION:'突破後是否還值得跟進'};
export const entryNames:Record<EntryResult['status'],string>={ENTRY_READY:'符合研究進場條件',WAIT_CONFIRMATION:'值得觀察，等待確認',AVOID_ENTRY:'目前不建議進場',INSUFFICIENT_EVIDENCE:'資料不足，暫時無法判斷'};
export function taipeiToday(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
export function isCurrentResearch(row:CockpitEntry|null,today:string,now=Date.now()){
 return Boolean(row&&row.mode==='FORWARD'&&row.business_date===today&&Date.parse(row.evaluation_time)<=now);
}
export function cockpitToday(lab:TradingLabData|null,entry:CockpitEntry|null,today:string){
 const valid=lab?.business_date===today&&lab.canonical?.report_date===today&&lab.canonical?.status==='READY';
 const market=valid&&lab?currentMarket(lab):null;
 const current=isCurrentResearch(entry,today);
 const count=(status:string)=>current?new Set(entry!.candidates.filter(c=>c.status===status).map(c=>c.symbol)).size:null;
 return {market,watch:count('WAIT_CONFIRMATION'),ready:count('ENTRY_READY'),currentResearch:current};
}
export const plainAction=(s:string)=>({WAIT:'先等條件確認，不急著進場',AVOID:'先避開風險，暫不進場',ENTER:'依正式條件研究機會，不代表直接買入'}[s]||'操作條件尚未確認，先不推定');
const regimeLabels:Record<string,string>={...PUBLIC_REGIMES,trending:'趨勢行情',volatile:'波動較大'};
export const plainRegime=(s:string)=>Object.hasOwn(regimeLabels,s)?regimeLabels[s]:'市場型態尚未確認';
// Display vocabulary only: preserve direction, signs, numbers and research meaning.
export function plainEvidence(text:string){
 const labels:Record<string,string>={UP:'上漲',DOWN:'下跌',FLAT:'持平',SOX:'費城半導體指數',SPX:'標普500指數',TSM:'台積電ADR',NVDA:'輝達'};
 return text.replace(/\b(?:UP|DOWN|FLAT|SOX|SPX|TSM|NVDA)\b/g,key=>labels[key]);
}
export function filterResearch(candidates:EntryResult[],query:string,status:string){
 const q=query.trim().toLocaleLowerCase();return candidates.filter(c=>(status==='ALL'||c.status===status)&&(!q||`${c.symbol} ${c.name||''}`.toLocaleLowerCase().includes(q)));
}
// Display metadata only: never changes an immutable research result or its evidence.
export function researchStockNames(rows:unknown,symbols:string[]):Record<string,string>{
 const allowed=new Set(symbols),names:Record<string,string>={},conflicts=new Set<string>();
 if(!Array.isArray(rows))return names;
 for(const row of rows){
  if(!row||typeof row.symbol!=='string'||!allowed.has(row.symbol)||typeof row.stock_name!=='string')continue;
  const name=row.stock_name.trim();if(!name||name.length>80)continue;
  if(names[row.symbol]&&names[row.symbol]!==name)conflicts.add(row.symbol);
  names[row.symbol]=name;
 }
 for(const symbol of conflicts)delete names[symbol];
 return names;
}
export function safePlan(c:EntryResult){const p=c.plan;if(c.status==='INSUFFICIENT_EVIDENCE'||!p)return null;
 return [p.reference_range[0],p.reference_range[1],p.stop,p.target,p.risk_distance,p.reward_space,p.reward_risk].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>0)?p:null;}
export type JournalRow={id:string;sequence:number;book:'LIVE'|'PAPER';symbol:string;action:'BUY'|'SELL'|'VOID';quantity:number|null;price:number|null;fee:number|null;tax:number|null;other_cost:number|null;occurred_at:string;reason:string;replaces:string|null;superseded?:boolean};
export type Position={book:'LIVE'|'PAPER';symbol:string;quantity:number;cost:number|null;average_cost:number|null;realized:number|null;mark:{price:number;at:string;business_date:string;phase:string}|null;unrealized:number|null};
export type Journal={version:'OWNER_COCKPIT_LEDGER_V1';method:'MOVING_AVERAGE_V1';positions:Position[];audit:JournalRow[];as_of:string};
export function readJournal(v:unknown):Journal{const j=v as Journal;if(!j||j.version!=='OWNER_COCKPIT_LEDGER_V1'||j.method!=='MOVING_AVERAGE_V1'||!Array.isArray(j.positions)||!Array.isArray(j.audit)||j.positions.some(p=>!['LIVE','PAPER'].includes(p.book)||!Number.isFinite(p.quantity)||p.quantity<0))throw Error('JOURNAL_CONTRACT');return j;}
export function totalKnown(rows:Position[],key:'realized'|'unrealized'){return rows.some(r=>r[key]===null)?null:rows.reduce((n,r)=>n+(r[key]||0),0);}
export const money=(n:number|null|undefined)=>typeof n==='number'&&Number.isFinite(n)?n.toLocaleString('zh-TW',{minimumFractionDigits:0,maximumFractionDigits:2}):'暫時無法可靠計算';

/** Read projection of the existing Owner-only RPC. Never evaluates a strategy,
 * writes a prediction, grants member access or adds performance samples. */
export async function dailyLockedEntry(value:unknown,today:string,now=Date.now()):Promise<CockpitEntry|null>{
 const object=(x:unknown):Record<string,unknown>=>{
  if(!x||typeof x!=='object'||Array.isArray(x))throw Error('DAILY_ENTRY_CONTRACT');
  return x as Record<string,unknown>;
 };
 const data=object(value),rows=data.predictions;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(today)||!Number.isFinite(now)||taipeiToday(new Date(now))!==today||data.business_date!==today
  ||data.member_published!==0||data.performance_sample!==0||data.analysis_value!=='INSUFFICIENT_SAMPLE'
  ||!Array.isArray(rows)||rows.length!==0&&rows.length!==216)throw Error('DAILY_ENTRY_CONTRACT');
 if(!rows.length)return null;
 // Own the response before the first digest await; a caller cannot replace a
 // later horizon or a price after the corresponding lock has been checked.
 const encoded=JSON.stringify(rows);if(encoded.length>12_000_000)throw Error('DAILY_ENTRY_LIMIT');
 const locks=JSON.parse(encoded) as unknown[],seen=new Set<string>(),ids=new Set<string>();
 const stocks=new Map<string,{entries:EntryResult[];digest:string}>();let cutoff:string|null=null;
 const time=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)?Date.parse(v):NaN;
 for(const raw of locks){
  const lock=object(raw),research=object(lock.research),{lock_hash,...body}=lock;
  const symbol=String(lock.symbol),horizon=String(lock.horizon),key=symbol+':'+horizon;
  const generated=time(lock.generated_at),locked=time(lock.locked_at),at=time(lock.evidence_cutoff),actionable=time(lock.actionable_at);
  if(typeof lock_hash!=='string'||!/^[a-f0-9]{64}$/.test(lock_hash)||lock_hash!==await snapshotHash(body)
   ||typeof lock.id!=='string'||!lock.id||ids.has(lock.id)||seen.has(key)||!/^\d{4,6}$/.test(symbol)
   ||!['SHORT','MEDIUM','LONG'].includes(horizon)||lock.business_date!==today||lock.mode!=='FORWARD_SHADOW'
   ||lock.provenance!=='RETAINED_REAL_EVIDENCE'||lock.strategy_version!=='VNEXT_OBSERVATION_HYPOTHESIS_2.0.0'
   ||lock.entry_version!=='ENTRY_OPPORTUNITY_1.0.0'||research.symbol!==symbol||research.horizon!==horizon
   ||lock.confirmation!==research.confirmation||lock.invalidation!==research.invalidation
   ||!Number.isFinite(at)||!Number.isFinite(generated)||!Number.isFinite(locked)||!Number.isFinite(actionable)
   ||at>generated||generated>locked||locked>now||locked>=actionable||actionable!==Date.parse(today+'T09:00:00+08:00')
   ||typeof lock.evidence_hash!=='string'||!/^[a-f0-9]{64}$/.test(lock.evidence_hash)
   ||!Array.isArray(lock.entry)||lock.entry.length!==3||lock.entry_gap!==null)throw Error('DAILY_ENTRY_LOCK');
  if(cutoff!==null&&cutoff!==lock.evidence_cutoff)throw Error('DAILY_ENTRY_CUTOFF');cutoff=String(lock.evidence_cutoff);
  const strategies=new Set<string>();
  for(const rawEntry of lock.entry){
   const e=object(rawEntry),strategy=String(e.strategy),status=String(e.status);
   if(e.symbol!==symbol||!Object.hasOwn(strategyNames,strategy)||!Object.hasOwn(entryNames,status)||strategies.has(strategy)
    ||e.strategy_version!==strategy+'_1.0.0'||!Array.isArray(e.reasons)||!e.reasons.every(r=>typeof r==='string')
    ||!Array.isArray(e.evidence_refs)||!e.evidence_refs.every(r=>typeof r==='string')
    ||e.entry_trigger!==null&&typeof e.entry_trigger!=='string'||e.invalidation!==null&&typeof e.invalidation!=='string')throw Error('DAILY_ENTRY_RESULT');
   strategies.add(strategy);
   if(e.plan!==null){const p=object(e.plan),range=p.reference_range;
    if(status==='INSUFFICIENT_EVIDENCE'||!Array.isArray(range)||range.length!==2
     ||![...range,p.trigger,p.stop,p.target,p.risk_distance,p.max_risk].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>0)
     ||![p.reward_space,p.reward_risk].every(n=>typeof n==='number'&&Number.isFinite(n))
     ||range[0]!==p.trigger||range[0]>range[1]||Number(p.stop)>=Number(p.trigger)||Number(p.target)<=range[1]
     ||typeof p.not_before!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(p.not_before)||p.expires_on!==p.not_before||p.not_before<today)throw Error('DAILY_ENTRY_PLAN');
   }
  }
  const digest=await snapshotHash(lock.entry),prior=stocks.get(symbol);
  if(prior&&prior.digest!==digest)throw Error('DAILY_ENTRY_HORIZON_CONFLICT');
  if(!prior)stocks.set(symbol,{entries:lock.entry as EntryResult[],digest});
  ids.add(lock.id);seen.add(key);
 }
 if(stocks.size!==72||[...stocks.keys()].some(s=>['SHORT','MEDIUM','LONG'].some(h=>!seen.has(s+':'+h))))throw Error('DAILY_ENTRY_UNIVERSE');
 return {business_date:today,evaluation_time:cutoff!,mode:'FORWARD',universe:72,scanned:72,
  source_kind:'DAILY_FORWARD_LOCKS',candidates:[...stocks].sort(([a],[b])=>a.localeCompare(b)).flatMap(([,s])=>s.entries)};
}

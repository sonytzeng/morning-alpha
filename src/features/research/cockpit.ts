import type { EntryEvaluation, EntryResult, Strategy } from '../../../research/entry-opportunity';
import { currentMarket, type TradingLabData } from './tradingLab';
export const strategyNames:Record<Strategy,string>={OVERSOLD_REVERSAL:'大跌後是否出現反彈機會',PULLBACK_ENTRY:'上漲趨勢中的回檔買點',BREAKOUT_CONTINUATION:'突破後是否還值得跟進'};
export const entryNames:Record<EntryResult['status'],string>={ENTRY_READY:'符合研究進場條件',WAIT_CONFIRMATION:'值得觀察，等待確認',AVOID_ENTRY:'目前不建議進場',INSUFFICIENT_EVIDENCE:'資料不足，暫時無法判斷'};
export function taipeiToday(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
export function isCurrentResearch(row:EntryEvaluation|null,today:string,now=Date.now()){
 return Boolean(row&&row.mode==='FORWARD'&&row.business_date===today&&Date.parse(row.evaluation_time)<=now);
}
export function cockpitToday(lab:TradingLabData|null,entry:EntryEvaluation|null,today:string){
 const valid=lab?.business_date===today&&lab.canonical?.report_date===today&&lab.canonical?.status==='READY';
 const market=valid&&lab?currentMarket(lab):null;
 const current=isCurrentResearch(entry,today);
 const count=(status:string)=>current?new Set(entry!.candidates.filter(c=>c.status===status).map(c=>c.symbol)).size:null;
 return {market,watch:count('WAIT_CONFIRMATION'),ready:count('ENTRY_READY'),currentResearch:current};
}
export const plainAction=(s:string)=>({WAIT:'先等條件確認，不急著進場',AVOID:'先避開風險，暫不進場',ENTER:'依正式條件研究機會，不代表直接買入'}[s]||'操作條件尚未確認，先不推定');
export const plainRegime=(s:string)=>({range:'震盪／盤整',trending:'趨勢行情',volatile:'波動較大',risk_off:'風險偏高'}[s]||'市場型態尚未確認');
export function filterResearch(candidates:EntryResult[],query:string,status:string){
 const q=query.trim().toLocaleLowerCase();return candidates.filter(c=>(status==='ALL'||c.status===status)&&(!q||`${c.symbol} ${c.name||''}`.toLocaleLowerCase().includes(q)));
}
export function safePlan(c:EntryResult){const p=c.plan;if(c.status==='INSUFFICIENT_EVIDENCE'||!p)return null;
 return [p.reference_range[0],p.reference_range[1],p.stop,p.target,p.risk_distance,p.reward_space,p.reward_risk].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>0)?p:null;}
export type JournalRow={id:string;sequence:number;book:'LIVE'|'PAPER';symbol:string;action:'BUY'|'SELL'|'VOID';quantity:number|null;price:number|null;fee:number|null;tax:number|null;other_cost:number|null;occurred_at:string;reason:string;replaces:string|null;superseded?:boolean};
export type Position={book:'LIVE'|'PAPER';symbol:string;quantity:number;cost:number|null;average_cost:number|null;realized:number|null;mark:{price:number;at:string;business_date:string;phase:string}|null;unrealized:number|null};
export type Journal={version:'OWNER_COCKPIT_LEDGER_V1';method:'MOVING_AVERAGE_V1';positions:Position[];audit:JournalRow[];as_of:string};
export function readJournal(v:unknown):Journal{const j=v as Journal;if(!j||j.version!=='OWNER_COCKPIT_LEDGER_V1'||j.method!=='MOVING_AVERAGE_V1'||!Array.isArray(j.positions)||!Array.isArray(j.audit)||j.positions.some(p=>!['LIVE','PAPER'].includes(p.book)||!Number.isFinite(p.quantity)||p.quantity<0))throw Error('JOURNAL_CONTRACT');return j;}
export function totalKnown(rows:Position[],key:'realized'|'unrealized'){return rows.some(r=>r[key]===null)?null:rows.reduce((n,r)=>n+(r[key]||0),0);}
export const money=(n:number|null|undefined)=>typeof n==='number'&&Number.isFinite(n)?n.toLocaleString('zh-TW',{minimumFractionDigits:0,maximumFractionDigits:2}):'暫時無法可靠計算';

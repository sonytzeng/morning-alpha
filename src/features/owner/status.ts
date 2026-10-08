// Owner presentation only. Never evaluates or overwrites an official business verdict.
export type RecordValue = Record<string, unknown>;
export const object = (v: unknown): RecordValue => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as RecordValue : {};
export const rows = (v: unknown): RecordValue[] => Array.isArray(v) ? v.map(object) : [];
export const text = (v: unknown): string => typeof v === 'string' ? v : '';
export const numeric = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null;
export type OwnerStatus = 'PASS'|'DEGRADED'|'CORE_FAIL'|'WAITING'|'NOT_OBSERVED'|'DATA_MISSING'|'ACTION_REQUIRED';
export const STATUS_LABEL: Record<OwnerStatus,string> = {
 PASS:'正常', DEGRADED:'可以使用，部分功能受限', CORE_FAIL:'核心服務異常', WAITING:'等待中',
 NOT_OBSERVED:'尚未取得驗證結果', DATA_MISSING:'資料不足', ACTION_REQUIRED:'需要處理',
};
export type SummaryItem = {key:string;title:string;status:OwnerStatus;detail:string;date?:string};
export function taipeiDate(iso:string) { return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso)); }
export function taipeiTime(iso:string) { return new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(iso)); }
export function readOwnerStatus(input:unknown):RecordValue {
 const r=object(input);
 if(r.schema_version!=='OWNER_BACKEND_STATUS_V1'||r.business_writes!==0||!/^\d{4}-\d{2}-\d{2}$/.test(text(r.today_date))||!Number.isFinite(Date.parse(text(r.as_of)))||!Array.isArray(r.calendar)||!Array.isArray(r.schedule)||taipeiDate(text(r.as_of))!==r.today_date)throw Error('OWNER_READ_CONTRACT_INVALID');
 return r;
}
function cronMatch(field:string,value:number):boolean {
 if(field==='*')return true;
 return field.split(',').some(part=>{
  if(/^\d+$/.test(part))return Number(part)===value;
  if(/^\d+-\d+$/.test(part)){const [a,b]=part.split('-').map(Number);return value>=a&&value<=b;}
  return false;
 });
}
/** Only the actual allowlisted cron expressions, scheduler timezone and official
 * calendar returned by the server are used. Unsupported schedules remain unknown. */
export function scheduledEvents(r:RecordValue):{name:string;at:string}[] {
 if(!['GMT','UTC','Etc/UTC'].includes(text(r.cron_timezone)))return [];
 const events:{name:string;at:string}[]=[];
 for(const day of rows(r.calendar).filter(d=>d.is_trading_day===true)) {
  const start=Date.parse(`${day.date}T00:00:00+08:00`);
  for(const job of rows(r.schedule).filter(j=>j.active===true)) {
   const f=text(job.expression).trim().split(/\s+/);
   if(f.length!==5||!/^\d+(,\d+)*$/.test(f[0])||!/^\d+(,\d+)*$/.test(f[1]))continue;
   for(const offset of [-1,0])for(const hour of f[1].split(',').map(Number))for(const minute of f[0].split(',').map(Number)){
    if(hour>23||minute>59)continue;
    const date=new Date(`${day.date}T00:00:00Z`);date.setUTCDate(date.getUTCDate()+offset);date.setUTCHours(hour,minute);
    if(date.getTime()<start||date.getTime()>=start+86400000)continue;
    if(cronMatch(f[2],date.getUTCDate())&&cronMatch(f[3],date.getUTCMonth()+1)&&cronMatch(f[4],date.getUTCDay()))events.push({name:text(job.name),at:date.toISOString()});
   }
  }
 }
 return events.sort((a,b)=>a.at.localeCompare(b.at));
}
function pending(r:RecordValue,job:string,deadline?:string):OwnerStatus {
 const day=rows(r.calendar).find(x=>x.date===r.today_date);
 if(day?.is_trading_day===false)return 'WAITING';
 if(day?.is_trading_day!==true)return 'NOT_OBSERVED';
 const now=Date.parse(text(r.as_of)),due=scheduledEvents(r).find(x=>x.name===job&&taipeiDate(x.at)===r.today_date);
 if(!due)return 'NOT_OBSERVED';
 if(now<Date.parse(due.at))return 'WAITING';
 const sla=rows(r.sla).find(x=>x.key===deadline&&x.active===true);
 if(sla?.deadline && now>=Date.parse(`${r.today_date}T${sla.deadline}+08:00`))return 'ACTION_REQUIRED';
 return 'NOT_OBSERVED';
}
export function officialStatus(value:unknown):OwnerStatus {
 if(['PASS','DEGRADED','CORE_FAIL'].includes(text(value)))return value as OwnerStatus;
 if(value==='FAIL')return 'ACTION_REQUIRED';
 if(value==='NOT_DUE'||value==='WAITING')return 'WAITING';
 return 'NOT_OBSERVED';
}
export function ownerSummary(r:RecordValue) {
 const today=text(r.today_date),acceptance=object(r.acceptance),report=object(r.report),line=object(r.line);
 const runtime=object(r.runtime).business_date===today?object(r.runtime):{};
 const currentTimestamp=(value:unknown)=>Number.isFinite(Date.parse(text(value)))&&Date.parse(text(value))<=Date.parse(text(r.as_of))&&taipeiDate(text(value))===today;
 const currentAcceptance=acceptance.business_date===today;
 const status=currentAcceptance?officialStatus(acceptance.overall_status||acceptance.verdict):'NOT_OBSERVED';
 const currentReport=report.business_date===today;
 const batch=rows(r.batches).find(b=>b.checkpoint==='PREMARKET');
 const reportPending=pending(r,'morning-alpha-daily-generate-primary','premarket_delivery_0730');
 const linePending=pending(r,'morning-alpha-daily-deliver-primary','premarket_delivery_0730');
 const corePending=pending(r,'morning-alpha-daily-refresh-primary','premarket_delivery_0730');
 const count=numeric(line.total),sent=numeric(line.sent),failed=numeric(line.failed);
 const recommendation=currentReport?text(report.recommendation_status)|| (currentAcceptance?text(object(acceptance.dimensions).RECOMMENDATION):''):'';
 const published=currentReport&&report.publication_status==='PUBLISHED'&&report.publication_date===today;
 const decisionReady=runtime.business_date===today&&runtime.decision_status==='READY';
 const reportWaiting=rows(r.calendar).find(x=>x.date===today)?.is_trading_day===false?'今天是台股休市日，系統依正式交易日曆等待下一交易日。':
  report.business_date?'今天的報告尚未到產生時間，目前顯示上一交易日報告。':'今天的報告尚未到產生時間，目前尚無可顯示的歷史報告。';
 const completeBatch=batch?.status==='COMMITTED'&&batch.committed_provider_count===11&&batch.expected_provider_count===11&&currentTimestamp(batch.committed_at);
 const items:SummaryItem[]=[
  {key:'decision',title:'今日市場判斷',status:decisionReady?'PASS':corePending,detail:decisionReady?'今日正式市場判斷已建立。':'等待當日正式市場判斷；不以昨日內容冒充。',date:today},
  {key:'report',title:'每日報告',status:published?'PASS':reportPending,detail:published?'今日報告已正式發布。':currentReport?'報告已產生，但尚未確認正式發布；不能當作已完成。':reportPending==='WAITING'?reportWaiting:reportPending==='ACTION_REQUIRED'?'已超過正式交付目標，尚未取得今日報告，需要確認。':'尚未取得今日報告，不能判定已完成。',date:text(report.business_date)},
  {key:'line',title:'LINE 發送',status:failed!==null&&failed>0?'ACTION_REQUIRED':count!==null&&count>0&&sent===count&&failed===0&&currentTimestamp(line.last_sent_at)?'PASS':linePending,detail:count!==null&&count>0?`已發送 ${sent??'未知'}／${count}；失敗 ${failed??'未知'}。`:'尚未觀察到今日正式發送紀錄。',date:today},
  {key:'market',title:'市場資料',status:completeBatch?'PASS':batch?'DATA_MISSING':corePending,detail:batch?`盤前已提交 ${batch.committed_provider_count}／${batch.expected_provider_count} 組資料。`:'等待正式市場資料，不以舊資料補足。',date:today},
  {key:'recommendation',title:'股票推薦評估',status:!currentReport?reportPending:['READY','QUALIFIED','NONE','NO_QUALIFIED_OPPORTUNITY'].includes(recommendation)?'PASS':recommendation==='BLOCKED'?'DATA_MISSING':'NOT_OBSERVED',detail:recommendation==='BLOCKED'?'正式個股評估資料不足，暫不發布推薦；這不代表市場沒有機會。':['NONE','NO_QUALIFIED_OPPORTUNITY'].includes(recommendation)?'評估完成，今天沒有符合正式條件的股票。':['READY','QUALIFIED'].includes(recommendation)?'正式推薦評估已完成。':'尚未取得正式推薦評估結果。',date:text(report.business_date)},
 ];
 const next=scheduledEvents(r).find(x=>Date.parse(x.at)>Date.parse(text(r.as_of)));
 const intraday=new Set(rows(r.batches).filter(b=>['0900','0930','1030','1300','1410','1430'].includes(text(b.checkpoint))&&b.status==='COMMITTED'&&b.committed_provider_count===11&&b.expected_provider_count===11&&currentTimestamp(b.committed_at)).map(b=>b.checkpoint));
 const learning=object(r.learning).business_date===today?object(r.learning):{};
 const closing=object(r.closing).business_date===today?object(r.closing):{};
 const closingComplete=closing.data_quality==='高可信'&&closing.missing_count===0&&closing.has_result===true&&currentTimestamp(closing.updated_at);
 const flow:SummaryItem[]=[...items.filter(x=>['report','market','line','recommendation'].includes(x.key)),
  {key:'intraday',title:'盤中追蹤',status:intraday.size?'PASS':pending(r,'morning-alpha-runtime-0900-primary'),detail:intraday.size?`已完成 ${intraday.size}／6 個盤中節點；${intraday.size===6?'今日盤中節點已完成。':'後續依正式排程更新。'}`:'尚未取得今日盤中節點。',date:today},
  {key:'closing',title:'收盤驗證',status:closingComplete?'PASS':runtime.closing_status==='FAILED'?'ACTION_REQUIRED':closing.has_result===true?'DATA_MISSING':pending(r,'morning-alpha-runtime-1430-primary','closing_verification_completion'),detail:closingComplete?'今日收盤驗證已完成；完成驗證不代表市場方向預測命中。':closing.has_result===true?'收盤驗證資料仍不足，不以盤中節點完成冒充完整驗證。':'等待正式收盤驗證結果。',date:today},
  {key:'learning',title:'分析流程',status:learning.status==='succeeded'?'PASS':learning.status==='degraded'?'DEGRADED':learning.status==='failed'?'ACTION_REQUIRED':pending(r,'morning-alpha-cle-primary'),detail:learning.status==='degraded'?'部分分析資料不足，已保留受限結果；不冒充完整學習。':learning.status==='succeeded'?'今日分析流程已完成。':'尚未取得今日分析流程完成結果。',date:today},
 ];
 const concerns=flow.filter(x=>['CORE_FAIL','ACTION_REQUIRED'].includes(x.status));
 const limited=flow.filter(x=>x.status==='DATA_MISSING');
 return {status,acceptanceDate:text(acceptance.business_date),items,flow,next,
  action:concerns.length?`需要確認：${concerns.map(x=>x.title).join('、')}。請展開技術詳細資料查看正式紀錄；不要手動重送。`:
   status==='PASS'&&limited.length&&!flow.some(x=>x.status==='NOT_OBSERVED')?`核心服務可使用；${limited.map(x=>x.title).join('、')}資料仍不足。不需手動補資料，系統會依既定排程更新。`:
   status==='PASS'&&!flow.some(x=>['NOT_OBSERVED','DATA_MISSING'].includes(x.status))?'目前不需要操作，系統會依既定排程執行。':
   '目前仍有等待或未驗證項目；先看各項說明，不要手動補資料或重送訊息。'};
}

import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import type {AcademyAccess} from '@/pages/academy/useAcademyAccess';
import {HORIZONS} from '@/features/vnext/contracts';
import type {DailyAiOwnerPriceRow} from '@/features/vnext/dailyAiOwnerPricePlans';
import {parseDailyAiOwnerPriceCalculation,type DailyAiOwnerPriceCalculation as Calculation,type OwnerCalculationDetails,type OwnerPriceCalculationAudit} from '@/features/vnext/dailyAiOwnerPriceCalculation';
import './daily-ai-owner-calculation.css';

const date=(value:string)=>new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(value));
const percent=(value:number)=>new Intl.NumberFormat('zh-TW',{style:'percent',maximumFractionDigits:10}).format(value);
const names:Record<string,string>={conservative:'保守情境',base:'基準情境',upside:'較高情境'};
const methodNames:Record<string,string>={SHORT_ATR_CONDITIONAL_V1:'ATR 與價格窗口條件',MEDIUM_EPS_PE_SCENARIOS_V1:'稀釋 EPS × 本益比情境',LONG_FCFE_DISCOUNT_SCENARIOS_V1:'每股 FCFE 折現情境',LONG_EPS_DIVIDEND_TERMINAL_PE_SCENARIOS_V1:'股利與末期本益比折現情境'};
const sourceNames:Record<string,string>={PRICE:'價格',FINANCIAL:'財務',NEWS:'公告／新聞',MARKET:'市場'};
const earningsNames:Record<string,string>={FORWARD_12_MONTH_DILUTED_EPS:'明列未來十二個月稀釋 EPS',NORMALIZED_12_MONTH_DILUTED_EPS:'明列正常化十二個月稀釋 EPS',FIXED_12_MONTH_DILUTED_EPS_ASSUMPTION:'固定十二個月稀釋 EPS 假設',REPORTED_FOUR_QUARTER_DILUTED_EPS_SUM:'四季揭露稀釋 EPS 合計'};

export function OwnerPriceCalculationContent(props:{audit:OwnerPriceCalculationAudit;context?:'PRICE_PLAN'}|{audit:OwnerCalculationDetails;context:'LONG_PREPARATION'}){
 const {audit}=props,storedAudit=props.context==='LONG_PREPARATION'?null:props.audit;
 const selection=audit.selection,short=audit.short,dividendMethod=audit.method_id==='LONG_EPS_DIVIDEND_TERMINAL_PE_SCENARIOS_V1';
 const methodName=methodNames[audit.method_id]??audit.method_id;
 return <div className="dac-content">
  <p className="dac-notice">{storedAudit?'這是價格產出時保存的計算與待審紀錄。最新獨立審查、Owner 核准或撤回狀態，仍以價格卡片為準。':'這是未完成長期選股審查的研究計算。這份準備物不構成正式價格計畫；需求、競爭優勢與估值判斷仍待審查，會員閱讀資格未變更。'}</p>
  <section><h4>資料與分析時間</h4><dl className="dac-facts">
   <div><dt>收盤資料截至</dt><dd>{audit.data_through} · NT${String(audit.quote)}</dd></div>
   <div><dt>來源證據截止</dt><dd>{date(audit.cutoff)}</dd></div>
   <div><dt>假設形成時間</dt><dd>{date(audit.assumptions_at)}</dd></div>
   <div><dt>本次計算時間</dt><dd>{date(audit.as_of)}</dd></div>
   <div><dt>{storedAudit?'價格有效至':'計算有效至'}</dt><dd>{date(audit.expires_at)}</dd></div>
  </dl><p className="dac-caption">時間均為台北時間。{audit.assumptions_after_cutoff?'假設形成在來源截止之後，這是後續分析，不能當作截止時已確定的預測。':'本次保留原始來源與假設形成時間；計算結果本身不建立績效紀錄。'}</p></section>
  <section><h4>使用什麼方法與假設？</h4><p><strong>{methodName}</strong></p><p>{audit.assumption_description}</p>
   {audit.forecast_period&&<p>{audit.reported_eps?'已揭露獲利期間':'EPS 期間'}：{audit.forecast_period.start}～{audit.forecast_period.end}；{earningsNames[audit.earnings_basis??'']??audit.earnings_basis}。</p>}
   {audit.dilution_description&&<p>每稀釋普通股基準：{audit.dilution_description}</p>}
   {selection&&<p>研究區間取「{names[selection.entry_scenarios[0]]??selection.entry_scenarios[0]}」到「{names[selection.entry_scenarios[1]]??selection.entry_scenarios[1]}」，各乘以（1 − {percent(selection.margin_of_safety)}）後，向下取至 NT$0.01。這是研究顯示精度，尚未認定為交易所下單單位。</p>}
  </section>
  {audit.reported_eps&&<section><h4>歷史起點：四季揭露稀釋 EPS 合計</h4><p>期間 {audit.reported_eps.period.start}～{audit.reported_eps.period.end}；四季合計 {audit.reported_eps.reported_sum_decimal} 元／股。</p>
   <p>這是四季各自揭露的稀釋 EPS 比率相加，沒有重新加權年度股數分母，也不是未來獲利預測。</p>
   <div className="dac-table-scroll" tabIndex={0} role="region" aria-label="已揭露季度稀釋 EPS 來源表"><table><thead><tr><th scope="col">季度</th><th scope="col">來源揭露稀釋 EPS</th><th scope="col">對應來源</th></tr></thead><tbody>{audit.reported_eps.quarters.map(q=><tr key={q.period}><th scope="row">{q.period}</th><td>{q.reported_decimal}</td><td><code>{q.evidence_id}</code></td></tr>)}</tbody></table></div>
  </section>}
  {short&&<section><h4>短期條件逐步核對</h4><p>前窗口高點加明列 tick 作為觸發條件，再用算術平均 ATR 計算區間上界與停止參考價。</p>
   <dl className="dac-facts"><div><dt>完整價格窗口</dt><dd>{short.bar_window[0]}～{short.bar_window.at(-1)}</dd></div>
    <div><dt>ATR 期間</dt><dd>{short.atr_period} 期 · 算術平均，非 Wilder 平滑</dd></div>
    <div><dt>True Range 原值</dt><dd>{short.true_ranges.map(String).join('、')}</dd></div>
    <div><dt>ATR 計算值</dt><dd>{String(short.atr)}</dd></div><div><dt>前 {short.breakout_lookback} 期窗口高點</dt><dd>NT${String(short.prior_window_high)}</dd></div>
    <div><dt>區間寬度</dt><dd>ATR × {String(short.entry_atr_width)}</dd></div><div><dt>停止參考距離</dt><dd>ATR × {String(short.stop_atr_multiple)}</dd></div>
    <div><dt>明列研究 tick</dt><dd>NT${String(short.tick_size)}</dd></div><div><dt>公司行動覆蓋來源</dt><dd><code>{short.corporate_actions_evidence_id}</code></dd></div>
   </dl><p className="dac-caption">可重現算式不等於已校準策略；目前沒有由這份計算驗證的勝率、報酬或成交能力。</p></section>}
  {audit.scenarios.length>0&&<section><h4>{audit.horizon==='MEDIUM'?'EPS 與本益比如何形成情境價值？':dividendMethod?'股利與末期股價如何折成今日價值？':'現金流如何折成今日價值？'}</h4>
   <p>{audit.reported_eps?'已揭露 EPS 的來源列在上方；本益比、未來成長、配息及折現條件仍是明列假設。':'下表列出明列假設與計算結果。'}情境名稱不代表發生機率，也不會自動視為公司預測。</p>
   <div className="dac-table-scroll" tabIndex={0} role="region" aria-label="價格情境計算表，可左右捲動"><table><caption>{methodName} · 原始計算值</caption>
    <thead><tr><th scope="col">情境</th>{audit.horizon==='MEDIUM'?<><th scope="col">{audit.reported_eps?'四季揭露稀釋 EPS 合計':'稀釋 EPS 假設'}</th><th scope="col">本益比假設</th></>:dividendMethod?<><th scope="col">必要報酬率假設</th><th scope="col">股利現值合計</th><th scope="col">末期股價現值</th></>:<><th scope="col">折現率假設</th><th scope="col">明列年度現值</th><th scope="col">終值現值</th></>}<th scope="col">每股情境價值</th></tr></thead>
    <tbody>{audit.scenarios.map(s=><tr key={s.name}><th scope="row">{names[s.name]??s.name}</th>{audit.horizon==='MEDIUM'?<><td>{String(s.eps)}</td><td>{String(s.pe)} 倍</td></>:s.dividend?<><td>{percent(s.dividend.required_return)}</td><td>{String(s.dividend.dividend_present_value)}</td><td>{String(s.dividend.terminal.present_value)}</td></>:<><td>{percent(s.discount_rate??0)}</td><td>{String(s.explicit_period_pv)}</td><td>{s.terminal?String(s.terminal.present_value):'未納入終值'}</td></>}<td>NT${String(s.value)}</td></tr>)}</tbody>
   </table></div>
   {audit.horizon==='LONG'&&!dividendMethod&&audit.scenarios.map(s=><details key={s.name}><summary>{names[s.name]??s.name}：逐年 FCFE 與終值</summary>
    <p>依本方法的輸入定義，FCFE 須是扣除再投資、淨債務與非控制權益調整後的每稀釋普通股金額，按各年年底折現；計算不代替這些假設的審查。</p>
    <div className="dac-table-scroll" tabIndex={0} role="region" aria-label={`${names[s.name]??s.name}逐年現金流表`}><table><thead><tr><th scope="col">年度</th><th scope="col">FCFE 假設</th><th scope="col">折現後價值</th></tr></thead><tbody>{s.cashflows.map(flow=><tr key={flow.year}><th scope="row">第 {flow.year} 年</th><td>{String(flow.fcfe)}</td><td>{String(flow.present_value)}</td></tr>)}</tbody></table></div>
    {s.terminal?<dl className="dac-facts"><div><dt>獨立明列的下一年 FCFE</dt><dd>{String(s.terminal.next_fcfe)}</dd></div><div><dt>終值成長率</dt><dd>{percent(s.terminal.growth)}</dd></div><div><dt>終值折現前</dt><dd>{String(s.terminal.undiscounted_value)}</dd></div><div><dt>終值占總價值</dt><dd>{percent(s.terminal.fraction)}</dd></div></dl>:<p>本情境明列不使用終值。</p>}
   </details>)}
   {dividendMethod&&audit.scenarios.map(s=>s.dividend?<details key={s.name}><summary>{names[s.name]??s.name}：逐年 EPS、股利與末期股價</summary>
    <p>以四季已揭露稀釋 EPS 合計 {String(s.dividend.base_eps)} 為起點，各年的成長率與配息率均為明列假設。</p>
    <div className="dac-table-scroll" tabIndex={0} role="region" aria-label={`${names[s.name]??s.name}逐年股利情境表`}><table><thead><tr><th scope="col">年度</th><th scope="col">成長率假設</th><th scope="col">EPS 推算</th><th scope="col">配息率假設</th><th scope="col">股利推算</th><th scope="col">股利現值</th></tr></thead>
     <tbody>{s.dividend.years.map(y=><tr key={y.year}><th scope="row">第 {y.year} 年</th><td>{percent(y.growth_rate)}</td><td>{String(y.eps)}</td><td>{percent(y.payout_ratio)}</td><td>{String(y.dividend)}</td><td>{String(y.present_value)}</td></tr>)}</tbody></table></div>
    <dl className="dac-facts"><div><dt>第 {s.dividend.terminal.year} 年 EPS 推算</dt><dd>{String(s.dividend.terminal.eps)}</dd></div><div><dt>末期本益比假設</dt><dd>{String(s.dividend.terminal.pe)} 倍</dd></div><div><dt>末期股價推算</dt><dd>NT${String(s.dividend.terminal.value)}</dd></div><div><dt>末期股價占總現值</dt><dd>{percent(s.dividend.terminal.fraction)}</dd></div></dl>
    <p className="dac-caption">末期股價依假設本益比推算，不保證未來市場願意採用該倍數；逐年推算也不等於已發生的財報結果。</p>
   </details>:null)}
  </section>}
  <section><h4>本次實際引用的來源</h4><p>每筆來源均與已保存輸入的完整內容 hash 核對；這項核對不取代資料品質或用途權限審查。</p>
   <div className="dac-sources">{audit.sources.map(source=><details key={source.id}><summary>{sourceNames[source.kind]} · {new URL(source.source).hostname} · {source.id}</summary>
    <a href={source.source} target="_blank" rel="noopener noreferrer">開啟來源</a>
    <dl className="dac-facts"><div><dt>原發布時間</dt><dd>{source.published_at?date(source.published_at):'未提供'}</dd></div><div><dt>本次可用時間</dt><dd>{date(source.available_at)}</dd></div>
     {source.first_seen_at&&<div><dt>首次收到時間</dt><dd>{date(source.first_seen_at)}</dd></div>}{source.as_of&&<div><dt>原始資料時點</dt><dd>{date(source.as_of)}</dd></div>}
    </dl><p>來源 SHA-256：<code>{source.evidence_hash}</code></p><details><summary>查看已保存的來源內容</summary><pre>{source.content}</pre></details>
   </details>)}</div>
  </section>
  <details><summary>完整方法原文與限制</summary><h4>公式推導原文</h4><pre>{audit.derivation}</pre><h4>保存的假設</h4><ul>{audit.assumptions.map((s,i)=><li key={i}>{s}</li>)}</ul><h4>方法限制原文</h4><ul>{audit.limitations.map((s,i)=><li key={i}>{s}</li>)}</ul></details>
  {storedAudit&&<details><summary>版本識別與原始審查文件</summary><p>以下識別可將輸入、計算與待審文件對回同一份價格。文件仍保留產出當時的 PENDING 狀態，並非最新審查結果。</p>
   <dl className="dac-facts"><div><dt>輸入</dt><dd><code>{audit.input_hash}</code></dd></div><div><dt>計算</dt><dd><code>{audit.calculation_hash}</code></dd></div><div><dt>方法文件</dt><dd><code>{storedAudit.method_note_hash}</code></dd></div><div><dt>待審文件</dt><dd><code>{storedAudit.review_request_hash}</code></dd></div><div><dt>保存時間</dt><dd>{date(audit.recorded_at)}</dd></div></dl>
   <details><summary>原始計算 JSON</summary><pre>{JSON.stringify(JSON.parse(audit.raw.calculation_text),null,2)}</pre></details>
   <details><summary>原始方法文件 JSON</summary><pre>{JSON.stringify(JSON.parse(storedAudit.raw.method_note_text),null,2)}</pre></details>
   <details><summary>原始待審文件 JSON</summary><pre>{JSON.stringify(JSON.parse(storedAudit.raw.review_request_text),null,2)}</pre></details>
  </details>}
 </div>;
}

type ReadState={access:AcademyAccess;row:DailyAiOwnerPriceRow;data:Calculation|null;error:boolean;missingReader:boolean};
export default function DailyAiOwnerPriceCalculation({access,row,onClose}:{access:AcademyAccess;row:DailyAiOwnerPriceRow;onClose:()=>void}){
 const [read,setRead]=useState<ReadState|null>(null),[revision,setRevision]=useState(0),heading=useRef<HTMLElement|null>(null);
 const latest=useRef({access,row});latest.current={access,row};
 useEffect(()=>{
  setRead(null);if(access.kind!=='member'||access.catalog.tier!=='owner'||access.signal.aborted)return;
  const controller=new AbortController();let live=true,timer:ReturnType<typeof setTimeout>|undefined,abort:(()=>void)|undefined;
  const current=()=>live&&latest.current.access===access&&latest.current.row===row&&!access.signal.aborted;
  const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('READ_TIMEOUT'));},8000);});
  const canceled=new Promise<never>((_,reject)=>{abort=()=>{controller.abort();if(live&&latest.current.access===access&&latest.current.row===row)setRead(null);reject(Error('READ_SCOPE_ENDED'));};access.signal.addEventListener('abort',abort,{once:true});if(access.signal.aborted)abort();});
  const request=Promise.resolve().then(async()=>{
   if(!current())throw Error('READ_SCOPE_ENDED');
   const response=await supabase.rpc('get_daily_ai_owner_price_calculation_v1',{p_edition_id:row.body.edition_id,p_plan_hash:row.plan_hash}).abortSignal(controller.signal);
   if(response.error)throw Error(response.error.code==='PGRST202'||response.error.code==='42883'?'READER_UNAVAILABLE':'READ_FAILED');
   return parseDailyAiOwnerPriceCalculation(response.data,row,access.id);
  });
  void Promise.race([request,deadline,canceled]).then(data=>{if(current())setRead({access,row,data,error:false,missingReader:false});})
   .catch(error=>{if(current())setRead({access,row,data:null,error:true,missingReader:error instanceof Error&&error.message==='READER_UNAVAILABLE'});})
   .finally(()=>{clearTimeout(timer);controller.abort();});
  heading.current?.focus();
  return()=>{live=false;clearTimeout(timer);controller.abort();if(abort)access.signal.removeEventListener('abort',abort);};
 },[access,row,revision]);
 if(access.kind!=='member'||access.catalog.tier!=='owner'||access.signal.aborted)return null;
 const current=read?.access===access&&read.row===row?read:null;
 return <section className="dac-panel" id="owner-price-calculation-detail" ref={heading} tabIndex={-1} aria-labelledby="owner-price-calculation-heading">
  <div className="dac-heading"><div><p>Owner 私人計算明細</p><h3 id="owner-price-calculation-heading">{row.body.symbol} · {HORIZONS[row.body.horizon].label}</h3></div><button type="button" onClick={onClose}>關閉計算明細</button></div>
  {!current?<p role="status">正在讀取這份價格的計算、假設與來源，並核對內容識別。</p>:current.error?<div role="status"><p>{current.missingReader?'這個版本尚未提供計算明細讀取功能。':'計算明細暫時無法核對，已隱藏未確認的內容。'}價格與獨立審查狀態未變更。</p><button type="button" onClick={()=>setRevision(value=>value+1)}>重新讀取計算明細</button></div>:current.data?.audit?<OwnerPriceCalculationContent audit={current.data.audit}/>:<p role="status">這份價格計畫沒有已保存的完整計算紀錄。目前只能核對卡片上的價格依據與獨立審查，不能從空白紀錄推定方法已通過。</p>}
 </section>;
}

import {HORIZONS,type Horizon} from '@/features/vnext/contracts';
import type {memberMarketSummary} from '@/features/vnext/member';
export default function PublicExperience({market,loading}:{market:ReturnType<typeof memberMarketSummary>;loading:boolean}){
 return <main className="vnext-content" id="stock-observations">
  <section className="vnext-intro"><p className="vnext-eyebrow">股票觀察</p><h1>先看市場，再決定要研究什麼</h1><p>依短期、中期、長期整理理由與風險。研究觀察不是正式買進推薦。</p></section>
  <section className="vm-market" aria-label="市場方向摘要"><h2>最近已確認的市場摘要</h2>
   {market?<><p>{market.date}：{market.direction} · {market.regime}</p><strong>{market.action}</strong><p>完整市場風險與取消條件，請查看同一日期的正式市場分析。這不是個股進場指令。</p></>
   :<p>{loading?'正在讀取公開摘要。':'目前尚未取得可確認的市場摘要，不以舊日期或研究結果代替今天的判斷。'}</p>}
   <a href="/report/today">查看市場分析與風險</a></section>
  <section className="vnext-grid vm-introductions" aria-label="股票研究期間">{(Object.keys(HORIZONS) as Horizon[]).map(h=><article className="vnext-card" key={h}><h2>{HORIZONS[h].label}</h2><p>{HORIZONS[h].duration}</p><p>{{SHORT:'觀察量價、相對表現及近期事件，等待具體條件確認。',MEDIUM:'觀察營收、財務與公司事件是否持續支持原本的看法。',LONG:'觀察需求、獲利、估值與長期風險；缺少證據就不下結論。'}[h]}</p></article>)}</section>
  <section className="vnext-card vm-join"><h2>登入後，可以看哪些內容？</h2><p>免費會員：每日最多3檔已核准摘要與主要風險。沒有合格研究時，不會硬湊股票。</p><p>Premium：依既有有效會員權益閱讀完整已核准研究、支持與反對理由、確認與失效條件。</p><a className="vnext-primary" href="/login?next=%2Fstocks">免費註冊／登入</a><a href="/pricing">查看現有會員方案</a><p>所有研究都必須完成品質、時間、資料使用權及逐筆審核，才會提供會員。</p></section>
  <section className="vnext-card"><h2>第一次接觸股票？</h2><p>股票學院從基礎、K線、成交量開始；免費入門與完整課程分開標示。</p><a href="/academy">認識股票學院</a></section>
 </main>;
}

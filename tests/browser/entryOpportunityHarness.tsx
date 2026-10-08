import {createRoot} from 'react-dom/client';
import EntryOpportunity from '../../src/pages/admin/analysis/EntryOpportunity';
import '../../src/index.css';
import '../../src/pages/admin/analysis/analysis.css';
const real=document.documentElement.dataset.evidenceKind==='real-retained';
createRoot(document.getElementById('root')!).render(<div className="owner-analysis-layout min-h-screen"><main className="mx-auto max-w-5xl p-4 sm:p-8"><p className="text-white">{real?'本機私有研究 · 真實保存資料重播 · 不是 Forward 績效，尚未正式發布':'隔離工程驗收 · 合成情境，不是真實投資績效，也不是 Sony 本人驗收'}</p>
 {real?<nav aria-label="真實研究日期" className="my-4 flex flex-wrap gap-4">{['2026-10-07','2026-10-08'].map(date=><a className="rounded bg-teal-800 p-3 text-white" key={date} href={'/__entry_owner?role=owner&date='+date}>{date}</a>)}</nav>:null}
 <button className="my-4 rounded border bg-navy-900 p-3 text-surface-100" onClick={()=>window.dispatchEvent(new Event('synthetic-logout'))}>模擬登出</button><EntryOpportunity/><section id="my-owner-trades">Paper Trade 既有入口示意，不建立交易；本機隔離身分不是 Sony 正式 Owner 驗收</section></main></div>);

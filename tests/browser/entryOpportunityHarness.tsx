import {createRoot} from 'react-dom/client';
import EntryOpportunity from '../../src/pages/admin/analysis/EntryOpportunity';
import '../../src/index.css';
import '../../src/pages/admin/analysis/analysis.css';
createRoot(document.getElementById('root')!).render(<div className="owner-analysis-layout min-h-screen"><main className="mx-auto max-w-5xl p-4 sm:p-8"><p className="text-white">隔離工程驗收 · 合成情境，不是真實投資績效，也不是 Sony 本人驗收</p><button className="my-4 rounded border bg-navy-900 p-3 text-surface-100" onClick={()=>window.dispatchEvent(new Event('synthetic-logout'))}>模擬登出</button><EntryOpportunity/><section id="my-owner-trades">Paper Trade 既有入口示意，不建立交易</section></main></div>);

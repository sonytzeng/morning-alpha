import {createRoot} from 'react-dom/client';
import OwnerCockpit from '../../src/pages/admin/analysis/OwnerCockpit';
import '../../src/index.css';
import '../../src/pages/admin/analysis/analysis.css';
createRoot(document.getElementById('root')!).render(<div className="owner-analysis-layout min-h-screen"><main className="mx-auto max-w-7xl p-4 sm:p-8"><p className="text-white">本機隔離驗收：真實保存的歷史研究＋合成測試帳務。不是正式 Sony 身分或真實交易。本頁不允許寫入。</p><button className="my-4 rounded border bg-navy-900 p-3 text-surface-100" onClick={()=>window.dispatchEvent(new Event('synthetic-logout'))}>模擬登出</button><OwnerCockpit><p>既有研究工具保留，預設收合。</p></OwnerCockpit></main></div>);

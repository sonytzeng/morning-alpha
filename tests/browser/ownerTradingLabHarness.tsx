import {createRoot} from 'react-dom/client';
import TradingLab from '../../src/pages/admin/analysis/TradingLab';
import '../../src/index.css';
import '../../src/pages/admin/analysis/analysis.css';
createRoot(document.getElementById('root')!).render(<div className="owner-analysis-layout min-h-screen"><main className="mx-auto max-w-5xl p-4 sm:p-8">
 <p className="mb-4 text-amber-300">LOCAL SYNTHETIC OWNER · 真實 Handler／隔離 DB · 不是 Production 或 Sony 實機可用性驗收</p>
 <button className="mb-4 rounded border p-3" onClick={()=>window.dispatchEvent(new Event('synthetic-logout'))}>模擬登出</button>
 <TradingLab/>
 </main></div>);

import {createRoot} from 'react-dom/client';
import RecommendationShadow from '../../src/pages/admin/analysis/RecommendationShadow';
import '../../src/index.css';
import '../../src/pages/admin/analysis/analysis.css';
createRoot(document.getElementById('root')!).render(<div className="owner-analysis-layout min-h-screen"><main className="mx-auto max-w-5xl p-4 sm:p-8"><p>LOCAL SYNTHETIC ISOLATION · 非 Production、非 Sony 本人可用性驗收</p><button className="my-4 rounded border p-3" onClick={()=>window.dispatchEvent(new Event('synthetic-logout'))}>模擬登出</button><RecommendationShadow/></main></div>);

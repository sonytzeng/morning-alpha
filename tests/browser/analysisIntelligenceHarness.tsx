import React from 'react';
import { createRoot } from 'react-dom/client';
import OwnerAnalysisPage from '../../src/pages/admin/analysis/page';
import '../../src/index.css';
createRoot(document.getElementById('root')!).render(<main className="min-h-screen bg-slate-50 p-4 sm:p-8"><div className="mx-auto max-w-5xl">
  <p className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm">LOCAL HISTORICAL REPLAY · 角色為合成測試 · 市場資料來自已保存 10/2 Evidence · 無 Production 請求</p>
  <button className="mb-5 rounded border bg-white px-4 py-2" onClick={() => window.dispatchEvent(new Event('synthetic-logout'))}>模擬登出</button>
  <OwnerAnalysisPage />
</div></main>);

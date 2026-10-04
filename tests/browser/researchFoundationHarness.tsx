import React from 'react';
import { createRoot } from 'react-dom/client';
import OwnerAnalysisPage from '../../src/pages/admin/analysis/page';
import '../../src/index.css';

createRoot(document.getElementById('root')!).render(<main className="min-h-screen bg-slate-50 p-5 sm:p-10">
  <div className="mx-auto max-w-5xl">
    <p className="mb-5 rounded border border-amber-300 bg-amber-50 p-3 text-sm">LOCAL SYNTHETIC FIXTURE · 無 Production 帳號／資料／請求</p>
    <OwnerAnalysisPage />
  </div>
</main>);

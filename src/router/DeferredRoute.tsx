import { Suspense, type ReactNode } from 'react';

export default function DeferredRoute({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="ma-page grid min-h-screen place-items-center text-sm text-white/60">正在載入頁面…</div>}>
      {children}
    </Suspense>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { completeMembershipCallback } from '@/services/membershipService';

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const started = useRef(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void completeMembershipCallback(window.location.href)
      .then((nextPath) => navigate(nextPath, { replace: true }))
      .catch((callbackError) => {
        setError(callbackError instanceof Error ? callbackError.message : '登入失敗，請重新寄送登入信。');
      });
  }, [navigate]);

  return (
    <main className="ma-page flex min-h-screen items-center justify-center px-4">
      <section className="w-full max-w-md rounded-2xl border border-background-200/70 bg-background-100 p-7 text-center md:p-9" aria-live="polite">
        {error ? (
          <>
            <i className="ri-error-warning-line text-4xl text-red-300" aria-hidden="true" />
            <h1 className="mt-4 text-2xl font-bold text-white">登入連結無法使用</h1>
            <p className="mt-3 text-sm leading-6 text-white/55">{error}</p>
            <Link to="/login" className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl bg-primary-500 px-5 font-bold text-background-50">重新寄送登入信</Link>
          </>
        ) : (
          <>
            <i className="ri-loader-4-line animate-spin text-4xl text-primary-300" aria-hidden="true" />
            <h1 className="mt-4 text-2xl font-bold text-white">正在完成登入</h1>
            <p className="mt-3 text-sm text-white/50">確認帳號並開通對應的會員權限。</p>
          </>
        )}
      </section>
    </main>
  );
}

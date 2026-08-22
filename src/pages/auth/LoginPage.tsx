import { FormEvent, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Footer from '@/components/feature/Footer';
import Navbar from '@/components/feature/Navbar';
import { supabase } from '@/lib/supabase';
import {
  fetchMemberAccess,
  requestMembershipLogin,
  sanitizeMembershipNextPath,
  signOutMembership,
} from '@/services/membershipService';
import type { MemberAccessResponse, MembershipState } from '@/types/membership';
import { trackPageView } from '@/utils/analytics';

const STATE_LABELS: Record<MembershipState, string> = {
  owner: '永久 Owner',
  beta_full: '創始測試完整權限',
  trialing: '14 天完整試用',
  paid_active: '正式會員',
  past_due: '付款待處理',
  canceled: '已取消，使用至本期結束',
  expired: '試用已結束',
  free: '免費會員',
};

function formatAccessDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export default function LoginPage() {
  const [searchParams] = useSearchParams();
  const nextPath = sanitizeMembershipNextPath(searchParams.get('next'));
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState('');
  const [access, setAccess] = useState<MemberAccessResponse | null>(null);

  useEffect(() => {
    trackPageView('/login');
    let active = true;
    void supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      if (!data.session) {
        setChecking(false);
        return;
      }
      try {
        const response = await fetchMemberAccess('activate');
        if (active) setAccess(response);
      } catch {
        if (active) setError('會員狀態暫時無法讀取，請重新登入。');
      } finally {
        if (active) setChecking(false);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSending(true);
    setError('');
    try {
      await requestMembershipLogin(email, nextPath);
      setSent(true);
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : '登入信寄送失敗，請稍後重試。');
    } finally {
      setSending(false);
    }
  };

  const signOut = async () => {
    setError('');
    try {
      await signOutMembership();
      setAccess(null);
      setSent(false);
      setEmail('');
    } catch (signOutError) {
      setError(signOutError instanceof Error ? signOutError.message : '登出失敗，請稍後重試。');
    }
  };

  const accessEndLabel = formatAccessDate(access?.membership.accessEndsAt || access?.membership.trialEndsAt || null);

  return (
    <div className="ma-page flex min-h-screen flex-col overflow-x-hidden">
      <Navbar />
      <main className="flex flex-1 items-center px-4 py-10 md:py-16">
        <div className="mx-auto grid w-full max-w-5xl gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
          <section className="rounded-2xl border border-background-200/70 bg-background-100 p-6 md:p-9">
            <span className="text-xs font-bold tracking-[0.18em] text-primary-300">MORNING ALPHA 會員</span>
            <h1 className="mt-4 text-3xl font-bold leading-tight text-white md:text-4xl">登入後，完整走完每天的決策循環</h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-white/55 md:text-base">
              創始測試期間不扣款，登入後可查看所有已通過內容品質閘門的會員研究、盤中追蹤與收盤驗證。正式訂閱啟用後，才開始計算完整 14 天試用。
            </p>
            <ul className="mt-7 grid gap-3 text-sm text-white/70 sm:grid-cols-2">
              {[
                '完整事件與台股傳導鏈',
                '代表股成立與取消條件',
                '09:00～14:30 盤中更新',
                '收盤驗證與隔日修正',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2 rounded-xl border border-white/5 bg-white/[0.025] p-3">
                  <i className="ri-check-line mt-0.5 text-primary-300" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-2xl border border-primary-400/25 bg-background-100 p-6 md:p-8" aria-live="polite">
            {checking ? (
              <div className="flex min-h-64 items-center justify-center text-sm text-white/45">
                <i className="ri-loader-4-line mr-2 animate-spin" aria-hidden="true" />正在確認會員狀態
              </div>
            ) : access ? (
              <div>
                <span className="text-xs font-bold tracking-[0.16em] text-primary-300">已登入</span>
                <h2 className="mt-3 text-2xl font-bold text-white">{STATE_LABELS[access.membership.state]}</h2>
                <p className="mt-2 break-all text-sm text-white/50">{access.user.email}</p>
                <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-xs text-white/45">完整會員內容</span>
                    <strong className={access.membership.active ? 'text-primary-300' : 'text-amber-300'}>
                      {access.membership.active ? '已開通' : '尚未開通'}
                    </strong>
                  </div>
                  {accessEndLabel && <p className="mt-2 text-xs text-white/40">目前權限至 {accessEndLabel}</p>}
                  {access.membership.state === 'owner' && <p className="mt-2 text-xs text-white/40">永久權限，不受試用與訂閱到期限制。</p>}
                </div>
                <div className="mt-6 grid gap-3">
                  <Link to={nextPath} className="flex min-h-12 items-center justify-center rounded-xl bg-primary-500 px-4 font-bold text-background-50 hover:bg-primary-400">
                    進入完整會員內容<i className="ri-arrow-right-line ml-2" aria-hidden="true" />
                  </Link>
                  <Link to="/account" className="flex min-h-11 items-center justify-center rounded-xl border border-white/10 px-4 text-sm font-semibold text-white/70 hover:border-white/20 hover:text-white">
                    查看會員中心
                  </Link>
                  <button type="button" onClick={signOut} className="min-h-11 text-sm text-white/40 hover:text-white/70">登出此帳號</button>
                </div>
              </div>
            ) : sent ? (
              <div className="flex min-h-64 flex-col justify-center">
                <i className="ri-mail-check-line text-4xl text-primary-300" aria-hidden="true" />
                <h2 className="mt-4 text-2xl font-bold text-white">登入信已寄出</h2>
                <p className="mt-3 text-sm leading-6 text-white/55">請到 <strong className="break-all text-white">{email.trim().toLowerCase()}</strong> 收信，點擊最新一封 Morning Alpha 登入連結。</p>
                <button type="button" onClick={() => setSent(false)} className="mt-6 min-h-11 rounded-xl border border-white/10 px-4 text-sm font-semibold text-white/70 hover:text-white">改用其他 Email</button>
              </div>
            ) : (
              <form onSubmit={submit}>
                <span className="text-xs font-bold tracking-[0.16em] text-primary-300">免密碼登入</span>
                <h2 className="mt-3 text-2xl font-bold text-white">輸入你的 Email</h2>
                <p className="mt-2 text-sm leading-6 text-white/50">新會員會自動建立帳號；既有會員與 Sony Owner 使用原本 Email 即可。</p>
                <label htmlFor="membership-email" className="mt-6 block text-xs font-semibold text-white/60">Email</label>
                <input
                  id="membership-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@example.com"
                  className="mt-2 min-h-12 w-full rounded-xl border border-background-300 bg-background-50 px-4 text-base text-white outline-none placeholder:text-white/20 focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20"
                />
                <button type="submit" disabled={sending} className="mt-4 flex min-h-12 w-full items-center justify-center rounded-xl bg-primary-500 px-4 font-bold text-background-50 hover:bg-primary-400 disabled:cursor-wait disabled:opacity-60">
                  {sending ? '正在寄送登入信…' : '寄送登入連結'}
                </button>
                <p className="mt-4 text-xs leading-5 text-white/35">不需要設定密碼。只有持有這個 Email 信箱的人可以完成登入。</p>
              </form>
            )}
            {error && <p className="mt-4 rounded-xl border border-red-400/20 bg-red-400/5 p-3 text-sm text-red-300" role="alert">{error}</p>}
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}

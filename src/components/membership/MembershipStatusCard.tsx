import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { fetchMemberAccess, signOutMembership } from '@/services/membershipService';
import type { MemberAccessResponse } from '@/types/membership';

const STATUS_LABEL: Record<string, string> = {
  owner: '永久 Owner',
  beta_full: '創始測試完整權限',
  trialing: '14 天完整試用中',
  paid_active: '正式會員',
  past_due: '付款待處理',
  canceled: '已取消，使用至本期結束',
  expired: '試用已結束',
  free: '免費會員',
};

function formatMembershipDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export default function MembershipStatusCard() {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<MemberAccessResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let disposed = false;
    let generation = 0;
    const load = async () => {
      const current = ++generation;
      const valid = () => !disposed && current === generation;
      setStatus(null);
      setFailed(false);
      setLoading(true);
      try {
        const { data, error } = await supabase.auth.getSession();
        if (!valid()) return;
        if (error) throw error;
        if (!data.session) return;
        const response = await fetchMemberAccess('activate');
        if (valid()) setStatus(response);
      } catch {
        if (valid()) setFailed(true);
      } finally {
        if (valid()) setLoading(false);
      }
    };
    const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        generation++;
        setStatus(null);
        setFailed(false);
        setLoading(false);
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        generation++;
        setStatus(null);
        // Do not call Auth while its callback holds the session lock.
        queueMicrotask(() => { if (!disposed) void load(); });
      }
    });
    void load();
    return () => {
      disposed = true;
      generation++;
      authListener.subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    await signOutMembership();
    setStatus(null);
  };

  if (loading) {
    return <section className="ma-card"><p className="text-sm text-white/45">正在確認會員權限…</p></section>;
  }

  if (!status) {
    return (
      <section className="ma-card border-primary-400/20">
        <span className="text-xs font-bold tracking-[0.14em] text-forest-300">會員權限</span>
        <h2 className="mt-2 text-xl font-bold text-white">{failed ? '暫時無法確認會員權益' : '登入後確認自己的會員權益'}</h2>
        <p className="mt-2 text-sm leading-6 text-white/50">{failed ? '目前沒有取得權益結果，不代表權益已失效。請稍後重新載入。' : '免費內容與完整內容依有效權益提供；登入不會自動扣款。'}</p>
        <Link to="/login?next=/member-note" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-primary-500 px-4 text-sm font-bold text-background-50">免費註冊／登入</Link>
      </section>
    );
  }

  const accessEndDate = formatMembershipDate(status.membership.trialEndsAt || status.membership.accessEndsAt);
  const accessPeriodLabel = status.membership.state === 'trialing' && accessEndDate
    ? `完整試用至 ${accessEndDate}`
    : status.membership.cancelAtPeriodEnd && accessEndDate
      ? `已取消，完整內容可使用至 ${accessEndDate}`
      : accessEndDate
        ? `目前權限至 ${accessEndDate}`
        : status.membership.active
          ? '目前權限持續有效'
          : '目前未開通完整內容';
  const billingLabel = status.offer.billing_mode === 'disabled'
    ? '正式扣款尚未啟用，目前不會產生費用'
    : status.offer.billing_mode === 'manual'
      ? '目前採人工確認付款'
      : '訂閱付款已啟用';

  return (
    <section className="ma-card border-primary-400/20">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="text-xs font-bold tracking-[0.14em] text-forest-300">會員權限</span>
          <h2 className="mt-2 text-xl font-bold text-white">{status.membership.legacyReviewRequired ? '既有會員權益保留中' : STATUS_LABEL[status.membership.state] || '會員權益待確認'}</h2>
          <p className="mt-1 break-all text-xs text-white/65">{status.user.email}</p>
          <p className="mt-3 text-sm font-medium text-white/70">{accessPeriodLabel}</p>
          <p className="mt-1 text-xs text-white/65">{billingLabel}</p>
          {status.membership.legacyReviewRequired && <p className="mt-2 text-sm leading-6 text-white/70">原有權益不變，期限與授權依據待確認；這不代表永久付費訂閱。</p>}
          {status.offer.signup_mode === 'free' && !status.membership.active && <p className="mt-2 text-sm leading-6 text-white/70">可以先閱讀免費摘要與股票學院入門課程。完整內容需有效的完整會員權益。</p>}
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          <strong className={status.membership.active ? 'text-forest-300' : 'text-amber-300'}>{status.membership.active ? '完整內容已開通' : '目前僅限免費內容'}</strong>
          <button type="button" onClick={signOut} className="min-h-10 text-left text-xs text-white/70 hover:text-white/65 sm:text-right">登出</button>
        </div>
      </div>
      {status.membership.state === 'owner' && (
        <Link
          to="/admin/analysis"
          className="mt-5 flex min-h-14 items-center gap-3 rounded-xl border border-primary-400/25 bg-primary-500/10 p-4 transition-colors hover:bg-primary-500/20"
        >
          <i className="ri-flask-line text-xl text-forest-300" aria-hidden="true"></i>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-white">分析中心</span>
            <span className="mt-1 block text-xs text-white/50">研究、Signal Lab與分析品質</span>
          </span>
          <i className="ri-arrow-right-line text-forest-300" aria-hidden="true"></i>
        </Link>
      )}
    </section>
  );
}

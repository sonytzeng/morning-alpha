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

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      if (!data.session) {
        setLoading(false);
        return;
      }
      try {
        const response = await fetchMemberAccess('activate');
        if (active) setStatus(response);
      } finally {
        if (active) setLoading(false);
      }
    });
    return () => {
      active = false;
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
        <span className="text-xs font-bold tracking-[0.14em] text-primary-300">會員權限</span>
        <h2 className="mt-2 text-xl font-bold text-white">登入後查看完整會員內容</h2>
        <p className="mt-2 text-sm leading-6 text-white/50">創始測試期間不扣款；正式訂閱啟用後才開始計算 14 天試用。</p>
        <Link to="/login?next=/member-note" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-primary-500 px-4 text-sm font-bold text-background-50">登入並開始完整體驗</Link>
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
          <span className="text-xs font-bold tracking-[0.14em] text-primary-300">會員權限</span>
          <h2 className="mt-2 text-xl font-bold text-white">{STATUS_LABEL[status.membership.state] || status.membership.state}</h2>
          <p className="mt-1 break-all text-xs text-white/40">{status.user.email}</p>
          <p className="mt-3 text-sm font-medium text-white/70">{accessPeriodLabel}</p>
          <p className="mt-1 text-xs text-white/40">{billingLabel}</p>
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          <strong className={status.membership.active ? 'text-primary-300' : 'text-amber-300'}>{status.membership.active ? '完整內容已開通' : '目前僅限免費內容'}</strong>
          <button type="button" onClick={signOut} className="min-h-10 text-left text-xs text-white/35 hover:text-white/65 sm:text-right">登出</button>
        </div>
      </div>
    </section>
  );
}

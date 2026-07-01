import type { SubscriptionTier } from '@/types/subscription';
import { getTierLabel } from '@/services/entitlementService';

interface PaywallCardProps {
  title: string;
  description: string;
  requiredTier: Exclude<SubscriptionTier, 'free' | 'admin'>;
  featureList?: string[];
  ctaText?: string;
  onCtaClick?: () => void;
  tone?: 'light' | 'dark';
}

export default function PaywallCard({
  title,
  description,
  requiredTier,
  featureList = [],
  ctaText = '查看會員方案',
  onCtaClick,
  tone = 'dark',
}: PaywallCardProps) {
  const isDark = tone === 'dark';

  return (
    <div className={`rounded-2xl border p-5 md:p-6 ${isDark ? 'bg-slate-900/80 border-amber-400/20' : 'bg-amber-50 border-amber-200'}`}>
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${isDark ? 'bg-amber-400/10 border border-amber-300/20' : 'bg-amber-100 border border-amber-200'}`}>
          <i className={`ri-lock-star-line text-lg ${isDark ? 'text-amber-300' : 'text-amber-700'}`}></i>
        </div>
        <div className="min-w-0">
          <p className={`text-[10px] uppercase tracking-[0.25em] font-semibold mb-1 ${isDark ? 'text-amber-300/80' : 'text-amber-700/80'}`}>
            {getTierLabel(requiredTier)}
          </p>
          <h3 className={`font-bold text-base mb-2 ${isDark ? 'text-white' : 'text-foreground-900'}`}>{title}</h3>
          <p className={`text-sm leading-relaxed ${isDark ? 'text-slate-300' : 'text-foreground-600'}`}>{description}</p>

          {featureList.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-4">
              {featureList.map((feature, idx) => (
                <div key={`${feature}-${idx}`} className={`flex items-start gap-2 text-xs ${isDark ? 'text-slate-300' : 'text-foreground-600'}`}>
                  <i className={`ri-check-line mt-0.5 ${isDark ? 'text-emerald-300' : 'text-emerald-600'}`}></i>
                  <span>{feature}</span>
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={onCtaClick}
            className={`mt-5 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors ${isDark ? 'bg-amber-400 text-slate-950 hover:bg-amber-300' : 'bg-foreground-900 text-white hover:bg-foreground-800'}`}
          >
            {ctaText}
            <i className="ri-arrow-right-line"></i>
          </button>
        </div>
      </div>
    </div>
  );
}

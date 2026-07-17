import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import MarketStatusLight from '@/components/base/MarketStatusLight';
import { BRAND_ICON_URL, BRAND_NAME } from '@/config/brand';
import type { MarketState } from '@/services/marketStateEngine';

interface NavbarProps {
  marketState?: MarketState | null;
  marketStatusLabel?: string;
}

export default function Navbar({ marketState, marketStatusLabel }: NavbarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [mobileOpen]);

  const navLinks = [
    { to: '/', label: '首頁' },
    { to: '/report/today', label: '今日判斷' },
    { to: '/opportunities', label: '今日受惠股' },
    { to: '/war-room', label: '盤中追蹤' },
    { to: '/member-note', label: '完整研究筆記' },
    { to: '/performance', label: '歷史績效' },
  ];

  const isActive = (path: string) => location.pathname === path;

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-background-200/70 bg-background-50">
      <div className="mx-auto w-full max-w-5xl px-4 md:px-6">
        <div className="flex h-14 items-center justify-between md:h-16">
          {/* Logo */}
          <Link to="/" className="flex min-h-11 items-center gap-2 flex-shrink-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/40">
            <img
              src={BRAND_ICON_URL}
              alt={BRAND_NAME}
              className="h-6 w-6 md:h-7 md:w-7 lg:h-8 lg:w-8 object-contain rounded-lg"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
            <span className="text-white font-semibold text-sm tracking-tight whitespace-nowrap">
              {BRAND_NAME}
            </span>
          </Link>

          {/* Desktop nav — hidden below md (768px) */}
          <div className="hidden md:flex items-center gap-1">
            {/* Market Status Light in navbar — V25: powered by marketState */}
            <div className="mr-2 hidden lg:block">
              <MarketStatusLight compact marketState={marketState} displayLabelOverride={marketStatusLabel} />
            </div>

            {navLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className={`rounded-md px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                  isActive(link.to)
                    ? 'text-primary-300 bg-primary-500/10'
                    : 'text-white/50 hover:text-white hover:bg-white/5'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Mobile hamburger — bigger tap target */}
          <button
            type="button"
            className="md:hidden w-11 h-11 flex items-center justify-center text-white -mr-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/40"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label={mobileOpen ? '關閉選單' : '開啟選單'}
            aria-expanded={mobileOpen}
            aria-controls="morning-alpha-mobile-menu"
          >
            <i className={`ri-${mobileOpen ? 'close' : 'menu'}-line text-2xl`}></i>
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div id="morning-alpha-mobile-menu" className="border-t border-background-200/70 bg-background-50 md:hidden">
          <div className="px-4 py-3 space-y-1">
            <div className="px-3 py-2.5">
              <MarketStatusLight compact marketState={marketState} displayLabelOverride={marketStatusLabel} />
            </div>
            {navLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                onClick={() => setMobileOpen(false)}
                className={`block px-4 py-3 rounded-lg text-base font-medium ${
                  isActive(link.to)
                    ? 'text-primary-300 bg-primary-500/10'
                    : 'text-white/50 hover:text-white hover:bg-white/5'
                }`}
              >
                {link.label}
              </Link>
            ))}
            <div className="mt-3 border-t border-background-200/70 pt-3">
              <p className="text-white/15 text-[10px] text-center leading-relaxed">
                愛吉網路資訊有限公司｜統編 60374105
              </p>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}

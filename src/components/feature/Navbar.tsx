import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import MarketStatusLight from '@/components/base/MarketStatusLight';
import { BRAND_ICON_URL, BRAND_NAME } from '@/config/brand';
import type { MarketState } from '@/services/marketStateEngine';

interface NavbarProps {
  marketState?: MarketState | null;
}

export default function Navbar({ marketState }: NavbarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  const navLinks = [
    { to: '/', label: '首頁' },
    { to: '/report/today', label: '今日判斷' },
    { to: '/opportunities', label: '今日受惠股' },
    { to: '/war-room', label: '盤中追蹤' },
    { to: '/member-note', label: '完整研究筆記' },
  ];

  const isActive = (path: string) => location.pathname === path;

  return (
    <nav className="w-full bg-[#07111f]/[0.92] backdrop-blur-sm border-b border-[rgba(59,130,246,0.18)] sticky top-0 z-50">
      <div className="w-full px-4 md:px-6">
        <div className="flex items-center justify-between h-14 md:h-16">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 flex-shrink-0">
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
              <MarketStatusLight compact marketState={marketState} />
            </div>

            {navLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className={`px-3 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                  isActive(link.to)
                    ? 'text-white bg-white/10'
                    : 'text-white/50 hover:text-white hover:bg-white/5'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Mobile hamburger — bigger tap target */}
          <button
            className="md:hidden w-10 h-10 flex items-center justify-center text-white -mr-2"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="選單"
          >
            <i className={`ri-${mobileOpen ? 'close' : 'menu'}-line text-2xl`}></i>
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-[rgba(59,130,246,0.18)] bg-[#07111f]/[0.98]">
          <div className="px-4 py-3 space-y-1">
            <div className="px-3 py-2.5">
              <MarketStatusLight compact marketState={marketState} />
            </div>
            {navLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                onClick={() => setMobileOpen(false)}
                className={`block px-4 py-3 rounded-lg text-base font-medium ${
                  isActive(link.to)
                    ? 'text-white bg-white/10'
                    : 'text-white/50 hover:text-white hover:bg-white/5'
                }`}
              >
                {link.label}
              </Link>
            ))}
            <div className="pt-3 mt-3 border-t border-[rgba(59,130,246,0.12)]">
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
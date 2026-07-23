import { Link } from 'react-router-dom';
import { BRAND_NAME, BRAND_ICON_URL } from '@/config/brand';

export default function Footer() {
  return (
    <footer className="mt-auto w-full border-t border-background-200/70 bg-background-50">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6 md:py-7">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          {/* Brand + description */}
          <div className="max-w-xs">
            <div className="flex items-center gap-2 mb-2">
              <img
                src={BRAND_ICON_URL}
                alt={BRAND_NAME}
                className="w-6 h-6 object-contain rounded-md"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
              <span className="text-white/80 font-semibold text-sm">{BRAND_NAME}</span>
            </div>
            <p className="text-white/45 text-xs leading-relaxed">
              每天早上 30 秒，先看市場情緒與今天最容易失控的地方。不預測漲跌，只幫你在開盤前保留冷靜判斷。
            </p>
          </div>

          {/* Links */}
          <div className="flex items-center gap-4 md:gap-6 flex-wrap">
            <Link to="/" className="inline-flex min-h-11 items-center text-white/50 hover:text-white text-xs font-medium transition-colors whitespace-nowrap">
              今日判斷
            </Link>
            <Link to="/war-room" className="inline-flex min-h-11 items-center text-white/50 hover:text-white text-xs font-medium transition-colors whitespace-nowrap">
              盤中追蹤
            </Link>
            <Link to="/faq" className="inline-flex min-h-11 items-center text-white/50 hover:text-white text-xs font-medium transition-colors whitespace-nowrap">
              常見問題
            </Link>
            <Link to="/contact" className="inline-flex min-h-11 items-center text-white/50 hover:text-white text-xs font-medium transition-colors whitespace-nowrap">
              聯絡我們
            </Link>
            <Link to="/pricing" className="inline-flex min-h-11 items-center text-white/50 hover:text-white text-xs font-medium transition-colors whitespace-nowrap">
              會員方案
            </Link>
            <Link to="/terms" className="inline-flex min-h-11 items-center text-white/50 hover:text-white text-xs font-medium transition-colors whitespace-nowrap">
              使用條款
            </Link>
            <Link to="/privacy" className="inline-flex min-h-11 items-center text-white/50 hover:text-white text-xs font-medium transition-colors whitespace-nowrap">
              隱私權
            </Link>
            <a href="mailto:aijinetwork@gmail.com" className="inline-flex min-h-11 items-center text-white/50 hover:text-white text-xs font-medium transition-colors whitespace-nowrap">
              客服信箱
            </a>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-5 flex flex-col items-center justify-between gap-3 border-t border-background-200/70 pt-4 sm:flex-row">
          <div className="flex items-center gap-2 flex-wrap justify-center sm:justify-start">
            <p className="text-white/25 text-[11px]">
              &copy; 2026 {BRAND_NAME}. 愛吉網路資訊有限公司｜統編 60374105
            </p>
          </div>
          <div className="flex flex-col items-center sm:items-end gap-1">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-forest-500/10 border border-forest-500/20 rounded-full text-forest-400 text-[10px] font-medium whitespace-nowrap">
              <span className="w-1.5 h-1.5 rounded-full bg-forest-400"></span>
              公開測試階段
            </span>
            <p className="text-white/20 text-[11px] text-center sm:text-right">
              本平台提供市場資訊整理與情緒判讀參考，不構成投資建議。
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}

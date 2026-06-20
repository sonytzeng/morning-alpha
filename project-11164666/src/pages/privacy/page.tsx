import Navbar from '@/components/feature/Navbar';
import Footer from '@/components/feature/Footer';

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-navy-950 flex flex-col">
      <Navbar />
      <main className="flex-1 w-full px-4 md:px-6 py-10 md:py-14">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-white font-bold text-2xl md:text-3xl mb-2">隱私政策</h1>
          <p className="text-white/40 text-sm md:text-base mb-10">
            Morning Alpha 重視使用者資料保護，目前以最小必要資料為原則。
          </p>

          <div className="space-y-4">
            {/* Section 1 */}
            <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <h3 className="text-white font-semibold text-sm md:text-base mb-2">個人資料處理與聯絡窗口</h3>
              <div className="text-white/50 text-sm leading-relaxed space-y-2">
                <p>
                  Morning Alpha 由愛吉網路資訊有限公司營運。
                </p>
                <p>
                  如您對個人資料、帳號資料或服務通知有任何疑問，請透過以下方式聯繫：
                </p>
                <div className="space-y-1">
                  <p>
                    <span className="text-white/30">客服信箱：</span>
                    <a href="mailto:aijinetwork@gmail.com" className="text-forest-400 hover:text-forest-300 transition-colors">
                      aijinetwork@gmail.com
                    </a>
                  </p>
                  <p><span className="text-white/30">客服專線：</span>0908586586</p>
                  <p><span className="text-white/30">營運公司：</span>愛吉網路資訊有限公司</p>
                  <p><span className="text-white/30">統一編號：</span>60374105</p>
                </div>
              </div>
            </div>

            {/* Section 2 */}
            <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <h3 className="text-white font-semibold text-sm md:text-base mb-2">我們蒐集哪些資料</h3>
              <p className="text-white/50 text-sm leading-relaxed">
                目前 Morning Alpha 主要提供市場資訊瀏覽。若使用者僅瀏覽網站，本站可能僅取得一般技術資訊，例如瀏覽器類型、裝置資訊、頁面瀏覽紀錄或系統錯誤紀錄，用於改善網站穩定性與使用體驗。
              </p>
            </div>

            {/* Section 3 */}
            <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <h3 className="text-white font-semibold text-sm md:text-base mb-2">會員、LINE 與訂閱資料</h3>
              <p className="text-white/50 text-sm leading-relaxed">
                目前 Morning Alpha 尚未正式開放付費訂閱、會員功能或 LINE 每日提醒。若未來開放相關功能，本站會在使用者主動填寫或授權前，清楚說明會蒐集哪些資料、用途與保存方式。
              </p>
            </div>

            {/* Section 4 */}
            <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <h3 className="text-white font-semibold text-sm md:text-base mb-2">資料使用目的</h3>
              <div className="text-white/50 text-sm leading-relaxed space-y-1">
                <p>可能使用資料的目的包括：</p>
                <ul className="list-disc pl-5 space-y-0.5">
                  <li>維持網站正常運作</li>
                  <li>改善頁面體驗</li>
                  <li>分析功能使用情況</li>
                  <li>偵測錯誤與維護系統安全</li>
                  <li>未來在使用者同意後提供提醒或會員服務</li>
                </ul>
              </div>
            </div>

            {/* Section 5 */}
            <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <h3 className="text-white font-semibold text-sm md:text-base mb-2">Cookie 與本機儲存</h3>
              <p className="text-white/50 text-sm leading-relaxed">
                本站可能使用瀏覽器 Cookie 或本機儲存技術，用於記住基本偏好、改善載入體驗或維持網站功能。使用者可透過瀏覽器設定管理 Cookie。
              </p>
            </div>

            {/* Section 6 */}
            <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <h3 className="text-white font-semibold text-sm md:text-base mb-2">第三方服務</h3>
              <p className="text-white/50 text-sm leading-relaxed">
                Morning Alpha 可能使用第三方服務協助網站運作，例如資料 API、網站部署平台、資料庫服務、排程服務或分析工具。這些服務可能依其自身政策處理必要技術資料。
              </p>
            </div>

            {/* Section 7 */}
            <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <h3 className="text-white font-semibold text-sm md:text-base mb-2">資料安全</h3>
              <p className="text-white/50 text-sm leading-relaxed">
                本站會以合理方式保護資料安全，但網路傳輸與系統服務無法保證絕對安全。若未來開放會員或付費功能，將再強化資料權限與安全規則。
              </p>
            </div>

            {/* Section 8 */}
            <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <h3 className="text-white font-semibold text-sm md:text-base mb-2">資料分享</h3>
              <p className="text-white/50 text-sm leading-relaxed">
                除非法律要求、系統維護必要，或使用者明確授權，本站不會主動出售使用者個人資料。
              </p>
            </div>

            {/* Section 9 */}
            <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <h3 className="text-white font-semibold text-sm md:text-base mb-2">使用者權利</h3>
              <p className="text-white/50 text-sm leading-relaxed">
                若未來本站開放會員、LINE 或訂閱功能，使用者可依實際功能申請查詢、更正或刪除相關資料。
              </p>
            </div>

            {/* Section 10 */}
            <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <h3 className="text-white font-semibold text-sm md:text-base mb-2">政策更新</h3>
              <p className="text-white/50 text-sm leading-relaxed">
                本站可能依產品發展或法規需求更新隱私政策。更新後會公布於本頁。
              </p>
            </div>

            {/* Section 11 */}
            <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <h3 className="text-white font-semibold text-sm md:text-base mb-2">聯絡方式</h3>
              <div className="text-white/50 text-sm leading-relaxed space-y-1.5">
                <p>
                  <span className="text-white/30">客服信箱：</span>
                  <a href="mailto:aijinetwork@gmail.com" className="text-forest-400 hover:text-forest-300 transition-colors">
                    aijinetwork@gmail.com
                  </a>
                </p>
                <p><span className="text-white/30">客服專線：</span>0908586586</p>
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
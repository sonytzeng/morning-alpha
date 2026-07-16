import Navbar from '@/components/feature/Navbar';
import Footer from '@/components/feature/Footer';

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-navy-950 flex flex-col">
      <Navbar />
      <main className="flex-1 w-full px-4 md:px-6 py-10 md:py-14">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-white font-bold text-2xl md:text-3xl mb-2">聯絡我們</h1>
          <p className="text-white/40 text-sm md:text-base mb-10">
            如有任何關於 Morning Alpha 服務、使用條款或隱私政策的疑問，請透過以下方式聯繫。
          </p>

          <div className="space-y-4">
            {/* Section 1: 營運公司資訊 */}
            <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <h3 className="text-white font-semibold text-sm md:text-base mb-3">營運公司資訊</h3>
              <div className="text-white/50 text-sm leading-relaxed space-y-1.5">
                <p><span className="text-white/30">公司名稱：</span>愛吉網路資訊有限公司</p>
                <p><span className="text-white/30">統一編號：</span>60374105</p>
                <p><span className="text-white/30">公司地址：</span>105台北市松山區南京東路五段2號3樓</p>
                <p><span className="text-white/30">公司電話：</span>02-2747-7158</p>
                <p><span className="text-white/30">傳真電話：</span>02-2747-7138</p>
              </div>
            </div>

            {/* Section 2: 客服聯繫 */}
            <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <h3 className="text-white font-semibold text-sm md:text-base mb-3">客服聯繫方式</h3>
              <div className="text-white/50 text-sm leading-relaxed space-y-1.5">
                <p><span className="text-white/30">客服專線：</span>0908586586</p>
                <p>
                  <span className="text-white/30">客服信箱：</span>
                  <a href="mailto:aijinetwork@gmail.com" className="inline-flex min-h-11 items-center text-forest-400 hover:text-forest-300 transition-colors">
                    aijinetwork@gmail.com
                  </a>
                </p>
              </div>
            </div>

            {/* Section 3: 服務資訊 */}
            <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <h3 className="text-white font-semibold text-sm md:text-base mb-3">服務資訊</h3>
              <div className="text-white/50 text-sm leading-relaxed space-y-1.5">
                <p><span className="text-white/30">服務名稱：</span>Morning Alpha</p>
                <p>
                  <span className="text-white/30">服務網站：</span>
                  <a href="https://morningalphatw.com" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-forest-400 hover:text-forest-300 transition-colors">
                    https://morningalphatw.com
                  </a>
                </p>
              </div>
            </div>

            {/* Section 4: 服務定位與免責 */}
            <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <h3 className="text-white font-semibold text-sm md:text-base mb-3">服務定位與免責聲明</h3>
              <div className="text-white/50 text-sm leading-relaxed space-y-2">
                <p>
                  Morning Alpha 提供市場資訊整理、盤前情緒判讀與風險提醒，不提供個股買賣建議，不保證任何投資結果。
                </p>
                <p>
                  本平台內容僅供市場資訊整理與情緒判讀參考，不構成投資建議、買賣推薦或收益保證。使用者應自行承擔投資風險。
                </p>
                <p>
                  Morning Alpha 不會提供明牌、不會承諾漲跌、不會保證報酬。
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

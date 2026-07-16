import Navbar from '@/components/feature/Navbar';
import Footer from '@/components/feature/Footer';

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-navy-950 flex flex-col">
      <Navbar />
      <main className="flex-1 w-full px-4 md:px-6 py-10 md:py-14">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-white font-bold text-2xl md:text-3xl mb-2">使用條款</h1>
          <p className="text-white/40 text-sm md:text-base mb-10">
            使用 Morning Alpha 前，請先了解本站服務定位與風險聲明。
          </p>

          <div className="space-y-4">
            {/* Section 1 */}
            <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <h3 className="text-white font-semibold text-sm md:text-base mb-2">服務定位</h3>
              <p className="text-white/50 text-sm leading-relaxed">
                Morning Alpha 是市場資訊整理與台股盤前情境判讀工具，主要協助使用者理解盤前市場環境、風險訊號與可能的市場節奏。
              </p>
            </div>

            {/* Section 2 */}
            <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <h3 className="text-white font-semibold text-sm md:text-base mb-2">非投資建議</h3>
              <p className="text-white/50 text-sm leading-relaxed">
                本站所有內容僅供資訊整理、研究參考與市場情境理解，不構成投資建議、買賣建議、財務規劃建議、法律建議或任何金融商品招攬。
              </p>
            </div>

            {/* Section 3 */}
            <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <h3 className="text-white font-semibold text-sm md:text-base mb-2">不保證準確或獲利</h3>
              <p className="text-white/50 text-sm leading-relaxed">
                Morning Alpha 會盡力整理公開市場資料與系統可取得的資料來源，但不保證資料即時性、完整性、準確性或任何投資結果。市場變化快速，任何判讀都可能與實際結果不同。
              </p>
            </div>

            {/* Section 4 */}
            <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <h3 className="text-white font-semibold text-sm md:text-base mb-2">使用者自行承擔風險</h3>
              <p className="text-white/50 text-sm leading-relaxed">
                使用者應自行判斷投資風險，並對自己的投資決策負完全責任。任何因使用本站資訊所造成的損失，本站不承擔投資結果責任。
              </p>
            </div>

            {/* Section 5 */}
            <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <h3 className="text-white font-semibold text-sm md:text-base mb-2">AI 判讀限制</h3>
              <p className="text-white/50 text-sm leading-relaxed">
                Morning Alpha 的 AI 判讀是根據資料來源、模型邏輯與當時市場資訊產生。AI 可能受到資料延遲、資料缺漏、新聞誤判、模型限制或市場突發事件影響，因此不可作為唯一決策依據。
              </p>
            </div>

            {/* Section 6 */}
            <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <h3 className="text-white font-semibold text-sm md:text-base mb-2">資料來源與延遲</h3>
              <p className="text-white/50 text-sm leading-relaxed">
                本站可能使用公開資料、第三方資料、API 資料與自行整理資料。不同資料來源可能存在延遲、缺漏或更新時間不一致。若資料不足，本站會盡量標示資料可信度。
              </p>
            </div>

            {/* Section 7 */}
            <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <h3 className="text-white font-semibold text-sm md:text-base mb-2">非報明牌與非交易訊號</h3>
              <p className="text-white/50 text-sm leading-relaxed">
                Morning Alpha 不提供明確買點、賣點、個股推薦、報明牌、保證獲利或代操服務。網站內容應理解為市場情境輔助，而不是交易指令。
              </p>
            </div>

            {/* Section 8 */}
            <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <h3 className="text-white font-semibold text-sm md:text-base mb-2">服務變更</h3>
              <p className="text-white/50 text-sm leading-relaxed">
                本站可依產品發展、資料源、法規、成本或技術需求，調整、暫停或修改部分功能與內容。
              </p>
            </div>

            {/* Section 9 */}
            <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <h3 className="text-white font-semibold text-sm md:text-base mb-2">禁止行為</h3>
              <p className="text-white/50 text-sm leading-relaxed">
                使用者不得將本站內容用於違法用途、誤導他人、冒用本站名義、未經授權轉載或作為保證獲利宣傳。
              </p>
            </div>

            {/* Section 10 */}
            <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <h3 className="text-white font-semibold text-sm md:text-base mb-2">條款更新</h3>
              <p className="text-white/50 text-sm leading-relaxed">
                本站可能不定期更新使用條款。更新後會以頁面內容為準，使用者繼續使用網站即表示理解並接受更新內容。
              </p>
            </div>

            {/* Section 11 */}
            <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <h3 className="text-white font-semibold text-sm md:text-base mb-2">服務提供者</h3>
              <div className="text-white/50 text-sm leading-relaxed space-y-1.5 mb-3">
                <p>本服務「Morning Alpha」由愛吉網路資訊有限公司營運。</p>
                <p><span className="text-white/30">公司名稱：</span>愛吉網路資訊有限公司</p>
                <p><span className="text-white/30">統一編號：</span>60374105</p>
                <p><span className="text-white/30">公司地址：</span>105台北市松山區南京東路五段2號3樓</p>
                <p>
                  <span className="text-white/30">客服信箱：</span>
                  <a href="mailto:aijinetwork@gmail.com" className="inline-flex min-h-11 items-center text-forest-400 hover:text-forest-300 transition-colors">
                    aijinetwork@gmail.com
                  </a>
                </p>
                <p><span className="text-white/30">客服專線：</span>0908586586</p>
              </div>
              <p className="text-white/50 text-sm leading-relaxed">
                Morning Alpha 提供市場資料整理、盤前情緒判讀、風險提醒與觀察方向，不提供個股買賣建議，不保證任何投資結果。使用者應自行判斷風險並承擔投資決策責任。
              </p>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

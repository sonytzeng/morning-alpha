import Navbar from '@/components/feature/Navbar';
import Footer from '@/components/feature/Footer';

export default function FaqPage() {
  return (
    <div className="min-h-screen bg-navy-950 flex flex-col">
      <Navbar />
      <main className="flex-1 w-full px-4 md:px-6 py-10 md:py-14">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-white font-bold text-2xl md:text-3xl mb-2">常見問題</h1>
          <p className="text-white/40 text-sm md:text-base mb-10">
            先了解 Morning Alpha 如何整理盤前資訊、如何判讀資料，以及使用時需要注意什麼。
          </p>

          <div className="space-y-4">
            {/* Q1 */}
            <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <h3 className="text-white font-semibold text-sm md:text-base mb-2">Morning Alpha 是什麼？</h3>
              <p className="text-white/50 text-sm leading-relaxed">
                Morning Alpha 是台股盤前全球情報判讀系統。每天盤前整理全球市場、美股、半導體、台積電 ADR、美元、美債、VIX、重大新聞與台股相關訊號，協助使用者快速理解今天台股可能面臨的市場情境。
              </p>
            </div>

            {/* Q2 */}
            <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <h3 className="text-white font-semibold text-sm md:text-base mb-2">Morning Alpha 是報明牌網站嗎？</h3>
              <p className="text-white/50 text-sm leading-relaxed">
                不是。Morning Alpha 不提供個股買賣建議，不保證漲跌，也不提供任何獲利承諾。本站的重點是協助使用者理解市場風險、盤前節奏與情境變化。
              </p>
            </div>

            {/* Q3 */}
            <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <h3 className="text-white font-semibold text-sm md:text-base mb-2">Morning Alpha 會提供投資建議嗎？</h3>
              <p className="text-white/50 text-sm leading-relaxed">
                不會。本站內容僅供市場資訊整理、情境判讀與研究參考，不構成投資建議、買賣建議、招攬或任何金融商品推薦。使用者仍應自行判斷並承擔投資風險。
              </p>
            </div>

            {/* Q4 */}
            <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <h3 className="text-white font-semibold text-sm md:text-base mb-2">資料通常什麼時候更新？</h3>
              <div className="text-white/50 text-sm leading-relaxed space-y-1">
                <p>Morning Alpha 的核心節奏是：</p>
                <ul className="list-disc pl-5 space-y-0.5">
                  <li>每日 <strong className="text-white/70">07:30 前</strong>：產生盤前劇本</li>
                  <li><strong className="text-white/70">09:30 左右</strong>：產生開盤雷達</li>
                  <li><strong className="text-white/70">盤後</strong>：產生盤後驗證</li>
                </ul>
                <p>遇到週末、國定假日或非交易日，系統會顯示最近交易日資料。</p>
              </div>
            </div>

            {/* Q5 */}
            <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <h3 className="text-white font-semibold text-sm md:text-base mb-2">為什麼有時會顯示「中可信」？</h3>
              <p className="text-white/50 text-sm leading-relaxed">
                因為市場資料來源可能有延遲、缺漏或尚未更新。例如 TXF 台指期、台指夜盤、部分新聞或即時資料不足時，Morning Alpha 會降低資料可信度，不會假裝資料完整。
              </p>
            </div>

            {/* Q6 */}
            <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <h3 className="text-white font-semibold text-sm md:text-base mb-2">如果資料不足，系統還會判斷嗎？</h3>
              <p className="text-white/50 text-sm leading-relaxed">
                會，但會降低判斷把握度，並標示資料缺口。若資料明顯不足，系統應顯示「資料不足」或「等待更新」，而不是強行給出高把握度結論。
              </p>
            </div>

            {/* Q7 */}
            <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <h3 className="text-white font-semibold text-sm md:text-base mb-2">為什麼盤前劇本和盤中結果可能不同？</h3>
              <p className="text-white/50 text-sm leading-relaxed">
                因為盤前劇本是根據開盤前資訊推估情境；開盤後市場會受到實際買賣力道、權值股、台指期與資金流影響。Morning Alpha 會透過 09:30 開盤雷達與盤後驗證修正原本假設。
              </p>
            </div>

            {/* Q8 */}
            <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <h3 className="text-white font-semibold text-sm md:text-base mb-2">盤後驗證是什麼？</h3>
              <p className="text-white/50 text-sm leading-relaxed">
                盤後驗證用來檢查 Morning Alpha 的盤前判讀是否接近實際市場。如果盤前方向不準，系統會標示修正結果，避免只展示成功案例。
              </p>
            </div>

            {/* Q9 */}
            <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <h3 className="text-white font-semibold text-sm md:text-base mb-2">非交易日會顯示什麼？</h3>
              <p className="text-white/50 text-sm leading-relaxed">
                非交易日不會假裝產生今日台股盤前報告。網站會明確標示「今天非交易日，顯示最近交易日資料」。
              </p>
            </div>

            {/* Q10 */}
            <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <h3 className="text-white font-semibold text-sm md:text-base mb-2">Morning Alpha 目前是否已開放付費？</h3>
              <p className="text-white/50 text-sm leading-relaxed">
                目前尚未正式開放付費訂閱。現階段仍以網站本體穩定、資料可信度與判讀品質優化為主。
              </p>
            </div>

            {/* Q11 */}
            <div className="bg-navy-900/60 border border-navy-800 rounded-2xl p-5 md:p-6">
              <h3 className="text-white font-semibold text-sm md:text-base mb-2">LINE 每日提醒是否已開放？</h3>
              <p className="text-white/50 text-sm leading-relaxed">
                目前 LINE 每日提醒暫緩開放。若未來開放，網站會明確說明訂閱方式、提醒內容與資料使用方式。
              </p>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
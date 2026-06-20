export default function RiskDisclaimer() {
  return (
    <div className="bg-surface-100 border border-surface-200 rounded-2xl p-5 md:p-6">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center flex-shrink-0">
          <i className="ri-shield-check-line text-surface-500 text-lg"></i>
        </div>
        <div>
          <h4 className="text-navy-900 font-semibold text-sm mb-2">風險提示與免責聲明</h4>
          <div className="text-surface-600 text-xs leading-relaxed space-y-2">
            <p>本平台內容僅供市場資訊整理、情緒判讀與風險提醒參考，不構成投資建議、買賣推薦或收益保證。</p>
            <p>使用者應自行承擔投資風險。Morning Alpha 不會提供明牌、不會承諾漲跌、不會保證報酬。</p>
            <p className="text-surface-500">Morning Alpha 由愛吉網路資訊有限公司營運，統一編號 60374105。</p>
          </div>
        </div>
      </div>
    </div>
  );
}
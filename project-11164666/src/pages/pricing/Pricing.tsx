import { useState, useEffect } from 'react';
import Navbar from '@/components/feature/Navbar';
import Footer from '@/components/feature/Footer';
import MarketStatusLight from '@/components/base/MarketStatusLight';
import { trackPageView, trackEvent } from '@/utils/analytics';
import { LINE_ADD_FRIEND_URL } from '@/config/brand';

export default function Pricing() {
  const [waitlistEmail, setWaitlistEmail] = useState('');
  const [waitlistSubmitted, setWaitlistSubmitted] = useState(false);

  useEffect(() => {
    trackPageView('/pricing');
  }, []);

  const handleWaitlistSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!waitlistEmail) return;
    trackEvent('click_waitlist');
    setWaitlistSubmitted(true);
  };

  return (
    <div className="min-h-screen bg-surface-50 flex flex-col overflow-x-hidden">
      <Navbar />

      <main className="flex-1 overflow-x-hidden">
        {/* Hero */}
        <section className="relative bg-navy-950 w-full px-4 md:px-6 py-8 md:py-16 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-navy-900 via-navy-950 to-navy-950"></div>
          <div className="relative max-w-3xl mx-auto text-center">
            <div className="mb-4 flex justify-center">
              <MarketStatusLight compact />
            </div>
            <span className="inline-block px-3 py-1 bg-forest-500/15 text-forest-400 text-xs font-medium rounded-full mb-4 border border-forest-500/25">
              Morning Alpha 目前為公開測試階段。每天早上 07:30，AI 會整理市場情緒、風險提醒與今日觀察重點。
            </span>
            <h1 className="text-white font-bold text-2xl md:text-3xl mb-3">
              會員版即將開放，先加入早鳥名單
            </h1>
            <p className="text-surface-300 text-sm md:text-base max-w-xl mx-auto leading-relaxed">
              Morning Alpha 目前為公開測試階段。每天早上 07:30，AI 會整理市場情緒、風險提醒與今日觀察重點。
            </p>
            <p className="text-surface-400 text-xs md:text-sm mt-3 max-w-lg mx-auto leading-relaxed">
              正式會員開放時，早鳥名單將優先收到通知，並優先取得完整盤前腳本、隔夜影響鏈、盤中追蹤與收盤驗證。
            </p>
            <p className="text-surface-400 text-xs md:text-sm mt-3 max-w-lg mx-auto leading-relaxed">
              不是帶單，而是幫你在市場混亂時，保留自己的節奏與判斷。
            </p>
          </div>
        </section>

        <div className="w-full overflow-x-hidden px-4 md:px-6 py-8 md:py-12">
          <div className="max-w-4xl mx-auto w-full">
            {/* Free — 主角 */}
            <div className="bg-white border border-surface-200 rounded-2xl p-6 md:p-8 mb-8">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-10 h-10 bg-forest-500/10 rounded-xl flex items-center justify-center">
                  <i className="ri-gift-line text-forest-500 text-lg"></i>
                </div>
                <div>
                  <h2 className="text-navy-900 font-bold text-lg">公開測試</h2>
                  <p className="text-surface-500 text-xs">目前開放，全部功能免費使用，幫你建立每天回來看的習慣</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
                {[
                  { icon: 'ri-sun-line', label: '每日 AI 市場情緒' },
                  { icon: 'ri-shield-check-line', label: '今天不要犯的錯' },
                  { icon: 'ri-chat-quote-line', label: '今日一句提醒' },
                  { icon: 'ri-line-line', label: '每天 07:30 LINE 盤前提醒' },
                  { icon: 'ri-history-line', label: '市場情緒時間軸' },
                  { icon: 'ri-brain-line', label: 'AI 軍師提醒' },
                ].map((item) => (
                  <div key={item.label} className="flex items-center gap-2 px-3 py-2.5 bg-surface-50 rounded-lg">
                    <div className="w-5 h-5 flex items-center justify-center">
                      <i className={`${item.icon} text-forest-500 text-sm`}></i>
                    </div>
                    <span className="text-navy-700 text-sm">{item.label}</span>
                  </div>
                ))}
              </div>

              {/* LINE CTA within Free tier */}
              <div className="bg-navy-950 border border-navy-800 rounded-xl p-4 md:p-5 mb-6">
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                  <div className="flex-shrink-0 w-10 h-10 bg-forest-500/15 rounded-xl flex items-center justify-center border border-forest-500/20">
                    <i className="ri-line-line text-forest-400 text-lg"></i>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-semibold text-sm mb-1">加入 LINE 每日提醒</p>
                    <p className="text-surface-400 text-xs leading-relaxed">
                      每天早上 07:30，把今日 AI 盤前提醒送到你的 LINE。
                    </p>
                  </div>
                  <a
                    href={LINE_ADD_FRIEND_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => trackEvent('click_line_daily_reminder', { location: 'pricing' })}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-forest-600 hover:bg-forest-500 text-white text-sm font-medium rounded-xl transition-colors whitespace-nowrap flex-shrink-0"
                  >
                    <i className="ri-add-line"></i>
                    加入 LINE 每日提醒
                  </a>
                </div>
              </div>

              <div className="bg-navy-50 border border-navy-100 rounded-xl p-4">
                <p className="text-navy-900 text-sm font-medium mb-1">為什麼現在全部免費？</p>
                <p className="text-surface-500 text-xs leading-relaxed">
                  目前在公開測試階段。我們的核心目標是讓你建立「每天早上先看 AI 對市場的看法再開始一天」的習慣。
                  真正有價值的產品，不需要急著收費，而是讓使用者在需要的時候，自然地考慮進階功能。
                </p>
              </div>
            </div>

            {/* Pro — 即將推出 */}
            <div className="bg-navy-950 border border-navy-800 rounded-2xl p-6 md:p-8 mb-8">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-10 h-10 bg-forest-500/10 rounded-xl flex items-center justify-center">
                  <i className="ri-vip-crown-line text-forest-400 text-lg"></i>
                </div>
                <div>
                  <h2 className="text-white font-bold text-lg">早鳥會員</h2>
                  <span className="inline-block px-2 py-0.5 bg-forest-500/15 text-forest-400 text-xs font-medium rounded-full">
                    即將開放
                  </span>
                </div>
              </div>

              <p className="text-surface-400 text-sm mb-5">
                正式會員開放後，早鳥名單將優先取得完整盤前腳本、隔夜影響鏈、盤中追蹤與收盤驗證。
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
                {[
                  { icon: 'ri-file-text-line', label: '完整盤前腳本' },
                  { icon: 'ri-link-m', label: '今日隔夜影響鏈' },
                  { icon: 'ri-list-check', label: '今日不要做清單' },
                  { icon: 'ri-compass-3-line', label: '盤中追蹤與修正訊號' },
                  { icon: 'ri-check-double-line', label: '收盤驗證與明日觀察' },
                ].map((item) => (
                  <div key={item.label} className="flex items-center gap-2 px-3 py-2.5 bg-navy-900/60 rounded-lg border border-navy-800">
                    <div className="w-5 h-5 flex items-center justify-center">
                      <i className={`${item.icon} text-forest-400/60 text-sm`}></i>
                    </div>
                    <span className="text-surface-300 text-sm">{item.label}</span>
                  </div>
                ))}
              </div>

              {waitlistSubmitted ? (
                <div className="bg-forest-500/10 border border-forest-500/20 rounded-xl p-4 text-center">
                  <div className="w-8 h-8 bg-forest-500/15 rounded-full flex items-center justify-center mx-auto mb-2">
                    <i className="ri-check-line text-forest-400 text-sm"></i>
                  </div>
                  <p className="text-forest-300 text-sm font-medium">已成功加入早鳥名單！</p>
                  <p className="text-surface-500 text-xs mt-1">正式會員開放時你會第一個收到通知</p>
                </div>
              ) : (
                <form
                  id="pro-waitlist"
                  data-readdy-form
                  onSubmit={handleWaitlistSubmit}
                  action="https://readdy.ai/api/form/d8ba9c0gjs7oo2th663g"
                  method="POST"
                  className="flex flex-col sm:flex-row gap-3"
                >
                  <input
                    type="email"
                    name="email"
                    value={waitlistEmail}
                    onChange={(e) => setWaitlistEmail(e.target.value)}
                    placeholder="輸入你的 Email"
                    required
                    className="flex-1 px-4 py-3 bg-navy-900 border border-navy-700 rounded-xl text-white text-sm placeholder:text-surface-500 focus:outline-none focus:border-forest-500/50 transition-colors"
                  />
                  <button
                    type="submit"
                    className="px-6 py-3 bg-forest-600 hover:bg-forest-500 text-white font-semibold text-sm rounded-xl transition-colors whitespace-nowrap flex items-center justify-center gap-2"
                  >
                    <i className="ri-mail-send-line"></i>
                    加入早鳥名單
                  </button>
                </form>
              )}
              {!waitlistSubmitted && (
                <p className="text-surface-600 text-xs text-center mt-2">
                  正式會員開放時優先通知，目前不收費
                </p>
              )}
            </div>

            {/* Value hooks */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
              {[
                {
                  icon: 'ri-time-line',
                  title: '30 秒看懂',
                  desc: '不用刷新聞、不用盯盤、不用懂術語',
                },
                {
                  icon: 'ri-emotion-line',
                  title: '情緒陪伴',
                  desc: 'AI 幫你消化市場焦慮，不是加劇它',
                },
                {
                  icon: 'ri-calendar-check-line',
                  title: '每天 07:30',
                  desc: '盤前自動送到，看完就出門',
                },
              ].map((hook) => (
                <div key={hook.title} className="bg-white border border-surface-200 rounded-xl p-5 text-center">
                  <div className="w-10 h-10 bg-navy-800 rounded-xl flex items-center justify-center mx-auto mb-3">
                    <i className={`${hook.icon} text-white text-base`}></i>
                  </div>
                  <h3 className="text-navy-900 font-semibold text-sm mb-1">{hook.title}</h3>
                  <p className="text-surface-500 text-xs">{hook.desc}</p>
                </div>
              ))}
            </div>

            {/* Testimonials */}
            <div className="bg-navy-950 border border-navy-800 rounded-2xl p-6 md:p-8 mb-10">
              <h3 className="text-white font-bold text-base mb-4 text-center">
                為什麼有人每天早上都想看？
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  {
                    text: '「以前每天早上要刷 10 個網站，現在 30 秒看完 AI 整理，還能知道今天該不該衝。」',
                    by: '台中 · 上班族投資人',
                  },
                  {
                    text: '「不是給我新聞，是告訴我今天適不適合操作。這個差別很大。」',
                    by: '台北 · 三年股齡',
                  },
                  {
                    text: '「最常看的是『今天最容易犯的錯』，因為 AI 真的了解市場情緒。」',
                    by: '高雄 · 新手投資人',
                  },
                  {
                    text: '「LINE 推播比我自己去查還快，而且語氣像朋友在提醒我冷靜。」',
                    by: '新竹 · 科技業',
                  },
                ].map((t, i) => (
                  <div key={i} className="bg-navy-900/60 rounded-xl p-4 border border-navy-800">
                    <p className="text-surface-300 text-sm leading-relaxed mb-2">{t.text}</p>
                    <p className="text-surface-600 text-xs">{t.by}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* FAQ */}
            <div className="bg-white border border-surface-200 rounded-xl p-5 md:p-6 mb-10">
              <h3 className="text-navy-900 font-semibold text-base mb-4">常見問題</h3>
              <div className="space-y-4">
                {[
                  {
                    q: '這是投資建議嗎？',
                    a: '不是。Morning Alpha 提供的是市場情緒觀察與 AI 分析整理，不構成投資建議。',
                  },
                  {
                    q: '多久更新一次？',
                    a: '每日早上 07:30 更新盤前觀察，未來將加入盤中情緒提醒。',
                  },
                  {
                    q: '為什麼需要加入 LINE？',
                    a: '重要市場情緒變化與盤中提醒會優先透過 LINE 推送。',
                  },
                  {
                    q: '現在需要付費嗎？',
                    a: '目前完全不需要付費。Morning Alpha 所有使用者都可以免費查看每日 AI 市場提醒與盤前報告。',
                  },
                  {
                    q: '會員版什麼時候開放？',
                    a: '會員版會在系統穩定後逐步開放，預計包含完整盤前腳本、隔夜影響鏈、盤中追蹤與收盤驗證。加入早鳥名單即可在開放時優先收到通知。',
                  },
                ].map((faq, i) => (
                  <div key={i}>
                    <p className="text-navy-900 text-sm font-semibold mb-1">{faq.q}</p>
                    <p className="text-surface-500 text-sm leading-relaxed">{faq.a}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
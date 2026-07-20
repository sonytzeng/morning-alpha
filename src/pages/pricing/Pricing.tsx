import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import EarlyAccessForm from '@/components/feature/EarlyAccessForm';
import Footer from '@/components/feature/Footer';
import Navbar from '@/components/feature/Navbar';
import { LINE_ADD_FRIEND_URL } from '@/config/brand';
import { trackEvent, trackPageView } from '@/utils/analytics';

const publicFeatures = [
  '30 秒首頁判斷',
  '今日方向與下一個驗證時間',
  '公開候選股篩選結果',
  '可查證的歷史績效',
];

const memberFeatures = [
  '海外事件 → 台股族群 → 代表股完整因果鏈',
  '09:30、10:30、13:00 盤中變化與判斷更新',
  '每檔候選股的成立條件、取消條件與反向證據',
  '14:20 收盤驗證、失誤原因與明日調整',
  'LINE 每日提醒與重要節點通知',
];

export default function Pricing() {
  const location = useLocation();

  useEffect(() => {
    trackPageView('/pricing');
  }, []);

  useEffect(() => {
    if (!location.hash) return;
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(location.hash.slice(1));
      target?.scrollIntoView({ block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.hash]);

  return (
    <div className="ma-page ma-pricing-v2 flex min-h-screen flex-col overflow-x-hidden">
      <Navbar />
      <main className="flex-1">
        <header className="ma-pricing-v2-hero">
          <div className="ma-pricing-v2-shell">
            <span>Morning Alpha 會員計畫</span>
            <h1>每天不用猜方向，<br />先知道什麼證據值得等</h1>
            <p>Morning Alpha 專為沒有時間盯盤的上班族整理：盤前先定判斷、盤中只更新變化、收盤公開驗證。不是報明牌，而是幫你少做一次情緒決策。</p>
            <div className="ma-pricing-v2-hero-actions">
              <a href="#early-access">加入早鳥名單<i className="ri-arrow-down-line" aria-hidden="true" /></a>
              <Link to="/report/today">先看今天怎麼判斷</Link>
            </div>
          </div>
        </header>

        <div className="ma-pricing-v2-shell ma-pricing-v2-content">
          <section aria-labelledby="pricing-plan-title">
            <div className="ma-pricing-v2-heading">
              <span>方案現況</span>
              <h2 id="pricing-plan-title">先完整試用 14 天，再決定值不值得留下</h2>
              <p>目前仍是公開測試，登記不會扣款。正式開放時預定提供 14 天完整會員體驗，之後才由你決定是否以每月 NT$199 繼續。</p>
            </div>
            <div className="ma-pricing-v2-plans">
              <article>
                <header><div><span>目前開放</span><h3>公開測試</h3></div><strong>NT$0</strong></header>
                <p>先確認這套流程是否真的能幫你減少衝動決策。</p>
                <ul>{publicFeatures.map((feature) => <li key={feature}><i className="ri-check-line" aria-hidden="true" />{feature}</li>)}</ul>
                <Link to="/">開始使用</Link>
              </article>
              <article className="is-member">
                <header><div><span>預定正式方案</span><h3>創始會員</h3></div><strong>NT$199<small>/月</small></strong></header>
                <p>前 14 天完整試用。適合想減少資訊焦慮、又需要每天有一套固定判斷流程的上班族。</p>
                <ul>{memberFeatures.map((feature) => <li key={feature}><i className="ri-check-line" aria-hidden="true" />{feature}</li>)}</ul>
                <a href="#early-access">取得開放通知</a>
              </article>
            </div>
          </section>

          <section className="ma-pricing-v2-flow" aria-labelledby="pricing-flow-title">
            <div className="ma-pricing-v2-heading">
              <span>每天的付費價值</span>
              <h2 id="pricing-flow-title">不是更多資訊，是一條走得完的決策鏈</h2>
            </div>
            <ol>
              <li><span>01</span><div><strong>盤前先定界線</strong><p>知道今天先不要做什麼，以及什麼證據出現才改變。</p></div></li>
              <li><span>02</span><div><strong>盤中只看變化</strong><p>事件流只記錄新增證據，不把早上的內容重複一次。</p></div></li>
              <li><span>03</span><div><strong>收盤留下紀錄</strong><p>把成立、失敗與下一次改善留下來，而不是只記得結果。</p></div></li>
            </ol>
          </section>

          <section className="ma-pricing-v2-flow" aria-labelledby="pricing-fit-title">
            <div className="ma-pricing-v2-heading">
              <span>適合誰</span>
              <h2 id="pricing-fit-title">你不需要更會預測，只需要更少被情緒帶走</h2>
              <p>如果你每天只有幾分鐘看盤，又常被新聞、群組或盤中急漲急跌打亂，這套流程就是為你設計。</p>
            </div>
            <ol>
              <li><span>✓</span><div><strong>適合：沒時間盯盤的上班族</strong><p>每天只看關鍵節點與真正改變判斷的新證據。</p></div></li>
              <li><span>✓</span><div><strong>適合：容易追高、殺低或資訊焦慮的人</strong><p>先看到失效條件，再決定是否需要行動。</p></div></li>
              <li><span>×</span><div><strong>不適合：只想拿明牌或保證獲利的人</strong><p>我們保留完整驗證紀錄，也會公開承認資料不足與判斷失誤。</p></div></li>
            </ol>
          </section>

          <section id="early-access" className="ma-pricing-v2-conversion" aria-labelledby="early-access-title">
            <div>
              <span>早鳥通知</span>
              <h2 id="early-access-title">先取得 14 天完整試用通知</h2>
              <p>早鳥登記不等於購買，也不會扣款。正式開放時，你會先收到 14 天試用方式、NT$199 方案內容與取消規則。</p>
            </div>
            <EarlyAccessForm sourcePage="/pricing" />
          </section>

          <section className="ma-pricing-v2-line">
            <div><i className="ri-line-line" aria-hidden="true" /><div><strong>先用 LINE 建立每日回訪習慣</strong><p>每天盤前提醒送到你常用的地方。</p></div></div>
            <a
              href={LINE_ADD_FRIEND_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackEvent('click_line_daily_reminder', { location: 'pricing' })}
            >
              加入 LINE<i className="ri-external-link-line" aria-hidden="true" />
            </a>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}

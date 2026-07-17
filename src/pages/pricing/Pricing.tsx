import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import EarlyAccessForm from '@/components/feature/EarlyAccessForm';
import Footer from '@/components/feature/Footer';
import Navbar from '@/components/feature/Navbar';
import { LINE_ADD_FRIEND_URL } from '@/config/brand';
import { trackEvent, trackPageView } from '@/utils/analytics';

const publicFeatures = [
  '30 秒首頁判斷',
  '今日判斷工作台',
  '候選股篩選流程',
  '公開驗證紀錄',
];

const memberFeatures = [
  '完整因果研究筆記',
  '盤中變化監控與提醒',
  '候選股成立與取消條件',
  '可追溯的收盤驗證與歷史紀錄',
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
            <h1>少看一點雜訊，<br />每天多保留一次冷靜判斷</h1>
            <p>Morning Alpha 不是報明牌服務。我們把盤前假設、盤中變化與收盤驗證串成一套每天能重複使用的決策流程。</p>
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
              <h2 id="pricing-plan-title">公開測試先驗證價值，正式收費前再決定</h2>
              <p>目前核心功能仍在公開測試。早鳥登記不等於購買，只代表接收通知，也不會產生費用。</p>
            </div>
            <div className="ma-pricing-v2-plans">
              <article>
                <header><div><span>目前開放</span><h3>公開測試</h3></div><strong>NT$0</strong></header>
                <p>先確認這套流程是否真的能幫你減少衝動決策。</p>
                <ul>{publicFeatures.map((feature) => <li key={feature}><i className="ri-check-line" aria-hidden="true" />{feature}</li>)}</ul>
                <Link to="/">開始使用</Link>
              </article>
              <article className="is-member">
                <header><div><span>規劃中</span><h3>創始會員</h3></div><strong>開放前公布</strong></header>
                <p>為需要完整脈絡、盤中追蹤與長期驗證紀錄的使用者準備。</p>
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

          <section id="early-access" className="ma-pricing-v2-conversion" aria-labelledby="early-access-title">
            <div>
              <span>早鳥通知</span>
              <h2 id="early-access-title">想在會員方案開放時先知道？</h2>
              <p>我們會先公布功能範圍、價格與開放日期，再由你決定是否加入。</p>
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

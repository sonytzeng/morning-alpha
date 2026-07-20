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
  '今日是否適合當沖、成立條件與放棄條件',
  '09:30、10:30、13:00 盤中變化與判斷更新',
  '每檔候選股的成立條件、取消條件與反向證據',
  '14:20 收盤驗證、失誤原因與明日調整',
  'LINE 每日提醒與重要節點通知',
];

const dailyDeliveries = [
  { time: '07:30', title: '盤前決策', detail: '四個答案、三個優先觀察，以及今天最該避免的錯。' },
  { time: '09:30', title: '開盤與當沖確認', detail: '判斷今天是否適合當沖；資料不足就不建立劇本。' },
  { time: '10:30／13:00', title: '盤中只報變化', detail: '更新成立條件、放棄條件與優先觀察順位。' },
  { time: '14:20', title: '收盤驗證', detail: '核對早盤假設、記錄失準原因並留下明日調整。' },
];

const planComparison = [
  { label: '今日能不能做', publicValue: '結論與下一次確認', memberValue: '完整理由、支持與反對證據' },
  { label: '優先觀察', publicValue: '最多三項摘要', memberValue: '因果鏈、成立與取消條件' },
  { label: '當沖決策', publicValue: '目前狀態', memberValue: '是否適合、成立條件與放棄條件' },
  { label: '盤中更新', publicValue: '目前狀態', memberValue: '09:30、10:30、13:00 新增變化' },
  { label: '收盤後', publicValue: '公開結果', memberValue: '失準原因、可保留規則與明日調整' },
  { label: '通知', publicValue: '自行回站查看', memberValue: 'LINE 關鍵節點提醒' },
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
            <ol className="is-daily-delivery">
              {dailyDeliveries.map((item) => (
                <li key={item.time}><span>{item.time}</span><div><strong>{item.title}</strong><p>{item.detail}</p></div></li>
              ))}
            </ol>
          </section>

          <section className="ma-pricing-v2-comparison" aria-labelledby="pricing-comparison-title">
            <div className="ma-pricing-v2-heading">
              <span>免費與會員差在哪裡</span>
              <h2 id="pricing-comparison-title">免費版給答案，會員版交代為什麼與何時改變</h2>
              <p>會員不是多看幾張卡，而是取得從盤前假設、盤中更新到收盤檢討的完整紀錄。</p>
            </div>
            <div className="ma-pricing-v2-comparison-table" role="table" aria-label="公開測試與創始會員比較">
              <div className="is-heading" role="row"><strong role="columnheader">每日需求</strong><strong role="columnheader">公開測試</strong><strong role="columnheader">創始會員</strong></div>
              {planComparison.map((item) => (
                <div key={item.label} role="row"><strong role="rowheader">{item.label}</strong><span role="cell">{item.publicValue}</span><span role="cell">{item.memberValue}</span></div>
              ))}
            </div>
          </section>

          <section className="ma-pricing-v2-trial" aria-labelledby="pricing-trial-title">
            <div className="ma-pricing-v2-heading">
              <span>14 天怎麼判斷值不值得</span>
              <h2 id="pricing-trial-title">不是試看兩篇文章，而是跑完兩週真實決策循環</h2>
            </div>
            <ol>
              <li><span>第 1–3 天</span><strong>建立每天三分鐘的固定閱讀順序</strong><p>先看四個答案，再決定今天是否需要繼續追蹤。</p></li>
              <li><span>第 4–10 天</span><strong>觀察它是否真的減少追高與焦慮</strong><p>用盤中更新確認自己有沒有少被短線雜訊帶走。</p></li>
              <li><span>第 11–14 天</span><strong>用收盤紀錄決定要不要留下</strong><p>檢查判斷是否誠實、失準是否有說明，再決定是否續用。</p></li>
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

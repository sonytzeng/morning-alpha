import { Link } from 'react-router-dom';
import Navbar from '@/components/feature/Navbar';
import Footer from '@/components/feature/Footer';
import MorningHeroCard from './components/MorningHeroCard';
import TodayInfoCards from './components/TodayInfoCards';
import MorningReminderCard from './components/MorningReminderCard';
import { useAccountDashboard } from '@/hooks/useAccountDashboard';
import VisualPageHero from '@/components/feature/VisualPageHero';
import MembershipStatusCard from '@/components/membership/MembershipStatusCard';

function isTaipeiWeekend(): boolean {
  const now = new Date();
  const tw = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  return tw.getDay() === 0 || tw.getDay() === 6;
}

export default function Account() {
  const { data, loading, error } = useAccountDashboard();

  const isWeekend = isTaipeiWeekend();
  const hasAnyReport = (data.recent30 && data.recent30.length > 0) || data.hasTodayReport;

  if (loading) {
    return (
      <div className="min-h-screen bg-navy-950 flex flex-col">
        <Navbar />
        <main className="flex-1">
          <div className="w-full px-4 md:px-6 py-6 md:py-10">
            <div className="max-w-4xl mx-auto space-y-6 md:space-y-8">
              <div className="mb-2">
                <div className="h-3 bg-white/5 rounded w-32 mb-2 animate-pulse"></div>
                <div className="h-6 bg-white/5 rounded w-48 mb-1 animate-pulse"></div>
                <div className="h-4 bg-white/5 rounded w-64 animate-pulse"></div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-8 animate-pulse">
                <div className="h-6 bg-white/5 rounded w-48 mb-3"></div>
                <div className="h-4 bg-white/5 rounded w-72 mb-6"></div>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div className="h-20 bg-white/5 rounded-xl"></div>
                  <div className="h-20 bg-white/5 rounded-xl"></div>
                  <div className="h-20 bg-white/5 rounded-xl"></div>
                  <div className="h-20 bg-white/5 rounded-xl"></div>
                </div>
              </div>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-navy-950 flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="text-center max-w-md">
            <i className="ri-error-warning-line text-red-400 text-3xl mb-3"></i>
            <h2 className="text-white font-semibold text-base mb-2">讀取資料失敗</h2>
            <p className="text-white/30 text-sm mb-4">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="min-h-11 px-4 py-2 bg-white/10 hover:bg-white/15 text-white text-sm rounded-xl transition-colors whitespace-nowrap border border-white/10"
            >
              重新載入
            </button>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  const { todayReport, hasTodayReport } = data;

  const reportLinkText = isWeekend ? '查看最近交易日盤前簡報' : '查看今日盤前簡報';

  return (
    <div className="ma-page flex flex-col">
      <Navbar />

      <main className="flex-1">
        <VisualPageHero
          eyebrow="會員中心"
          icon="ri-user-star-line"
          title="你的 Morning Alpha"
          subtitle="先確認會員權限，再沿著今日判斷、盤中追蹤與收盤驗證完成一天。"
          decisionLabel="今日入口"
          decision={reportLinkText}
          ctaLabel={reportLinkText}
          ctaTo="/report/today"
        />
        <div className="w-full px-4 md:px-6 py-6 md:py-10">
          <div className="max-w-4xl mx-auto space-y-6 md:space-y-8">
            <MembershipStatusCard />

            <section aria-labelledby="member-daily-path-title">
              <div className="mb-4">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary-300">每日使用路徑</p>
                <h2 id="member-daily-path-title" className="mt-2 text-xl font-bold text-white">從盤前判斷一路走到收盤驗證</h2>
                <p className="mt-1 text-sm leading-6 text-white/45">每個入口只處理一件事，不需要在不同頁面重複找答案。</p>
              </div>
            <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-3">
              <Link
                to="/report/today"
                className="ma-card-compact group flex items-center gap-3 transition-colors hover:border-primary-400/40"
              >
                <div className="w-9 h-9 bg-forest-500/15 rounded-lg flex items-center justify-center border border-forest-500/20">
                  <i className="ri-file-list-3-line text-forest-400 text-sm"></i>
                </div>
                <div>
                  <p className="text-white text-sm font-medium group-hover:text-forest-300 transition-colors">今日判斷</p>
                  <p className="text-white/30 text-[10px]">先看今日怎麼做</p>
                </div>
              </Link>
              <Link
                to="/member-note"
                className="ma-card-compact group flex items-center gap-3 transition-colors hover:border-primary-400/40"
              >
                <div className="w-9 h-9 bg-primary-500/15 rounded-lg flex items-center justify-center border border-primary-500/20">
                  <i className="ri-file-shield-2-line text-primary-400 text-sm"></i>
                </div>
                <div>
                  <p className="text-white text-sm font-medium group-hover:text-primary-300 transition-colors">會員決策簡報</p>
                  <p className="text-white/30 text-[10px]">完整因果與條件</p>
                </div>
              </Link>
              <Link
                to="/war-room"
                className="ma-card-compact group flex items-center gap-3 transition-colors hover:border-primary-400/40"
              >
                <div className="w-9 h-9 bg-forest-500/15 rounded-lg flex items-center justify-center border border-forest-500/20">
                  <i className="ri-radar-line text-forest-400 text-sm"></i>
                </div>
                <div>
                  <p className="text-white text-sm font-medium group-hover:text-forest-300 transition-colors">盤中追蹤</p>
                  <p className="text-white/30 text-[10px]">只看市場變化</p>
                </div>
              </Link>
              <Link
                to="/verification"
                className="ma-card-compact group flex items-center gap-3 transition-colors hover:border-amber-400/40"
              >
                <div className="w-9 h-9 bg-amber-500/15 rounded-lg flex items-center justify-center border border-amber-500/20">
                  <i className="ri-checkbox-circle-line text-amber-300 text-sm"></i>
                </div>
                <div>
                  <p className="text-white text-sm font-medium group-hover:text-amber-300 transition-colors">收盤驗證</p>
                  <p className="text-white/30 text-[10px]">核對早盤判斷</p>
                </div>
              </Link>
            </div>
            </section>

            <MorningHeroCard
              todayReport={todayReport}
              hasTodayReport={hasTodayReport}
              streak={data.streak}
              isWeekend={isWeekend}
              hasAnyReport={hasAnyReport}
            />

            {/* Today Info Cards */}
            <TodayInfoCards
              todayReport={todayReport}
              hasTodayReport={hasTodayReport}
              marketDataLatestAt={data.marketDataLatestAt}
              isMarketDataToday={data.isMarketDataToday}
              marketNewsLatestAt={data.marketNewsLatestAt}
              selectedNewsCount={data.selectedNewsCount}
              totalNewsCount={data.totalNewsCount}
              isMarketNewsToday={data.isMarketNewsToday}
              intradayLatestAt={data.intradayLatestAt}
              intradayCheckDate={data.intradayCheckDate}
              hasIntradayData={data.hasIntradayData}
              isIntradayToday={data.isIntradayToday}
              intradayRadarStatus={data.intradayRadarStatus}
              intradayRadarBias={data.intradayRadarBias}
              intradayRadarSummary={data.intradayRadarSummary}
              isWeekend={isWeekend}
              fallbackReportDate={todayReport?.report_date ?? null}
              isTXFAvailable={data.isTXFAvailable}
            />

            {/* Morning Reminder (LINE) */}
            <MorningReminderCard />
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}

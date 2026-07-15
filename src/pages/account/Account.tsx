import { Link } from 'react-router-dom';
import Navbar from '@/components/feature/Navbar';
import Footer from '@/components/feature/Footer';
import MorningHeroCard from './components/MorningHeroCard';
import TodayInfoCards from './components/TodayInfoCards';
import MarketRhythmCard from './components/MarketRhythmCard';
import MorningReminderCard from './components/MorningReminderCard';
import AIQuotesCollection from './components/AIQuotesCollection';
import MarketTimeline from './components/MarketTimeline';
import { useAccountDashboard } from '@/hooks/useAccountDashboard';
import VisualPageHero from '@/components/feature/VisualPageHero';
import VisualSectionHeader from '@/components/feature/VisualSectionHeader';

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
              className="px-4 py-2 bg-white/10 hover:bg-white/15 text-white text-sm rounded-xl transition-colors whitespace-nowrap border border-white/10"
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

  // Compute growth stats
  const totalReportsRead = data.recent30.length;
  const totalVerifications = 0; // would need intraday_checks join
  const monthlyObservations = data.recent30.filter((r) => {
    const rd = new Date(r.report_date);
    const now = new Date();
    return rd.getMonth() === now.getMonth() && rd.getFullYear() === now.getFullYear();
  }).length;

  const reportLinkText = isWeekend ? '查看最近交易日盤前簡報' : '查看今日盤前簡報';

  return (
    <div className="ma-page flex flex-col">
      <Navbar />

      <main className="flex-1">
        <VisualPageHero
          eyebrow="觀察中心"
          icon="ri-eye-line"
          title="Morning Alpha 觀察中心"
          subtitle="集中查看最近交易日的盤前劇本、資料狀態、盤中驗證與歷史觀察。"
          decisionLabel="今日入口"
          decision={reportLinkText}
          ctaLabel={reportLinkText}
          ctaTo="/report/today"
        />
        <div className="w-full px-4 md:px-6 py-6 md:py-10">
          <div className="max-w-4xl mx-auto space-y-6 md:space-y-8">
            {/* Hero: 觀察中心 */}
            <MorningHeroCard
              todayReport={todayReport}
              hasTodayReport={hasTodayReport}
              streak={data.streak}
              isWeekend={isWeekend}
              hasAnyReport={hasAnyReport}
            />

            {/* Quick Access */}
            <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-3">
              <Link
                to="/report/today"
                className="ma-card-compact group flex items-center gap-3 transition-colors hover:border-primary-400/40"
              >
                <div className="w-9 h-9 bg-forest-500/15 rounded-lg flex items-center justify-center border border-forest-500/20">
                  <i className="ri-file-list-3-line text-forest-400 text-sm"></i>
                </div>
                <div>
                  <p className="text-white text-sm font-medium group-hover:text-forest-300 transition-colors">盤前簡報</p>
                  <p className="text-white/30 text-[10px]">AI 每日分析</p>
                </div>
              </Link>
              <Link
                to="/war-room"
                className="ma-card-compact group flex items-center gap-3 transition-colors hover:border-primary-400/40"
              >
                <div className="w-9 h-9 bg-primary-500/15 rounded-lg flex items-center justify-center border border-primary-500/20">
                  <i className="ri-shield-check-line text-primary-400 text-sm"></i>
                </div>
                <div>
                  <p className="text-white text-sm font-medium group-hover:text-primary-300 transition-colors">資料完整度</p>
                  <p className="text-white/30 text-[10px]">來源新鮮度</p>
                </div>
              </Link>
              <Link
                to="/"
                className="ma-card-compact group flex items-center gap-3 transition-colors hover:border-primary-400/40"
              >
                <div className="w-9 h-9 bg-forest-500/15 rounded-lg flex items-center justify-center border border-forest-500/20">
                  <i className="ri-home-4-line text-forest-400 text-sm"></i>
                </div>
                <div>
                  <p className="text-white text-sm font-medium group-hover:text-forest-300 transition-colors">首頁</p>
                  <p className="text-white/30 text-[10px]">30 秒摘要</p>
                </div>
              </Link>
              <span className="ma-card-compact group flex items-center gap-3 opacity-60 cursor-not-allowed">
                <div className="w-9 h-9 bg-green-500/15 rounded-lg flex items-center justify-center border border-green-500/20">
                  <i className="ri-line-line text-green-400 text-sm"></i>
                </div>
                <div>
                  <p className="text-white/50 text-sm font-medium">LINE 推播</p>
                  <p className="text-white/20 text-[10px]">暫緩開放</p>
                </div>
              </span>
            </div>

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

            {/* V377: 早鳥名單表單 */}
            <section>
              <div className="ma-card md:p-6">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-5 h-5 rounded bg-emerald-500/15 flex items-center justify-center">
                    <i className="ri-mail-send-line text-emerald-400 text-[10px]" />
                  </div>
                  <h2 className="text-white/80 font-semibold text-sm uppercase tracking-wider">加入早鳥名單</h2>
                </div>
                <p className="text-white/45 text-xs leading-relaxed mb-4">
                  訂閱 Morning Alpha 早鳥通知，第一時間收到每日盤前報告更新提醒。
                </p>
                <form
                  data-readdy-form
                  action="https://readdy.ai/api/form/d8ocrlu7ga8frnon0lfg"
                  method="POST"
                  encType="application/x-www-form-urlencoded"
                  className="flex flex-col sm:flex-row gap-3"
                  onSubmit={(e) => {
                    const btn = e.currentTarget.querySelector('button');
                    if (btn) {
                      btn.textContent = '已送出';
                      btn.setAttribute('disabled', 'true');
                    }
                  }}
                >
                  <input
                    type="email"
                    name="email"
                    required
                    placeholder="你的 Email"
                    className="flex-1 px-4 py-3 bg-navy-800 border border-navy-700 rounded-xl text-white placeholder:text-white/25 text-sm outline-none focus:border-emerald-500/50 transition-colors"
                  />
                  <button
                    type="submit"
                  className="ma-btn-primary whitespace-nowrap"
                  >
                    加入早鳥名單
                  </button>
                </form>
                <p className="text-white/20 text-[10px] mt-3 leading-relaxed">
                  我們不會發送垃圾郵件，僅用於 Morning Alpha 更新通知。隨時可取消訂閱。
                </p>
              </div>
            </section>

            {/* Market Rhythm */}
            <MarketRhythmCard reports={data.recent7} />

            {/* 資料累積統計 */}
            <section>
              <VisualSectionHeader icon="ri-award-line" title="Morning Alpha 資料累積" description="已累積的觀察與資料日。" />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="ma-card-compact text-center">
                  <p className="text-white/25 text-[10px] uppercase tracking-wider mb-1">已累積觀察日</p>
                  <p className="text-white font-bold text-xl">{totalReportsRead}<span className="text-white/30 text-sm ml-1">天</span></p>
                </div>
                <div className="ma-card-compact text-center">
                  <p className="text-white/25 text-[10px] uppercase tracking-wider mb-1">連續資料日</p>
                  <p className="text-white font-bold text-xl">{data.streak}<span className="text-white/30 text-sm ml-1">天</span></p>
                </div>
                <div className="ma-card-compact text-center">
                  <p className="text-white/25 text-[10px] uppercase tracking-wider mb-1">本月市場觀察</p>
                  <p className="text-white font-bold text-xl">{monthlyObservations}<span className="text-white/30 text-sm ml-1">次</span></p>
                </div>
              </div>
            </section>

            {/* Morning Alpha 資料累積 */}
            <section>
              <VisualSectionHeader icon="ri-seedling-line" title="Morning Alpha 資料累積" description="報告與市場驗證累積。" />
              <div className="ma-card md:p-6">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="flex items-center gap-4 p-3 rounded-xl bg-white/[0.02] border border-white/5">
                    <div className="w-10 h-10 bg-forest-500/10 rounded-lg flex items-center justify-center flex-shrink-0 border border-forest-500/20">
                      <i className="ri-calendar-check-line text-forest-400 text-sm" />
                    </div>
                    <div>
                      <p className="text-white font-bold text-lg">{totalReportsRead}<span className="text-white/30 text-sm"> 天</span></p>
                      <p className="text-white/30 text-xs">已累積觀察</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 p-3 rounded-xl bg-white/[0.02] border border-white/5">
                    <div className="w-10 h-10 bg-amber-500/10 rounded-lg flex items-center justify-center flex-shrink-0 border border-amber-500/20">
                      <i className="ri-file-list-3-line text-amber-400 text-sm" />
                    </div>
                    <div>
                      <p className="text-white font-bold text-lg">{totalReportsRead}<span className="text-white/30 text-sm"> 份</span></p>
                      <p className="text-white/30 text-xs">已產生盤前報告</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 p-3 rounded-xl bg-white/[0.02] border border-white/5">
                    <div className="w-10 h-10 bg-primary-500/10 rounded-lg flex items-center justify-center flex-shrink-0 border border-primary-500/20">
                      <i className="ri-shield-check-line text-primary-400 text-sm" />
                    </div>
                    <div>
                      <p className="text-white font-bold text-lg">{totalVerifications}<span className="text-white/30 text-sm"> 次</span></p>
                      <p className="text-white/30 text-xs">已完成市場驗證</p>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Morning Reminder (LINE) */}
            <MorningReminderCard />

            {/* AI Quotes */}
            <AIQuotesCollection recentReports={data.recent30} />

            {/* Market Timeline */}
            <MarketTimeline reports={data.recent30} />

            {/* Bottom CTA */}
            <div className="ma-card-primary p-5 text-center md:p-8">
              <div className="max-w-lg mx-auto">
                <div className="w-10 h-10 bg-forest-500/15 rounded-xl flex items-center justify-center mx-auto mb-3 md:mb-4">
                  <i className="ri-sun-line text-forest-400 text-lg"></i>
                </div>
                <h3 className="text-white font-bold text-base md:text-lg mb-2">
                  下一個交易日早上，Morning Alpha 會再幫你看一次市場
                </h3>
                <p className="text-white/40 text-xs md:text-sm mb-4 md:mb-5 leading-relaxed">
                  每天早上 07:30，Morning Alpha 會整理市場氛圍、熱門方向與風險提醒，
                  幫你用更冷靜的方式開始看市場。
                </p>
                <div className="flex flex-col gap-3 w-full sm:flex-row sm:justify-center">
                  <Link
                    to="/report/today"
                    className="ma-btn-primary w-full whitespace-nowrap sm:w-auto"
                  >
                    <i className="ri-file-list-3-line"></i>
                    {reportLinkText}
                  </Link>
                  <Link
                    to="/reports"
                    className="ma-btn-secondary w-full whitespace-nowrap sm:w-auto"
                  >
                    歷史報告
                    <i className="ri-arrow-right-line"></i>
                  </Link>
                </div>
                <p className="text-white/20 text-[11px] mt-3 md:mt-4">
                  免費封測中 · 不構成投資建議
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

import { useState } from 'react';

interface AnalyticsData {
  todayVisitors: number;
  returnRate: number;
  avgDwellTime: string;
  peakHour: string;
  topSection: string;
  topSectionTime: string;
  topReminder: string;
  topClickArea: string;
  weekTraffic: number[];
}

const mockAnalytics: AnalyticsData = {
  todayVisitors: 1247,
  returnRate: 62.3,
  avgDwellTime: '3:42',
  peakHour: '07:25 - 07:45',
  topSection: '「今天最容易犯的錯」',
  topSectionTime: '平均 5.8 秒',
  topReminder: '「今天不是拼速度，而是拼誰比較冷靜」',
  topClickArea: '查看今日完整情報',
  weekTraffic: [892, 1045, 1234, 1156, 1089, 1247, 0],
};

const sectionDwellData = [
  { name: '今天最容易犯的錯', time: '5.8s', pct: 100 },
  { name: '今日 AI 想提醒你', time: '4.2s', pct: 72 },
  { name: '市場情緒雷達', time: '3.9s', pct: 67 },
  { name: '10 萬元配置', time: '3.5s', pct: 60 },
  { name: '明天市場劇本', time: '3.1s', pct: 53 },
  { name: '市場數據翻譯', time: '2.4s', pct: 41 },
];

const reminderClicks = [
  { text: '今天不是拼速度，而是拼誰比較冷靜', clicks: 387, shares: 142 },
  { text: '市場最危險時，通常看起來最安全', clicks: 342, shares: 118 },
  { text: '保留現金不是懦弱，是智慧', clicks: 298, shares: 89 },
  { text: '不要因為市場熱，就忘記風險', clicks: 256, shares: 76 },
  { text: '你看到的漲停，可能已經是別人的利潤', clicks: 231, shares: 94 },
];

export default function AdminAnalyticsDashboard() {
  const [data] = useState<AnalyticsData>(mockAnalytics);
  const days = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'];
  const maxTraffic = Math.max(...data.weekTraffic);

  return (
    <div className="space-y-5">
      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: '今日訪客數', value: data.todayVisitors.toLocaleString(), icon: 'ri-user-line', color: 'bg-navy-800' },
          { label: '回訪率', value: `${data.returnRate}%`, icon: 'ri-refresh-line', color: 'bg-forest-600' },
          { label: '平均停留', value: data.avgDwellTime, icon: 'ri-time-line', color: 'bg-amber-500' },
          { label: '今日高峰時段', value: data.peakHour, icon: 'ri-fire-line', color: 'bg-red-500' },
        ].map((stat) => (
          <div key={stat.label} className="bg-white border border-surface-200 rounded-xl p-4">
            <div className={`w-8 h-8 ${stat.color} rounded-lg flex items-center justify-center mb-3`}>
              <i className={`${stat.icon} text-white text-sm`}></i>
            </div>
            <span className="text-surface-500 text-xs block mb-1">{stat.label}</span>
            <span className="text-navy-900 text-lg font-bold">{stat.value}</span>
          </div>
        ))}
      </div>

      {/* Week Traffic */}
      <div className="bg-white border border-surface-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-navy-900 font-semibold text-sm">最近 7 天流量變化</h3>
          <span className="text-surface-400 text-xs">單位：人次</span>
        </div>
        <div className="flex items-end gap-2 h-40">
          {data.weekTraffic.map((val, idx) => (
            <div key={idx} className="flex-1 flex flex-col items-center gap-1.5">
              <div className="w-full relative">
                <div
                  className="w-full bg-navy-800 rounded-t-md transition-all"
                  style={{ height: val > 0 ? `${(val / maxTraffic) * 140}px` : '4px' }}
                ></div>
                {val > 0 && (
                  <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-navy-900 text-[10px] font-medium whitespace-nowrap">
                    {val}
                  </span>
                )}
              </div>
              <span className="text-surface-500 text-[10px]">{days[idx]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Top Section & Reminder */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white border border-surface-200 rounded-xl p-5">
          <h3 className="text-navy-900 font-semibold text-sm mb-3">哪個區塊停留最久</h3>
          <div className="space-y-3">
            {sectionDwellData.map((section) => (
              <div key={section.name}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-navy-700 text-xs">{section.name}</span>
                  <span className="text-surface-500 text-xs">{section.time}</span>
                </div>
                <div className="w-full bg-surface-100 rounded-full h-2">
                  <div
                    className="bg-navy-800 h-2 rounded-full transition-all"
                    style={{ width: `${section.pct}%` }}
                  ></div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white border border-surface-200 rounded-xl p-5">
          <h3 className="text-navy-900 font-semibold text-sm mb-3">今日最熱門 AI 提醒</h3>
          <div className="bg-navy-50 border border-navy-100 rounded-lg p-4 mb-4">
            <p className="text-navy-900 text-sm font-medium leading-relaxed">
              「{data.topReminder}」
            </p>
          </div>
          <div className="space-y-2">
            {reminderClicks.slice(0, 3).map((r) => (
              <div key={r.text} className="flex items-center justify-between py-2 border-b border-surface-100 last:border-0">
                <p className="text-navy-700 text-xs truncate max-w-[60%]">「{r.text}」</p>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-surface-500">{r.clicks} 點擊</span>
                  <span className="text-surface-500">{r.shares} 分享</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Top Click Areas */}
      <div className="bg-white border border-surface-200 rounded-xl p-5">
        <h3 className="text-navy-900 font-semibold text-sm mb-4">使用者最常點擊區塊</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { name: '查看今日完整情報', clicks: 523, pct: 42 },
            { name: '加入 LINE 推播', clicks: 387, pct: 31 },
            { name: '10 萬元配置展開', clicks: 198, pct: 16 },
          ].map((area) => (
            <div key={area.name} className="bg-surface-50 rounded-lg p-3">
              <p className="text-navy-700 text-xs font-medium mb-2">{area.name}</p>
              <div className="flex items-baseline gap-1 mb-1">
                <span className="text-navy-900 text-lg font-bold">{area.clicks}</span>
                <span className="text-surface-500 text-xs">次點擊</span>
              </div>
              <div className="w-full bg-surface-200 rounded-full h-1.5">
                <div className="bg-forest-500 h-1.5 rounded-full" style={{ width: `${area.pct}%` }}></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
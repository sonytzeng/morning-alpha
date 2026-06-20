import { useState, useEffect } from 'react';
import { getLatestReports } from '@/services/reportService';
import type { Report } from '@/types/report';

export interface ComparisonResult {
  todayReport: Report | null;
  yesterdayReport: Report | null;
  hasYesterday: boolean;
  confidenceDiff: number;
  moodChange: 'warmer' | 'cooler' | 'same' | 'first';
  moodChangeLabel: string;
  moodChangeText: string;
  todayScore: number;
  yesterdayScore: number;
  aiWorry: string;
}

function getAIWorry(today: Report | null, yesterday: Report | null): string {
  if (!today) return 'AI 正在整理市場情緒中...';
  const tBias = today.market_bias || '震盪';
  const tScore = today.confidence_score ?? 50;

  if (!yesterday) {
    return '今天是第一筆 AI 情緒紀錄，明天開始會看到變化。';
  }

  const yBias = yesterday.market_bias || '震盪';
  const yScore = yesterday.confidence_score ?? 50;
  const diff = tScore - yScore;

  // Big confidence drop
  if (diff <= -15) {
    if (tBias.includes('偏多')) return 'AI 在擔心：把握度突然降溫，太多人可能會在回檔時恐慌亂賣。';
    if (tBias.includes('偏空')) return 'AI 在擔心：情緒持續降温，不要因為跌多了就想抄底。';
    return 'AI 在擔心：市場把握度快速流失，沒方向的人最容易亂操作。';
  }

  // Moderate drop
  if (diff <= -5) {
    if (tBias.includes('偏多')) return 'AI 在擔心：雖然還是偏多，但動能在減弱，有人會開始急了。';
    if (tBias.includes('偏空')) return 'AI 在擔心：情緒沒有改善，不要急著進場撿便宜。';
    return 'AI 在擔心：把握度小幅下降，市場可能進入觀望期。';
  }

  // Big rise
  if (diff >= 15) {
    if (tBias.includes('偏多')) return 'AI 在擔心：情緒快速升溫，今天最容易犯的錯是追高。';
    if (tBias.includes('偏空')) return 'AI 在擔心：雖然還偏空，但有人會誤以為轉折到了。';
    return 'AI 在擔心：把握度快速回升，但不代表方向已經穩定。';
  }

  // Moderate rise
  if (diff >= 5) {
    if (tBias.includes('偏多')) return 'AI 在擔心：情緒慢慢升溫，記得不要越漲越樂觀。';
    if (tBias.includes('偏空')) return 'AI 在擔心：把握度小幅回升，但還不到進場時候。';
    return 'AI 在擔心：把握度微幅回升，市場還在觀望中。';
  }

  // Same-ish
  if (tBias.includes('偏多') && yBias.includes('偏多')) {
    if (tScore >= 75) return 'AI 在擔心：連續兩天把握度都很高，過熱的時候要保持清醒。';
    return 'AI 在擔心：連續兩天把握度普通，不要因為沒變化就放鬆警惕。';
  }
  if (tBias.includes('偏空') && yBias.includes('偏空')) {
    if (tScore <= 40) return 'AI 在擔心：連續兩天情緒都很低，恐慌會讓人亂賣。';
    return 'AI 在擔心：連續兩天偏空，但底還沒到，不要抄底。';
  }
  if ((tBias.includes('震盪') || tBias.includes('中性')) && (yBias.includes('震盪') || yBias.includes('中性'))) {
    return 'AI 在擔心：連續兩天沒有方向，這時候人最容易亂操作。';
  }
  return 'AI 在擔心：市場情緒持平，但沒有方向本身就是一種風險。';
}

export function useReportComparison(): ComparisonResult & { loading: boolean } {
  const [todayReport, setTodayReport] = useState<Report | null>(null);
  const [yesterdayReport, setYesterdayReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const reports = await getLatestReports(2);
        if (reports.length >= 1) setTodayReport(reports[0]);
        if (reports.length >= 2) setYesterdayReport(reports[1]);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const todayScore = todayReport?.confidence_score ?? 50;
  const yesterdayScore = yesterdayReport?.confidence_score ?? 50;
  const confidenceDiff = todayScore - yesterdayScore;

  let moodChange: ComparisonResult['moodChange'] = 'same';
  let moodChangeLabel = '持平';
  let moodChangeText = '跟昨天差不多';

  if (!yesterdayReport) {
    moodChange = 'first';
    moodChangeLabel = '首日';
    moodChangeText = '今天是第一筆 AI 情緒紀錄';
  } else if (confidenceDiff >= 10) {
    moodChange = 'warmer';
    moodChangeLabel = '升溫';
    moodChangeText = `情緒升溫 ${confidenceDiff} 分`;
  } else if (confidenceDiff >= 5) {
    moodChange = 'warmer';
    moodChangeLabel = '微升';
    moodChangeText = `情緒微升 ${confidenceDiff} 分`;
  } else if (confidenceDiff <= -10) {
    moodChange = 'cooler';
    moodChangeLabel = '降溫';
    moodChangeText = `情緒降溫 ${Math.abs(confidenceDiff)} 分`;
  } else if (confidenceDiff <= -5) {
    moodChange = 'cooler';
    moodChangeLabel = '微降';
    moodChangeText = `情緒微降 ${Math.abs(confidenceDiff)} 分`;
  }

  const aiWorry = getAIWorry(todayReport, yesterdayReport);

  return {
    todayReport,
    yesterdayReport,
    hasYesterday: !!yesterdayReport,
    confidenceDiff,
    moodChange,
    moodChangeLabel,
    moodChangeText,
    todayScore,
    yesterdayScore,
    aiWorry,
    loading,
  };
}
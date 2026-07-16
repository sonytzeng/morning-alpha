import { useState, useEffect, useCallback } from 'react';
import { formatTaipeiDate } from '@/utils/tradingDay';

const STORAGE_KEY = 'market_ai_streak_v1';

interface StreakData {
  lastVisitDate: string;
  streakCount: number;
  streakStartDate: string;
}

function getTodayStr(): string {
  return formatTaipeiDate();
}

function getDaysDiff(a: string, b: string): number {
  const da = new Date(a + 'T00:00:00');
  const db = new Date(b + 'T00:00:00');
  return Math.round((db.getTime() - da.getTime()) / (1000 * 60 * 60 * 24));
}

function loadStreakData(): StreakData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StreakData;
      if (parsed.lastVisitDate && typeof parsed.streakCount === 'number') {
        return parsed;
      }
    }
  } catch {
    // ignore
  }
  return {
    lastVisitDate: '',
    streakCount: 0,
    streakStartDate: '',
  };
}

function saveStreakData(data: StreakData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
}

export function useStreak() {
  const [streak, setStreak] = useState(0);
  const [isFirstVisitToday, setIsFirstVisitToday] = useState(false);

  const getStageMessage = useCallback((count: number): string | null => {
    if (count >= 30) return '市場會淘汰情緒化的人，但會留下穩定的人。';
    if (count >= 14) return '真正的投資，不是每天交易，而是每天觀察。';
    if (count >= 7) return '你開始比大部分人更穩定了。';
    if (count >= 3) return '開始養成每天先觀察市場的習慣。';
    return null;
  }, []);

  useEffect(() => {
    const today = getTodayStr();
    const data = loadStreakData();

    if (data.lastVisitDate === today) {
      // Already visited today, just show current streak
      setStreak(data.streakCount);
      setIsFirstVisitToday(false);
      return;
    }

    // First visit today
    setIsFirstVisitToday(true);

    if (!data.lastVisitDate) {
      // First time ever
      const newData: StreakData = {
        lastVisitDate: today,
        streakCount: 1,
        streakStartDate: today,
      };
      saveStreakData(newData);
      setStreak(1);
      return;
    }

    const daysDiff = getDaysDiff(data.lastVisitDate, today);

    if (daysDiff === 1) {
      // Consecutive day
      const newData: StreakData = {
        lastVisitDate: today,
        streakCount: data.streakCount + 1,
        streakStartDate: data.streakStartDate,
      };
      saveStreakData(newData);
      setStreak(newData.streakCount);
    } else if (daysDiff <= 0) {
      // Same day or clock issue, keep as is
      setStreak(data.streakCount);
      setIsFirstVisitToday(false);
    } else {
      // Streak broken (missed at least one day)
      const newData: StreakData = {
        lastVisitDate: today,
        streakCount: 1,
        streakStartDate: today,
      };
      saveStreakData(newData);
      setStreak(1);
    }
  }, []);

  return {
    streak,
    isFirstVisitToday,
    stageMessage: getStageMessage(streak),
  };
}

import { useStreak } from '@/hooks/useStreak';

export default function StreakBadge() {
  const { streak } = useStreak();

  if (streak < 1) return null;

  const getStageData = (count: number) => {
    if (count >= 30) return { label: '穩定者', dot: 'bg-amber-400', border: 'border-amber-500/20 bg-amber-500/8', text: 'text-amber-300' };
    if (count >= 14) return { label: '觀察者', dot: 'bg-forest-400', border: 'border-forest-500/20 bg-forest-500/8', text: 'text-forest-300' };
    if (count >= 7) return { label: '穩定中', dot: 'bg-forest-300', border: 'border-forest-500/15 bg-forest-500/5', text: 'text-forest-300' };
    if (count >= 3) return { label: '起步中', dot: 'bg-surface-400', border: 'border-white/10 bg-white/5', text: 'text-surface-300' };
    return { label: '第一天', dot: 'bg-surface-500', border: 'border-white/5 bg-white/3', text: 'text-surface-400' };
  };

  const d = getStageData(streak);

  const getStreakMessage = (count: number): string => {
    if (count >= 30) return '真正留下來的人，都懂得等待。';
    if (count >= 14) return '市場最難的不是分析，是穩定。';
    if (count >= 7) return '你開始比大部分人更穩定了。';
    if (count >= 3) return '開始養成先觀察再行動的習慣。';
    return '歡迎，這是第一天的市場觀察。';
  };

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border ${d.border}`}>
      <div className={`w-1.5 h-1.5 rounded-full ${d.dot} animate-breathing`}></div>
      <span className={`text-xs font-medium ${d.text}`}>
        你已經連續 {streak} 天，沒有錯過 AI 市場觀察
      </span>
      <span className="text-surface-600 text-[10px] hidden sm:inline">{getStreakMessage(streak)}</span>
    </div>
  );
}
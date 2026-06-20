import type { Report } from '@/types/report';

interface WhyJudgmentProps {
  report: Report | null;
}

function getJudgmentSections(report: Report | null) {
  if (!report) {
    return [
      { label: '情緒面', icon: 'ri-emotion-line', text: 'AI 正在觀察市場整體情緒，等待更多數據確認方向。' },
      { label: '波動面', icon: 'ri-pulse-line', text: '市場波動處於正常區間，沒有極端恐慌或貪婪訊號。' },
      { label: '國際面', icon: 'ri-global-line', text: '全球市場動態尚在整理中，留意盤中突發消息。' },
      { label: '台股影響', icon: 'ri-map-pin-line', text: '台股開盤方向受美股與國際資金流向影響，建議開盤後再確認。' },
    ];
  }

  const sections: { label: string; icon: string; text: string }[] = [];

  // 情緒面
  const fearGreed = report.fear_greed;
  const fearGreedSummary = report.fear_greed_summary;
  if (fearGreedSummary) {
    sections.push({ label: '情緒面', icon: 'ri-emotion-line', text: fearGreedSummary });
  } else if (fearGreed !== null) {
    const level = fearGreed >= 75 ? '貪婪' : fearGreed >= 50 ? '中性偏貪婪' : fearGreed >= 25 ? '中性偏恐懼' : '恐懼';
    sections.push({
      label: '情緒面',
      icon: 'ri-emotion-line',
      text: `市場貪婪指數 ${fearGreed}/100，處於${level}區間。${fearGreed >= 75 ? '過度樂觀時更要保持冷靜。' : fearGreed <= 25 ? '過度恐慌時反而要觀察機會。' : '情緒相對平穩，適合理性判斷。'}`,
    });
  }

  // 波動面
  const vix = report.vix;
  const vixSummary = report.vix_summary;
  if (vixSummary) {
    sections.push({ label: '波動面', icon: 'ri-pulse-line', text: vixSummary });
  } else if (vix !== null) {
    const level = vix >= 25 ? '偏高' : vix >= 18 ? '中等' : '偏低';
    sections.push({
      label: '波動面',
      icon: 'ri-pulse-line',
      text: `VIX 恐慌指數 ${vix}，波動${level}。${vix >= 25 ? '市場可能較不穩定，留意盤中震盪。' : '市場波動平穩，但要留意突發消息。'}`,
    });
  }

  // 國際面
  const globalEvents = report.global_events_json;
  if (globalEvents?.length && globalEvents[0].taiwanImpact) {
    sections.push({
      label: '國際面',
      icon: 'ri-global-line',
      text: globalEvents[0].taiwanImpact,
    });
  } else {
    sections.push({
      label: '國際面',
      icon: 'ri-global-line',
      text: '全球市場與國際消息持續影響台股開盤情緒，建議留意盤中動態。',
    });
  }

  // 台股影響
  const news = report.important_news_json;
  if (news?.length && news[0].impact) {
    sections.push({
      label: '台股影響',
      icon: 'ri-map-pin-line',
      text: news[0].impact,
    });
  } else {
    const taiex = report.taiex_futures_change;
    if (taiex !== null) {
      const dir = taiex > 0 ? '上漲' : taiex < 0 ? '下跌' : '持平';
      sections.push({
        label: '台股影響',
        icon: 'ri-map-pin-line',
        text: `台指期夜盤${dir} ${Math.abs(taiex).toFixed(2)}%，為今日開盤提供參考方向。開盤後請再確認真實走勢。`,
      });
    } else {
      sections.push({
        label: '台股影響',
        icon: 'ri-map-pin-line',
        text: '台股開盤方向受美股與國際資金流向影響，建議開盤後觀察成交量與族群輪動再決定。',
      });
    }
  }

  return sections;
}

export default function WhyJudgment({ report }: WhyJudgmentProps) {
  const sections = getJudgmentSections(report);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-8 h-8 bg-navy-800 rounded-lg flex items-center justify-center">
          <i className="ri-brain-line text-amber-400 text-sm"></i>
        </div>
        <div>
          <h2 className="text-white font-bold text-base md:text-lg">AI 為什麼這樣判斷？</h2>
          <p className="text-white/40 text-[10px] md:text-xs">不是黑箱，是這些訊號讓 AI 得出今天的結論</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {sections.map((section, i) => (
          <div key={i} className="bg-navy-900/60 border border-navy-800 rounded-xl p-4 md:p-5">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 bg-navy-800 rounded-lg flex items-center justify-center">
                <i className={`${section.icon} text-amber-400/70 text-xs`}></i>
              </div>
              <span className="text-white/70 text-xs font-semibold">{section.label}</span>
            </div>
            <p className="text-white/60 text-sm leading-relaxed">{section.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
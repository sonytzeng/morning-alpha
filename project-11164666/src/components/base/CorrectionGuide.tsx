import type { Report } from '@/types/report';

interface CorrectionRule {
  trigger: string;
  action: string;
  why: string;
}

function getCorrectionRules(report: Report | null): CorrectionRule[] {
  const rules: CorrectionRule[] = [
    {
      trigger: '開高走低',
      action: '不要再用早盤情緒追價',
      why: '開高走低是盤前偏多劇本最常見的失效模式，這時候追價風險最大。',
    },
    {
      trigger: '熱區退潮',
      action: '降低對單一族群的期待',
      why: '熱區退潮通常伴隨市場情緒降溫，不要把昨天的強勢套到今天。',
    },
    {
      trigger: '指數跌破昨收',
      action: '先轉成防守觀察',
      why: '跌破昨收代表市場比昨天更弱，這時候不要硬看多。',
    },
    {
      trigger: '量能放大但價格不動',
      action: '小心高檔換手',
      why: '量增價不動代表多空在激烈交戰，不要站在錯誤的那一邊。',
    },
    {
      trigger: '主流沒有延續',
      action: '不要把昨天的強勢套到今天',
      why: '主流沒延續代表盤前劇本失效，這時候繼續硬撐只會越虧越多。',
    },
  ];

  if (!report) return rules;

  // 根據報告內容調整
  const bias = report.market_bias || '震盪';
  const avoid = report.avoid_today || [];

  // 如果 avoid_today 有內容，加到最前面
  if (avoid.length > 0) {
    rules.unshift({
      trigger: 'AI 盤前提醒的情境出現',
      action: avoid[0],
      why: '這是 AI 根據今日市場情緒整理出的高頻錯誤，不是猜測。',
    });
  }

  if (bias.includes('偏空')) {
    rules.unshift({
      trigger: '持續下跌無承接',
      action: '不要急著抄底',
      why: '底是市場走出來的，不是猜出來的。趨勢沒轉之前，你的「跌夠了」可能只是腰斬的開始。',
    });
  }

  return rules.slice(0, 5);
}

export default function CorrectionGuide({ report }: { report: Report | null }) {
  const rules = getCorrectionRules(report);

  return (
    <section className="w-full">
      <div className="mb-4 md:mb-5">
        <div className="flex items-center gap-2 mb-1">
          <p className="text-white/30 text-[10px] uppercase tracking-[0.3em] font-semibold">CORRECTION GUIDE</p>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-500/10 text-amber-400 text-[10px] font-medium rounded-full border border-amber-500/20">
            <i className="ri-compass-line"></i>
            修正指南
          </span>
        </div>
        <h2 className="text-white font-bold text-base md:text-lg">如果今天看錯，要怎麼修正？</h2>
        <p className="text-white/40 text-sm mt-1">
          盤前劇本不是答案。真正重要的是，當市場開始偏離劇本時，你有沒有停下來。
        </p>
      </div>

      <div className="bg-navy-900/80 border border-navy-800 rounded-2xl overflow-hidden">
        {/* 引言 */}
        <div className="px-5 md:px-6 py-4 md:py-5 border-b border-navy-800">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 bg-navy-800 rounded-lg flex items-center justify-center flex-shrink-0">
              <i className="ri-brain-line text-white/40 text-sm"></i>
            </div>
            <div>
              <p className="text-white/80 text-sm font-medium leading-relaxed mb-1">
                盤前劇本不是答案。
              </p>
              <p className="text-white/50 text-sm leading-relaxed">
                真正重要的是，當市場開始偏離劇本時，你有沒有停下來。
              </p>
            </div>
          </div>
        </div>

        {/* 修正規則 */}
        <div className="px-5 md:px-6 py-4 md:py-5">
          <p className="text-white/40 text-[10px] uppercase tracking-wider mb-3">修正規則</p>
          <div className="space-y-3">
            {rules.map((rule, idx) => (
              <div
                key={idx}
                className="flex items-start gap-3 md:gap-4 p-3.5 md:p-4 rounded-xl bg-white/[0.02] border border-white/5 transition-all duration-300 hover:border-white/10"
              >
                <div className="w-8 h-8 bg-amber-500/10 rounded-lg flex items-center justify-center border border-amber-500/20 flex-shrink-0">
                  <span className="text-amber-400 text-xs font-bold">{idx + 1}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-red-400/80 text-xs font-medium">如果：{rule.trigger}</span>
                  </div>
                  <p className="text-white text-sm font-medium mb-1">{rule.action}</p>
                  <p className="text-white/40 text-xs leading-relaxed">{rule.why}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 底部金句 */}
        <div className="px-5 md:px-6 py-3 bg-navy-950/50 border-t border-navy-800">
          <p className="text-white/30 text-xs text-center leading-relaxed">
            市場每天都會給你機會，但你的本金沒有第二次。今天少犯一個錯，比多賺一點更重要。
          </p>
        </div>
      </div>
    </section>
  );
}
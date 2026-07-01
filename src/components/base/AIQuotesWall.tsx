import { useState } from 'react';
import { useShareReport } from '@/hooks/useShareReport';

interface Quote {
  id: string;
  text: string;
  date: string;
  bias: string;
  score: number;
}

const QUOTES: Quote[] = [
  {
    id: 'q1',
    text: '今天不是拼速度，而是看誰比較冷靜。',
    date: '2026-05-25',
    bias: '偏多',
    score: 82,
  },
  {
    id: 'q2',
    text: '市場有機會，但不代表每個機會都適合你。',
    date: '2026-05-24',
    bias: '偏多',
    score: 68,
  },
  {
    id: 'q3',
    text: '真正危險的不是波動，是你失去紀律。',
    date: '2026-05-22',
    bias: '震盪',
    score: 55,
  },
  {
    id: 'q4',
    text: '看懂市場以前，先看懂自己的情緒。',
    date: '2026-05-21',
    bias: '偏空',
    score: 32,
  },
  {
    id: 'q5',
    text: '今天可以觀察，但不需要急著證明自己。',
    date: '2026-05-20',
    bias: '偏多',
    score: 85,
  },
  {
    id: 'q6',
    text: '市場不需要你每天都做決定，有時候等待就是最好的行動。',
    date: '2026-05-19',
    bias: '偏空',
    score: 38,
  },
  {
    id: 'q7',
    text: '冷靜不是不在乎，是知道什麼時候該在乎。',
    date: '2026-05-18',
    bias: '震盪',
    score: 50,
  },
  {
    id: 'q8',
    text: '不要拿別人的節奏來衡量自己的步調。',
    date: '2026-05-17',
    bias: '偏多',
    score: 72,
  },
  {
    id: 'q9',
    text: '保持紀律的人，市場會用長期回報來回答。',
    date: '2026-05-16',
    bias: '偏空',
    score: 35,
  },
  {
    id: 'q10',
    text: '市場永遠有明天，不需要在今天把所有事情做完。',
    date: '2026-05-15',
    bias: '震盪',
    score: 48,
  },
  {
    id: 'q11',
    text: '穩定的觀察，比準確的預測更有價值。',
    date: '2026-05-14',
    bias: '偏多',
    score: 78,
  },
  {
    id: 'q12',
    text: '今天市場給你的訊息，不一定是你想聽的，但可能是你需要的。',
    date: '2026-05-13',
    bias: '震盪',
    score: 52,
  },
];

function getBiasStyle(bias: string) {
  if (bias.includes('偏多')) return { bg: 'bg-[#10251F]', text: 'text-green-400', border: 'border-green-500/15', accent: 'bg-green-500/15' };
  if (bias.includes('偏空')) return { bg: 'bg-[#1F1525]', text: 'text-red-400', border: 'border-red-500/15', accent: 'bg-red-500/15' };
  return { bg: 'bg-[#1F2937]', text: 'text-amber-400', border: 'border-amber-500/15', accent: 'bg-amber-500/15' };
}

export default function AIQuotesWall() {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const { buildShareText } = useShareReport();
  const url = typeof window !== 'undefined' ? window.location.origin : '';

  const handleCopyQuote = async (quote: Quote) => {
    const text = [
      `Morning Alpha`,
      `AI 軍師語錄｜${quote.date}`,
      `「${quote.text}」`,
      `市場情緒：${quote.bias}｜AI 判讀把握度：${quote.score}/100`,
      url,
    ].join('\n');

    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(quote.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopiedId(quote.id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  return (
    <section className="w-full">
      <div className="mb-5">
        <p className="text-white/30 text-[10px] uppercase tracking-widest font-semibold mb-1">Quotes Wall</p>
        <h2 className="text-white font-bold text-xl md:text-2xl">AI 軍師語錄</h2>
        <p className="text-white/40 text-sm mt-1">這些話值得留下來，市場不好的時候回來看。</p>
      </div>

      <div className="relative">
        <div className="overflow-x-auto pb-3 -mx-4 px-4 scrollbar-hide snap-x snap-mandatory">
          <div className="flex gap-3 min-w-max">
            {QUOTES.map((quote) => {
              const style = getBiasStyle(quote.bias);
              return (
                <div
                  key={quote.id}
                  className={`flex-shrink-0 w-[85vw] max-w-[320px] md:w-64 rounded-xl border p-5 ${style.bg} ${style.border} transition-all duration-300 hover:scale-[1.02] snap-center`}
                >
                  {/* Quote icon */}
                  <div className={`w-8 h-8 ${style.accent} rounded-lg flex items-center justify-center mb-3`}>
                    <i className={`ri-double-quotes-l ${style.text} text-sm`}></i>
                  </div>

                  {/* Quote text */}
                  <p className="text-slate-50 text-sm leading-relaxed font-medium mb-4">
                    {quote.text}
                  </p>

                  {/* Meta */}
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-slate-400 text-[10px]">{quote.date}</span>
                    <span className={`text-[10px] font-semibold ${style.text}`}>{quote.bias} · {quote.score}</span>
                  </div>

                  {/* Copy button */}
                  <button
                    onClick={() => handleCopyQuote(quote)}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white text-xs transition-colors border border-white/5"
                  >
                    <i className={`${copiedId === quote.id ? 'ri-check-line text-green-400' : 'ri-file-copy-line'} text-xs`}></i>
                    {copiedId === quote.id ? '已複製' : '複製這句'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Fade edges */}
        <div className="absolute left-0 top-0 bottom-3 w-8 bg-gradient-to-r from-navy-950 to-transparent pointer-events-none"></div>
        <div className="absolute right-0 top-0 bottom-3 w-8 bg-gradient-to-l from-navy-950 to-transparent pointer-events-none"></div>
      </div>

      <p className="text-white/40 text-xs text-center mt-4">
        每句都可以複製分享到 Threads、X 或 LINE
      </p>
    </section>
  );
}

export { QUOTES };
export type { Quote };
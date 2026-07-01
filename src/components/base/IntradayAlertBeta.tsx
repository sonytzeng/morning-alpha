import type { Report } from '@/types/report';

interface Props {
  report: Report | null;
}

function getAlertData(bias: string, score: number) {
  const isBullish = bias.includes('偏多');
  const isBearish = bias.includes('偏空');

  if (isBullish && score >= 75) {
    return {
      status: '市場情緒偏熱',
      statusColor: 'text-amber-400',
      statusBg: 'bg-amber-500/10',
      statusBorder: 'border-amber-500/20',
      worry: '太多人今天可能會追在最高點，開盤後的急拉往往是陷阱。',
      emotion: '貪婪、興奮、怕錯過（FOMO）',
      avoid: '開盤追高、看到漲停失控、把樂觀當依據',
    };
  }

  if (isBullish) {
    return {
      status: '市場有方向，但不強',
      statusColor: 'text-forest-400',
      statusBg: 'bg-forest-500/10',
      statusBorder: 'border-forest-500/20',
      worry: '動能沒有看起來那麼強，有人會過度樂觀，然後追在半空中。',
      emotion: '樂觀但不安、想進場又怕',
      avoid: '一次重押、沒確認趨勢就進場、看到別人賺就慌',
    };
  }

  if (isBearish && score <= 40) {
    return {
      status: '市場壓力較大',
      statusColor: 'text-red-400',
      statusBg: 'bg-red-500/10',
      statusBorder: 'border-red-500/20',
      worry: '恐慌會讓人亂賣，亂賣比亂買更傷。今天最危險的是「覺得跌夠了」。',
      emotion: '恐慌、懷疑、後悔',
      avoid: '恐慌賣出、覺得跌夠了開始抄底、開槓桿攤平',
    };
  }

  if (isBearish) {
    return {
      status: '市場偏弱',
      statusColor: 'text-red-300',
      statusBg: 'bg-red-500/8',
      statusBorder: 'border-red-500/15',
      worry: '有人會想抄底，但底還沒到。耐心比勇氣更重要。',
      emotion: '猶豫、不甘心、想進場撿便宜',
      avoid: '急著抄底、亂開槓桿、把下跌當機會',
    };
  }

  return {
    status: '市場沒有明確方向',
    statusColor: 'text-amber-400',
    statusBg: 'bg-amber-500/10',
    statusBorder: 'border-amber-500/20',
    worry: '沒有方向的時候，人最容易亂操作。今天適合觀察，不適合練習交易。',
    emotion: '茫然、無聊、想找事做',
    avoid: '硬找方向、頻繁進出、把無聊當機會',
  };
}

export default function IntradayAlertBeta({ report }: Props) {
  if (!report) return null;

  const bias = report.market_bias || '震盪';
  const score = report.confidence_score ?? 50;
  const data = getAlertData(bias, score);

  return (
    <section className="w-full">
      <div className="mb-5">
        <div className="flex items-center gap-2">
          <p className="text-surface-500 text-[10px] uppercase tracking-widest font-semibold mb-1">Intraday Monitor</p>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-surface-200 text-surface-600 text-[10px] font-medium rounded-full">
            <i className="ri-flashlight-line"></i>
            Beta
          </span>
        </div>
        <h2 className="text-navy-900 font-bold text-xl md:text-2xl">盤中 AI 情緒警報</h2>
        <p className="text-surface-500 text-sm mt-1">AI 正在監控市場情緒，這是它現在擔心的事</p>
      </div>

      <div className={`rounded-2xl border p-5 md:p-6 ${data.statusBg} ${data.statusBorder}`}>
        <div className="flex items-center gap-3 mb-4">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${data.statusBg}`}>
            <i className={`ri-radar-line ${data.statusColor} text-lg`}></i>
          </div>
          <div>
            <p className={`text-sm font-bold ${data.statusColor}`}>{data.status}</p>
            <p className="text-surface-500 text-xs">AI 盤中監控 · 09:00 - 13:30</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-white/60 rounded-xl p-4 border border-white/50">
            <p className="text-surface-500 text-[10px] uppercase tracking-wider font-semibold mb-2">AI 擔心什麼</p>
            <p className="text-navy-800 text-sm leading-relaxed">{data.worry}</p>
          </div>

          <div className="bg-white/60 rounded-xl p-4 border border-white/50">
            <p className="text-surface-500 text-[10px] uppercase tracking-wider font-semibold mb-2">今天容易出現的情緒</p>
            <p className="text-navy-800 text-sm leading-relaxed">{data.emotion}</p>
          </div>

          <div className="bg-white/60 rounded-xl p-4 border border-white/50">
            <p className="text-surface-500 text-[10px] uppercase tracking-wider font-semibold mb-2">今天最該避免</p>
            <p className="text-navy-800 text-sm leading-relaxed">{data.avoid}</p>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-surface-200/60">
          <p className="text-surface-500 text-xs leading-relaxed">
            <i className="ri-information-line mr-1"></i>
            盤中警報正在開發中，目前基於 AI 市場情緒提供靜態參考。即時情緒追蹤將在未來版本開放。
          </p>
        </div>
      </div>
    </section>
  );
}
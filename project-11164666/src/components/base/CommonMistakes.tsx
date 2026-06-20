import type { Report } from '@/types/report';

interface Mistake {
  title: string;
  icon: string;
  whyDangerous: string;
}

function getMistakes(report: Report | null): Mistake[] {
  const bias = report?.market_bias || '震盪';
  const score = report?.confidence_score ?? 50;
  const isBullish = bias.includes('偏多');
  const isHot = isBullish && score >= 75;

  const hotMarket: Mistake[] = [
    { title: '開盤追第一根紅K', icon: 'ri-fire-line', whyDangerous: '開盤追高的人，通常收盤在哭。先觀察 30 分鐘，趨勢穩了再說。' },
    { title: '看到 AI 漲停後失控追價', icon: 'ri-robot-2-line', whyDangerous: '漲停後追進去，明天開盤可能直接躺在地板。不是每個熱門股都值得追。' },
    { title: '把全部資金壓同一族群', icon: 'ri-stack-line', whyDangerous: 'All in 一個族群，等於賭一個方向。錯一次，你可能會很久不想看股票。' },
    { title: '看到群組帶風向就衝', icon: 'ri-chat-1-line', whyDangerous: '群組裡最熱情的人，通常最早套在高點。用自己的眼睛判斷，不是用別人的嘴。' },
    { title: '賺一點就跑，虧很多才停損', icon: 'ri-emotion-unhappy-line', whyDangerous: '小賺大賠是散戶的宿命。設定好規則，比靠感覺重要。' },
  ];

  const coldMarket: Mistake[] = [
    { title: '覺得「跌夠了」開始抄底', icon: 'ri-arrow-down-line', whyDangerous: '你覺得跌夠了，市場可能覺得才剛開始。趨勢沒轉多之前，不要猜底。' },
    { title: '看到別人賣就跟著恐慌賣', icon: 'ri-emotion-normal-line', whyDangerous: '恐慌賣出的人，通常賣在最低點。問自己：「我為什麼要賣？」' },
    { title: '開槓桿想快速攤平', icon: 'ri-bank-card-line', whyDangerous: '下跌時開槓桿，等於跳進正在漏水的船。這不是勇氣，是賭博。' },
    { title: '把今天的下跌當成「機會」', icon: 'ri-lightbulb-line', whyDangerous: '每一個跌都是機會，等於沒有一個跌是機會。等待趨勢明朗，比搶反彈安全。' },
    { title: '忽略現金的重要性', icon: 'ri-money-cny-circle-line', whyDangerous: '現金不是廢物，是你的彈藥。沒有現金，趨勢轉多時你只能看別人賺。' },
  ];

  const neutralMarket: Mistake[] = [
    { title: '市場沒方向，自己硬要找方向', icon: 'ri-compass-line', whyDangerous: '市場沒方向時，你硬要做方向，就是在賭。不操作也是一種操作。' },
    { title: '今天買明天賣，頻繁進出', icon: 'ri-exchange-line', whyDangerous: '手續費和情緒成本會吃掉你。新手最大的敵人不是市場，是自己的手癢。' },
    { title: '研究一整天，最後憑感覺下單', icon: 'ri-brain-line', whyDangerous: '做了功課卻不照做，等於沒做。寫下理由再下單，比較不會後悔。' },
    { title: '今天漲就後悔昨天沒買', icon: 'ri-time-line', whyDangerous: '活在後悔裡的人，會一直追高。市場每天都有機會，但你的錢不是每天都有。' },
    { title: '把模擬配置的數字當聖旨', icon: 'ri-file-list-3-line', whyDangerous: 'AI 的模擬是參考，不是聖旨。最後下決定的人是你，請為自己的錢負責。' },
  ];

  if (isHot) return hotMarket;
  if (bias.includes('偏空')) return coldMarket;
  return neutralMarket;
}

export default function CommonMistakes({ report }: { report: Report | null }) {
  const mistakes = getMistakes(report);

  return (
    <section className="w-full">
      <div className="mb-5">
        <p className="text-surface-500 text-[10px] uppercase tracking-widest font-semibold mb-1">Guard Rails</p>
        <h2 className="text-navy-900 font-bold text-xl md:text-2xl">今天最容易犯的錯</h2>
        <p className="text-surface-500 text-sm mt-1">AI 軍師說：「這些錯看起來很蠢，但每天都有人在犯。」</p>
      </div>

      <div className="bg-navy-900 rounded-2xl overflow-hidden">
        <div className="p-5 md:p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 bg-red-500/15 rounded-lg flex items-center justify-center">
              <i className="ri-alarm-warning-line text-red-400 text-sm"></i>
            </div>
            <p className="text-surface-300 text-sm font-medium">
              今天市場{report?.market_bias?.includes('偏多') ? '很熱' : report?.market_bias?.includes('偏空') ? '很冷' : '沒有明確方向'}，
              但越{report?.market_bias?.includes('偏多') ? '熱' : '慌'}越容易受傷
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {mistakes.map((m, idx) => (
              <div key={idx} className="flex items-start gap-3 p-3 bg-navy-800/60 rounded-xl border border-navy-700/50">
                <div className="w-8 h-8 bg-navy-700 rounded-lg flex items-center justify-center flex-shrink-0">
                  <i className={`${m.icon} text-amber-400 text-sm`}></i>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-medium text-sm mb-1">{m.title}</p>
                  <p className="text-surface-400 text-xs leading-relaxed">{m.whyDangerous}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
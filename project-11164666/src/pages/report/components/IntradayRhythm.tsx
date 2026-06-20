interface IntradayRhythmProps {
  marketBias?: string | null;
}

function getRhythmSteps(bias: string): {
  time: string;
  title: string;
  content: string;
  icon: string;
}[] {
  const isBull = bias.includes('偏多');
  const isBear = bias.includes('偏空');
  const isSwingBull = bias.includes('震盪偏多');
  const isSwingBear = bias.includes('震盪偏空');

  if (isBull) {
    return [
      {
        time: '09:00',
        title: '開盤前後',
        content: '先看市場是否開高過熱。今天偏多不代表每個位置都適合進場，開太高反而要更冷靜。',
        icon: 'ri-sun-line',
      },
      {
        time: '10:30',
        title: '早盤確認',
        content: '觀察強勢族群是否續航，不要只看一根紅 K。資金留下來才是真強。',
        icon: 'ri-bar-chart-line',
      },
      {
        time: '12:00',
        title: '午盤冷靜',
        content: '如果市場震盪，這是檢驗你紀律的時候。不要因為短線波動就改變原本計畫。',
        icon: 'ri-cup-line',
      },
      {
        time: '13:20',
        title: '尾盤前',
        content: '觀察資金是否真的留下來。尾盤方向比早盤情緒更重要，不要急著在尾盤衝。',
        icon: 'ri-moon-line',
      },
    ];
  }

  if (isBear) {
    return [
      {
        time: '09:00',
        title: '開盤前後',
        content: '開盤若殺低，先確認是恐慌還是真轉弱。恐慌時不做決定，觀察最重要。',
        icon: 'ri-sun-line',
      },
      {
        time: '10:30',
        title: '早盤確認',
        content: '弱勢族群是否繼續破底？如果開始止穩，可能是短線承接訊號，但不要搶。',
        icon: 'ri-bar-chart-line',
      },
      {
        time: '12:00',
        title: '午盤冷靜',
        content: '市場偏弱時最容易恐慌殺低。問自己：現在賣的理由是什麼？如果說不出來，先不要賣。',
        icon: 'ri-cup-line',
      },
      {
        time: '13:20',
        title: '尾盤前',
        content: '尾盤如果繼續走弱，代表資金真的在跑。不要接飛刀，明天還有機會。',
        icon: 'ri-moon-line',
      },
    ];
  }

  if (isSwingBull) {
    return [
      {
        time: '09:00',
        title: '開盤前後',
        content: '市場方向模糊偏多，開盤先看熱門族群有沒有帶動，沒有就不要勉強。',
        icon: 'ri-sun-line',
      },
      {
        time: '10:30',
        title: '早盤確認',
        content: '震盪偏多時，最忌諱的就是追高。等拉回才是你的機會，不是追漲。',
        icon: 'ri-bar-chart-line',
      },
      {
        time: '12:00',
        title: '午盤冷靜',
        content: '午盤是考驗耐心的時候。沒有訊號就不操作，這是震盪市最好的策略。',
        icon: 'ri-cup-line',
      },
      {
        time: '13:20',
        title: '尾盤前',
        content: '尾盤如果偏弱，明天可能還有更低點。不要因為怕錯過就急著進場。',
        icon: 'ri-moon-line',
      },
    ];
  }

  if (isSwingBear) {
    return [
      {
        time: '09:00',
        title: '開盤前後',
        content: '震盪偏空，開盤若有反彈不要馬上樂觀。反彈可能是給你減碼的機會。',
        icon: 'ri-sun-line',
      },
      {
        time: '10:30',
        title: '早盤確認',
        content: '弱勢中若有反彈，觀察量夠不夠。量不夠的反彈通常只是曇花一現。',
        icon: 'ri-bar-chart-line',
      },
      {
        time: '12:00',
        title: '午盤冷靜',
        content: '震盪偏空最容易犯的錯是抄底。底是走出來的，不是看出來的。繼續觀察。',
        icon: 'ri-cup-line',
      },
      {
        time: '13:20',
        title: '尾盤前',
        content: '尾盤若沒有明顯轉強，今天就先不要勉強。保守一點，明天還有機會。',
        icon: 'ri-moon-line',
      },
    ];
  }

  // 中性 / 震盪
  return [
    {
      time: '09:00',
      title: '開盤前後',
      content: '市場沒有明確方向，開盤先看有沒有族群帶頭。沒有的話就先觀察，不急著站邊。',
      icon: 'ri-sun-line',
    },
    {
      time: '10:30',
      title: '早盤確認',
      content: '震盪市最忌諱的就是硬找方向。今天可能是盤整日，沒有訊號也是一種訊號。',
      icon: 'ri-bar-chart-line',
    },
    {
      time: '12:00',
      title: '午盤冷靜',
      content: '午盤是考驗耐心的時候。無聊的時候不要因為想操作而硬做，手續費也是成本。',
      icon: 'ri-cup-line',
    },
    {
      time: '13:20',
      title: '尾盤前',
      content: '尾盤如果還是沒有方向，今天就當作觀察日。明天會有新的訊號出現。',
      icon: 'ri-moon-line',
    },
  ];
}

export default function IntradayRhythm({ marketBias }: IntradayRhythmProps) {
  const steps = getRhythmSteps(marketBias || '震盪');

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-8 h-8 bg-navy-800 rounded-lg flex items-center justify-center">
          <i className="ri-time-line text-amber-400 text-sm"></i>
        </div>
        <div>
          <h2 className="text-white font-bold text-base md:text-lg">AI 今日盤中節奏</h2>
          <p className="text-white/40 text-[10px] md:text-xs">四個時間點的提醒，幫你守住紀律</p>
        </div>
      </div>

      <div className="relative">
        {/* Timeline line */}
        <div className="absolute left-[19px] top-4 bottom-4 w-px bg-white/5 hidden md:block"></div>

        <div className="space-y-3 md:space-y-4">
          {steps.map((step, i) => (
            <div key={i} className="flex gap-3 md:gap-4">
              {/* Time + dot */}
              <div className="flex flex-col items-center flex-shrink-0">
                <div className="w-10 h-10 bg-navy-800 border border-navy-700 rounded-full flex items-center justify-center z-[1]">
                  <i className={`${step.icon} text-amber-400/70 text-sm`}></i>
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0 bg-navy-900/60 border border-navy-800 rounded-xl p-3.5 md:p-4">
                <div className="flex items-baseline gap-2 mb-1 flex-wrap">
                  <span className="text-amber-400/70 text-xs font-mono font-semibold">{step.time}</span>
                  <span className="text-white/80 text-sm font-semibold">{step.title}</span>
                </div>
                <p className="text-white/60 text-xs md:text-sm leading-relaxed">{step.content}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
import { Link } from 'react-router-dom';

interface Props {
  variant?: 'mid' | 'bottom';
}

export default function ProCTACard({ variant = 'bottom' }: Props) {
  const isMid = variant === 'mid';

  return (
    <section className={`${isMid ? 'bg-navy-900' : 'bg-navy-950'} border border-navy-800 rounded-2xl p-6 md:p-8 text-center`}>
      <div className="max-w-xl mx-auto">
        <div className={`w-12 h-12 ${isMid ? 'bg-forest-500/15' : 'bg-forest-500/20'} rounded-xl flex items-center justify-center mx-auto mb-4`}>
          <i className="ri-sun-line text-forest-400 text-xl"></i>
        </div>
        <h3 className="text-white font-bold text-lg md:text-xl mb-2">
          每天早上，有人先幫你看完市場
        </h3>
        <p className="text-surface-400 text-sm mb-6 leading-relaxed">
          不是給你更多資訊，而是幫你消化市場情緒。<br className="hidden md:block" />
          AI 每天 07:30 自動提醒，30 秒看懂今天氣氛。
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            to="/war-room"
            className="inline-flex items-center gap-2 px-6 py-3 bg-white/10 hover:bg-white/15 text-white font-medium text-sm rounded-xl transition-colors whitespace-nowrap border border-white/10"
          >
            先看今天市場
            <i className="ri-arrow-right-line"></i>
          </Link>
        </div>
        <p className="text-surface-600 text-xs mt-4">
          免費封測中，全部功能開放
        </p>
      </div>
    </section>
  );
}
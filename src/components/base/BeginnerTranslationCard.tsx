interface Props {
  text: string;
}

export default function BeginnerTranslationCard({ text }: Props) {
  if (!text || !text.trim()) return null;

  return (
    <div className="bg-[#E8F4FD] border border-[#B8DDF7] rounded-2xl p-6 md:p-8">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm">
          <i className="ri-translate-2 text-sky-600 text-xl"></i>
        </div>
        <div className="flex-1">
          <h2 className="text-navy-900 font-bold text-base md:text-lg mb-3">給股市新手看的今日市場翻譯</h2>
          <p className="text-navy-800 text-sm md:text-base leading-relaxed font-medium">
            {text}
          </p>
        </div>
      </div>
    </div>
  );
}
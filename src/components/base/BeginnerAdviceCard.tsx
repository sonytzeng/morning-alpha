interface BeginnerAdviceProps {
  data: {
    dos: string[];
    donts: string[];
    watchList: string[];
  };
}

export default function BeginnerAdviceCard({ data }: BeginnerAdviceProps) {
  const hasDos = data.dos.length > 0 && data.dos.some((d) => d.trim());
  const hasDonts = data.donts.length > 0 && data.donts.some((d) => d.trim());

  if (!hasDos && !hasDonts) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* 今天可以觀察 */}
      {hasDos && (
        <div className="bg-forest-50 border border-forest-200 rounded-2xl p-5 md:p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 bg-forest-500 rounded-lg flex items-center justify-center">
              <i className="ri-check-line text-white text-sm"></i>
            </div>
            <h3 className="text-forest-800 font-semibold text-sm">今天可以觀察</h3>
          </div>
          <div className="space-y-3">
            {data.dos.map((item, idx) => (
              <div key={`do-${idx}`} className="flex items-start gap-3">
                <div className="w-5 h-5 bg-forest-500 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                  <i className="ri-check-line text-white text-[10px]"></i>
                </div>
                <p className="text-navy-800 text-sm leading-relaxed">{item}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 今天先不要做 */}
      {hasDonts && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-5 md:p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 bg-red-500 rounded-lg flex items-center justify-center">
              <i className="ri-forbid-line text-white text-sm"></i>
            </div>
            <h3 className="text-red-800 font-semibold text-sm">今天先不要做</h3>
          </div>
          <div className="space-y-3">
            {data.donts.map((item, idx) => (
              <div key={`dont-${idx}`} className="flex items-start gap-3">
                <div className="w-5 h-5 bg-red-500 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                  <i className="ri-close-line text-white text-[10px]"></i>
                </div>
                <p className="text-navy-800 text-sm leading-relaxed">{item}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
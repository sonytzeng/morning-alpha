interface GlobalEventCardProps {
  data: {
    id: string;
    title: string;
    category: string;
    description: string;
  };
  index: number;
}

export default function GlobalEventCard({ data, index }: GlobalEventCardProps) {
  return (
    <div className="flex gap-3 bg-surface-50 border border-surface-200 rounded-xl p-4">
      <div className="w-8 h-8 bg-navy-800 text-white text-sm font-bold rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
        {index + 1}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-navy-900 font-semibold text-sm">{data.title}</span>
          <span className="px-2 py-0.5 bg-surface-200 text-surface-600 text-xs rounded-md whitespace-nowrap">
            {data.category}
          </span>
        </div>
        <p className="text-surface-500 text-xs leading-relaxed">{data.description}</p>
      </div>
    </div>
  );
}
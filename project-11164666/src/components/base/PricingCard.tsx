import type { PricingPlan } from '@/mocks/pricingData';

interface PricingCardProps {
  data: PricingPlan;
}

export default function PricingCard({ data }: PricingCardProps) {
  return (
    <div className={`relative bg-white border rounded-2xl p-6 md:p-8 flex flex-col ${
      data.isPopular
        ? 'border-forest-500'
        : data.isPremium
          ? 'border-navy-700'
          : 'border-surface-200'
    }`}>
      {data.isPopular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-forest-500 text-white text-xs font-semibold rounded-full">
          最受歡迎
        </div>
      )}
      {data.isPremium && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-navy-800 text-white text-xs font-semibold rounded-full">
          專業級
        </div>
      )}

      <div className="mb-5">
        <h3 className="text-navy-900 font-bold text-xl mb-1">{data.name}</h3>
        <p className="text-surface-500 text-sm">{data.description}</p>
      </div>

      <div className="mb-6">
        <span className="text-navy-900 font-bold text-3xl">{data.price}</span>
        <span className="text-surface-400 text-sm ml-1">{data.period}</span>
      </div>

      <ul className="space-y-3 mb-8 flex-1">
        {data.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2.5">
            <i className="ri-check-line text-forest-500 text-sm mt-0.5 flex-shrink-0"></i>
            <span className="text-surface-600 text-sm">{feature}</span>
          </li>
        ))}
      </ul>

      <button
        className={`w-full py-3 rounded-xl font-semibold text-sm transition-colors whitespace-nowrap ${
          data.isPopular
            ? 'bg-forest-600 hover:bg-forest-500 text-white'
            : data.isPremium
              ? 'bg-navy-800 hover:bg-navy-700 text-white'
              : 'bg-surface-100 hover:bg-surface-200 text-navy-900'
        }`}
      >
        {data.buttonText}
      </button>
    </div>
  );
}
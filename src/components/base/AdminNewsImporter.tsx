import type { AdminNewsSource } from '@/mocks/adminData';

interface AdminNewsImporterProps {
  sources: AdminNewsSource[];
}

export default function AdminNewsImporter({ sources }: AdminNewsImporterProps) {
  return (
    <div className="bg-white border border-surface-200 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-surface-100 flex items-center justify-between">
        <h3 className="text-navy-900 font-semibold text-sm">新聞 API 來源管理</h3>
        <button className="px-3 py-1.5 bg-navy-800 hover:bg-navy-700 text-white text-xs font-medium rounded-lg transition-colors whitespace-nowrap">
          手動匯入
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px]">
          <thead>
            <tr className="bg-surface-50">
              <th className="px-4 py-3 text-left text-surface-500 text-xs font-medium">來源</th>
              <th className="px-4 py-3 text-left text-surface-500 text-xs font-medium">狀態</th>
              <th className="px-4 py-3 text-left text-surface-500 text-xs font-medium">API Key</th>
              <th className="px-4 py-3 text-left text-surface-500 text-xs font-medium">今日匯入</th>
              <th className="px-4 py-3 text-left text-surface-500 text-xs font-medium">最後更新</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((source) => (
              <tr key={source.id} className="border-t border-surface-100">
                <td className="px-4 py-3 text-navy-900 text-sm font-medium">{source.name}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                    source.status === 'active'
                      ? 'bg-forest-50 text-forest-600'
                      : source.status === 'error'
                        ? 'bg-red-50 text-red-600'
                        : 'bg-yellow-50 text-yellow-600'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      source.status === 'active' ? 'bg-forest-500' : source.status === 'error' ? 'bg-red-500' : 'bg-yellow-500'
                    }`}></span>
                    {source.status === 'active' ? '運作中' : source.status === 'error' ? '錯誤' : '暫停'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-medium ${
                    source.apiKeyStatus === 'valid' ? 'text-forest-600' : 'text-red-600'
                  }`}>
                    {source.apiKeyStatus === 'valid' ? '有效' : '已過期'}
                  </span>
                </td>
                <td className="px-4 py-3 text-navy-900 text-sm">{source.articlesToday} 則</td>
                <td className="px-4 py-3 text-surface-500 text-xs">{source.lastImportAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
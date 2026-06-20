import type { AdminReportStatus } from '@/mocks/adminData';

interface AdminReportGeneratorProps {
  reports: AdminReportStatus[];
}

export default function AdminReportGenerator({ reports }: AdminReportGeneratorProps) {
  return (
    <div className="bg-white border border-surface-200 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-surface-100 flex items-center justify-between">
        <h3 className="text-navy-900 font-semibold text-sm">報告生成狀態</h3>
        <button className="px-3 py-1.5 bg-forest-600 hover:bg-forest-500 text-white text-xs font-medium rounded-lg transition-colors whitespace-nowrap">
          <i className="ri-refresh-line mr-1"></i>重新生成
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px]">
          <thead>
            <tr className="bg-surface-50">
              <th className="px-4 py-3 text-left text-surface-500 text-xs font-medium">日期</th>
              <th className="px-4 py-3 text-left text-surface-500 text-xs font-medium">狀態</th>
              <th className="px-4 py-3 text-left text-surface-500 text-xs font-medium">完成度</th>
              <th className="px-4 py-3 text-left text-surface-500 text-xs font-medium">AI 把握度</th>
              <th className="px-4 py-3 text-left text-surface-500 text-xs font-medium">生成時間</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((report) => (
              <tr key={report.id} className="border-t border-surface-100">
                <td className="px-4 py-3 text-navy-900 text-sm font-medium">{report.date}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                    report.status === 'generated'
                      ? 'bg-forest-50 text-forest-600'
                      : report.status === 'generating'
                        ? 'bg-blue-50 text-blue-600'
                        : 'bg-yellow-50 text-yellow-600'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      report.status === 'generated' ? 'bg-forest-500' : report.status === 'generating' ? 'bg-blue-500' : 'bg-yellow-500'
                    }`}></span>
                    {report.status === 'generated' ? '已完成' : report.status === 'generating' ? '生成中' : '等待中'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-20 h-1.5 bg-surface-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-navy-600 rounded-full"
                        style={{ width: `${(report.sectionsCompleted / report.totalSections) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs text-surface-500">{report.sectionsCompleted}/{report.totalSections}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-sm font-semibold ${
                    (report.aiConfidence || 0) >= 70 ? 'text-forest-600' : (report.aiConfidence || 0) >= 50 ? 'text-yellow-600' : 'text-red-600'
                  }`}>
                    {report.aiConfidence || '-'}
                  </span>
                </td>
                <td className="px-4 py-3 text-surface-500 text-xs">{report.generatedAt || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
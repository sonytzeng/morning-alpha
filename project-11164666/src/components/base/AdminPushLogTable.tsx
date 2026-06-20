import type { AdminPushLog } from '@/mocks/adminData';

interface AdminPushLogTableProps {
  logs: AdminPushLog[];
}

export default function AdminPushLogTable({ logs }: AdminPushLogTableProps) {
  return (
    <div className="bg-white border border-surface-200 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-surface-100 flex items-center justify-between">
        <h3 className="text-navy-900 font-semibold text-sm">推播紀錄</h3>
        <button className="px-3 py-1.5 bg-forest-600 hover:bg-forest-500 text-white text-xs font-medium rounded-lg transition-colors whitespace-nowrap">
          <i className="ri-send-plane-line mr-1"></i>發送推播
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px]">
          <thead>
            <tr className="bg-surface-50">
              <th className="px-4 py-3 text-left text-surface-500 text-xs font-medium">類型</th>
              <th className="px-4 py-3 text-left text-surface-500 text-xs font-medium">狀態</th>
              <th className="px-4 py-3 text-left text-surface-500 text-xs font-medium">發送時間</th>
              <th className="px-4 py-3 text-left text-surface-500 text-xs font-medium">成功 / 總計</th>
              <th className="px-4 py-3 text-left text-surface-500 text-xs font-medium">內容預覽</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id} className="border-t border-surface-100">
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                    log.type === 'line' ? 'bg-green-50 text-green-600' : 'bg-blue-50 text-blue-600'
                  }`}>
                    <i className={log.type === 'line' ? 'ri-chat-3-line' : 'ri-mail-line'}></i>
                    {log.type === 'line' ? 'LINE' : 'Email'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                    log.status === 'success' ? 'bg-forest-50 text-forest-600' : 'bg-red-50 text-red-600'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${log.status === 'success' ? 'bg-forest-500' : 'bg-red-500'}`}></span>
                    {log.status === 'success' ? '成功' : '失敗'}
                  </span>
                </td>
                <td className="px-4 py-3 text-surface-600 text-xs">{log.sentAt}</td>
                <td className="px-4 py-3">
                  <span className="text-navy-900 text-sm font-medium">{log.successCount}</span>
                  <span className="text-surface-400 text-xs"> / {log.recipientCount}</span>
                </td>
                <td className="px-4 py-3 text-surface-500 text-xs max-w-[200px] truncate">{log.messagePreview}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
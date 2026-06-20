import { Link, Outlet, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';

const NAV_ITEMS = [
  { path: '/admin/today-content', label: '今日內容', icon: 'ri-file-text-line' },
  { path: '/admin/publish', label: '發布素材', icon: 'ri-film-line' },
  { path: '/admin/system-status', label: '系統狀態', icon: 'ri-shield-check-line' },
  { path: '/admin/data-health', label: '資料健康檢查', icon: 'ri-search-eye-line' },
];

function getPageLabel(pathname: string): string {
  const item = NAV_ITEMS.find((n) => pathname === n.path || (n.path !== '/admin/dashboard' && pathname.startsWith(n.path)));
  return item?.label || '後台';
}

export default function AdminLayout() {
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close drawer on route change
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  const pageLabel = getPageLabel(location.pathname);

  const sidebarContent = (
    <>
      {/* Logo area */}
      <div className="px-5 py-4 border-b border-background-200">
        <Link to="/" className="flex items-center gap-2">
          <span className="text-foreground-900 font-bold text-sm tracking-tight">Morning Alpha</span>
          <span className="text-foreground-400 text-[10px] font-medium bg-background-100 px-1.5 py-0.5 rounded">後台</span>
        </Link>
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const isActive = location.pathname === item.path ||
            (item.path !== '/admin/dashboard' && location.pathname.startsWith(item.path));
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                isActive
                  ? 'bg-primary-500 text-white'
                  : 'text-foreground-600 hover:bg-background-100 hover:text-foreground-900'
              }`}
            >
              <i className={`${item.icon} text-base`}></i>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-background-200">
        <Link
          to="/"
          className="flex items-center gap-1.5 text-foreground-400 hover:text-foreground-600 text-xs transition-colors"
        >
          <i className="ri-arrow-left-line"></i>
          返回前台
        </Link>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-background-50 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-56 flex-shrink-0 bg-white border-r border-background-200 flex-col min-h-screen sticky top-0">
        {sidebarContent}
      </aside>

      {/* Mobile Top Bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 bg-white border-b border-background-200 flex items-center justify-between px-4 h-14">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-foreground-900 font-bold text-sm whitespace-nowrap">Morning Alpha</span>
          <span className="text-foreground-400 text-[10px] font-medium bg-background-100 px-1.5 py-0.5 rounded whitespace-nowrap">後台</span>
          <span className="text-foreground-300 mx-1 hidden sm:inline">|</span>
          <span className="text-foreground-500 text-sm truncate hidden sm:inline">{pageLabel}</span>
        </div>
        <button
          onClick={() => setDrawerOpen(true)}
          className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-background-100 text-foreground-600 transition-colors cursor-pointer"
          aria-label="開啟選單"
        >
          <i className="ri-menu-line text-xl"></i>
        </button>
      </div>

      {/* Mobile Drawer */}
      {drawerOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-[#07111f]/40"
            onClick={() => setDrawerOpen(false)}
          ></div>
          {/* Drawer panel */}
          <div className="absolute left-0 top-0 bottom-0 w-64 bg-white shadow-xl flex flex-col" style={{ animation: 'slideIn 0.2s ease-out' }}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-background-200">
              <span className="text-foreground-900 font-bold text-sm">後台選單</span>
              <button
                onClick={() => setDrawerOpen(false)}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-background-100 text-foreground-400 hover:text-foreground-600 transition-colors cursor-pointer"
              >
                <i className="ri-close-line text-lg"></i>
              </button>
            </div>
            {sidebarContent}
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 min-w-0 overflow-x-hidden pt-14 md:pt-0">
        <div className="px-4 md:px-6 py-4 md:py-6">
          <Outlet />
        </div>
      </main>

      <style>{`
        @keyframes slideIn {
          from { transform: translateX(-100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
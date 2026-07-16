import { Component, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  fallbackMessage?: string;
  showHomeButton?: boolean;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error.message || '未知錯誤' };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-navy-950 flex flex-col">
          <div className="flex-1 flex items-center justify-center px-4">
            <div className="text-center max-w-md">
              <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-4">
                <i className="ri-error-warning-line text-red-400 text-2xl"></i>
              </div>
              <h2 className="text-white font-bold text-lg mb-2">
                {this.props.fallbackTitle || '頁面暫時無法載入'}
              </h2>
              <p className="text-white/50 text-sm mb-2 leading-relaxed">
                {this.props.fallbackMessage || '今日判斷暫時無法載入，請稍後再試。'}
              </p>
              <div className="mt-5 flex flex-col sm:flex-row items-stretch sm:items-center gap-3 justify-center">
                <button
                  onClick={() => {
                    this.setState({ hasError: false, errorMessage: '' });
                    window.location.reload();
                  }}
                  className="px-5 py-2.5 bg-forest-600 hover:bg-forest-500 text-white font-medium text-sm rounded-xl transition-colors whitespace-nowrap cursor-pointer"
                >
                  重新載入
                </button>
                {this.props.showHomeButton !== false && (
                  <Link
                    to="/"
                    className="px-5 py-2.5 bg-white/10 hover:bg-white/15 text-white text-sm rounded-xl transition-colors whitespace-nowrap border border-white/10 inline-block text-center"
                  >
                    返回首頁
                  </Link>
                )}
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

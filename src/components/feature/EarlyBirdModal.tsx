import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { submitEarlyAccess, updateEarlyAccessSupplement, trackEngagementEvent } from '@/services/engagementService';

interface EarlyBirdModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const INTEREST_OPTIONS = [
  { value: 'daily_summary', label: '每日 07:30 盤前摘要' },
  { value: 'member_notebook', label: '會員完整研究筆記' },
  { value: 'reels_line_highlight', label: 'LINE / Reels 重點提醒' },
] as const;

const SUPPLEMENT_OPTIONS = [
  { value: 'taiwan_stocks', label: '我主要看台股' },
  { value: 'us_stocks', label: '我主要看美股' },
  { value: 'semiconductor_ai', label: '我想看半導體 / AI' },
  { value: 'intraday_tracking', label: '我想看盤中追蹤' },
  { value: 'close_review', label: '我想看收盤驗證' },
] as const;

export default function EarlyBirdModal({ isOpen, onClose }: EarlyBirdModalProps) {
  const navigate = useNavigate();

  // Form fields
  const [email, setEmail] = useState('');
  const [lineName, setLineName] = useState('');
  const [interests, setInterests] = useState<string[]>([]);

  // Submit state
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Post-submit supplement
  const [signupId, setSignupId] = useState<string | null>(null);
  const [supplementPrefs, setSupplementPrefs] = useState<string[]>([]);
  const [supplementSubmitting, setSupplementSubmitting] = useState(false);
  const [supplementDone, setSupplementDone] = useState(false);
  const [supplementError, setSupplementError] = useState<string | null>(null);

  // Track modal open event
  useEffect(() => {
    if (isOpen) {
      trackEngagementEvent('click_early_access');
    }
  }, [isOpen]);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setEmail('');
      setLineName('');
      setInterests([]);
      setSubmitted(false);
      setError(null);
      setSignupId(null);
      setSupplementPrefs([]);
      setSupplementSubmitting(false);
      setSupplementDone(false);
      setSupplementError(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const toggleInterest = (val: string) => {
    setInterests((prev) => (prev.includes(val) ? prev.filter((x) => x !== val) : [...prev, val]));
  };

  const toggleSupplement = (val: string) => {
    setSupplementPrefs((prev) => (prev.includes(val) ? prev.filter((x) => x !== val) : [...prev, val]));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.trim()) {
      setError('請填寫 Email。');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      setError('請填寫正確的 Email 格式。');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const result = await submitEarlyAccess({
        email: email.trim(),
        line_name: lineName.trim() || undefined,
        interests: interests.length > 0 ? interests : undefined,
        source_page: typeof window !== 'undefined' ? window.location.pathname : undefined,
      });

      if (result.success) {
        setSignupId(result.id || null);
        setSubmitted(true);
        trackEngagementEvent('submit_early_access');
      } else {
        setError(result.error || '送出失敗，請稍後再試。');
      }
    } catch {
      setError('送出失敗，請稍後再試。');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSupplementSubmit = async () => {
    if (supplementPrefs.length === 0 || !signupId) return;

    setSupplementSubmitting(true);
    setSupplementError(null);

    try {
      // Merge supplement with existing interests for the update
      const merged = [...new Set([...interests, ...supplementPrefs])];
      const result = await updateEarlyAccessSupplement(signupId, merged);

      if (result.success) {
        setSupplementDone(true);
      } else {
        setSupplementError(result.error || '偏好儲存失敗，但不影響早鳥登記。');
      }
    } catch {
      setSupplementError('偏好儲存失敗，但不影響早鳥登記。');
    } finally {
      setSupplementSubmitting(false);
    }
  };

  const handleBackToHome = () => {
    onClose();
    navigate('/');
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-navy-950/80 backdrop-blur-sm" onClick={onClose}></div>

      <div className="relative w-full max-w-sm bg-navy-900 border border-navy-700 rounded-2xl p-5 md:p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors cursor-pointer"
        >
          <i className="ri-close-line text-white/50"></i>
        </button>

        {submitted ? (
          /* ── Success State ── */
          <div className="text-center py-4">
            <div className="w-12 h-12 rounded-2xl bg-forest-500/10 border border-forest-500/20 flex items-center justify-center mx-auto mb-3">
              <i className="ri-check-line text-forest-400 text-xl"></i>
            </div>
            <h3 className="text-white font-bold text-lg mb-2">已加入早鳥名單</h3>
            <p className="text-white/50 text-sm leading-relaxed max-w-xs mx-auto mb-5">
              Morning Alpha 穩定開放後，會優先通知你。
            </p>

            <button
              onClick={handleBackToHome}
              className="px-5 py-2.5 bg-forest-600 hover:bg-forest-500 text-white text-sm font-semibold rounded-xl transition-colors cursor-pointer whitespace-nowrap"
            >
              回到首頁
            </button>

            {/* ── Optional Supplement Section ── */}
            <div className="mt-6 pt-5 border-t border-navy-700">
              {supplementDone ? (
                <div className="flex items-center justify-center gap-2 text-forest-400/70 text-xs">
                  <i className="ri-check-line"></i>
                  <span>偏好已記錄，謝謝！</span>
                </div>
              ) : (
                <>
                  <p className="text-white/35 text-xs font-medium mb-3">
                    想讓 Morning Alpha 更貼近你的需求？
                  </p>
                  <div className="space-y-1.5">
                    {SUPPLEMENT_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => toggleSupplement(opt.value)}
                        className={`w-full px-3 py-2 rounded-lg text-xs font-medium border transition-colors cursor-pointer text-left whitespace-nowrap flex items-center gap-2 ${
                          supplementPrefs.includes(opt.value)
                            ? 'bg-forest-500/10 text-forest-400 border-forest-500/30'
                            : 'bg-navy-800 text-white/40 border-navy-700 hover:border-navy-600 hover:text-white/55'
                        }`}
                      >
                        <span className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center text-[10px] transition-colors ${
                          supplementPrefs.includes(opt.value)
                            ? 'bg-forest-500/20 border-forest-500/40 text-forest-400'
                            : 'border-navy-600 text-transparent'
                        }`}>
                          {supplementPrefs.includes(opt.value) && <i className="ri-check-line"></i>}
                        </span>
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  {supplementError && (
                    <p className="text-amber-400/70 text-[10px] mt-2">{supplementError}</p>
                  )}

                  {supplementPrefs.length > 0 && (
                    <button
                      onClick={handleSupplementSubmit}
                      disabled={supplementSubmitting}
                      className="mt-3 px-4 py-2 bg-white/8 hover:bg-white/12 disabled:bg-white/5 text-white/60 hover:text-white/80 text-xs rounded-lg transition-colors cursor-pointer whitespace-nowrap border border-white/10"
                    >
                      {supplementSubmitting ? '儲存中...' : '送出偏好'}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        ) : (
          /* ── Form State ── */
          <>
            <div className="mb-5">
              <div className="w-9 h-9 rounded-xl bg-forest-500/10 border border-forest-500/20 flex items-center justify-center mb-3">
                <i className="ri-notification-3-line text-forest-400"></i>
              </div>
              <h3 className="text-white font-bold text-lg mb-2">
                加入 Morning Alpha 早鳥名單
              </h3>
              <p className="text-white/45 text-xs leading-relaxed">
                目前為公開測試階段。正式會員開放前，會優先通知早鳥名單。會員版預計包含完整盤前研究筆記、盤中追蹤與收盤驗證，不只是多看新聞，而是每天建立一套盤前判斷節奏。
              </p>
            </div>

            <form data-readdy-form onSubmit={handleSubmit} className="space-y-3.5">
              {/* Email — required */}
              <div>
                <label className="block text-white/40 text-[11px] font-medium mb-1.5">
                  Email <span className="text-red-400">*</span>
                </label>
                <input
                  type="email"
                  name="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  required
                  className="w-full px-3 py-2.5 bg-navy-800 border border-navy-700 rounded-xl text-white text-sm placeholder-white/20 focus:outline-none focus:border-forest-500/50 transition-colors"
                />
                <p className="text-white/20 text-[10px] mt-1">只用於早鳥通知與重要更新，不會寄垃圾信。</p>
              </div>

              {/* LINE name — optional */}
              <div>
                <label className="block text-white/40 text-[11px] font-medium mb-1.5">
                  LINE 顯示名稱 <span className="text-white/25 text-[10px]">（選填）</span>
                </label>
                <input
                  type="text"
                  name="line_name"
                  value={lineName}
                  onChange={(e) => setLineName(e.target.value)}
                  placeholder="你的 LINE 顯示名稱"
                  className="w-full px-3 py-2.5 bg-navy-800 border border-navy-700 rounded-xl text-white text-sm placeholder-white/20 focus:outline-none focus:border-forest-500/50 transition-colors"
                />
                <p className="text-white/20 text-[10px] mt-1">選填，未來若開放 LINE 提醒時方便通知。</p>
              </div>

              {/* Interests — optional, max 3 */}
              <div>
                <label className="block text-white/40 text-[11px] font-medium mb-2">
                  想收到什麼內容？ <span className="text-white/25 text-[10px]">（選填，可複選）</span>
                </label>
                <div className="space-y-1.5">
                  {INTEREST_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => toggleInterest(opt.value)}
                      className={`w-full px-3 py-2.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer text-left whitespace-nowrap flex items-center gap-2 ${
                        interests.includes(opt.value)
                          ? 'bg-forest-500/10 text-forest-400 border-forest-500/30'
                          : 'bg-navy-800 text-white/40 border-navy-700 hover:border-navy-600 hover:text-white/55'
                      }`}
                    >
                      <span className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center text-[10px] transition-colors ${
                        interests.includes(opt.value)
                          ? 'bg-forest-500/20 border-forest-500/40 text-forest-400'
                          : 'border-navy-600 text-transparent'
                      }`}>
                        {interests.includes(opt.value) && <i className="ri-check-line"></i>}
                      </span>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Error */}
              {error && (
                <p className="text-red-400 text-xs flex items-center gap-1.5 bg-red-400/5 border border-red-400/10 rounded-lg px-3 py-2">
                  <i className="ri-error-warning-line flex-shrink-0"></i>
                  {error}
                </p>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={submitting}
                className="w-full px-5 py-3 bg-forest-600 hover:bg-forest-500 disabled:bg-forest-600/50 text-white font-semibold text-sm rounded-xl transition-colors cursor-pointer whitespace-nowrap flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    送出中...
                  </>
                ) : (
                  '加入早鳥名單'
                )}
              </button>

              <p className="text-white/20 text-[10px] text-center leading-relaxed">
                目前不收費，正式開放前會先通知，不會強迫付費。
              </p>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
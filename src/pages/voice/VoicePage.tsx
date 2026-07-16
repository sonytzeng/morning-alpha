import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Navbar from '@/components/feature/Navbar';
import Footer from '@/components/feature/Footer';
import {
  getActiveReport,
  getSelectedMarketNews,
  getLatestMarketData,
  getTodayVoiceReport,
  buildVoiceScript1Min,
  buildVoiceScript3Min,
  generateVoiceScript,
} from '@/services/voiceScriptEngine';
import type { VoiceScript, VoiceReportRow } from '@/services/voiceScriptEngine';

export default function VoicePage() {
  const [voiceReport, setVoiceReport] = useState<VoiceReportRow | null>(null);
  const [generatedScript, setGeneratedScript] = useState<VoiceScript | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'1min' | '3min'>('1min');
  const [sourceMode, setSourceMode] = useState<'db' | 'generated'>('generated');

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError(null);

        // Step 1: Check if voice_reports has today's data
        const existing = await getTodayVoiceReport();
        if (existing) {
          setVoiceReport(existing);
          setSourceMode('db');
          setLoading(false);
          return;
        }

        // Step 2: Fall back — generate from reports + market_data + market_news
        const [report, marketData, marketNews] = await Promise.all([
          getActiveReport(),
          getLatestMarketData(),
          getSelectedMarketNews(),
        ]);

        const generatedAt = new Date().toISOString();

        const script = generateVoiceScript({
          report,
          marketData,
          marketNews,
          generatedAt,
        });

        setGeneratedScript(script);
        setSourceMode('generated');
      } catch {
        setError('語音內容暫時無法取得，請稍後重新載入。');
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  // Derive display data from either DB or generated
  const displayScript = useMemo(() => {
    if (sourceMode === 'db' && voiceReport) {
      return activeTab === '1min' ? (voiceReport.script_1min || '') : (voiceReport.script_3min || '');
    }
    if (sourceMode === 'generated' && generatedScript) {
      return activeTab === '1min' ? generatedScript.oneMinute : generatedScript.threeMinute;
    }
    return '';
  }, [sourceMode, voiceReport, generatedScript, activeTab]);

  const reportDate = voiceReport?.report_date || generatedScript?.reportDate || '';
  const generatedAt = voiceReport?.generated_at || generatedScript?.generatedAt || '';
  const dataSourceCounts = generatedScript?.dataSourceCounts || { marketDataCount: 0, marketNewsCount: 0 };

  const lineCount = displayScript.split('\n').length;
  const charCount = displayScript.length;
  const estimatedSeconds = activeTab === '1min' ? 60 : 180;
  const wordCount = displayScript.replace(/\s/g, '').length;
  const readingPace = Math.round(wordCount / Math.max(estimatedSeconds, 1));

  // ── Admin gate ──
  const isAdmin = (() => {
    try { return localStorage.getItem('ma_tools') === '1'; } catch { return false; }
  })();
  const navigate = useNavigate();
  const [accessCountdown, setAccessCountdown] = useState(3);

  useEffect(() => {
    if (!isAdmin && accessCountdown > 0) {
      const timer = setTimeout(() => setAccessCountdown((prev) => prev - 1), 1000);
      return () => clearTimeout(timer);
    }
    if (!isAdmin && accessCountdown === 0) {
      navigate('/', { replace: true });
    }
  }, [isAdmin, accessCountdown, navigate]);

  // ── Internal tools toggle (localStorage gated) ──
  const [internalMode, setInternalMode] = useState(() => {
    try { return localStorage.getItem('ma_tools') === '1'; } catch { return false; }
  });
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [toggleClicks, setToggleClicks] = useState(0);

  const toggleInternalMode = useCallback(() => {
    setInternalMode((prev) => {
      const next = !prev;
      try { localStorage.setItem('ma_tools', next ? '1' : '0'); } catch { /* noop */ }
      return next;
    });
  }, []);

  // Hidden toggle: triple-click the "Podcast 風格腳本" subtitle text
  const handleSubtitleClick = useCallback(() => {
    setToggleClicks((prev) => {
      const next = prev + 1;
      if (next >= 3) {
        toggleInternalMode();
        return 0;
      }
      setTimeout(() => setToggleClicks(0), 1500);
      return next;
    });
  }, [toggleInternalMode]);

  const handleCopy = useCallback(async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus(`已複製${label}`);
      setTimeout(() => setCopyStatus(null), 2000);
    } catch {
      setCopyStatus('複製失敗，請手動選取');
      setTimeout(() => setCopyStatus(null), 2500);
    }
  }, []);

  const reels = (sourceMode === 'generated' && generatedScript?.reels) ? generatedScript.reels : null;

  // ==========================================
  // ADMIN GATE — block all non-admin access
  // ==========================================
  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-navy-950 flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="text-center max-w-md">
            <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-5">
              <i className="ri-shield-keyhole-line text-amber-400 text-2xl" />
            </div>
            <h2 className="text-white font-semibold text-lg mb-2">內部工具頁面</h2>
            <p className="text-white/35 text-sm mb-1">此頁面為 Morning Alpha 站方內部營運工具，不對外公開。</p>
            <p className="text-white/20 text-xs mb-6">僅限管理員與內部人員使用。</p>
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-xl">
              <span className="text-white/30 text-xs">{accessCountdown} 秒後自動返回首頁</span>
            </div>
            <div className="mt-4">
              <Link
                to="/"
                className="inline-flex items-center gap-2 text-white/40 hover:text-white/60 text-xs transition-colors whitespace-nowrap"
              >
                <i className="ri-arrow-left-line" />
                立即返回首頁
              </Link>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // --- LOADING ---
  if (loading) {
    return (
      <div className="min-h-screen bg-navy-950 flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-white/10 border-t-amber-400/60 rounded-full animate-spin mx-auto mb-3" />
            <span className="text-white/40 text-sm">正在載入語音腳本...</span>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // --- ERROR / NO DATA ---
  if (error || (!voiceReport && !generatedScript)) {
    return (
      <div className="min-h-screen bg-navy-950 flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="text-center max-w-md">
            <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center mx-auto mb-4">
              <i className="ri-mic-line text-white/20 text-xl" />
            </div>
            <h2 className="text-white font-semibold text-base mb-2">語音腳本尚未就緒</h2>
            <p className="text-white/40 text-sm mb-4">
              {error || '盤前報告尚未生成。Morning Alpha 每天 07:30 自動產生報告與語音腳本。'}
            </p>
            <Link
              to="/"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-white/8 hover:bg-white/12 text-white text-sm rounded-xl transition-colors whitespace-nowrap border border-white/10"
            >
              <i className="ri-arrow-left-line" />
              返回首頁
            </Link>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-navy-950 flex flex-col overflow-x-hidden">
      <Navbar />

      <main className="flex-1 overflow-x-hidden">
        {/* ===== HEADER ===== */}
        <div className="border-b border-navy-800 bg-navy-900/80 backdrop-blur-sm">
          <div className="max-w-5xl mx-auto px-4 md:px-6 py-5">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                    <i className="ri-mic-line text-amber-400 text-base" />
                  </div>
                  <h1 className="text-white font-bold text-lg md:text-xl whitespace-nowrap">
                    每日盤前語音簡報
                  </h1>
                </div>
                <p className="text-white/30 text-xs pl-10 cursor-default select-none" onClick={handleSubtitleClick} title="點擊三次切換內部工具">
                  Podcast 風格腳本 · 財經主持人語調 · 模擬真人播報
                </p>
              </div>
              <div className="flex items-center gap-2 self-start sm:self-end">
                <button
                  onClick={toggleInternalMode}
                  className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
                    internalMode
                      ? 'bg-amber-500/15 text-amber-400 border border-amber-500/20'
                      : 'text-white/15 hover:text-white/40 hover:bg-white/5'
                  }`}
                  title={internalMode ? '關閉內部工具' : '開啟內部工具'}
                >
                  <i className={`${internalMode ? 'ri-settings-3-fill' : 'ri-settings-3-line'} text-sm`} />
                </button>
                <Link
                  to="/"
                  className="inline-flex items-center gap-1.5 text-white/40 hover:text-white/60 text-xs transition-colors whitespace-nowrap"
                >
                  <i className="ri-arrow-left-line" />
                  首頁
                </Link>
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-5xl mx-auto px-4 md:px-6 py-6 md:py-8 space-y-5 md:space-y-6">

          {/* ===== REPORT META ===== */}
          <div className="bg-navy-900/60 border border-navy-800/80 rounded-2xl p-5 md:p-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-6">
              {/* Report Date */}
              <div>
                <p className="text-white/25 text-[10px] uppercase tracking-wider mb-1">報告日期</p>
                <p className="text-white font-semibold text-sm">{reportDate || '—'}</p>
              </div>

              {/* Bias */}
              <div>
                <p className="text-white/25 text-[10px] uppercase tracking-wider mb-1">盤前訊號</p>
                <div className="flex items-center gap-2">
                  {(sourceMode === 'generated' && generatedScript) ? (
                    <>
                      <div className={`w-2 h-2 rounded-full ${
                        generatedScript.oneMinute.includes('偏多') && !generatedScript.oneMinute.includes('偏空')
                          ? 'bg-emerald-400'
                          : generatedScript.oneMinute.includes('偏空')
                          ? 'bg-red-400'
                          : 'bg-amber-400'
                      }`} />
                      <span className="text-white text-sm font-medium">
                        {generatedScript.oneMinute.includes('偏多') && !generatedScript.oneMinute.includes('偏空')
                          ? '偏多'
                          : generatedScript.oneMinute.includes('偏空')
                          ? '偏空'
                          : '中性'}
                      </span>
                    </>
                  ) : (
                    <span className="text-white/50 text-sm">由報告產生</span>
                  )}
                </div>
              </div>

              {/* Confidence */}
              <div>
                <p className="text-white/25 text-[10px] uppercase tracking-wider mb-1">判讀把握度</p>
                <p className="text-white font-semibold text-sm">
                  {sourceMode === 'generated' && generatedScript
                    ? `${generatedScript.oneMinute.match(/判讀把握度.*?(\d+)/)?.[1] || '—'}/100`
                    : '由報告產生'}
                </p>
              </div>

              {/* Generated At */}
              <div>
                <p className="text-white/25 text-[10px] uppercase tracking-wider mb-1">產生時間</p>
                <p className="text-white/60 text-xs">{generatedAt ? new Date(generatedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) : '—'}</p>
              </div>

              {/* Data Sources */}
              <div>
                <p className="text-white/25 text-[10px] uppercase tracking-wider mb-1">資料來源</p>
                <p className="text-white/60 text-xs">
                  使用 {dataSourceCounts.marketDataCount} 筆市場數據 · {dataSourceCounts.marketNewsCount} 筆精選新聞
                </p>
              </div>

              {/* Source Mode */}
              <div className="flex items-end">
                <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-medium border ${
                  sourceMode === 'db'
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                }`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${sourceMode === 'db' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                  {sourceMode === 'db' ? '已儲存腳本' : '即時生成'}
                </span>
              </div>
            </div>
          </div>

          {/* ===== TAB SWITCHER ===== */}
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-1 bg-navy-900/80 border border-navy-800 rounded-full p-1">
              <button
                onClick={() => setActiveTab('1min')}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap ${
                  activeTab === '1min'
                    ? 'bg-amber-500/15 text-amber-400 border border-amber-500/20'
                    : 'text-white/35 hover:text-white/60'
                }`}
              >
                <i className="ri-timer-line" />
                1 分鐘速報
              </button>
              <button
                onClick={() => setActiveTab('3min')}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap ${
                  activeTab === '3min'
                    ? 'bg-amber-500/15 text-amber-400 border border-amber-500/20'
                    : 'text-white/35 hover:text-white/60'
                }`}
              >
                <i className="ri-headphone-line" />
                3 分鐘完整版
              </button>
            </div>

            {/* Stats */}
            <div className="hidden sm:flex items-center gap-3 ml-auto text-white/25 text-[10px]">
              <span>{lineCount} 行</span>
              <span className="text-white/10">|</span>
              <span>{charCount} 字</span>
              <span className="text-white/10">|</span>
              <span>約 {estimatedSeconds} 秒 · {readingPace} 字/分</span>
            </div>
          </div>

          {/* ===== SCRIPT CARD ===== */}
          <div className="bg-navy-900/60 border border-navy-800/80 rounded-2xl overflow-hidden">
            {/* Card header */}
            <div className="border-b border-navy-800 px-5 md:px-6 py-3.5 flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full ${sourceMode === 'db' ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
              <span className="text-white/50 text-xs font-medium uppercase tracking-wider">
                {activeTab === '1min' ? '1 分鐘盤前語音稿' : '3 分鐘盤前語音稿'}
              </span>
              <span className="text-white/15 text-[10px] ml-auto hidden sm:inline">
                {activeTab === '1min' ? '適合 LINE 推播 · 快速掃描' : '適合 Podcast · 通勤收聽'}
              </span>
            </div>

            {/* Script body */}
            <div className="p-5 md:p-6">
              <div className="bg-navy-950/80 border border-navy-800/60 rounded-xl p-5 md:p-6 max-h-[550px] md:max-h-[650px] overflow-y-auto">
                <pre className="text-white/70 text-sm md:text-base leading-7 whitespace-pre-wrap font-sans tracking-wide">
                  {displayScript}
                </pre>
              </div>
            </div>

            {/* Card footer */}
            <div className="border-t border-navy-800 px-5 md:px-6 py-3 flex items-center justify-between flex-wrap gap-2">
              <span className="text-white/20 text-[10px]">
                腳本由 Morning Alpha 語音引擎生成 · 非真人錄製
              </span>
              <div className="flex items-center gap-1.5 text-white/20 text-[10px]">
                <i className="ri-information-line" />
                <span>不構成買賣建議</span>
              </div>
            </div>
          </div>

          {/* ===== INTERNAL TOOLS — only visible when internalMode is enabled ===== */}
          {internalMode && reels && (
            <>
              {/* Internal mode indicator */}
              <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border border-amber-500/20 rounded-full w-fit">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                <span className="text-amber-400 text-[10px] font-medium uppercase tracking-wider">內部工具模式</span>
              </div>

              <div className="bg-navy-900/60 border border-amber-500/10 rounded-2xl overflow-hidden">
                <div className="border-b border-navy-800 px-5 md:px-6 py-3.5 flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-amber-400" />
                  <span className="text-amber-400/80 text-xs font-medium uppercase tracking-wider">
                    Reels 輸出素材（內部用）
                  </span>
                </div>

                <div className="p-5 md:p-6 space-y-5">
                  {/* ── 1. 封面標題 ── */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-white/40 text-[10px] uppercase tracking-wider">封面標題（3 版）</span>
                    </div>
                    <div className="bg-navy-950/80 border border-navy-800/60 rounded-lg p-3 space-y-1">
                      {reels.coverTitles.map((t, i) => (
                        <p key={i} className="text-white/60 text-xs">{i + 1}. {t}</p>
                      ))}
                    </div>
                  </div>

                  {/* ── 2. 60 秒旁白 + 複製 ── */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-white/40 text-[10px] uppercase tracking-wider">60 秒旁白</span>
                      <button
                        onClick={() => handleCopy(reels.narration, '旁白')}
                        className="flex items-center gap-1 px-2.5 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-md text-white/50 hover:text-white/70 text-[10px] transition-colors whitespace-nowrap cursor-pointer"
                      >
                        <i className="ri-file-copy-line text-xs" />
                        複製旁白
                      </button>
                    </div>
                    <div className="bg-navy-950/80 border border-navy-800/60 rounded-lg p-3 max-h-48 overflow-y-auto">
                      <pre className="text-white/50 text-[11px] leading-relaxed whitespace-pre-wrap font-sans">{reels.narration}</pre>
                    </div>
                  </div>

                  {/* ── 3. 字幕切段 + 複製 ── */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-white/40 text-[10px] uppercase tracking-wider">字幕切段</span>
                      <button
                        onClick={() => {
                          const text = reels.subtitleSegments.map((s) => `[${String(s.startSec).padStart(2, '0')}:${String(s.endSec).padStart(2, '0')}] ${s.text}`).join('\n');
                          handleCopy(text, '字幕切段');
                        }}
                        className="flex items-center gap-1 px-2.5 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-md text-white/50 hover:text-white/70 text-[10px] transition-colors whitespace-nowrap cursor-pointer"
                      >
                        <i className="ri-file-copy-line text-xs" />
                        複製字幕
                      </button>
                    </div>
                    <div className="bg-navy-950/80 border border-navy-800/60 rounded-lg p-3 max-h-48 overflow-y-auto">
                      {reels.subtitleSegments.map((s, i) => (
                        <div key={i} className="flex gap-2 text-[11px] leading-relaxed py-0.5">
                          <span className="text-white/20 font-mono flex-shrink-0">{String(s.startSec).padStart(2, '0')}:{String(s.endSec).padStart(2, '0')}</span>
                          <span className="text-white/50">{s.text}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* ── 4. Caption + 複製 ── */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-white/40 text-[10px] uppercase tracking-wider">貼文 Caption</span>
                      <button
                        onClick={() => handleCopy(reels.caption, 'Caption')}
                        className="flex items-center gap-1 px-2.5 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-md text-white/50 hover:text-white/70 text-[10px] transition-colors whitespace-nowrap cursor-pointer"
                      >
                        <i className="ri-file-copy-line text-xs" />
                        複製 Caption
                      </button>
                    </div>
                    <div className="bg-navy-950/80 border border-navy-800/60 rounded-lg p-3">
                      <p className="text-white/50 text-[11px] leading-relaxed">{reels.caption}</p>
                    </div>
                  </div>

                  {/* ── 5. Hashtags + 複製 ── */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-white/40 text-[10px] uppercase tracking-wider">Hashtags</span>
                      <button
                        onClick={() => handleCopy(reels.hashtags, 'Hashtags')}
                        className="flex items-center gap-1 px-2.5 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-md text-white/50 hover:text-white/70 text-[10px] transition-colors whitespace-nowrap cursor-pointer"
                      >
                        <i className="ri-file-copy-line text-xs" />
                        複製 Hashtags
                      </button>
                    </div>
                    <div className="bg-navy-950/80 border border-navy-800/60 rounded-lg p-3">
                      <p className="text-white/50 text-[11px]">{reels.hashtags}</p>
                    </div>
                  </div>

                  {/* ── 6. SRT 字幕 + 複製 ── */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-white/40 text-[10px] uppercase tracking-wider">SRT 字幕</span>
                      <button
                        onClick={() => handleCopy(reels.srt, 'SRT')}
                        className="flex items-center gap-1 px-2.5 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-md text-white/50 hover:text-white/70 text-[10px] transition-colors whitespace-nowrap cursor-pointer"
                      >
                        <i className="ri-file-copy-line text-xs" />
                        複製 SRT
                      </button>
                    </div>
                    <div className="bg-navy-950/80 border border-navy-800/60 rounded-lg p-3 max-h-56 overflow-y-auto">
                      <pre className="text-white/50 text-[10px] leading-relaxed font-mono whitespace-pre">{reels.srt}</pre>
                    </div>
                  </div>

                  {/* ── 7. 畫面分鏡（參考用） ── */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-white/40 text-[10px] uppercase tracking-wider">畫面分鏡（參考）</span>
                    </div>
                    <div className="bg-navy-950/80 border border-navy-800/60 rounded-lg overflow-hidden">
                      {reels.storyboard.map((seg, i) => (
                        <div key={i} className={`px-3 py-2.5 flex items-start gap-3 ${i < reels.storyboard.length - 1 ? 'border-b border-navy-800/60' : ''}`}>
                          <span className="text-white/20 font-mono text-[10px] flex-shrink-0 w-12">{seg.timeStart}s–{seg.timeEnd}s</span>
                          <div className="flex-1 min-w-0">
                            <span className="text-amber-400/70 text-[10px] font-medium block mb-0.5">{seg.subText}</span>
                            <p className="text-white/45 text-[10px] leading-relaxed truncate">{seg.mainText}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ===== DESCRIPTIONS ===== */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-navy-900/60 border border-navy-800/80 rounded-xl p-4 md:p-5">
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                  <i className="ri-timer-line text-emerald-400 text-sm" />
                </div>
                <div>
                  <h3 className="text-white text-sm font-semibold">1 分鐘速報</h3>
                  <p className="text-white/30 text-[10px]">盤前快速掃描</p>
                </div>
              </div>
              <p className="text-white/40 text-xs leading-relaxed">
                五段結構：一句話鉤子 → 盤前判讀 → 全球市場訊號 → 台股影響與風險 → 今日觀察重點。
                適合 LINE 推播 · 開盤前快速掃描，60 秒掌握盤前核心。
              </p>
            </div>
            <div className="bg-navy-900/60 border border-navy-800/80 rounded-xl p-4 md:p-5">
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                  <i className="ri-headphone-line text-amber-400 text-sm" />
                </div>
                <div>
                  <h3 className="text-white text-sm font-semibold">3 分鐘完整版</h3>
                  <p className="text-white/30 text-[10px]">Full Podcast</p>
                </div>
              </div>
              <p className="text-white/40 text-xs leading-relaxed">
                七段完整結構：開場 → 全球市場背景 → 美股/費半/台積電 ADR → 今日台股判讀 → 受惠與風險方向
                → 09:15 / 10:30 觀察重點 → 收尾提醒。適合通勤收聽。
              </p>
            </div>
          </div>

          {/* ===== AUDIO COMING SOON ===== */}
          <div className="bg-navy-900/60 border border-amber-500/10 rounded-xl p-4 md:p-5">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <i className="ri-volume-up-line text-amber-400 text-base" />
              </div>
              <div>
                <h3 className="text-white/60 font-medium text-sm mb-1">音訊生成：下一版本開放</h3>
                <p className="text-white/35 text-xs leading-relaxed">
                  目前顯示的是文字語音稿。下一版本將整合 TTS 文字轉語音技術，自動生成可收聽的每日盤前 Podcast。
                  敬請期待。
                </p>
              </div>
            </div>
          </div>

          {/* ===== DISCLAIMER ===== */}
          <div className="bg-navy-950 border border-navy-800/60 rounded-xl p-4 md:p-5">
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center flex-shrink-0 mt-0.5">
                <i className="ri-information-line text-white/25 text-xs" />
              </div>
              <div className="flex-1">
                <p className="text-white/25 text-xs leading-relaxed">
                  本語音腳本為市場資訊整理與情境判讀，不構成任何買賣建議或投資邀約。
                  所有內容僅供參考，市場有風險，決策請自行判斷。
                </p>
                <button
                  onClick={toggleInternalMode}
                  className={`mt-2 text-[9px] transition-colors cursor-pointer whitespace-nowrap ${
                    internalMode
                      ? 'text-amber-400/60 hover:text-amber-400'
                      : 'text-white/15 hover:text-white/35'
                  }`}
                >
                  {internalMode ? '關閉內部工具' : '內部工具'}
                </button>
              </div>
            </div>
          </div>

        </div>

        {/* ── Copy status toast ── */}
        {copyStatus && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-navy-800/95 border border-navy-700/80 rounded-full shadow-lg backdrop-blur-sm">
            <span className="text-white/70 text-xs flex items-center gap-1.5">
              <i className="ri-check-line text-emerald-400 text-xs" />
              {copyStatus}
            </span>
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}

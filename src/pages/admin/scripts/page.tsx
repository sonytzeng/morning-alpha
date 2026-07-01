import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { fetchBestReport, normalizeMorningAlphaReport, type MorningAlphaNormalizedReport } from '@/lib/morningAlphaReportAdapter';
import { isTaipeiWeekendToday, formatTaipeiDate } from '@/utils/tradingDay';

export default function AdminPublish() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ma, setMa] = useState<MorningAlphaNormalizedReport | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const raw = await fetchBestReport();
      setMa(normalizeMorningAlphaReport(raw));
    } catch (err) {
      setError(err instanceof Error ? err.message : '讀取失敗');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function copyToClipboard(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied('複製失敗');
      setTimeout(() => setCopied(null), 2000);
    }
  }

  const displayDate = formatTaipeiDate();
  const isWeekend = isTaipeiWeekendToday();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl space-y-5">
        <div>
          <h1 className="text-foreground-900 font-bold text-lg">發布素材</h1>
          <p className="text-foreground-500 text-sm mt-0.5">{displayDate}{isWeekend ? '（非交易日）' : ''}</p>
        </div>
        <div className="bg-white border border-red-200 rounded-xl p-6 text-center">
          <i className="ri-error-warning-line text-red-400 text-xl mb-2 block"></i>
          <p className="text-red-600 text-sm font-medium">讀取失敗</p>
          <p className="text-foreground-500 text-xs mb-3">{error}</p>
          <button onClick={load} className="px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white text-sm rounded-lg whitespace-nowrap">重新載入</button>
        </div>
      </div>
    );
  }

  if (!ma) return null;

  const hasReels = ma.hasReelsScript;
  const hasSocial = ma.hasSocialPost;
  const hasLine = ma.hasLineCopy;

  return (
    <div className="max-w-4xl space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-foreground-900 font-bold text-lg">發布素材</h1>
          <p className="text-foreground-500 text-sm mt-0.5">
            {displayDate}{isWeekend ? '（非交易日）' : ''}｜複製即可發布
          </p>
        </div>
        {copied && (
          <span className="px-3 py-1.5 bg-emerald-500/8 text-emerald-600 text-xs rounded-lg border border-emerald-500/20 whitespace-nowrap">
            <i className="ri-check-line mr-1"></i>{copied}
          </span>
        )}
      </div>

      {/* ── 1. Reels 60s Script ── */}
      <div className="bg-white border border-background-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-foreground-900 font-semibold text-sm">Reels 60 秒腳本</h3>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border whitespace-nowrap ${
                hasReels ? 'bg-emerald-500/5 text-emerald-600 border-emerald-500/15' : 'bg-background-50 text-foreground-400 border-background-200'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${hasReels ? 'bg-emerald-500' : 'bg-foreground-300'}`}></span>
                {hasReels ? '可用' : '尚未產生'}
              </span>
            </div>
            <p className="text-foreground-400 text-[10px] mt-0.5">開場 0–5 秒 → 核心 5–25 秒 → 風險 25–40 秒 → 觀察 40–55 秒 → 收尾 55–60 秒</p>
          </div>
          {hasReels && ma.reelsScript && (
            <button onClick={() => copyToClipboard(buildReelsFullScript(ma), '已複製 Reels 腳本')} className="px-3 py-1.5 bg-foreground-900 hover:bg-foreground-800 text-white text-xs rounded-lg transition-colors whitespace-nowrap cursor-pointer">
              <i className="ri-file-copy-line mr-1"></i>複製完整腳本
            </button>
          )}
        </div>
        {hasReels && ma.reelsScript ? (
          <div className="space-y-2">
            <ScriptRow label="開場鉤子" time="0–5 秒" value={ma.reelsScript.hook_0_5_sec as string} icon="ri-flashlight-line" copyFn={copyToClipboard} />
            <ScriptRow label="核心內容" time="5–25 秒" value={ma.reelsScript.core_5_25_sec as string} icon="ri-focus-3-line" copyFn={copyToClipboard} />
            <ScriptRow label="風險提醒" time="25–40 秒" value={ma.reelsScript.risk_25_40_sec as string} icon="ri-alert-line" tone="warn" copyFn={copyToClipboard} />
            <ScriptRow label="觀察重點" time="40–55 秒" value={ma.reelsScript.watch_40_55_sec as string} icon="ri-eye-line" copyFn={copyToClipboard} />
            <ScriptRow label="收尾 CTA" time="55–60 秒" value={ma.reelsScript.cta_55_60_sec as string} icon="ri-thumb-up-line" tone="accent" copyFn={copyToClipboard} />
          </div>
        ) : (
          <p className="text-foreground-400 text-xs py-4 text-center">Reels 腳本尚未產生，請確認今日報告已生成完整 ai_strategy_json。</p>
        )}
      </div>

      {/* ── 2. Social Post ── */}
      <div className="bg-white border border-background-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-foreground-900 font-semibold text-sm">社群貼文</h3>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border whitespace-nowrap ${
                hasSocial ? 'bg-emerald-500/5 text-emerald-600 border-emerald-500/15' : 'bg-background-50 text-foreground-400 border-background-200'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${hasSocial ? 'bg-emerald-500' : 'bg-foreground-300'}`}></span>
                {hasSocial ? '可用' : '尚未產生'}
              </span>
            </div>
            <p className="text-foreground-400 text-[10px] mt-0.5">適用於 Facebook / Threads / LINE 社群</p>
          </div>
          {hasSocial && ma.socialPost && (
            <button onClick={() => copyToClipboard(buildSocialFullPost(ma), '已複製社群貼文')} className="px-3 py-1.5 bg-foreground-900 hover:bg-foreground-800 text-white text-xs rounded-lg transition-colors whitespace-nowrap cursor-pointer">
              <i className="ri-file-copy-line mr-1"></i>複製完整貼文
            </button>
          )}
        </div>
        {hasSocial && ma.socialPost ? (
          <div className="space-y-2">
            <ScriptRow label="標題" value={ma.socialPost.title as string} icon="ri-hashtag" highlight copyFn={copyToClipboard} />
            {Array.isArray(ma.socialPost.three_points) && (ma.socialPost.three_points as string[]).length > 0 && (
              <div className="bg-background-50 rounded-lg p-3 border border-background-100">
                <p className="text-foreground-400 text-[10px] uppercase tracking-wider mb-2">三個重點</p>
                <ul className="space-y-1">
                  {(ma.socialPost.three_points as string[]).map((p, i) => (
                    <li key={i} className="text-foreground-700 text-xs flex items-start gap-2">
                      <span className="w-4 h-4 rounded-full bg-foreground-900 text-white flex items-center justify-center text-[9px] font-bold flex-shrink-0 mt-0.5">{i + 1}</span>
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <ScriptRow label="風險提醒" value={ma.socialPost.risk_reminder as string} icon="ri-alert-line" tone="warn" copyFn={copyToClipboard} />
            <ScriptRow label="CTA" value={ma.socialPost.cta as string} icon="ri-thumb-up-line" tone="accent" copyFn={copyToClipboard} />
          </div>
        ) : (
          <p className="text-foreground-400 text-xs py-4 text-center">社群貼文尚未產生，請確認今日報告已生成完整 ai_strategy_json。</p>
        )}
      </div>

      {/* ── 3. LINE Push ── */}
      <div className="bg-white border border-background-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-foreground-900 font-semibold text-sm">LINE 推播文案</h3>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border whitespace-nowrap ${
                hasLine ? 'bg-emerald-500/5 text-emerald-600 border-emerald-500/15' : 'bg-background-50 text-foreground-400 border-background-200'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${hasLine ? 'bg-emerald-500' : 'bg-foreground-300'}`}></span>
                {hasLine ? '可用' : 'LINE 尚未接入'}
              </span>
            </div>
            {!hasLine && <p className="text-foreground-400 text-[10px] mt-0.5">LINE 推播模組尚未接入，不影響每日內容公開。</p>}
          </div>
          {hasLine && ma.lineCopy && (
            <button onClick={() => copyToClipboard(buildLineFullText(ma), '已複製 LINE 文案')} className="px-3 py-1.5 bg-foreground-900 hover:bg-foreground-800 text-white text-xs rounded-lg transition-colors whitespace-nowrap cursor-pointer">
              <i className="ri-file-copy-line mr-1"></i>複製 LINE 文案
            </button>
          )}
        </div>
        {hasLine && ma.lineCopy ? (
          <div className="space-y-2">
            <ScriptRow label="推播標題" value={ma.lineCopy.title as string} icon="ri-hashtag" copyFn={copyToClipboard} />
            <ScriptRow label="一句話" value={ma.lineCopy.one_sentence as string} icon="ri-message-2-line" copyFn={copyToClipboard} />
            <ScriptRow label="今日不要做" value={ma.lineCopy.do_not_do as string} icon="ri-close-circle-line" tone="warn" copyFn={copyToClipboard} />
            <ScriptRow label="觀察重點" value={ma.lineCopy.watch_point as string} icon="ri-eye-line" copyFn={copyToClipboard} />
            <ScriptRow label="CTA" value={ma.lineCopy.cta as string} icon="ri-thumb-up-line" tone="accent" copyFn={copyToClipboard} />
          </div>
        ) : (
          <p className="text-foreground-400 text-xs py-4 text-center">LINE 推播文案尚未接入，不影響今日內容公開。</p>
        )}
      </div>

      {/* Quick links */}
      <div className="bg-white border border-background-200 rounded-xl p-5">
        <h3 className="text-foreground-900 font-semibold text-sm mb-3">快速操作</h3>
        <div className="flex flex-wrap gap-2">
          <Link to="/admin/today-content" className="px-4 py-2 bg-background-100 hover:bg-background-200 text-foreground-700 text-sm rounded-lg transition-colors whitespace-nowrap">
            <i className="ri-arrow-left-line mr-1.5"></i>回到今日內容
          </Link>
          <Link to="/" className="px-4 py-2 bg-background-100 hover:bg-background-200 text-foreground-700 text-sm rounded-lg transition-colors whitespace-nowrap">
            <i className="ri-eye-line mr-1.5"></i>前往公開頁
          </Link>
          {ma.canPublish && (
            <Link to="/report/today" className="px-4 py-2 bg-emerald-500/8 hover:bg-emerald-500/12 text-emerald-600 text-sm rounded-lg transition-colors whitespace-nowrap">
              <i className="ri-line-chart-line mr-1.5"></i>查看今日盤前判斷
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ───

function buildReelsFullScript(ma: MorningAlphaNormalizedReport): string {
  const rs = ma.reelsScript;
  if (!rs) return '';
  const parts: string[] = [];
  parts.push('【開場 0–5 秒：一句鉤子】');
  parts.push(String(rs.hook_0_5_sec || ''));
  parts.push('');
  parts.push('【核心 5–25 秒：今天主劇本】');
  parts.push(String(rs.core_5_25_sec || ''));
  parts.push('');
  parts.push('【風險 25–40 秒：今天不要做什麼】');
  parts.push(String(rs.risk_25_40_sec || ''));
  parts.push('');
  parts.push('【觀察 40–55 秒：今天看誰】');
  parts.push(String(rs.watch_40_55_sec || ''));
  parts.push('');
  parts.push('【收尾 55–60 秒：提醒】');
  parts.push(String(rs.cta_55_60_sec || ''));
  if (rs.full_script && typeof rs.full_script === 'string') return rs.full_script;
  return parts.join('\n');
}

function buildSocialFullPost(ma: MorningAlphaNormalizedReport): string {
  const sp = ma.socialPost;
  if (!sp) return '';
  if (sp.full_post && typeof sp.full_post === 'string' && sp.full_post.trim().length > 10) return sp.full_post;
  const lines: string[] = [];
  lines.push(String(sp.title || ''));
  lines.push('');
  if (Array.isArray(sp.three_points)) {
    (sp.three_points as string[]).slice(0, 3).forEach((p, i) => lines.push(`${i + 1}️⃣ ${p}`));
  }
  lines.push('');
  if (sp.risk_reminder) lines.push(`⚠️ ${sp.risk_reminder}`);
  lines.push('');
  lines.push(String(sp.cta || ''));
  return lines.join('\n');
}

function buildLineFullText(ma: MorningAlphaNormalizedReport): string {
  const lp = ma.lineCopy;
  if (!lp) return '';
  const lines: string[] = [];
  lines.push('【Morning Alpha 今日盤前】');
  lines.push(`📌 ${String(lp.title || '今日盤前')}`);
  lines.push(`📝 ${String(lp.one_sentence || '')}`);
  lines.push('');
  if (lp.do_not_do) lines.push(`🚫 ${lp.do_not_do}`);
  if (lp.watch_point) lines.push(`🔍 ${lp.watch_point}`);
  lines.push('');
  lines.push(String(lp.cta || ''));
  return lines.join('\n');
}

function ScriptRow({ label, time, value, icon, tone, highlight, copyFn }: { label: string; time?: string; value?: string | null; icon: string; tone?: 'warn' | 'accent'; highlight?: boolean; copyFn: (text: string, label: string) => void }) {
  if (!value) return null;
  const borderColor = tone === 'warn' ? 'border-rose-500/10' : tone === 'accent' ? 'border-primary-500/10' : highlight ? 'border-primary-500/10' : 'border-background-100';
  const bgColor = highlight ? 'bg-primary-500/5' : 'bg-background-50';
  return (
    <div className={`rounded-lg border ${borderColor} ${bgColor} p-3`}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <i className={`${icon} ${tone === 'warn' ? 'text-rose-500' : 'text-foreground-500'} text-sm`}></i>
          <span className="text-foreground-500 text-xs font-medium">{label}</span>
          {time && <span className="text-foreground-400 text-[10px] bg-white px-1.5 py-0.5 rounded-full">{time}</span>}
        </div>
        <button onClick={() => copyFn(value, `已複製 ${label}`)} className="px-2 py-1 bg-white border border-background-200 hover:border-background-300 rounded-md text-foreground-400 hover:text-foreground-600 text-[10px] transition-colors cursor-pointer whitespace-nowrap">
          <i className="ri-file-copy-line mr-1"></i>複製
        </button>
      </div>
      <p className="text-foreground-700 text-sm leading-relaxed whitespace-pre-wrap">{value}</p>
    </div>
  );
}
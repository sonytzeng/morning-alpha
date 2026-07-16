import { useState, useCallback } from 'react';
import { trackEvent } from '@/utils/analytics';
import { showToast } from '@/utils/toast';
import type { Report } from '@/types/report';
import { formatTaipeiDate } from '@/utils/tradingDay';

const REPORT_TODAY_URL = 'https://morningalphatw.com/report/today';

function getShareLocation(): string {
  if (typeof window === 'undefined') return 'unknown';
  const path = window.location.pathname;
  if (path === '/' || path === '') return 'home';
  if (path.includes('/report/today')) return 'report_today';
  if (path.includes('/pricing')) return 'pricing';
  if (path.includes('/account')) return 'account';
  return 'other';
}

interface UseShareQuoteOptions {
  report: Report | null;
}

export function useShareQuote({ report }: UseShareQuoteOptions) {
  const [copied, setCopied] = useState(false);
  const [shareImageUrl, setShareImageUrl] = useState<string | null>(null);
  const [generatingImage, setGeneratingImage] = useState(false);

  const bias = report?.market_bias || '震盪';
  const score = report?.confidence_score ?? 50;
  const quote = report?.today_quote || report?.summary || '今日市場觀察中...';
  const date = report?.report_date || formatTaipeiDate();

  const buildShareText = useCallback(() => {
    return `「${quote}」\n\n來源：Morning Alpha\n查看今日 AI 觀察：${REPORT_TODAY_URL}`;
  }, [quote]);

  const buildShareTextForSocial = useCallback(() => {
    return `${quote}\n\nMorning Alpha｜今日 AI 觀察\n${REPORT_TODAY_URL}`;
  }, [quote]);

  const copyToClipboard = useCallback(async () => {
    const text = buildShareText();
    const location = getShareLocation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      showToast('已複製，可以貼到 LINE 或社群分享。', 'success');
      trackEvent('copy_quote', { location });
      setTimeout(() => setCopied(false), 2000);
      return true;
    } catch {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const success = document.execCommand('copy');
        document.body.removeChild(textarea);
        if (success) {
          setCopied(true);
          showToast('已複製，可以貼到 LINE 或社群分享。', 'success');
          trackEvent('copy_quote', { location, method: 'fallback' });
          setTimeout(() => setCopied(false), 2000);
          return true;
        }
      } catch {
        // fallback failed
      }
      showToast('複製失敗，請稍後再試。', 'error');
      trackEvent('copy_quote', { location, status: 'failed' });
      return false;
    }
  }, [buildShareText]);

  const shareToX = useCallback(() => {
    const location = getShareLocation();
    const text = `${quote}\n\nMorning Alpha｜今日 AI 觀察`;
    const shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(REPORT_TODAY_URL)}`;
    window.open(shareUrl, '_blank', 'noopener,noreferrer');
    trackEvent('share_to_x', { location });
  }, [quote]);

  const shareToThreads = useCallback(async () => {
    const location = getShareLocation();
    const shareText = buildShareTextForSocial();

    // Try native Web Share API first (works on mobile for Threads app)
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: 'Morning Alpha 今日 AI 觀察',
          text: quote,
          url: REPORT_TODAY_URL,
        });
        trackEvent('share_to_threads', { location, method: 'native_share' });
        return;
      } catch (err) {
        // User cancelled — don't fallback
        if ((err as Error).name === 'AbortError') {
          return;
        }
      }
    }

    // Fallback: copy to clipboard
    try {
      await navigator.clipboard.writeText(shareText);
      showToast('已複製分享文字，請貼到 Threads。', 'success');
      trackEvent('share_to_threads', { location, method: 'clipboard_fallback' });
    } catch {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = shareText;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const success = document.execCommand('copy');
        document.body.removeChild(textarea);
        if (success) {
          showToast('已複製分享文字，請貼到 Threads。', 'success');
          trackEvent('share_to_threads', { location, method: 'clipboard_fallback_legacy' });
        } else {
          showToast('複製失敗，請稍後再試。', 'error');
          trackEvent('share_to_threads', { location, status: 'failed' });
        }
      } catch {
        showToast('複製失敗，請稍後再試。', 'error');
        trackEvent('share_to_threads', { location, status: 'failed' });
      }
    }
  }, [quote, buildShareTextForSocial]);

  const generateShareImage = useCallback(() => {
    const location = getShareLocation();
    setGeneratingImage(true);
    trackEvent('generate_share_card', { location, action: 'start' });

    // Use canvas to generate a premium black card
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 630;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setGeneratingImage(false);
      showToast('圖卡生成失敗，請稍後再試。', 'error');
      trackEvent('generate_share_card', { location, status: 'failed' });
      return;
    }

    // Background
    ctx.fillStyle = '#0a1120';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Subtle gradient overlay
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, 'rgba(16, 37, 31, 0.3)');
    gradient.addColorStop(1, 'rgba(31, 41, 55, 0.1)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Decorative line
    ctx.strokeStyle = '#334e68';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(80, 80);
    ctx.lineTo(200, 80);
    ctx.stroke();

    // Brand
    ctx.font = '400 18px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = '#627d98';
    ctx.fillText('MORNING ALPHA · AI 盤前軍師', 80, 120);

    // Date
    ctx.font = '400 16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = '#486581';
    ctx.fillText(date, 80, 150);

    // Quote
    ctx.font = '700 42px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = '#ffffff';
    const maxWidth = 1040;
    const lineHeight = 56;
    const words = quote.split('');
    let line = '';
    let y = 240;

    for (let i = 0; i < words.length; i++) {
      const testLine = line + words[i];
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && i > 0) {
        ctx.fillText(line, 80, y);
        line = words[i];
        y += lineHeight;
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line, 80, y);

    // Bottom info
    const biasColor = bias.includes('偏多') ? '#34d399' : bias.includes('偏空') ? '#f87171' : '#fbbf24';
    ctx.font = '500 18px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = biasColor;
    ctx.fillText(`${bias} · 把握度 ${score}/100`, 80, 520);

    // URL
    ctx.font = '400 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = '#334e68';
    ctx.fillText(REPORT_TODAY_URL.replace(/^https?:\/\//, ''), 80, 550);

    // Convert to data URL
    const dataUrl = canvas.toDataURL('image/png');
    setShareImageUrl(dataUrl);
    setGeneratingImage(false);
    showToast('圖卡已生成，長按或點擊下載儲存。', 'success');
    trackEvent('generate_share_card', { location, status: 'success' });
  }, [bias, score, quote, date]);

  const downloadImage = useCallback(() => {
    if (!shareImageUrl) return;
    const location = getShareLocation();
    const link = document.createElement('a');
    link.download = `morning-alpha-${date}.png`;
    link.href = shareImageUrl;
    link.click();
    trackEvent('download_share_card', { location });
  }, [shareImageUrl, date]);

  return {
    copied,
    copyToClipboard,
    shareToX,
    shareToThreads,
    generateShareImage,
    downloadImage,
    shareImageUrl,
    generatingImage,
    quote,
    date,
    bias,
    score,
  };
}

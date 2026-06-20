import { useState, useCallback } from 'react';

export interface ShareData {
  date: string;
  bias: string;
  score: number;
  soulSentence: string;
  url: string;
}

export function useShareReport() {
  const [copied, setCopied] = useState(false);

  const buildShareText = useCallback((data: ShareData): string => {
    const safeUrl = data.url || window.location.href;
    return [
      `Morning Alpha`,
      `${data.date} 今日 AI 觀察`,
      '',
      `市場情緒：${data.bias}`,
      `AI 判讀把握度：${data.score}/100`,
      '',
      `AI 提醒：`,
      `${data.soulSentence}`,
      '',
      safeUrl,
    ].join('\n');
  }, []);

  const copyToClipboard = useCallback(
    async (data: ShareData): Promise<boolean> => {
      try {
        const text = buildShareText(data);
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        return true;
      } catch {
        // Fallback
        try {
          const text = buildShareText(data);
          const textarea = document.createElement('textarea');
          textarea.value = text;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.select();
          const ok = document.execCommand('copy');
          document.body.removeChild(textarea);
          if (ok) {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }
          return ok;
        } catch {
          return false;
        }
      }
    },
    [buildShareText]
  );

  return { copied, copyToClipboard, buildShareText };
}
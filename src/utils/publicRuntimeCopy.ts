import { naturalizeSyntheticResearchSentence } from './publicResearchText.ts';

const CHECKPOINT_LABELS: Record<string, string> = {
  '0930': '09:30 開盤驗證',
  '1030': '10:30 主線確認',
  '1300': '13:00 盤中追蹤',
  '1420': '14:20 收盤驗證',
};

function checkpointLabel(hours: string, minutes: string): string {
  const key = `${hours.padStart(2, '0')}${minutes.padStart(2, '0')}`;
  return CHECKPOINT_LABELS[key] || `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')} 驗證`;
}

export function humanizePublicRuntimeText(value: unknown): string {
  const input = String(value ?? '').trim();
  if (!input) return '';

  const withoutDiagnosticSentence = input.replace(
    /checkpoint\s*(\d{2}):?(\d{2})\s*缺少同日、同\s*phase\s*且在\s*freshness window\s*內的完整\s*TAIEX\s*[／/]\s*TXF\s*[／/]\s*(?:2330(?:\s*[／/]\s*台積電)?)\s*快照[。.]?/gi,
    (_match, hours: string, minutes: string) => `${checkpointLabel(hours, minutes)}資料不完整：加權指數、台指期與台積電快照沒有在同一交易日與有效時間內到齊；資料補齊前不更新判斷。`,
  );

  return naturalizeSyntheticResearchSentence(withoutDiagnosticSentence
    .replace(/Runtime checkpoint/gi, '盤中驗證節點')
    .replace(/checkpoint\s*(\d{2}):?(\d{2})/gi, (_match, hours: string, minutes: string) => checkpointLabel(hours, minutes))
    .replace(/freshness window/gi, '有效時間範圍')
    .replace(/same\s+phase/gi, '同一資料階段')
    .replace(/同\s*phase/gi, '同一資料階段')
    .replace(/\bphase\b/gi, '資料階段')
    .replace(/\bSEMICONDUCTOR\b/gi, '半導體')
    .replace(/\bMEMORY\b/gi, '記憶體')
    .replace(/\bELECTRONICS\b/gi, '電子')
    .replace(/\bFINANCIAL\b/gi, '金融')
    .replace(/\bDEFENSIVE\b/gi, '防禦型族群')
    .replace(/\bPETROCHEMICAL\b/gi, '塑化')
    .replace(/\bSHIPPING\b/gi, '航運')
    .replace(/\bAI[ _-]?SERVER\b/gi, 'AI 伺服器族群')
    .replace(/\bTAIEX\b/gi, '加權指數')
    .replace(/\bTXF\b/gi, '台指期')
    .replace(/\b2330\b(?!\s*[／/])/g, '2330／台積電')
    .replace(/\bADR\b/gi, '海外存託憑證')
    .replace(/\bRuntime\b/gi, '盤中資料')
    .replace(/\bunknown\b/gi, '尚未取得')
    .replace(/\bpending\b/gi, '等待驗證')
    .replace(/\s+/g, ' ')
    .trim());
}

export function naturalizeSyntheticResearchSentence(value: string): string {
  const text = value.trim();
  const match = text.match(/^今天要驗證的是\s*(.+?)\s*能否從.+?傳導到台股代表(?:個)?股[。.]?$/);
  if (!match?.[1]) return text;
  return `${match[1].trim()}是今天的主要觀察方向，先等市場承接確認。`;
}
